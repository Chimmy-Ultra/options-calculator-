# Design Port Plan — execution spec

> **Status (2026-07-10): ALL DONE.** ① Light/Dark ✅ ② Chart tab ✅ ③ Chain
> SIDE/WIDE/SPLIT ✅ ④ chain Δ/spot-line/badges ✅ ⑤ P&L what-if card ✅
> ⑥ product dropdown + liquidity pill ✅ ⑦ collapsible What-if rail ✅
> ⑧ IV 3D/HEATMAP ✅ ⑨ eighth ticks ✅ · new products ES/GC/CL/NG ✅ ·
> Pricer folded into Calculator, Compare shelved ✅. Verified in-browser
> (dark+light, all tabs, grains + NG, zero console errors). On PR #17.


Port the owner's claude.ai/design mockup to the real app. The mockup is committed
at `docs/design-reference/trading-main-screen.dc.html` — **consult it for exact
styles**; all pixel values, colors, and grid specs below were extracted from it.

**Read `CLAUDE.md` first.** Zero-build Babel frontend, `window.*` globals, no
imports, Taiwan colors (red = calls/up, teal = puts/down — never "fix" this).

## Ground rules (owner decisions, settled 2026-07-10)

1. **Everything lands on branch `claude/repo-status-check-0l17ql`** (PR #17,
   draft). One batch, one merge at the end. Do NOT merge; the owner merges.
2. **English only** for commits, PR text, and code comments (owner request).
   One concern per commit. Existing Chinese comments stay untouched.
3. **Desktop only.** Mobile (`MobileApp` and below) stays exactly as-is,
   including its Pricer tab and K線 sub-tab.
4. Bump `CACHE_VERSION` in service-worker.js once per landed batch.
5. Status of increments ①② (already merged/landed): Light/Dark theme ✅,
   Chart top-level tab ✅, default workspace = chain ✅.

## Increment ③ — Chain tab SIDE / WIDE / SPLIT layouts

`ChainWorkspace` becomes a CSS-grid with named areas and a local
`layout: 'a'|'b'|'c'` state ('a' default). Switcher UI: right-aligned row above
the grid — label `Layout` (9px uppercase, opacity .45) + three chips
`SIDE`/`WIDE`/`SPLIT` (9px 700, padding 3px 10px, radius 999; active = accent
gradient `linear-gradient(150deg,oklch(0.66 0.16 250),oklch(0.55 0.18 240))`,
white text; inactive transparent, border `rgba(255,255,255,.14)` /
light `rgba(25,40,70,.14)`).

Grid specs (from mockup):

| id | columns | areas |
|---|---|---|
| a SIDE | `minmax(460px,1fr) minmax(340px,392px)` | `'chain pnl' 'chain payoff' 'chain greeks' 'chain legs'` |
| b WIDE | `1fr 1fr` | `'chain chain' 'pnl payoff' 'greeks legs'` |
| c SPLIT | `1.1fr 1fr 1fr` | `'chain chain chain' 'payoff pnl legs' 'greeks greeks greeks'` |

Blocks: `chain` (chain table panel), `pnl` (new what-if card, ⑤), `payoff`
(PayoffChart panel, same props as Calc one), `greeks` (4 tiles,
`repeat(auto-fit,minmax(140px,1fr))`, values from `portfolioG`), `legs` (card
with current `LegEditor`, net debit line, `+ leg`/`clear` mini buttons, and the
stress-test buttons moved in). **OI Profile and Max Pain stay** (owner decision)
— render them below the grid in a 2-col row.

New props needed by `ChainWorkspace` from `Obsidian3`: `pnlPts, pnlNTD,
maxProfit, maxLoss, popValue, portfolioG, iv, dte, sliceFrac` (reuse the values
already computed in `Obsidian3`; nothing new to compute).

## Increment ④ — chain table upgrades (`option-chain.jsx`, desktop `OptionChain`)

