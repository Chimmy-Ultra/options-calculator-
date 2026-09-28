---
name: verify
description: How to run and drive TXO Options Lab to verify a change — static server, headless Chromium through Playwright, and the server/ CLIs.
---

# Verifying Options Lab

## Frontend (the app)

- Serve the app: `cd design_handoff_options_lab && python3 -m http.server 8080 --bind 127.0.0.1` (run it in the background; it does not survive between sessions — check with `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/index.html`). Never `pkill -f "http.server 8080"` from the same shell command: the pattern matches the shell itself.
- Drive it with Playwright from `/opt/node22/lib/node_modules/playwright` (Chromium preinstalled; do not run `playwright install`).
  - New context per scenario with `serviceWorkers: 'block'`.
  - Route every request through a Node `fetch` relay (`ctx.route('**/*', relay)`), because the CDN scripts (React, Babel, react-grid-layout) only come through the agent proxy.
  - Seed state before load with `addInitScript`: `localStorage.optionsLab.helpSeen = '1'` and `optionsLab.v1 = {productId, workspace, theme:'dark'}`. Workspaces: `watch levels chain chart calc lab`. Add `legsByProduct` to test a saved position.
  - Wait for `#root` to have children, then about 7 s for Babel.
- Tabs are buttons with the exact labels 自選 / 關卡 / 報價表 / K線 / 策略 / 實驗室. Panels are `.react-grid-item`; filter them by title text (e.g. `上方關卡價`, `當日走勢`, `T 字報價`, `部位明細`).
- Read the ground truth from the page's own data: `window.TAIFEX_EOD` (TXO) and `window.IB_EOD[pid]`. Compare what the screen shows against it.
- Check desk (1640), fold (820) and phone (390). Non-desk widths redirect a saved `levels` / `lab` workspace to `calc`, and their top bar is a product strip rather than a price. Watch `pageerror` and console errors; ignore failed requests to `127.0.0.1:8720` (no proxy).
- Gotchas:
  - JSX text does not process `\uXXXX` escapes — look for literal escapes on screen.
  - A row rendered not clickable (e.g. 自選's 僅報價) makes a normal Playwright click time out. Use `click({ force: true })` to prove nothing happens.
  - Strike and premium in 部位明細 are `<input>` values, not text. Take the smallest element whose text starts with 部位明細, or you also collect 理論價試算's input.

## Data pipeline (server/ CLIs)

- `cd server && python3 taifex.py --write <tmp>/eod.js`, then diff the JSON against `design_handoff_options_lab/taifex-eod.js`. The same session should differ only in `builtAt`. If `top20` comes back a day older, TWSE did not answer and the fetch stepped back a day — rerun.
- `python3 taifex.py --archive-minutes <tmp-dir>` against an empty directory must reproduce `data/tx-1m` byte for byte. A second run prints `archived nothing new`.
- `python3 server/ibsnap.py <capture-dir> --write <tmp>/ib.js` reproduces `ib-eod.js` apart from `builtAt`. The capture files are not in the repo; without them this path cannot be run.
- `server/sinopac.py` needs Shioaji credentials and a live session — not runnable here; say so.

## The daily workflow

`.github/workflows/taifex-eod.yml` commits and pushes, so do not dispatch it to verify a change. Clone the repo into a temp directory, extract the commit step's `run:` block with PyYAML, replace `git push` with an echo, and run it twice: once with no changes (must print `nothing new`), once with a new file under `data/tx-1m` (must commit).
