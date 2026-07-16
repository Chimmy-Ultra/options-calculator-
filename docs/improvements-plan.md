# Improvements Batch — execution spec

> **Status (2026-07-16): PENDING — not started.** Scope settled with the owner.
> Eight increments: ① state persistence ② live auto-refresh + freshness stamp
> ③ per-leg expiry ④ IB positions import ⑤ fees & tax ⑥ chain BUY/SELL popover
> ⑦ 3D surface auto-rotate fix ⑧ in-app help drawer (English).
> **Mobile design port is explicitly OUT of this batch** (next batch, own plan).

**Read `CLAUDE.md` first.** Zero-build Babel frontend, `window.*` globals, no
imports, Taiwan colors (red = calls, teal = puts — never "fix"), all product
facts come from the product object `P` (never hardcode TXO values), `.js`
files must stay `.js`.

## Ground rules (owner decisions, settled 2026-07-16)

1. **Everything lands on branch `claude/repo-status-check-0l17ql`** (restarted
   from `main` after PR #19). One batch, one draft PR at the end. Do NOT
   merge; the owner merges.
2. **English only** for commits, PR text, new code comments, and ALL new UI
   copy. One concern per commit (roughly one commit per increment).
3. **Desktop-only for new UI** (help drawer, popover, timestamp chip). Shared
   logic (persistence, refresh, per-leg math, fees) naturally reaches mobile —
   that is fine; just don't restyle mobile.
4. The 3D P&L surface in Calculator **stays** (owner likes it). Only fix its
   auto-rotate behavior (⑦) and explain it in the help drawer (⑧).
5. Bump `CACHE_VERSION` in service-worker.js to `options-lab-v28` once for the
   whole batch.
6. Suggested order: ① ② ⑦ are independent; do ③ **before** ④ (positions
   import needs per-leg expiry); ⑤ ⑥ ⑧ anytime after ③.

## Increment ① — persist state to localStorage

Today a refresh loses everything (only tweaks-panel and `ibProxyBase` use
localStorage). Persist the working state:

- Single key `optionsLab.v1`, JSON:
  `{ productId, expiryId, workspace, theme, spot, iv, legsByProduct }` where
  `legsByProduct` is `{ [productId]: legs[] }` (legs are plain JSON already).
- **Save**: one `useEffect` in `Obsidian3` watching those states, debounced
  ~400 ms, wrapped in try/catch (quota / private mode must never crash).
- **Restore**: lazy `useState` initializers in `Obsidian3` reading the key
  once. Validate hard, fall back to current defaults on any doubt:
  - `productId` must exist in `window.PRODUCTS`, else `'txo'`.
  - `expiryId` must exist in that product's expiry list, else first expiry.
  - each leg: `side`∈{long,short}, `type`∈{call,put}, finite `strike`,
    `premium`, `qty` ≥ 1; `dte` optional (see ③ — tolerate missing). Drop bad
    legs; if the array ends up empty use `defaultLegsFor`.
  - clamp `spot`/`iv` to `P.spotMin/Max`, `P.ivMin/Max`.
- Live products: the quote effect already overwrites `spot` when IB connects —
  keep that (restored spot is just the starting value).
- Do NOT persist tweaks (own system), `whatIfOpen`, or hover state.

## Increment ② — live data auto-refresh + freshness stamp

Live quotes/chains are fetched once per product/expiry switch and never again
(no polling anywhere; effects at `obsidian3.jsx` ~320/341). Ten minutes later
the screen silently shows ten-minute-old prices.

- New effect in `Obsidian3`, active only when `live && P.ib`:
  - refetch `LiveData.quote(P.id)` every **10 s**; on success update spot/chg
    (same mapping as the initial fetch) and set `lastLiveAt = Date.now()`.
  - refetch `LiveData.chain(P.id, expiryId)` every **30 s**; on success
    `setLiveRows(rows)` (same shape, so the table just re-renders).
  - Pause while `document.hidden`; on `visibilitychange` → visible, refetch
    immediately. Clear both intervals on cleanup (product/expiry change).
  - Expiries stay one-shot (they don't change intraday).
- **Freshness chip** in the desktop top bar next to `DataQualityPill`
  (live products only): mono 9px `HH:MM:SS` of `lastLiveAt`. If a refetch
  returns null OR `now − lastLiveAt > 45 s`, render it amber with a `STALE`
  label at opacity .8; normal state opacity .5. A 1 s ticker interval just for
  the chip is fine (keep it in a tiny component so only the chip re-renders).
- Mock mode: no chip, no polling (nothing to refresh).

## Increment ③ — per-leg expiry (calendars / diagonals become possible)

Today every math call shares one global `dte`, so a calendar spread is
impossible to model. Legs gain an optional `dte`.

- **Leg shape**: `{ side, type, strike, premium, qty, dte? }`. `_mkLeg`
  (obsidian3.jsx:1083) already receives `dte` — store it on the leg. Legs
  without `dte` (old persisted state) fall back to the global `dte`.
- **New helper in atoms.jsx** (single source of truth, export on window like
  the other math fns):
  ```js
  // Value the portfolio in points after `daysElapsed` days.
  // Each leg's remaining life T = max((leg.dte ?? globalDte) - daysElapsed, 0);
  // T === 0 → intrinsic value, else bsPrice at the workspace IV.
  function portfolioValuePts(legs, S, ivPct, daysElapsed, globalDte, r, model)
  ```
  Per-leg IV is out of scope — the workspace IV slider applies to all legs
  (leave a one-line comment saying so).
- **Horizon convention**: the "at expiry" curve/metrics are evaluated at the
  FRONT expiry `T0 = min(leg.dte ?? globalDte)`. Back-month legs keep time
  value at T0 (priced with `bsPrice` at `legDte − T0`). The time slider
  (`sliceFrac`) maps to `daysElapsed = sliceFrac * T0`.
- **Call sites to migrate** onto the helper / per-leg T (verify each still
  matches current output when all legs share one dte — that's the regression
  guard): `pnlPts`/`pnlNTD` memo in Obsidian3, `PayoffChart` (expiry + now
  lines, breakevens), `pnlDistribution` (terminal S distribution uses T0),
  `legGreeks`/`portfolioGreeks` (use `leg.dte ?? dte`), `GreeksProfile`,
  `CrossSection`, `PnLAttribution`, and the Calculator `Surface3DMount` data
  grid (time axis runs 0 → T0).
- **LegEditor UI**: each leg row gains a compact expiry `<select>` listing the
  workspace expiry list (`W1 4d / M 11d / …`, value = dte). A leg whose `dte`
  (e.g. from IB import) matches no listed expiry renders as an extra
  `{n}d` option. Default for new legs = currently selected expiry.
- `STRATEGY_LIBRARY` builders keep single-expiry (all legs get the current
  dte) — no new strategies this batch.

## Increment ④ — import real positions from IB (after ③)

The server already talks to TWS; add read-only position import so the
portfolio P&L/Greeks reflect reality instead of hand-typed legs.

- **server/main.py**: new `GET /api/positions/{pid}`:
  - `await _ensure_connected()`; use `ib.portfolio()` (has `averageCost`).
  - Filter: `contract.secType == 'FOP'` and `tradingClass` (fallback
    `symbol`) matching `PRODUCTS[pid]`.
  - Map each item: `type` = right C/P → call/put; `side` = position sign
    (long/short), `qty = abs(position)`; `strike`;
    `premium = averageCost / float(contract.multiplier)` (points, matching
    the frontend's premium convention); `expiry` = lastTradeDate `YYYYMMDD`;
    `dte` = calendar days from today (same date math as `/api/expiries`).
  - Return `{ positions: [...] }` (empty list is a valid answer). Short cache
    TTL (~10 s). Server stays **read-only** — no order endpoints, ever.
- **data-live.js**: `positions: (pid) => get('/api/positions/' + encodeURIComponent(pid), 8000)`
  — null on failure, house pattern.
- **Frontend** (desktop Legs panel, `CalcWorkspace`): next to `+ leg` add a
  mini button `⟳ IB` (render only when `live && P.ib`). On click: fetch;
  non-empty → `setLegs(mapped)` (replace — they ARE the real positions) and
  show a transient inline note `{n} positions loaded`; null/empty → note
  `no IB positions`. Imported legs carry real `premium` (avg entry) and real
  per-leg `dte`, so "P&L now" becomes actual unrealized P&L.

## Increment ⑤ — commission & tax in P&L

- **products.js**: every product gains
  `fees: { perSide: <currency per contract per side>, taxRate: <rate on premium notional per side> }`.
  Defaults (comment: broker-dependent, owner should tune):
  - TXO: `{ perSide: 20, taxRate: 0.001 }` (NT$20 brokerage; 0.1% futures
    transaction tax on premium × mult).
  - All CBOT/CME/NYMEX/COMEX products: `{ perSide: 2.5, taxRate: 0 }`
    (IB commission + exchange fees, rough all-in).
- **atoms.jsx** helper: `estFees(legs, P)` → round-trip estimate in currency:
  `Σ qty × (2 × perSide + 2 × taxRate × premium × P.mult)` (exit tax
  approximated with entry premium; comment that).
- **UI**: in the Calculator "P&L now" card and the Chain "P&L what-if" card,
  the hero P&L and the Max profit / Max loss tiles become **net of fees**;
  add a 9px caption `incl. est. fees {cur}{X}`. Charts stay gross (they show
  the theoretical structure; a one-line comment at the estFees call sites).

## Increment ⑥ — chain click → BUY / SELL popover

`cellClick` (option-chain.jsx:82) hardcodes `side: 'long'` — sellers must
edit every leg after adding. Desktop `OptionChain` only:

- Click no longer adds immediately; it opens a small popover anchored at the
  clicked cell (component-local state `{ strike, side, opt, x, y }`).
- Popover: Glass-style card, caption `{strike} {CALL|PUT} @ {last}` (use
  `fmtPx`/`fmtStrike`), two buttons: `BUY` (gold `#f0c068`, dark text) and
  `SELL` (blue `#5fa3d4`, dark text). Click → `onAddLeg({ side: long|short,
  type, strike, premium: opt.last, qty: 1, dte: <current expiry dte> })`
  (pass the current dte down — after ③ legs carry it). Esc or click-outside
  closes. Keep the existing hover highlight behavior.
- `MobileChainTable` untouched.

## Increment ⑦ — 3D surface: stop auto-rotate after user interaction

Owner: keeps the surface, but "it starts spinning again when I let go".

- `surface3d.js` ~381: `if (!isTouch && idleTime > 1.5) orbit.az += dt * 0.04;`
  — add a `userMoved` flag set on the first pointer drag that changes the
  orbit; condition becomes `!isTouch && !userMoved && idleTime > 1.5`.
  So: gentle idle spin until the user grabs it once, then it stays where
  they left it (per mount; a remount may spin again — acceptable).
- Check `iv-surface.js` for the same idle-spin pattern; if present, apply the
  identical fix.

## Increment ⑧ — in-app help drawer (English, hideable)

Owner: "I don't really know how to read these — write an English tutorial
inside the app, must be hideable."

- **New file `design_handoff_options_lab/help.jsx`** (Babel .jsx):
  `window.HelpDrawer = ({ open, onClose, workspace, theme }) => ...` plus a
  `HELP_SECTIONS` data array. Register it in `index.html`
  (`<script type="text/babel" src="help.jsx">` before obsidian3.jsx) and in
  the service-worker `APP_SHELL`.
- **Trigger**: a `?` chip in the desktop top bar (after the theme toggle),
  toggles `helpOpen` state in `Obsidian3`. Desktop only (hide on
  phone/fold viewports).
- **Drawer**: fixed right side (`right:24; top:110; bottom:20; width:320`),
  Glass2 raised, `overflow-y:auto`, `×` close button, Esc closes,
  z-index above panels. On open, scroll to the section matching the current
  `workspace`.
- **Sections** (all copy in plain English, 1–3 sentences per concept,
  written for a non-quant):
  - *Option chain*: what OI / VOL / Δ / IV / BID·ASK columns mean; the spot
    line; click a price to add a leg; BUY/SELL badges are your positions.
  - *Calculator — 3D P&L surface* (owner explicitly asked): "Horizontal axis =
    underlying price, depth axis = days passing (front edge = today, back
    edge = expiry), height & color = profit or loss of your current legs.
    Hover to read exact numbers; drag to orbit, scroll to zoom."
  - *Payoff chart*: solid line = P&L at expiry, faint line = P&L today,
    breakevens, the shaded cone = ±1σ/±2σ expected move.
  - *Greeks*: one-liners for Δ Γ Θ V ρ ("Δ: how much the position gains per
    1-point move of the underlying", etc.).
  - *P&L distribution & POP*: probability-weighted outcomes; POP = chance of
    any profit at expiry.
  - *What-if rail*: sliders re-price everything at a hypothetical spot/IV.
  - *IV surface*: strike × expiry × IV; smile/skew in one sentence
    (grains skew to calls, TXO to puts).
- Content lives in `HELP_SECTIONS`; Opus writes the full copy following the
  bullets above.

## CLAUDE.md updates (same batch, last commit)

- Persistence: note the `optionsLab.v1` localStorage key.
- Products: note the `fees` field and the per-leg `dte` on legs.
- Server: add `/api/positions/{pid}` to the endpoint list; re-state that the
  server is read-only market data + positions, no orders.
- Files: add `help.jsx` to the extension notes (it's a Babel .jsx).

## Verification (required before pushing each commit)

No test suite — verify in a real browser (see the session scratchpad's
existing setup: `vpricer.js` et al.):

1. `npm i react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0 three@0.160.0`
   in a scratch dir; Playwright with `executablePath /opt/pw-browsers/chromium`,
   proxy bypass `127.0.0.1,localhost`, and `ctx.route('https://unpkg.com/**')`
   fulfilled from the npm copies.
2. Static server from `design_handoff_options_lab/`; for live-mode tests run a
   stub proxy on :8720 (extend it with `/api/positions/{pid}` returning 2–3
   fake FOP positions across two expiries).
3. Per-increment checks, dark AND light, zero console/page errors, screenshots:
   - ①: build a strangle, set product GC, reload → everything restored;
     corrupt the key with garbage JSON → app boots with defaults.
   - ②: stub proxy live → timestamp chip ticks; kill the stub → STALE within
     45 s; mock products show no chip.
   - ③: two legs on different expiries → payoff chart, Greeks, distribution,
     3D surface all render, time slider runs to the FRONT expiry; single-expiry
     portfolios produce numbers identical to before the change.
   - ④: `⟳ IB` visible only in live mode; click loads stub positions with
     correct side/qty/premium/dte; P&L now reflects entry premiums.
   - ⑤: fees line shows in both P&L cards; net = gross − estFees by hand-check.
   - ⑥: click chain cell → popover; BUY adds long, SELL adds short; badges
     update; Esc closes.
   - ⑦: drag the Calculator 3D surface, release, wait 5 s → no spin; fresh
     reload → idle spin still present before first drag.
   - ⑧: `?` opens drawer scrolled to current tab's section; Esc/× closes;
     hidden on ~390px viewport.

## Endgame

- One draft PR (English title/body) covering the batch on
  `claude/repo-status-check-0l17ql`. Leave as draft; the owner merges.
- Mark increments done in this file's status header in the final commit.