- **Δ columns** both sides. Column order (11 cols):
  `OI VOL Δ IV BID/ASK | STRIKE | BID/ASK IV Δ VOL OI`. Grid template:
  `minmax(0,.8fr) minmax(0,.75fr) minmax(0,.6fr) minmax(0,.65fr) minmax(0,1.5fr) 84px minmax(0,1.5fr) minmax(0,.65fr) minmax(0,.6fr) minmax(0,.75fr) minmax(0,.8fr)`,
  `min-width: 900px`, wrapped in an `overflow-x:auto` container. Delta format:
  `'+.69'` / `'-.31'` (strip leading zero, 2 decimals), opacity .85. Delta is
  already in every row (`r.call.delta` / `r.put.delta`) for both mock and IB.
- **Spot line overlay**: absolutely-positioned 1px horizontal line +
  centered pill showing the spot value.
  `top: calc(28px + (100% - 28px) * spotFrac)` where
  `spotFrac = clamp(((spot - firstStrike)/strikeStep + 1) / rowCount, .02, 1)`.
  Pill: mono 9.5px 700, padding 2px 8px, radius 999, bg `#10141d` border
  `rgba(255,255,255,.3)` (light: bg `#1c2433`, border `rgba(20,30,50,.5)`,
  white text). Both `pointer-events:none`.
- **Position badges**: for each leg in `legs` matching a row's strike+type:
  long → `BUY +{qty}` badge (bg `#f0c068`, color `#0a0d14`), short →
  `SELL −{qty}` (bg `#5fa3d4`, color `#0a0d14`); 7.5px 800, absolute left in
  that side's BID/ASK cell, plus cell ring
  `inset 0 0 0 1px rgba(240,192,104,.8)` (gold, long) /
  `rgba(95,163,212,.8)` (blue, short) and bg tint `.10/.12`.
  `OptionChain` needs a new optional `legs` prop — pass from `ChainWorkspace`.
- Keep 17 rows (±8); `MobileChainTable` untouched.

## Increment ⑤ — "P&L what-if" card (the `pnl` grid area)

Compact raised-glass card (Glass2 `raised`, padding `14px 14px 12px`, r16):
- Eyebrow `P&L what-if · {P.code}` (9px, letter-spacing .7, uppercase, .5).
- Hero: 24px 600 mono tnum; profit `oklch(0.84 0.14 75)` (light
  `oklch(0.60 0.13 75)`), loss `oklch(0.74 0.12 220)` (light
  `oklch(0.50 0.10 220)`); no minus sign, color codes the sign (house style).
- Sub-line 9px .5: `{±pts} pts {P.unitLabel}`.
- POP arc gauge, right side, 74px wide: svg `viewBox="0 0 110 66"`, track
  `M 12 60 A 46 46 0 0 1 98 60` stroke `rgba(255,255,255,.10)` (light
  `rgba(20,30,50,.14)`) width 7 round; value arc same path family stroke
  `#5fa3d4`, end angle interpolated by `popValue`
  (`gcx=55, gcy=76.16, gr=46, a0=atan2(60-gcy,12-gcx), a1=atan2(60-gcy,98-gcx),
  phi=a0+pop*(a1-a0)`; arc end `(gcx+gr*cos(phi), gcy+gr*sin(phi))`).
  Centered `%` text 12px 700 mono; caption `prob. of profit` 7px uppercase .5.
- 1px divider, then 2 tiles (grid 1fr 1fr, gap 8): `Max profit` value gold
  `#f0c068` 14px mono; `Max loss` value blue `#5fa3d4`. Tile bg
  `rgba(255,255,255,.04)` border `rgba(255,255,255,.08)` (light: use the
  `lt-tile` class already in tokens.css).

Calc workspace keeps its existing big "P&L now" card — this card is Chain-tab only.

## Increment ⑥ — top bar: product dropdown + liquidity pill

- Replace the native `<select>` with a button that toggles a custom dropdown
  (`prodMenuOpen` state in `Obsidian3`; close on pick and on workspace change).
  Button = existing chip capsule, but border `oklch(0.66 0.16 250 / .55)`; tag
  pill text `{CODE} ▾`.
