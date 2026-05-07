# Handoff: Options Lab — TXO Options Calculator

## Overview

A full-featured **TXO (台指選擇權) options strategy calculator** with four workspaces:
- **Chain** — Option chain table (T-quote style, click any cell to add a leg)
- **Calculator** — 3D P&L surface + payoff chart + Greeks + scenario tools
- **IV Surface** — Implied volatility surface (strike × DTE × IV) in 3D
- **Compare** — Side-by-side payoff comparison of up to 4 strategies, editable strikes

The design is **high-fidelity**: dark "Obsidian" glass aesthetic, exact colors/spacing/animations are specified below. All HTML prototype files are **design references** — recreate the UI in your target stack (React recommended), pulling exact values from this document. Do not ship the HTML files directly.

---

## Fidelity

**High-fidelity.** Recreate pixel-precisely using the design tokens and component specs below. The developer should adapt to the target codebase's patterns (component library, routing, state management) but must match visual appearance closely.

---

## Design Tokens

### Colors
```
Background:        #0c0e14  (deep near-black)
Panel glass:       rgba(20,24,34,0.55) with blur(28px)
Panel border:      rgba(255,255,255,0.10)
Panel inset:       rgba(255,255,255,0.10) top edge

Accent (default):  oklch(0.72 0.18 280)  ≈ #7c5cf0 purple-blue
Call (red):        #ef5350
Put (green):       #26a69a
Profit fill:       #ef5350 at 22% opacity
Loss fill:         #26a69a at 22% opacity
Break-even:        #a78bfa (purple)
Gold accent:       #f0c068 (ATM, monthly markers)
Bullish bias:      #ef5350
Bearish bias:      #26a69a
Neutral bias:      #a78bfa
Volatile bias:     #f0c068

Text primary:      #e8eaef
Text secondary:    rgba(255,255,255,0.55)
Text dim:          rgba(255,255,255,0.35)
Mono numbers:      ui-monospace, SF Mono, Menlo, monospace
```

### Typography
```
Body font:         system-ui, -apple-system, sans-serif
Mono font:         ui-monospace, SF Mono, Menlo, monospace
Label caps:        9–10px, weight 600, letter-spacing 0.5–0.8px, uppercase
Body small:        11–12px, weight 400–500
Numbers large:     18–24px, weight 700, tabular-nums
Eyebrow:           10px, weight 600, uppercase, letter-spacing 0.8px
```

### Spacing
```
Page padding:      24px all sides
Panel radius:      16px (panels), 10px (chips), 999px (pill chips)
Panel padding:     16px
Gap between panels: 12px
Top bar height:    ~44px from top 18px → bottom ~62px
Expiry strip:      top 64px
Workspace body:    top 110px, bottom 24px
```

### Glass Primitive (`Glass2`)
All panels are glass cards:
```css
background: linear-gradient(180deg, rgba(28,32,44,0.60) 0%, rgba(16,18,26,0.45) 100%);
border: 1px solid rgba(255,255,255,0.10);
box-shadow: 0 1px 0 rgba(255,255,255,0.10) inset, 0 16px 48px -20px rgba(0,0,0,0.8);
backdrop-filter: blur(28px) saturate(140%);
border-radius: 16px;
```
Chip variant (smaller pill):
```css
background: rgba(255,255,255,0.05);
border: 1px solid rgba(255,255,255,0.10);
border-radius: 999px;
padding: 6–8px 12–14px;
```

---

## Architecture / File Map

| File | Role |
|------|------|
| `index.html` | Entry point — loads React 18, Babel, Three.js, then all JSX modules |
| `obsidian3.jsx` | Root app component (`Obsidian3`), top bar, workspace router, tweaks |
| `atoms.jsx` | Shared primitives: `Glass2`, `PayoffChart`, `CrossSection`, `ThetaDecay`, `IVSmile`, `legPayoff`, `CompareWorkspace`, `CompareCard` |
| `surface3d.jsx` | Three.js 3D P&L surface with hover tooltip, axis labels, break-even ring, color schemes |
| `option-chain.jsx` | `OptionChain` component — T-quote table, call/put red/green, click-to-add-leg |
| `iv-surface.jsx` | `IVSurface3D` — Three.js IV surface (strike × DTE × IV) |
| `charts.jsx` | `ThetaDecay`, `IVSmile`, `PayoffChart` mini SVG charts |
| `tokens.css` | CSS custom properties for spacing, radii, color |
| `tweaks-panel.jsx` | Floating tweaks panel (accent color, surface scheme, density, prob cone toggle) |

