// help.jsx — layered in-app help (⑧), all English, desktop only.
//  ⑧a HelpTip  : a hover tooltip on individual metrics (the layer that matters most).
//  ⑧b HelpDrawer: a per-workspace glossary / tutorial behind the top-bar "?" chip.
// Copy lives in HELP_COPY so the tooltip and the drawer stay consistent.
// No top-level React hook destructure here — classic scripts share one global
// scope, so we call React.useState / React.useRef inline to avoid clashing with
// the aliases declared in the other .jsx files.

// Plain-English copy for every metric. Concrete numbers beat definitions.
const HELP_COPY = {
  delta:  { term: 'Delta (Δ)',  short: 'How much the position gains or loses per 1-point move in the underlying.', example: 'Δ +0.50 → ≈ +0.5 pt per +1 pt of the underlying' },
  gamma:  { term: 'Gamma (Γ)',  short: 'How fast Delta itself changes as the underlying moves. High gamma = Delta shifts quickly.', example: 'Γ 0.010 → Delta moves 0.01 per 1-pt move' },
  theta:  { term: 'Theta (Θ)',  short: 'Time decay: value lost per day if nothing else changes. Negative for buyers, positive for sellers.', example: 'Θ −1.2 → loses ≈ 1.2 pts of value each day' },
  vega:   { term: 'Vega (V)',   short: 'Sensitivity to implied volatility: value change per 1 percentage-point change in IV.', example: 'V +2.0 → +2 pts if IV rises from 24% to 25%' },
  rho:    { term: 'Rho (ρ)',    short: 'Sensitivity to interest rates: value change per 1% change in the risk-free rate.', example: 'ρ +0.3 → +0.3 pts if rates rise 1%' },
  pop:    { term: 'Probability of profit', short: 'The model’s estimate of the chance the position finishes at or above break-even at expiry.', example: '77% → profitable in ~77% of simulated outcomes' },
  maxpain:{ term: 'Max pain',   short: 'The settlement price at which the most options expire worthless — where option buyers, in aggregate, lose the most.' },
  oi:     { term: 'Open interest', short: 'Contracts currently outstanding at that strike. Higher = more liquidity and standing interest.' },
  vol:    { term: 'Volume',     short: 'Contracts traded so far in the session at that strike.' },
  iv:     { term: 'Implied volatility', short: 'The volatility the market’s price implies for the underlying. Higher IV = pricier options.' },
  hv:     { term: 'IV vs historical volatility', short: 'HV is how much the underlying actually moved — the annualized volatility of the last 20 daily returns. IV above HV means options price in more movement than has been happening (premium rich); IV below HV means premium is cheap.', example: 'IV 24% vs HV 18% → ×1.33, premium rich' },
  dte:    { term: 'Days to expiry', short: 'Calendar days until the option expires. Less time left = faster time decay (theta).' },
  breakeven: { term: 'Break-even', short: 'The underlying price(s) where the position’s P&L crosses zero at expiry.' },
  maxprofit: { term: 'Max profit', short: 'Best P&L the position can reach at the front expiry, net of estimated fees.' },
  maxloss:{ term: 'Max loss',   short: 'Worst P&L the position can reach at the front expiry, net of estimated fees.' },
  theoprice: { term: 'Theoretical price', short: 'The model’s fair value for this contract given spot, strike, IV, days to expiry and rate.' },
  pnlnow: { term: 'P&L now',    short: 'Your position’s current profit or loss at the selected time slice, net of estimated fees. Value shown as a magnitude — the color codes the sign.' },
  pnlwhatif: { term: 'P&L what-if', short: 'Position P&L re-priced at the What-if spot / IV, net of estimated fees.' },
  payoff: { term: 'Payoff',     short: 'P&L across a range of underlying prices. The shaded band is the ±1σ / ±2σ expected move implied by IV.' },
  greeksprofile: { term: 'Greeks profile', short: 'How Δ Γ Θ V change as the underlying moves — read your risk away from the current spot.' },
  pnldist:{ term: 'P&L distribution', short: 'Probability-weighted outcomes at expiry: red bars = profit, teal = loss.' },
  pricer: { term: 'Option pricer', short: 'Fair value + Greeks for one strike. IV is pulled from the chain smile; spot and days come from the market — no manual entry.' },
  ivsurface: { term: 'IV surface', short: 'Implied volatility across every strike and expiry. Skew / smile shows where the market prices more risk.' },
};