- Menu: absolute below button, width 250, radius 14, padding 6, z-index 30,
  near-opaque glass: dark `linear-gradient(155deg,rgba(80,90,115,.85),rgba(36,42,58,.9))`,
  border `rgba(255,255,255,.14)`; light: `rgba(255,255,255,.96)` solid, border
  `rgba(25,40,70,.16)`. Rows (one per `window.PRODUCTS`): tag pill (min-width 26,
  centered) + name 11px .85 flex-1 + `defaultSpot` right-aligned mono 11px.
  Selected row bg `rgba(255,255,255,.10)` (light `rgba(20,40,80,.08)`).
- Move the liquidity `DataQualityPill` into the top bar (after tabs, before
  product capsule) — pass `quality` — matching the mockup's `2/2 liquid` chip.

## Increment ⑦ — global What-if rail, COLLAPSIBLE (desktop)

Owner revision (2026-07-10): the What-if sliders are used infrequently, so keep
them tucked away and out of the main layout — collapsed by default, available
on every tab.

- Shell state `whatIfOpen` (default `false`).
- Collapsed: a small fixed bottom-right pill (`position:fixed; bottom:20px;
  right:24px; z-index:15`), Glass2 `chip` r999, padding `8px 14px`, click to
  open. Content: `⇅ What-if` label + compact readout
  `{P.code} {spot} · IV {iv}%` (mono, tnum) so it's informative while closed.
- Expanded: the full rail replaces the pill at the same bottom-right anchor —
  Glass2 `raised` r14, `width:520px; max-width:calc(100vw - 48px)`, padding
  `10px 16px`, grid `auto 1fr 1fr` gap 18: a header cell with `What-if` label +
  a `×` collapse button, Spot slider (`Spot · {P.code}`), IV slider. Reuse the
  `Slider` component and `spotMin/spotMax/P.spotStep/P.ivMin/P.ivMax`.
- Remove the old centered rail from `CalcWorkspace`. When expanded it may sit
  over the Max-Pain card — that's fine since it's user-triggered and dismissable;
  no layout reflow needed.

## Increment ⑧ — IV Surface: 3D / HEATMAP toggle

- Local state in `IVWorkspace`: `ivView: '3d'|'heat'`, chips `3D` / `HEATMAP`
  styled like the layout switcher chips.
- 3D = existing Three.js mount (unchanged). HEATMAP = table in an
  `overflow-x:auto` dark container: header row `EXP` + every 2nd strike from
  the current chain (10 cols); one row per expiry in `expiries`; cell = IV
  value `toFixed(1)`, bg `rgba(240,192,104, a)` with
  `a = clamp(((iv - (atmIv-1.8)) / 4.5) * 0.55, .05, .6)`.
  Data: for each expiry call
  `genChain({spot, contract: e.type, dte: e.dte, product: P})` and read
  `call.iv` of every 2nd row (needs new `spot` prop on `IVWorkspace`; when the
  IB live chain is loaded it only covers the selected expiry — mock rows for
  the others are acceptable, note it in a comment).
- Legend row under either view: `low` → 120×8 gradient bar
  (`linear-gradient(90deg,rgba(240,192,104,.06),rgba(240,192,104,.6))`) →
  `high · X = strike · depth = expiry (front = near) · height = IV %`.

## Increment ⑨ — CBOT eighth-tick display

- `products.js`: add `eighth: true` to zc/zs/zw.
- Shared helper `fmtPx(v, P)` (put next to `genChain` in option-chain.jsx,
  export on `window`): `P.eighth ? (Math.round(v*8)/8).toFixed(3) : v.toFixed(1)`.
- Use it for bid/ask text in the **desktop** chain table only (both sides).

## New products — ES / GC / CL / NG (registry entries, specs from the mockup)

Add to `design_handoff_options_lab/products.js` (after zw), and to
`server/main.py` `PRODUCTS`:

