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
  straddle: { term: 'ATM straddle (價平和)', short: 'ATM call premium + ATM put premium for the selected expiry. Adding the two cancels direction, so what is left is the move the market is pricing in until expiry, in index points. ATM ± this value is the expected range.', example: 'ATM 46,150 · call 131 + put 158 → 289 pts → band 45,861–46,439' },
  resistance: { term: 'Resistance (壓力)', short: 'The strike with the largest call open interest. Read from the sellers’ side: call writers do not expect the index to close above it. The change vs the previous session shows whether the wall is still being built.' },
  support: { term: 'Support (支撐)', short: 'The strike with the largest put open interest — put writers do not expect the index to close below it.' },
  pcratio: { term: 'Put/Call OI ratio', short: 'Put open interest ÷ call open interest. The strip shows TAIFEX’s market-wide number for all TXO expiries with its 23-session trend; the OI table’s footer shows the same ratio for the selected expiry only. Above 1 = more put positions outstanding; below 1 = call-heavy.' },
  oichg: { term: 'OI change', short: 'Open interest today minus the previous session. Red = positions added, teal = closed out. A growing wall matters more than a static one.' },
  foreign: { term: '外資期貨淨部位 (foreign net futures position)', short: 'Foreign investors’ net open interest in TAIEX futures, summed across the large, mini and micro contracts in large-contract equivalents (TX + MTX/4 + TMF/20, the exchange’s own conversion). Negative = net short. Published by TAIFEX after the close.' },
  gex: { term: 'Gamma exposure (GEX)', short: 'Dealer gamma per strike, the SqueezeMetrics / SpotGamma read: γ × open interest × contract multiplier × spot² × 1%, calls counted positive and puts negative on the convention that market makers are long the calls customers sold and short the puts customers bought. Positive total GEX → dealers hedge against the move (volatility damped); negative → their hedging chases it. Call Wall / Put Wall = the strike with the largest call / put gamma·OI; the zero-gamma level is where total GEX, re-priced across spots, crosses zero. One expiry at a time, previous-session OI.', example: 'ATM γ 0.0004 × OI 3,000 × 50 × 46,000² × 1% ≈ NT$12.7 億 per 1% move' },
  maxpainlevel: { term: '最大痛苦點 (max pain)', short: 'The settlement price at which option buyers, in aggregate, collect the least: Σ call OI × max(0, S − K) + Σ put OI × max(0, K − S), minimised over the listed strikes.' },
  expmove: { term: '預期波動 (expected move)', short: 'The ±1σ move the market prices in until the selected expiry: spot × ATM IV × √(days / 365), so about 68% of outcomes land inside the band. The ATM IV is the average of the ATM call and put IV from the chain. The straddle × 0.85 rule of thumb (tastytrade) is shown beside it for comparison.', example: '46,185 × 24.3% × √(3/365) ≈ ±1,017' },
  pnlheat: { term: '損益表 (P&L by price × date)', short: 'The position’s profit or loss for a grid of underlying prices (rows, about 1% apart) and dates from today to the front expiry (columns), valued with the same model as the payoff chart at the workspace IV held constant. Red = profit, teal = loss; darker = larger. Gross of fees.' },
  volcone: { term: '波動率錐 (volatility cone)', short: 'For 5 / 10 / 20 / 60-day windows, where realized volatility has ranged over the available daily history: min / max (dashed), 25–75th percentile band, median, and today’s value (gold dots). The dashed purple line is the current ATM implied volatility — above the band means options price in more movement than the index has usually delivered over that horizon.' },
  keylevels: { term: '關鍵價位 (key levels with hit rates)', short: 'This site\'s own level set, each shown with how often the exchange\'s history actually reached it. 樞軸: the floor-trader pivots from the previous session\'s high / low / close (P = (H+L+C)/3, R1 = 2P−L, S1 = 2P−H, R2/S2 = P ± range, R3/S3 one range further — Person 2004). 前日高 / 低 / 收. 前日量價中心, 價值區 and 前日均價 come from the previous session\'s ticks (Market Profile: the most-traded price and the band holding 70% of the lots; VWAP). The hit rate is the share of past sessions whose high (for levels above) or low (below) reached the level recomputed from each session\'s predecessor — computed here from the loaded daily bars, not quoted from anyone.', example: '壓力一 47,123 · 54% → in 54% of the last 250 sessions the day\'s high reached that session\'s 壓力一' },
  costline: { term: '成本線 / 成本價', short: '自由人\'s 成本線: (session high + session low) ÷ 2, rounded half up. It steps only when the session prints a new high or low, so it draws as a staircase; price above it means shorts are under water, below it longs are. This is his stated formula (his 主力成本線 post) and it reproduces three dated screenshots to the point. Before the open the previous session\'s high / low stand in.', example: '高 22,211 · 低 22,048 → (22,211 + 22,048) ÷ 2 = 22,129.5 → 22,130' },
  intraday: { term: '當日走勢 / 多空差額', short: 'One-minute closes with the 成本線 staircase and the open line; below, 多空差額 = the running sum of each minute\'s 外盤 − 內盤 lots (his per-minute table adds up exactly this way), with the minute\'s net as bars. The 1/5/15/30/60 分 toggle re-aggregates the same ticks; the K-line tab\'s 日 / 週 / 月 comes from the daily bars. With a Shioaji session the exchange\'s own tick type decides 外盤 / 內盤; from TAIFEX\'s daily tick file (no bid / ask) the tick rule approximates it — an uptick counts as 外盤, a downtick as 內盤, unchanged inherits — and the header says so.' },
  top20: { term: '權值股 TOP20', short: 'The twenty largest TAIEX constituents by index weight — TAIFEX publishes the constituent weight table once a month (資料日期 shown) — with the previous session’s close-to-close move from TWSE’s daily closing table. Read it the 多空指南針 way: how many of the heavyweights rose, and how much index weight is behind the move (台積電 alone is over 40%).' },
  premarket: { term: '盤前脈絡 (the overseas read before the open)', short: 'What a Taiwan day trader checks before 08:45: the S&P 500 and Nasdaq-100 front-month futures, the Philadelphia Semiconductor index, VIX, TSMC\'s ADR (TSM) against 2330\'s last close, and USD/TWD — here the SGX USD/TWD future, quoted TWD per USD. Quotes come from the proxy\'s Interactive Brokers session, change against the prior close as IB reports it; without a market-data subscription IB serves them delayed or frozen, and the header says where and when they were taken. ADR 換算 = TSM × USD/TWD ÷ 5 (one ADR is five ordinary shares); 溢價 is that against 2330\'s last close — the overnight market\'s opinion of where 台積電 opens.', example: 'TSM 432.96 × 31.63 ÷ 5 = 2,739 vs 2330 收 2,410 → 溢價 +13.6%' },
  twseflows: { term: '台股籌碼日報 (TWSE institutional flows and margin)', short: 'Two after-close tables from the stock exchange, previous session: 三大法人 net buy / sell by category — 外資及陸資, 投信, 自營商 (自行 / 避險) — in NT$, and the margin balances: 融資 (financed longs) and 融券 (borrowed shorts) in 張 with the change against the day before, plus the 融資 amount. A common read: heavy 外資 net selling while 融資 climbs means retail leverage is absorbing what foreigners sell.' },
  rangelevels: { term: '關卡價 (range targets)', short: 'Intraday targets in the 多空指南針 idiom: 一壘 / 二壘 / 三壘 / 全壘 / 場外 above today’s low and below today’s high. The distances are statistics of the last 20 sessions’ day-session ranges (high − low): 一壘 = the smallest range — verified exactly against two dated 自由人 screenshots; 二壘 = 30th percentile (his own figure: 二壘 is reached on ~70% of days); 三壘 = mean; 全壘 = mean + 1σ; 場外 = the largest range. Levels beyond 一壘 are this site’s definition, not his formula. Before the session opens the previous session’s high / low stand in as the base.', example: '20-day smallest range 170 · today’s high 22,211 → 一壘↓ 22,041' },
  top10: { term: '十大交易人淨部位 (top-10 traders)', short: 'Net position (buy − sell) of the ten largest traders in the front-month TAIEX futures, from TAIFEX’s large-trader report. The institutional subset (特定法人) is in the data (/api/market → top10.specificNet).' },
};