---

## Screens / Workspaces

### Top Bar (always visible)
**Layout:** `position: absolute; top: 18px; left/right: 24px; display: flex; justify-content: space-between; align-items: center; gap: 12px`

**Left:** Brand pill `Options Lab` (logo square gradient + text)  
**Center:** 4 workspace tabs in a pill group: Chain · Calculator · IV Surface · Compare  
**Right:** TXO spot price chip (`TXO 21,850 +0.84%`) + Settlement countdown chip (`● SETTLE 17d · 13:30`)

Tab active state: solid accent-colored background, white text  
Tab inactive: transparent, 65% opacity text

### Expiry Strip (always visible)
**Layout:** `position: absolute; top: 64px; display: flex; justify-content: space-between`

Left side: expiry buttons — W1 12/04, W2 12/11, **M 12/18** (selected), W4 12/25, M+1 01/22  
Selected: accent border + background tint + slightly larger text  
Monthly expiries: gold dot badge in top-right corner  
Right side: `×50 NTD/pt` chip

---

## Workspace 1: Chain

**Layout:** Full width below bar. Left: scrollable Option Chain table. Right (280px): Leg builder panel (shows added legs, net premium in NTD).

### Option Chain Table
T-quote layout — 9 columns: `OI | Vol | IV | BID/ASK || STRIKE || BID/ASK | IV | Vol | OI`

- **Call side (left 4 cols):** red tinted (`#ef5350`)
  - ITM rows: `rgba(239,83,80,0.08)` background
  - Hover: `rgba(239,83,80,0.22)` background
  - BID/ASK cell: `color: #ef5350, fontWeight: 600`
- **Put side (right 4 cols):** teal tinted (`#26a69a`)
  - ITM rows: `rgba(38,166,154,0.08)` background
  - Hover: `rgba(38,166,154,0.22)` background
  - BID/ASK cell: `color: #26a69a, fontWeight: 600`
- **Strike center col:** 80px wide, bold, centered. ATM row: accent-colored border, gold text, `ATM` badge
- Font: `ui-monospace`, 12px, tabular-nums
- Clicking any call/put row → adds a long leg to the leg builder at that strike

### Leg Builder (right panel, 280px)
- Lists all legs with: LONG/SHORT badge · CALL/PUT badge · strike · premium · qty · × remove
- Net premium row: `Net premium: +NT$x,xxx` (red if credit, gray if debit)
- `+ LEG` button opens a simple form to manually add a leg

---

## Workspace 2: Calculator

**Layout:** Left column 320px + right column 340px, both `position: absolute; top: 110px`

### Left Column
1. **Legs panel** — same leg editor as Chain right panel. `+ LEG` button.
2. **Stress Test panel** — 4 scenario buttons: `−5% & IV+30%`, `+3% & IV−10%`, `−10% crash`, `Reset`
3. **Saved Scenarios** — timeline row: 4 dots labeled `2w ago / 1w ago / 3d ago / today`, each with a P&L value. Gold dot = today.

### Right Column
1. **P&L Now card** — Large `NT$x,xxx` number (teal if loss, white if profit). Sub: `xx pts × 50 NTD`. Right side: circular POP gauge (arc, `68%`). Below: `Max profit +NT$x,xxx · Max loss NT$−x,xxx`
2. **Chart tabs** — pill segment: Payoff · P&L · Theta · IV
   - **Payoff chart:** SVG, ±8% price range. Profit fill red, loss fill teal. Break-even: purple vertical dashed line, label at top. Max profit: `↑ +xxx` at top-right. Max loss: `↓ xxx` at bottom-left. Spot: vertical dashed + dot. 1σ/2σ probability cone: purple tinted bands. Time-slice range slider below (`NOW → EXPIRY`).
   - **P&L chart:** cross-section at fixed DTE
   - **Theta chart:** decay curve, red gradient
   - **IV chart:** IV smile curve
3. **Greeks panel** — 2×2 grid: Delta Δ / Gamma Γ / Theta θ / Vega V. Each in its own glass card. Positive = white, negative = teal.
4. **P&L range bar** — bottom of right column: `P&L −15K ████████ +45K` gradient bar

