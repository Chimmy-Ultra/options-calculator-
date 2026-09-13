# CLAUDE.md

Behavioral guidelines + project facts for Claude Code working in this repo.
First half is Karpathy's universal rules. Second half is what's specific to **TXO Options Lab**.

**Tradeoff:** These bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables YOUR changes made unused — leave pre-existing dead code alone unless asked.

The test: every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

- "Fix the bug" → reproduce it first, then fix, then confirm the repro is gone.
- "Add a feature" → state the visible outcome and how you'll see it (which screen, which value, which interaction).
- For multi-step work, write a 3-line plan with a verify step per item.

---

## Project facts — read before editing

This is **not a typical React app.** Skim these before touching code, or you'll waste a turn.

### Stack

- **Babel Standalone in the browser.** No build step, no bundler, no `package.json`, no `node_modules`. React + Three.js loaded from CDN in `index.html`.
- Entry point: `design_handoff_options_lab/index.html`. Vercel serves that directory (see `vercel.json`).
- Deployed as a real app — despite the `design_handoff_*` directory name and the README's "design reference, do not ship" note, this is the shipped product. Treat it as production.

### File extensions matter — do not rename casually

- `.jsx` files are loaded with `<script type="text/babel">` and parsed by Babel. They use JSX syntax. (`atoms.jsx`, `charts.jsx`, `option-chain.jsx`, `help.jsx`, `obsidian3.jsx`, `tweaks-panel.jsx` — `help.jsx` holds the in-app tooltips + help drawer.)
- `.js` files (`surface3d.js`, `iv-surface.js`, `service-worker.js`) are plain ES5/ES6, loaded as `<script src>`. **They must stay `.js`** — see commit `56009a0` ("rename plain-JS files to .js so CDN serves correct MIME"). Renaming breaks the CDN content-type and the file silently fails to execute.
- No `import`/`export`. Modules communicate via globals on `window` and shared React hooks (`const { useState, useEffect, useRef, useMemo } = React;` at the top of each `.jsx`).

### Don't introduce

- A build step (Vite, Webpack, Next.js, esbuild). The whole point of this prototype is zero-install.
- TypeScript, package managers, linters as files in the **frontend**. If you want types, use JSDoc comments inline. (`server/` is Python with its own `requirements.txt` — the one sanctioned exception.)
- Imports between modules. Add to the existing global / `window.*` pattern instead.
- New backends. All P&L / Greeks / IV math stays as pure frontend functions. The ONE backend is `server/` — a **read-only** market-data proxy with two sources, selected per product by `PRODUCTS[pid]["source"]` in `main.py`: `ib` (FastAPI + ib_async → local TWS/Gateway, futures options) and `sinopac` (Shioaji → 永豐金, TXO). Endpoints are source-agnostic: quote / expiries / chain / bars, plus account positions where the source supports it (`GET /api/positions/{pid}`). **Never** add order/trade endpoints. Shared option math lives in `server/pricing.py` so both sources invert IV identically. `shioaji` is an optional dependency — `sinopac.py` imports it lazily, so the IB-only path runs without it. The frontend must always work without the proxy: `data-live.js` (`window.LiveData`) returns `null` on any failure and everything falls back to mock.

### Products (multi-product since the IB integration)

Product specs live in `products.js` (`window.PRODUCTS` / `window.getProduct`). Every contract fact — multiplier, strike step, currency, pricing model, IV/spot ranges, expiries — must come from the product object `P`; never hardcode TXO values in shared components.