// Drawer sections. `tabs` lists the workspaces a section is relevant to; on open
// the drawer scrolls to the first section matching the current workspace.
const HELP_SECTIONS = [
  { id: 'chain', tabs: ['chain'], title: 'Option chain', paras: [
    'Calls are on the left (red), puts on the right (teal) — Taiwan T-quote colors, used app-wide.',
    'Columns: OI = open interest, VOL = volume, Δ = delta, IV = implied volatility, BID/ASK = live quotes.',
    'The blue line and pill mark the current underlying (spot); ATM is the nearest strike.',
    'Click any quote to add it as a leg, then choose BUY or SELL. Your open legs show BUY / SELL badges on their strikes.',
  ] },
  { id: 'surface', tabs: ['calc'], title: 'Calculator — 3D P&L surface', paras: [
    'The rotating surface is your position’s P&L. Horizontal axis = underlying price; depth axis = days passing (front edge = today, back edge = expiry); height and color = profit (gold) or loss (blue).',
    'Hover to read exact numbers. Drag to orbit, scroll to zoom. It idles gently until you grab it once, then stays where you leave it.',
  ] },
  { id: 'payoff', tabs: ['calc', 'chain'], title: 'Payoff chart', paras: [
    'The solid line is P&L across underlying prices at the front expiry (the earliest-expiring leg). Drag the time slice to compare today vs expiry.',
    'Purple markers are break-evens. The shaded cone is the ±1σ / ±2σ expected move implied by current IV.',
  ] },
  { id: 'greeks', tabs: ['calc', 'chain'], title: 'The Greeks', paras: [
    'Δ Delta — value change per 1-pt move in the underlying.',
    'Γ Gamma — how fast Delta itself changes.',
    'Θ Theta — value lost per day (time decay).',
    'V Vega — value change per 1% change in implied volatility.',
    'ρ Rho — value change per 1% change in interest rates.',
  ] },
  { id: 'dist', tabs: ['calc', 'chain'], title: 'P&L distribution & POP', paras: [
    'The histogram weights each outcome by its probability at expiry (lognormal). Red bars = profit, teal = loss.',
    'POP (probability of profit) is the total chance of finishing at or above break-even.',
  ] },
  { id: 'whatif', tabs: ['calc', 'chain', 'chart', 'iv'], title: 'What-if rail', paras: [
    'The collapsible rail at the bottom-right re-prices everything at a hypothetical spot and IV without touching your real position — a quick stress test. Click it to expand.',
  ] },
  { id: 'fees', tabs: ['calc', 'chain'], title: 'Fees', paras: [
    'The P&L cards are shown net of an estimated round-trip commission + tax. The numbers are broker-dependent and can be tuned per product.',
  ] },
  { id: 'iv', tabs: ['iv'], title: 'IV surface', paras: [
    'Implied volatility across strike (X axis) and expiry (depth), built from the chain’s per-strike IVs. Grain options skew to calls (upside / drought risk); index options like TXO skew to puts (downside hedging).',
    'Drag to orbit and scroll to zoom, or switch to the HEATMAP view for a flat grid.',
    'IV vs HV compares implied volatility with how much the underlying actually moved over the last 20 days. Above ×1 the market prices more movement than realized (premium rich — favors sellers); below ×1, premium is cheap (favors buyers).',
    'Term structure lists the at-the-money IV per expiry; Skew · 25Δ is the IV gap between the 25-delta put and call — positive means downside protection costs more.',
  ] },
];