### Bottom Slider Bar
Fixed at bottom: two sliders spanning full width  
`SPOT [slider] 21,850   IV [slider] 24%`  
Background: glass panel with blur, `border-radius: 16px`

---

## Workspace 3: IV Surface

**Layout:** Left: 3D canvas (Three.js). Right 280px: Term structure list + Skew card + instructions.

### 3D IV Surface
- Axes: Strike (X) × DTE (Z) × IV% (Y)
- Color: purple-to-blue gradient (low IV = cool, high IV = warm)
- Orbit controls: drag to rotate, scroll to zoom
- Hover tooltip (raycast): shows `Strike xxx · DTE xxd · IV xx%`

### Right Panel
- **Term structure:** list of all expiries with ATM IV%. Currently selected expiry highlighted gold.
- **Skew · 25Δ:** single large number (put skew in vol pts), small description
- **Instructions chip:** drag/scroll hint

---

## Workspace 4: Compare

**Layout:** Top: strategy picker bar. Below: 1–4 card grid (responsive columns).

### Strategy Picker Bar
Glass panel, `padding: 12px 16px`. Horizontal scrollable pill buttons for 11 strategies:
```
Bull Call Spread · Bear Put Spread · Iron Condor · Long Straddle · Long Strangle
Short Strangle · Put Credit Spread · Call Credit Spread · Long Butterfly
Long Call · Long Put
```
Active chip: colored border + tinted background (color = bias: bullish red, bearish teal, neutral purple, volatile gold). Colored 6px dot inside chip.  
Max 4 strategies selected simultaneously.

### Compare Card
Each selected strategy renders a card with:
1. **Header:** colored 8px dot + strategy name + `x` remove button. Below: `N legs` subtitle.
2. **Payoff chart:** 170px tall, ±6% range, `showKeyNumbers=true` (break-even dashed lines at top, max profit top-right, max loss bottom-left)
3. **Editable strikes table:** labeled `STRIKES · ADJUST K`
   - Each leg row: `[+1/−1 badge] [C/P badge] [number input for strike] [@premium]`
   - Call badge: red background. Put badge: teal background. Long: brighter bg.
   - Strike input: monospace, right-aligned, step=50
   - Changing strike instantly recalculates payoff chart + key numbers
4. **Key numbers grid (2×2):**
   - MAX PROFIT: red chip, `+NT$x,xxx`
   - MAX LOSS: teal chip, `NT$−x,xxx`
   - BREAK-EVEN: purple chip, `xxxxx / xxxxx`
   - NET CREDIT / NET DEBIT: neutral chip

---

## Interactions & Behavior

### 3D P&L Surface (Three.js)
- **Color schemes:** `pnl` (green→red around 0), `aurora` (blue→purple→red), `heat` (blue→orange), `mono` (white)
- **Axes:** X = spot price (labeled with actual prices), Z = DTE (labeled 0d→17d), Y = P&L NTD
- **Zero plane:** semi-transparent teal (`#4dd0c8`, 22% opacity) at Y=0
- **Break-even ring:** highlighted contour where P&L = 0
- **Hover tooltip:** raycast on mouse move → floating chip showing `spot | DTE | NT$P&L`
- **Z-axis labels:** rendered as Three.js canvas sprites, positioned along Y axis
- **Orbit controls:** mouse drag rotates, scroll zooms

### PayoffChart (SVG)
- X range: `spot × (1 ± rangePct)` — default 8%, Compare uses 6%
- Color: profit = `#ef5350`, loss = `#26a69a` (matches T-chart convention)
- Filled areas above/below zero axis
- `sliceFrac` (0→1): lerps payoff between "now" (flat, premium only) and "at expiry" (intrinsic)
- Probability cone: 1σ = `purple 36% opacity`, 2σ = `purple 18% opacity`
- Break-even: purple dashed vertical line full height, label at top of chart
- Max profit label: `↑ +xxx` anchored top-right
- Max loss label: `↓ xxx` anchored bottom-left

### Time-slice Scrubber
- `<input type="range" min=0 max=1 step=0.01>` below payoff chart
- Moving it re-renders payoff shape in real time (linear interpolation from now → expiry)

### Tweaks Panel
Floating panel (bottom-right), toggled via host toolbar:
- **Accent color:** 4 swatches (purple, blue, emerald, rose)
- **Surface scheme:** pnl / aurora / heat / mono
- **Density:** compact / default / relaxed
- **Probability cone:** toggle on/off