| id | code | name | cur | mult | unitLabel | strikeStep | model | r | skew | spot0 | iv0 | ivMin–Max | spotStep | settle | IB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| es | ES | S&P 500 E-mini | US$ | 50 | ×US$50 / pt | 25 | b76 | 4.0 | put | 6120 | 15 | 8–60 | 0.25 | 15:00 CT | CME, tradingClass `ES` |
| gc | GC | Gold 黃金 | US$ | 100 | ×US$100 / oz | 25 | b76 | 4.0 | call | 3352 | 18 | 8–60 | 0.5 | 12:30 CT | COMEX, tradingClass `OG` |
| cl | CL | WTI Crude 原油 | US$ | 1000 | ×US$1,000 / bbl | 1 | b76 | 4.0 | call | 72.30 | 33 | 15–80 | 0.05 | 14:30 CT | NYMEX, tradingClass `LO` |
| ng | NG | Natural Gas 天然氣 | US$ | 10000 | ×US$10,000 / pt | 0.1 | b76 | 4.0 | call | 3.42 | 45 | 20–100 | 0.005 | 14:30 CT | NYMEX, tradingClass `ON` |

- `spotMin/Max` = spot0 × 0.88 / 1.12 (round sensibly). `ivBase: { std: iv0 }`.
- 3 `mockExpiries` each (like the grains: std monthlies, dte ≈ 35/65/95).
- server `PRODUCTS` needs matching `strikeStep`; tradingClass values above are
  best-guesses for the standard monthly class — the existing fallback (pick the
  class with the most expirations) covers mismatches; leave a comment.
- Note: NG strikes are fractional (0.1) — `genChain`'s `strike` stays a float;
  the chain `kTxt` should render `k.toFixed(2)` when `P.strikeStep < 1`
  (mirror the mockup's `spec.step < 1` logic) — check OIProfile/MaxPain labels
  still fit.

## Tab consolidation — remove Pricer & Compare (desktop)

- `WorkspaceTabs` items → `Chain / Chart / Calculator / IV Surface`.
- Move the single-contract pricer INTO `CalcWorkspace`: add a Glass2 panel
  card containing `<OptionPricer key={P.id} product={P} …/>` at the bottom of
  the **left** column. Delete `PricerWorkspace` and its route.
- Compare: remove the tab and route only. **Keep** `CompareWorkspace` /
  `CompareCard` / `STRATEGY_LIBRARY` code in place with a short comment
  `// Shelved: Compare tab removed per owner decision (2026-07-10); re-enable by re-adding the tab.`
  (STRATEGY_LIBRARY is still used by mobile strategy chips — do not delete.)
- Extend the mobile-guard effect: on desktop, if `workspace` is `'pricer'` or
  `'compare'`, fall back to `'chain'`.
- Mobile keeps its own Pricer tab (unchanged).

## CLAUDE.md updates (same batch)

- Products section: add ES/GC/CL/NG to the product list.
- Commits/PRs section: replace the Traditional-Chinese commit convention with:
  commits, PR text, and new code comments are **English** (owner request,
  2026-07-10); existing Chinese comments stay.
- Tabs: note desktop tabs are Chain/Chart/Calculator/IV Surface; Compare is
  shelved; mobile unchanged.

## Verification (required before pushing each commit)

No test suite — verify in a real browser. The environment blocks unpkg, so:
1. `npm i react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0 three@0.160.0`
   in a scratch dir (registry.npmjs.org is allowed; SRI hashes match unpkg).
2. Playwright (`/opt/pw-browsers/chromium`, proxy `HTTPS_PROXY` with
   `bypass: '127.0.0.1,localhost'`) + `ctx.route('https://unpkg.com/**', …)`
   fulfilling from the npm files.
3. Static server: `python3 -m http.server 8080` in
   `design_handoff_options_lab/`. For live-mode tests, a stub proxy on :8720
   serving `/api/health|quote|expiries|chain|bars` (see git history of the
   session, or improvise — rows must match the genChain shape).
4. Check per increment: dark AND light, default tab, zero console/page errors,
   and screenshot evidence. Exercise: layout switch a/b/c, product dropdown pick
   (incl. a new product like GC), spot-line position, BUY/SELL badges after
   clicking a chain row, POP gauge sanity, heatmap toggle, what-if rail on all
   four tabs.

## Endgame

- Update PR #17 title/body (English) to cover the whole batch.
- Mark increments done in this file in the final commit.
- Leave the PR as draft; the owner merges.
