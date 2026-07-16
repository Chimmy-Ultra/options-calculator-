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
- New backends. All P&L / Greeks / IV math stays as pure frontend functions. The ONE backend is `server/` (FastAPI + ib_async) — a **read-only** proxy to the user's local IB TWS/Gateway: market data (quote / expiries / chain / bars) **and account positions** (`GET /api/positions/{pid}`, `window.LiveData.positions`), never orders. Don't add order/trade endpoints. The frontend must always work without it: `data-live.js` (`window.LiveData`) returns `null` on any failure and everything falls back to mock.

### Products (multi-product since the IB integration)

Product specs live in `products.js` (`window.PRODUCTS` / `window.getProduct`). Every contract fact — multiplier, strike step, currency, pricing model, IV/spot ranges, expiries — must come from the product object `P`; never hardcode TXO values in shared components.

- **TXO** 台指選擇權 — Black-Scholes on spot (`model: 'bs'`), NT$, ×50/pt, strike step 50.
- **ZC / ZS / ZW** CBOT 玉米/黃豆/小麥期貨選擇權 — **Black-76 on futures** (`model: 'b76'`), US$, 報價 cents/bushel, 5,000 bu → 1¢ = $50/口. Strike steps: ZC/ZW 10¢, ZS 20¢. `eighth: true` → quotes show 1/8-cent ticks (462.875). Grain IV smiles skew to CALLS (drought risk) — opposite of TXO's put skew (`P.skew`).
- **ES / GC / CL / NG** — S&P 500 E-mini, Gold, WTI Crude, Natural Gas futures options (Black-76, US$). Multipliers ×US$50/pt, ×US$100/oz, ×US$1,000/bbl, ×US$10,000/pt. NG uses fractional strikes (step 0.1) — the chain shows two-decimal strikes. These are registry-only entries: adding a product is a `products.js` entry plus a `server/main.py` `PRODUCTS` row; nothing else changes.
- Live data: futures products pull real quotes/expiries/chains from IB via `server/` (see `server/README.md`). Live chain rows replace `genChain` mock rows but keep the same row shape — keep it that way. While connected, quotes re-poll every 10s and the chain every 30s (paused when the tab is hidden); a top-bar freshness chip goes amber `STALE` past 45s.
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

### Layouts

`useViewport()` in `atoms.jsx` classifies into `phone` (<640), `fold` (640–1023), `desk` (≥1024). Three real layouts, not just responsive CSS — desktop uses absolute positioning that breaks on phone. When changing a workspace, check all three.

### How to verify changes

There is no test suite. To verify:

1. Open `design_handoff_options_lab/index.html` directly in a browser, **or** run a static server from that directory.
2. Exercise the desktop workspaces: **Chain / Chart / Calculator / IV Surface** (the single-contract pricer is folded into Calculator; Compare is shelved — code kept, tab removed). Mobile keeps its own Calc/Chain/Pricer/IV tabs.
3. Check phone width too (DevTools responsive mode, ~390px) — many regressions only show on mobile.
4. Watch the console: Babel parse errors and Three.js warnings show up there.

If you can't run a browser in this environment, **say so explicitly** rather than claiming success from static reading.

### Commits and PRs

- **English** for everything pushed to GitHub — commit messages, PR titles/bodies, and new code comments (owner request, 2026-07). Prefix commits `feat:` / `fix:` / `chore:`. Existing Chinese comments can stay; don't mass-translate them.
- One concern per commit. The history is granular on purpose.
- Branch convention: `claude/<short-kebab-topic>`.