---

## State Management

### Global state (in `Obsidian3`)
```
workspace: 'calc' | 'chain' | 'iv' | 'compare'
expiryId: 'w1' | 'w2' | 'm' | 'w4' | 'm1'
legs: Leg[]          // shared across chain + calc
spot: number         // default 21850
iv: number           // default 24 (percent)
sliceFrac: number    // 0–1, time slice
view: 'payoff' | 'cross' | 'theta' | 'iv'
hover: HoverInfo | null
tweaks: TweakState
```

### Leg type
```ts
interface Leg {
  side: 'long' | 'short';
  type: 'call' | 'put';
  strike: number;    // TXO strike, multiples of 50
  premium: number;   // points
  qty: number;       // default 1
}
```

### Compare state (local to CompareWorkspace)
```
picked: string[]     // list of strategy IDs, max 4
```
Each `CompareCard` holds its own local `legs: Leg[]` state initialized from the strategy template, editable by the user.

### P&L computation
```ts
function legPayoff(leg: Leg, spotAtExpiry: number): number {
  const sign = leg.side === 'long' ? 1 : -1;
  const intrinsic = leg.type === 'call'
    ? Math.max(spotAtExpiry - leg.strike, 0)
    : Math.max(leg.strike - spotAtExpiry, 0);
  return sign * leg.qty * (intrinsic - leg.premium);
}
// Total P&L in points: legs.reduce((a, l) => a + legPayoff(l, spot), 0)
// In NTD: multiply by 50
```

---

## TXO Market Data (Mock)

The prototype uses static mock data. In production connect to TAIFEX API or a broker feed.

### Expiries
```
W1: 週選 12/04 (4 DTE)
W2: 週選 12/11 (11 DTE)
M:  月選 12/18 (17 DTE) ← default
W4: 週選 12/25 (25 DTE)
M+1: 月選 01/22 (45 DTE)
```

### Strike generation
ATM ≈ 21850. Strikes: ATM ± {0, 50, 100, 150, 200, 300, 400, 500} in 50pt steps.  
IV smile: ATM IV = 24%, wings higher (mock BS model).  
OI/Volume: mock numbers decreasing away from ATM.

---

## Key Formulas

### Probability cone (1σ band)
```
sigma = (iv / 100) * sqrt(dte / 365)
oneSigUp   = spot * (1 + sigma)
oneSigDown = spot * (1 - sigma)
twoSigUp   = spot * (1 + 2 * sigma)
twoSigDown = spot * (1 - 2 * sigma)
```

### Greeks (approximate BS, for display)
```
delta (call) ≈ N(d1)
delta (put)  ≈ N(d1) - 1
gamma        ≈ n(d1) / (S * σ * √T)
theta        ≈ -S * n(d1) * σ / (2√T)
vega         ≈ S * n(d1) * √T
where d1 = (ln(S/K) + (r + σ²/2) * T) / (σ√T)
```

---

## Assets & Dependencies

| Dependency | Version | CDN |
|---|---|---|
| React | 18.3.1 | `unpkg.com/react@18.3.1/umd/react.development.js` |
| ReactDOM | 18.3.1 | `unpkg.com/react-dom@18.3.1/umd/react-dom.development.js` |
| Babel Standalone | 7.29.0 | `unpkg.com/@babel/standalone@7.29.0/babel.min.js` |
| Three.js | r128 | `cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` |

No other external assets. No images/icons used — all UI is CSS/SVG.

---

## Implementation Notes for Claude Code

1. **Start with the data layer:** define `Leg` type, `legPayoff()`, strike generation, mock chain data.
2. **Build atoms first:** Glass card component, PayoffChart (SVG), Greeks display.
3. **Wire up Calculator workspace** — it's the core. Get spot/IV sliders, leg editor, and payoff chart working with live computation.
4. **Add Chain workspace** — reuse leg editor, add the T-quote table.
5. **Add Compare workspace** — reuse PayoffChart, add strategy picker and per-card editable strikes.
6. **Add IV Surface and 3D P&L surface** last (Three.js can be isolated in a `useEffect`).
7. **The 3D surface** is the most complex: it needs a Two.js/Three.js canvas with OrbitControls, a custom vertex shader or per-vertex color mapping, axis label sprites, and a raycaster for hover.
8. **All computations are pure functions** — no backend needed for the prototype. Wire real data when the broker API is available.
