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

- `.jsx` files are loaded with `<script type="text/babel">` and parsed by Babel. They use JSX syntax.
- `.js` files (`surface3d.js`, `iv-surface.js`, `service-worker.js`) are plain ES5/ES6, loaded as `<script src>`. **They must stay `.js`** — see commit `56009a0` ("rename plain-JS files to .js so CDN serves correct MIME"). Renaming breaks the CDN content-type and the file silently fails to execute.
- No `import`/`export`. Modules communicate via globals on `window` and shared React hooks (`const { useState, useEffect, useRef, useMemo } = React;` at the top of each `.jsx`).

### Don't introduce

- A build step (Vite, Webpack, Next.js, esbuild). The whole point of this prototype is zero-install.
- TypeScript, package managers, linters as files in the repo. If you want types, use JSDoc comments inline.
- Imports between modules. Add to the existing global / `window.*` pattern instead.
- A backend or API call. All P&L / Greeks / IV math is pure functions on mock data.

### TXO domain conventions (Taiwan index options)

These break Western intuition — get them wrong and the UI looks correct but means the opposite.

- **Calls are red, puts are teal/green.** This matches Taiwan T-quote convention (`#ef5350` calls, `#26a69a` puts), not the US convention. Don't "fix" it.
- **Contract multiplier: ×50 NTD per index point.** P&L in NTD = points × 50.
- **Strikes are multiples of 50.** Strike inputs use `step=50`.
- **Spot default: 21,850. ATM IV default: 24%. IV slider range: 10–50%.**
- Expiries are weekly + monthly (W1/W2/M/W4). M+1 was removed in `bb2697b` — don't add it back.
- Pricing model: Black-Scholes for theoretical premiums everywhere (payoff chart, strategy library, +leg, P&L Now). See commits `f0f1ae2`, `1b7355d`. Don't introduce a separate pricing path.

### Layouts

`useViewport()` in `atoms.jsx` classifies into `phone` (<640), `fold` (640–1023), `desk` (≥1024). Three real layouts, not just responsive CSS — desktop uses absolute positioning that breaks on phone. When changing a workspace, check all three.

### How to verify changes

There is no test suite. To verify:

1. Open `design_handoff_options_lab/index.html` directly in a browser, **or** run a static server from that directory.
2. Exercise the four workspaces: Chain, Calculator, IV Surface, Compare.
3. Check phone width too (DevTools responsive mode, ~390px) — many regressions only show on mobile.
4. Watch the console: Babel parse errors and Three.js warnings show up there.

If you can't run a browser in this environment, **say so explicitly** rather than claiming success from static reading.

### Commits and PRs

- Commit messages in this repo are short Traditional Chinese (繁中), prefixed `feat:` / `fix:` / `chore:`. Match that style.
- One concern per commit. The history is granular on purpose.
- Branch convention: `claude/<short-kebab-topic>`.