// Drawer sections. `tabs` lists the workspaces a section is relevant to; on open
// the drawer scrolls to the first section matching the current workspace.
const HELP_SECTIONS = [
  { id: 'levels', tabs: ['levels'], title: 'Levels — the day-trading read', paras: [
    'One price ladder, spot in the middle. Above it: the resistance wall (strike with the largest call OI) and ATM + straddle; below it: ATM − straddle and the support wall (largest put OI). Each row shows its distance from spot.',
    'ATM straddle (價平和) = ATM call + ATM put for the selected expiry. It is the move the market prices in until expiry; ATM ± straddle is the expected range. It decays every session — a straddle that is not shrinking (or is growing) means expected volatility is rising. When previous-session settlement prices are available, the tile shows the change against them.',
    'Open interest is published by TAIFEX once a day after the close, so the walls are the previous session’s numbers — the way day traders use them. The change column (+/−) shows whether a wall is being built or unwound. Without the proxy, the walls come from mock data and are labeled MOCK.',
    'The same levels are drawn on the K-line as dashed lines with price tags on the right axis. Switch expiry in the strip to read weekly vs monthly walls.',
    'Also on the ladder: 最大痛苦點 (max pain — the settlement price that pays option buyers the least), the Call / Put Gamma walls and the zero-gamma level from the Gamma exposure panel, and a 預期波動 tile with the ±1σ move implied by the ATM IV until expiry.',
    'Gamma 曝險 (bottom right): dealer gamma exposure per strike in the SpotGamma idiom — γ × OI × multiplier × spot² × 1%, calls positive and puts negative. Above the zero-gamma level dealers’ hedging damps moves; below it their hedging chases them. Previous-session OI, one expiry at a time.',
    '關卡價 (below the ladder): five range targets each way, in the 多空指南針 baseball idiom. Distances come from the last 20 day-session ranges — 一壘 is the smallest of them (the one rule we could verify exactly against dated screenshots), 二壘 the 30th percentile, 三壘 the mean, 全壘 mean + 1σ, 場外 the largest. Above = today’s low + distance, below = today’s high − distance; the 距一壘 tile shows the nearer unreached 一壘. Only the two 一壘 lines go on the K-line.',
  ] },
  { id: 'chain', tabs: ['chain'], title: 'Option chain', paras: [
    'Calls are on the left (red), puts on the right (teal) — Taiwan T-quote colors, used app-wide.',
    'Columns: OI = open interest, VOL = volume, Δ = delta, IV = implied volatility, BID/ASK = live quotes.',
    'The blue line and pill mark the current underlying (spot); ATM is the nearest strike.',
    'Click any quote to add it as a leg, then choose BUY or SELL. Your open legs show BUY / SELL badges on their strikes.',
  ] },
  { id: 'surface', tabs: ['lab'], title: 'Lab — 3D P&L surface', paras: [
    'The surface is your position’s P&L. Horizontal axis = underlying price; depth axis = days passing (front edge = today, back edge = expiry); height and color = profit (gold) or loss (blue).',
    'Hover to read exact numbers. Drag to orbit, scroll to zoom. It stays where you leave it.',
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
  { id: 'whatif', tabs: ['calc', 'chain', 'chart', 'lab'], title: 'What-if rail', paras: [
    'The collapsible rail at the bottom-right re-prices everything at a hypothetical spot and IV without touching your real position — a quick stress test. Click it to expand.',
  ] },
  { id: 'fees', tabs: ['calc', 'chain'], title: 'Fees', paras: [
    'The P&L cards are shown net of an estimated round-trip commission + tax. The numbers are broker-dependent and can be tuned per product.',
  ] },
  { id: 'iv', tabs: ['lab'], title: 'Lab — IV surface', paras: [
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
          {info.example && <div style={{ fontSize: 10, marginTop: 6, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>{info.example}</div>}
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
      position: 'fixed', right: 24, top: 110, bottom: 20, width: 'min(320px, calc(100vw - 48px))', zIndex: 55,
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