// ⑧a — hover tooltip on a single label. Reads theme from body.light so callers
// don’t have to thread it. Renders `children` plainly if there is no copy for k.
function HelpTip({ k, children }) {
  const info = HELP_COPY[k];
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  if (!info) return children || null;
  const show = () => {
    const r = ref.current && ref.current.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom });
  };
  const dark = typeof document !== 'undefined' && !document.body.classList.contains('light');
  const W = 240;
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)}
      style={{ borderBottom: '1px dotted', borderColor: 'currentColor', cursor: 'help', paddingBottom: 1 }}>
      {children}
      {pos && (
        <div style={{
          position: 'fixed',
          left: Math.max(8, Math.min(pos.x, window.innerWidth - W - 8)),
          top: Math.min(pos.y + 8, window.innerHeight - 130),
          zIndex: 60, width: W, padding: '10px 12px', borderRadius: 10,
          background: dark ? 'linear-gradient(155deg, rgba(80,90,115,0.96), rgba(30,36,50,0.98))' : 'rgba(255,255,255,0.99)',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(25,40,70,0.16)'}`,
          boxShadow: '0 20px 48px -18px rgba(0,0,0,0.7)', color: dark ? '#e8eaef' : '#1c2433',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          fontFamily: 'var(--font-display)', pointerEvents: 'none', textTransform: 'none', letterSpacing: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{info.term}</div>
          <div style={{ fontSize: 11, lineHeight: 1.5, opacity: 0.85 }}>{info.short}</div>
          {info.example && <div style={{ fontSize: 10, marginTop: 6, opacity: 0.7, fontFamily: 'ui-monospace, SF Mono, monospace' }}>{info.example}</div>}
        </div>
      )}
    </span>
  );
}

// ⑧b — the glossary drawer. Fixed to the right, scrollable, Esc / × to close.
function HelpDrawer({ open, onClose, workspace }) {
  const bodyRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  React.useEffect(() => {
    if (!open || !bodyRef.current) return;
    const sec = HELP_SECTIONS.find((s) => s.tabs.includes(workspace));
    const el = sec && bodyRef.current.querySelector(`#help-${sec.id}`);
    if (el) el.scrollIntoView({ block: 'start' });
  }, [open, workspace]);
  if (!open) return null;
  const dark = !document.body.classList.contains('light');
  return (
    <div style={{
      position: 'fixed', right: 24, top: 110, bottom: 20, width: 320, zIndex: 55,
      borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      background: dark ? 'linear-gradient(155deg, rgba(80,90,115,0.55), rgba(30,36,50,0.55))' : 'rgba(255,255,255,0.85)',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(25,40,70,0.14)'}`,
      boxShadow: '0 28px 64px -24px rgba(0,0,0,0.7)', color: dark ? '#e8eaef' : '#1c2433',
      backdropFilter: 'blur(36px) saturate(160%)', WebkitBackdropFilter: 'blur(36px) saturate(160%)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(25,40,70,0.08)'}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.7 }}>How to read this</span>
        <button onClick={onClose} title="close (Esc)" style={{ width: 24, height: 24, borderRadius: 12, border: `1px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(25,40,70,0.14)'}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
      </div>
      <div ref={bodyRef} style={{ overflowY: 'auto', padding: '4px 16px 18px' }}>
        {HELP_SECTIONS.map((s) => {
          const active = s.tabs.includes(workspace);
          return (
            <div key={s.id} id={`help-${s.id}`} style={{ padding: '14px 0', borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(25,40,70,0.06)'}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                {s.title}
                {active && <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'oklch(0.66 0.16 250)', color: '#fff', letterSpacing: 0.4 }}>THIS TAB</span>}
              </div>
              {s.paras.map((para, i) => (
                <div key={i} style={{ fontSize: 11.5, lineHeight: 1.6, opacity: 0.82, marginBottom: 6 }}>{para}</div>
              ))}
            </div>
          );
        })}
        <div style={{ fontSize: 10, opacity: 0.45, paddingTop: 12 }}>Tip: hover any dotted-underlined label for a quick definition.</div>
      </div>
    </div>
  );
}

Object.assign(window, { HELP_COPY, HELP_SECTIONS, HelpTip, HelpDrawer });