- **TXO** 台指選擇權 — Black-Scholes on spot (`model: 'bs'`), NT$, ×50/pt, strike step 50. Live via 永豐金 Shioaji (`live: 'sinopac'`); that feed has no open interest, so the liquidity score falls back to spread-only when a chain reports no OI anywhere.
- **ZC / ZS / ZW** CBOT 玉米/黃豆/小麥期貨選擇權 — **Black-76 on futures** (`model: 'b76'`), US$, 報價 cents/bushel, 5,000 bu → 1¢ = $50/口. Strike steps: ZC/ZW 10¢, ZS 20¢. `eighth: true` → quotes show 1/8-cent ticks (462.875). Grain IV smiles skew to CALLS (drought risk) — opposite of TXO's put skew (`P.skew`).
- **ES / GC / CL / NG** — S&P 500 E-mini, Gold, WTI Crude, Natural Gas futures options (Black-76, US$). Multipliers ×US$50/pt, ×US$100/oz, ×US$1,000/bbl, ×US$10,000/pt. NG uses fractional strikes (step 0.1) — the chain shows two-decimal strikes. These are registry-only entries: adding a product is a `products.js` entry plus a `server/main.py` `PRODUCTS` row; nothing else changes.
- Live data: each product declares its provider in `products.js` — `live: 'ib' | 'sinopac' | null` (the badge label comes from the `BROKER` map) and `livePositions: true` only where the source can return account positions. Products pull real quotes/expiries/chains via `server/` (see `server/README.md`); `LiveData.probe(pid)` asks about that product's own source, so a live badge never appears for a backend that isn't actually serving it. Live chain rows replace `genChain` mock rows but keep the same row shape — keep it that way. While connected, quotes re-poll every 10s and the chain every 30s (paused when the tab is hidden); a top-bar freshness chip goes amber `STALE` past 45s.
- **Open interest for TXO** comes from TAIFEX's daily report, not the broker: `server/taifex.py` reads the exchange's options CSV (per-strike 未沖銷契約數 + previous session for the change + expiry dates), `/api/chain/txo` merges it into the rows (`oi`, `oiChg`), and `/api/oi/txo?expiry=` serves the whole strike range with the max-OI strikes. Products opt in with `oiSource: 'taifex'` in `products.js`. It is the previous session's number by design ("yesterday's walls").
- **Positioning (籌碼) for TXO** is the same source: `taifex.market()` → `/api/market/txo` and the snapshot's `market` block — market-wide put/call OI ratio with ~23 sessions, 外資 net futures position in TX-equivalent contracts (TX + MTX/4 + TMF/20, the exchange's own conversion), and the top-10 traders' front-month net. All previous-session numbers.
- **關卡價 (range targets)** are computed client-side from the daily 日盤 bars (`liveDayBars`, fetched independently of the K-line toggles; the EOD snapshot's `bars` otherwise). Only the 一壘 rule is verified against 自由人's app; the other four levels are this site's statistics and the UI says so — don't present them as his formula. The proxy quotes carry `open / high / low` so a running session uses today's real range as the base.
- **權值股 TOP20** (關卡 tab panel): the twenty heaviest TAIEX constituents from TAIFEX's monthly 成分股暨市值比重 page (`taifex._fetch_weights`, 資料日期 shown) joined with the previous session's move from TWSE's 每日收盤行情 table (`_fetch_twse_daily`, `MI_INDEX?type=ALLBUT0999`, steps back over non-trading days and retries TWSE's rate-limit 307). Served by `/api/top20/txo` and stored in the snapshot's `top20` block. The list is never hardcoded — if either source fails the panel says so.
- **成本線 / 多空差額 (intraday)**: 成本線 = (session high + session low) ÷ 2, rounded half up — 自由人's own published formula, verified on three dated screenshots (docs §8); it is computed client-side from the same running high / low the 關卡價 use. 多空差額 = Σ per minute (外盤 − 內盤). `taifex.intraday()` builds 1-minute bars + both series from TAIFEX's daily tick file (`Daily_YYYY_MM_DD.zip`, ~two weeks kept, no bid/ask → tick-rule approximation, `flow: "tick-rule"`); `sinopac.intraday()` does the same from Shioaji ticks with the exchange's `tick_type` (`flow: "tick-type"`, exact) when a session is connected. `/api/intraday/txo?date=` prefers the exact path; the snapshot's `intraday` block feeds the deployed site. The panel header always says which it is — never present the tick-rule number as the exchange's 內外盤.
- **End-of-day snapshot**: `python3 server/taifex.py --write design_handoff_options_lab/taifex-eod.js` writes `window.TAIFEX_EOD` (index close, five expiries' chains with settlement premiums + OI, 權值股 TOP20, ~100 real TX daily bars in two series — `bars` = 日盤, `barsFull` = 全日盤 (night + day session of the same trading day; TAIFEX books the after-hours session under the next business day), positioning). The K-line's 日盤 / 全日盤 toggle and its MA5/10/20/60 legend live in `PriceChart` (`charts.jsx`); `LiveData.bars` takes `session: 'day' | 'full'`. `data-live.js` answers from it whenever the proxy could not, so the deployed site shows real previous-session data; the badge reads `● TAIFEX MM/DD EOD`. Pure ASCII, ~200 KB, committed; rebuild once per trading day.
- Each product also carries a `fees: { perSide, taxRate }` field (broker-dependent, tunable). `estFees(legs, P)` estimates round-trip commission + tax; the Calculator "P&L now" and Chain "P&L what-if" cards show P&L **net of fees**, charts stay gross.
- **Legs carry an optional per-leg `dte`** so calendars / diagonals work. Shared math values each leg at its own expiry and evaluates "at expiry" metrics at the front expiry `T0` (earliest leg) via `portfolioValuePts`. Legs without `dte` fall back to the workspace dte, so single-expiry portfolios are unchanged.

### Persistence & state

- Working state (product, expiry, workspace, theme, spot, IV, per-product legs) is saved to the `optionsLab.v1` localStorage key (debounced) and hard-validated on restore — corrupt / stale state falls back to defaults, never crashes. Tweaks, the What-if rail and hover are not persisted.
- In-app help: a `?` chip opens a per-workspace help drawer (`help.jsx`); Greek tiles and key labels have hover tooltips. A one-time "New here?" hint uses the `optionsLab.helpSeen` flag.

### TXO domain conventions (Taiwan index options)

These break Western intuition — get them wrong and the UI looks correct but means the opposite.

- **Calls are red, puts are teal/green.** This matches Taiwan T-quote convention (`#ef5350` calls, `#26a69a` puts), not the US convention. Don't "fix" it. Applies app-wide, including the US grain products.
- **Contract multiplier: ×50 NTD per index point.** P&L in NTD = points × 50.
- **Strikes are multiples of 50.** Strike inputs use `step=50`.
- **Spot default: 21,850. ATM IV default: 24%. IV slider range: 10–50%.**
- Expiries are weekly + monthly (W1/W2/M/W4). M+1 was removed in `bb2697b` — don't add it back.
- Pricing model: Black-Scholes for theoretical premiums everywhere (payoff chart, strategy library, +leg, P&L Now). See commits `f0f1ae2`, `1b7355d`. Don't introduce a separate pricing path — Black-76 for futures options is a `model` parameter on the SAME functions (`bsPrice` / `bsGreeks` / `legGreeks` / `portfolioGreeks`), not a second code path.

### Terminal skin and the panel grid (2026-09-13 redesign)

- The desktop shell is the owner's 交易終端風: flat `var(--panel)` panels with 1px `var(--border)` and square corners, system fonts (`--font-display` = 蘋方 / 微軟正黑體, `--font-mono` = the system sans with tabular figures — still no inline font stacks), a 44px top bar and a 36px expiry row. Palette lives in `tokens.css` (`--bg / --panel / --panel2 / --border / --text / --text2 / --muted / --gold`); `body.light` overrides the same variables. `Glass2` is the only panel primitive and `Eyebrow` inside it is the header bar (it bleeds to the edges via `--ppx/--ppy`). Don't reintroduce blur, glow or rounded chips.
- All desktop labels are Chinese (tabs 關卡 / 報價表 / K線 / 策略 / 實驗室). Expiry codes (SEP / W4 / F3) stay as TAIFEX names them; chips show 月選 / 天.
- Every desktop tab renders through `PanelGrid` (react-grid-layout from cdnjs, `window.ReactGridLayout`; panels stack if it fails to load). Panels are `{ i, title, right, hk, body, tone, pad }`; defaults per tab live in `GRID_DEFAULTS` (12 cols × 30px rows, 8px gutters). 調整版面 unlocks drag (by the header, `.pg-handle`) and resize; layouts persist per tab in `optionsLab.layout.v1`, 重設 clears that tab. When you add or rename a panel, give it a new `i` and a default — saved layouts are validated against the current panel set and fall back to defaults. Mobile is untouched.

### Typography and labels

- Fonts are the platform's own (no web fonts since the 2026-09 redesign): `--font-display` (蘋方 / 微軟正黑體 / Noto Sans TC / system-ui) and `--font-mono` (the system sans, used with tabular figures for numbers) in `tokens.css`. **Never write an inline font stack** — use `fontFamily: 'var(--font-mono)'` (numbers, codes) or inherit the body face. Every number column also gets `className="tnum"` (tabular figures).
- The Levels tab uses the Taiwanese day-trading vocabulary as its primary labels (現價 / 價平和 / 流失 / 壓力 / 支撐 / 外資淨未平倉 / 十大交易人 / P/C 比 / 關卡價 一壘…場外), modelled on 多空指南針's strip of big numbers (owner request, 2026-09). Since the redesign the other desktop tabs are Chinese too.

### Layouts

`useViewport()` in `atoms.jsx` classifies into `phone` (<640), `fold` (640–1023), `desk` (≥1024). Three real layouts, not just responsive CSS — desktop uses absolute positioning that breaks on phone. When changing a workspace, check all three.

### How to verify changes

There is no test suite. To verify:

1. Open `design_handoff_options_lab/index.html` directly in a browser, **or** run a static server from that directory.
2. Exercise the desktop workspaces: **Levels / Chain / Chart / Calculator / Lab** (Levels is the day-trading read — ATM straddle 價平和 band + max-OI 壓力/支撐 walls, ladder + K-line tags + OI table, plus the Western-tool readings added 2026-09: 關卡價 range targets (`computeRangeLevels`, see `docs/daytrade-redesign.md` §7 for what was verified), dealer gamma exposure per strike with Call/Put gamma walls and the zero-gamma flip (`computeGex`, SqueezeMetrics convention), max pain, a ±1σ expected-move tile, and a probability cone on the K-line. Calculator = legs + pricer on the left, the full-size payoff chart + a price × date P&L heatmap in the centre, P&L / Greeks on the right. Lab = the research views demoted from the working tabs: the stylised 3D P&L surface and the IV surface (with a 5/10/20/60-day volatility cone), picked by a sub-toggle in the expiry row; a saved `iv` workspace lands there. The single-contract pricer is folded into Calculator; Compare is shelved — code kept, tab removed). Mobile keeps its own Calc/Chain/Pricer/IV tabs; a saved `levels` or `lab` workspace redirects to Calc on phone.
3. Check phone width too (DevTools responsive mode, ~390px) — many regressions only show on mobile.
4. Watch the console: Babel parse errors and Three.js warnings show up there.

If you can't run a browser in this environment, **say so explicitly** rather than claiming success from static reading.

### Commits and PRs

- **English** for everything pushed to GitHub — commit messages, PR titles/bodies, and new code comments (owner request, 2026-07). Prefix commits `feat:` / `fix:` / `chore:`. Existing Chinese comments can stay; don't mass-translate them.
- One concern per commit. The history is granular on purpose.
- Branch convention: `claude/<short-kebab-topic>`.
