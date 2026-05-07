# Options Calculator (TXO · 台指選擇權)

Next.js + TypeScript implementation of the Options Lab design (`design_handoff_options_lab/`). Stage 1 ships the **Calculator** workspace with mock TXO data; Chain / IV Surface / Compare workspaces are stubbed for follow-up work.

## Stack

- Next.js 14 (App Router) + TypeScript
- React 18, Tailwind CSS (utility helpers only — most styling is via inline tokens for fidelity)
- Pure-function P&L / Greeks layer in `src/lib/options.ts`

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run typecheck
```

## Project layout

```
src/
  app/
    layout.tsx
    page.tsx                 # Calculator workspace (default)
    globals.css              # design tokens + base styles
    api/
      quotes/route.ts        # GET /api/quotes        → QuoteSnapshot
      expiries/route.ts      # GET /api/expiries      → ExpiryDef[]
      chain/route.ts         # GET /api/chain?expiry= → ChainRow[]
  components/
    CalculatorWorkspace.tsx  # main screen
    Glass.tsx                # glass primitive (panel / chip / raised)
    TopBar.tsx
    ExpiryStrip.tsx
    LegEditor.tsx
    PayoffChart.tsx          # SVG payoff with cone, breakevens, slice
    PnlNowCard.tsx           # P&L now + POP gauge
    GreeksPanel.tsx
    SpotIvSlider.tsx         # bottom sticky controls
    StressTest.tsx
  lib/
    types.ts                 # Leg, ChainRow, ExpiryDef, Greeks
    options.ts               # legPayoff, BS Greeks, payoff stats, prob cone
    mock.ts                  # mock TXO chain + quote
    datasource.ts            # DataSource interface (swap point for Shioaji)
```

## Wiring SinoPac (永豐金) Shioaji later

The frontend never touches the broker SDK directly — Shioaji is Python only and CA certificates must stay on the server. The plan is:

```
[Browser]  ──HTTP──>  [Next.js API routes (this repo)]  ──HTTP/WS──>  [FastAPI · Shioaji]
                                                                       │
                                                                       └─ CA cert, login token
```

To swap mock → real:

1. Stand up a Python FastAPI service that wraps `shioaji`. Expose at minimum:
   - `GET /quote?symbol=TXFD4` → `{ symbol, spot, changePct, ts }`
   - `GET /expiries` → `[{ id, label, dte, type, date }, ...]`
   - `GET /chain?expiry=W1` → `{ expiry, rows: ChainRow[] }`
   - `GET /ws/quotes` (WebSocket) for streaming ticks
2. Login flow runs at FastAPI startup using env vars: `SHIOAJI_API_KEY`, `SHIOAJI_SECRET_KEY`, CA cert path. Never expose these to the browser.
3. In `src/lib/datasource.ts`, replace `mockDataSource` with a `shioajiDataSource` that fetches from `process.env.SHIOAJI_PROXY_URL`. The shape returned must match the existing TypeScript types — no frontend code needs to change.
4. Add a `/api/stream` route or use Next.js `fetch` with `revalidate: 0` to plumb the WebSocket through to the client (or call the FastAPI WS directly from the browser if it sits behind the same auth).

### Why a Python proxy?

- Shioaji (`shioaji` PyPI package) is the official 永豐金 SDK and is **Python-only**.
- CA certificate (`.pfx`) login can't be done from browser code safely.
- Streaming subscribe/unsubscribe is much cleaner from a long-lived Python process than from serverless functions.

## What's mocked right now

- `TXO spot`: 21,850 (constant)
- `chain`: BS-priced strikes ATM ± 500 in 50pt steps with mock IV smile
- `expiries`: W1 / W2 / M / W4 / M+1
- `POP`: Monte Carlo (2,000 samples) on a lognormal spot at expiry

These all live behind the `DataSource` interface, so swapping them is a single-file change.
