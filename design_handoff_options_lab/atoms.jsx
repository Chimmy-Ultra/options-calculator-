// Shared atoms used across all three directions.
// Glass primitive, payoff chart, cross-section chart, leg editor, sliders.

const { useState, useEffect, useRef, useMemo } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Viewport detection — phone / foldable-inner / desktop.
// Returns { width, height, layout } where layout is 'phone' | 'fold' | 'desk'.
// 'phone' < 640  (cover screen of a foldable, or a normal phone in portrait)
// 'fold'  640-1023  (foldable inner, tablet, narrow desktop)
// 'desk'  ≥ 1024 (full desktop)
function useViewport() {
  const [vp, setVp] = useState(() => {
    if (typeof window === 'undefined') return { width: 1440, height: 900, layout: 'desk' };
    return classify(window.innerWidth, window.innerHeight);
  });
  useEffect(() => {
    let raf = 0;
    function onResize() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(classify(window.innerWidth, window.innerHeight)));
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return vp;
}
function classify(w, h) {
  let layout = 'desk';
  if (w < 640) layout = 'phone';
  else if (w < 1024) layout = 'fold';
  return { width: w, height: h, layout };
}

// ─────────────────────────────────────────────────────────────────────────────
// Glass primitive — variants: 'light' | 'dark' | 'paper'
function Glass({ variant = 'light', radius = 18, padding = 20, style, children, className = '', ...rest }) {
  const base = {
    borderRadius: radius,
    padding,
    backdropFilter: 'blur(28px) saturate(140%)',
    WebkitBackdropFilter: 'blur(28px) saturate(140%)',
    position: 'relative',
    overflow: 'hidden',
  };
  const variants = {
    light: {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.46) 100%)',
      border: '1px solid rgba(255,255,255,0.85)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 8px 24px -12px rgba(20,30,60,0.25), 0 1px 2px rgba(20,30,60,0.06)',
      color: '#1d1d22',
    },
    dark: {
      background: 'linear-gradient(180deg, rgba(40,46,60,0.55) 0%, rgba(20,24,34,0.40) 100%)',
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.10) inset, 0 12px 36px -16px rgba(0,0,0,0.7)',
      color: '#e8eaef',
    },
    paper: {
      background: 'linear-gradient(180deg, rgba(255,253,250,0.82) 0%, rgba(252,248,242,0.62) 100%)',
      border: '1px solid rgba(60,40,20,0.08)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 6px 20px -10px rgba(60,40,20,0.18)',
      color: '#231f1c',
    },
  };
  return (
    <div className={`glass glass-${variant} ${className}`} style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2D payoff at expiry (SVG) — with probability cone overlay and time-slice
function PayoffChart({ legs, spot, theme = 'light', height = 160, width = 420, iv = 28, dte = 30, showCone = false, sliceFrac = 1, rangePct = 0.08, showKeyNumbers = false }) {
  // Auto-fit X range around the legs' strikes + spot, with a margin. Falls back to
  // spot ± rangePct when there are no legs. The previous fixed rangePct made narrow
  // strategies (e.g. 200pt-wide bull-call) look flat because the elbow sat in 10%
  // of the chart while the rest was just capped max-profit / max-loss plateaus.
  const xs = useMemo(() => {
    let lo, hi;
    if (legs && legs.length > 0) {
      const strikes = legs.map((l) => l.strike);
      const strikeLo = Math.min.apply(null, [...strikes, spot]);
      const strikeHi = Math.max.apply(null, [...strikes, spot]);
      const spread = strikeHi - strikeLo;
      // Wider margin for narrow strategies (so they don't fill 100% of chart)
      // tighter margin (relative) for wide strategies (iron condor, etc.).
      const margin = Math.max(spread * 0.40, spot * 0.012);
      lo = strikeLo - margin;
      hi = strikeHi + margin;
      // We do NOT extend the X range to fit the probability cone — that would defeat
      // the strike-tight fit on narrow strategies. The cone rects are clamped to the
      // chart bounds in the render below, so they show the visible portion only.
    } else {
      lo = spot * (1 - rangePct);
      hi = spot * (1 + rangePct);
    }
    const arr = [];
    for (let i = 0; i <= 80; i++) arr.push(lo + (i / 80) * (hi - lo));
    return arr;
  }, [legs, spot, iv, dte, showCone, rangePct]);
  // payoff at slice: lerp between zero P&L (now, no time decay) and full intrinsic at expiry
  const ys = xs.map((s) => legs.reduce((acc, l) => acc + legPayoff(l, s), 0) * sliceFrac);
  const maxY = Math.max(...ys.map(Math.abs), 1);
  const pad = 16;
  const W = width, H = height;
  const x = (i) => pad + (i / (xs.length - 1)) * (W - pad * 2);
  const y = (v) => H / 2 - (v / maxY) * (H / 2 - pad);

  const segments = [];
  let cur = null;
  ys.forEach((v, i) => {
    const sign = v >= 0 ? 1 : -1;
    if (!cur || cur.sign !== sign) { if (cur) segments.push(cur); cur = { sign, pts: [[x(i), y(v)]] }; }
    else cur.pts.push([x(i), y(v)]);
  });
  if (cur) segments.push(cur);

  // Red=profit (台股上漲色), Green=loss (台股下跌色) — matches T-chart convention
  const upColor = theme === 'dark' ? '#ef5350' : '#d32f2f';
  const downColor = theme === 'dark' ? '#26a69a' : '#00897b';
  const axisColor = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)';
  const textColor = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)';
  const coneColor = theme === 'dark' ? 'rgba(167,139,250,0.18)' : 'rgba(124,58,237,0.18)';

  const linePath = ys.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const spotIdx = xs.findIndex((v) => v >= spot);

  // Find break-even points (zero crossings)
  const breakEvens = [];
  for (let i = 1; i < ys.length; i++) {
    if ((ys[i - 1] >= 0) !== (ys[i] >= 0)) {
      const t = Math.abs(ys[i - 1]) / (Math.abs(ys[i - 1]) + Math.abs(ys[i]));
      breakEvens.push(xs[i - 1] + t * (xs[i] - xs[i - 1]));
    }
  }

  // Probability cone — 1σ band from BS: σ * sqrt(t)
  const sigma = (iv / 100) * Math.sqrt(dte / 365);
  const oneSigUp = spot * (1 + sigma), oneSigDown = spot * (1 - sigma);
  const twoSigUp = spot * (1 + 2 * sigma), twoSigDown = spot * (1 - 2 * sigma);
  const xat = (s) => pad + ((s - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - pad * 2);

  // Max profit/loss within visible range
  const maxProfit = Math.max(...ys);
  const maxLoss = Math.min(...ys);
  const maxProfitIdx = ys.indexOf(maxProfit);
  const maxLossIdx = ys.indexOf(maxLoss);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {showCone && (() => {
        // Clamp cone rect to chart bounds. Without this, when σ extends beyond
        // the auto-fit range, xat() produces negative x or x > W, and the rect
        // either renders far off-screen (huge width) or distorts layout.
        const clampX = (s) => Math.max(pad, Math.min(W - pad, xat(s)));
        const x2lo = clampX(twoSigDown), x2hi = clampX(twoSigUp);
        const x1lo = clampX(oneSigDown), x1hi = clampX(oneSigUp);
        return (
          <g>
            <rect x={x2lo} y={pad/2} width={Math.max(0, x2hi - x2lo)} height={H - pad} fill={coneColor} fillOpacity="0.5" />
            <rect x={x1lo} y={pad/2} width={Math.max(0, x1hi - x1lo)} height={H - pad} fill={coneColor} />
          </g>
        );
      })()}
      <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke={axisColor} strokeWidth="1" strokeDasharray="2 3" />
      {segments.map((seg, k) => {
        if (seg.pts.length < 2) return null;
        const sX = seg.pts[0][0], eX = seg.pts[seg.pts.length - 1][0];
        const d = `M${sX},${H / 2} ` + seg.pts.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(' ') + ` L${eX},${H / 2} Z`;
        return <path key={k} d={d} fill={seg.sign > 0 ? upColor : downColor} fillOpacity="0.22" />;
      })}
      <path d={linePath} fill="none" stroke={textColor} strokeWidth="1.5" strokeOpacity="0.9" />
      {spotIdx >= 0 && (
        <g>
          <line x1={x(spotIdx)} x2={x(spotIdx)} y1={pad/2} y2={H - pad/2} stroke={textColor} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.6" />
          <circle cx={x(spotIdx)} cy={y(ys[spotIdx])} r="3.5" fill={ys[spotIdx] >= 0 ? upColor : downColor} stroke={theme === 'dark' ? '#0c0e14' : '#fff'} strokeWidth="1.5" />
        </g>
      )}
      {showKeyNumbers && breakEvens.map((be, k) => {
        const tx = xat(be);
        // place break-even labels at very top of chart so they never collide with line/spot/maxProfit
        const ty = pad - 4;
        // small horizontal anti-overlap nudge if neighbor is close
        let dx = 0;
        if (k > 0) {
          const prev = xat(breakEvens[k - 1]);
          if (Math.abs(tx - prev) < 32) dx = (tx > prev ? 1 : -1) * 16;
        }
        return (
          <g key={`be${k}`}>
            <line x1={tx} x2={tx} y1={pad + 2} y2={H - pad} stroke="#a78bfa" strokeWidth="1" strokeDasharray="2 3" strokeOpacity="0.55" />
            <text x={tx + dx} y={ty} fontSize="9" fill="#a78bfa" textAnchor="middle" fontFamily="ui-monospace, SF Mono, monospace" fontWeight="700">{be.toFixed(0)}</text>
          </g>
        );
      })}
      {showKeyNumbers && maxProfit > 0 && (
        <g>
          <circle cx={x(maxProfitIdx)} cy={y(maxProfit)} r="2.5" fill={upColor} />
          {/* anchor max profit to the right edge of chart instead of plot point so it never overlaps spot/break-evens */}
          <text x={W - pad} y={pad + 2} fontSize="10" fill={upColor} textAnchor="end" fontFamily="ui-monospace, SF Mono, monospace" fontWeight="700">↑ +{maxProfit.toFixed(0)}</text>
        </g>
      )}
      {showKeyNumbers && maxLoss < 0 && (
        <g>
          <circle cx={x(maxLossIdx)} cy={y(maxLoss)} r="2.5" fill={downColor} />
          <text x={pad} y={H - 4} fontSize="10" fill={downColor} textAnchor="start" fontFamily="ui-monospace, SF Mono, monospace" fontWeight="700">↓ {maxLoss.toFixed(0)}</text>
        </g>
      )}
      {!showKeyNumbers && (
        <>
          <text x={pad} y={H - 4} fontSize="10" fill={textColor} fontFamily="ui-monospace, SF Mono, monospace">{xs[0].toFixed(0)}</text>
          <text x={W - pad} y={H - 4} fontSize="10" fill={textColor} textAnchor="end" fontFamily="ui-monospace, SF Mono, monospace">{xs[xs.length - 1].toFixed(0)}</text>
        </>
      )}
    </svg>
  );
}

function legPayoff(leg, S) {
  const { type, side, strike, premium, qty } = leg;
  const sign = side === 'long' ? 1 : -1;
  const intrinsic = type === 'call' ? Math.max(S - strike, 0) : Math.max(strike - S, 0);
  return sign * qty * (intrinsic - premium);
}

// ─────────────────────────────────────────────────────────────────────────────
// Black-Scholes math: standard normal PDF & CDF, per-leg Greeks, portfolio aggregator.
// Used by GreeksProfile chart and PnLDistribution chart.
function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
// Abramowitz & Stegun approximation, max error ≈ 1.5e-7.
function normalCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

// Black-Scholes theoretical price for a European call/put at spot S, strike K,
// implied vol ivPct (in %), days to expiry, risk-free r (decimal). Returns price
// in points (multiply by 50 for TXO NTD).
function bsPrice(type, S, K, ivPct, dte, r = 0.015) {
  const T = Math.max(dte / 365, 1e-6);
  const sigma = Math.max(ivPct / 100, 1e-4);
  const sigmaRT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sigmaRT;
  const d2 = d1 - sigmaRT;
  if (type === 'call') {
    return S * normalCdf(d1) - K * Math.exp(-r * T) * normalCdf(d2);
  }
  return K * Math.exp(-r * T) * normalCdf(-d2) - S * normalCdf(-d1);
}

// All BS Greeks for a single contract (no qty / side scaling), suitable for the
// single-contract pricer UI. Includes Rho. Theta scaled to per-day, Vega to
// per-1-vol-pt, Rho to per-1-pct-rate.
function bsGreeks(type, S, K, ivPct, dte, r = 0.015) {
  const T = Math.max(dte / 365, 1e-6);
  const sigma = Math.max(ivPct / 100, 1e-4);
  const sigmaRT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sigmaRT;
  const d2 = d1 - sigmaRT;
  const nd1 = normalPdf(d1);
  let delta, theta, rho;
  if (type === 'call') {
    delta = normalCdf(d1);
    theta = (-S * nd1 * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normalCdf(d2);
    rho   = K * T * Math.exp(-r * T) * normalCdf(d2);
  } else {
    delta = normalCdf(d1) - 1;
    theta = (-S * nd1 * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normalCdf(-d2);
    rho   = -K * T * Math.exp(-r * T) * normalCdf(-d2);
  }
  return {
    delta,
    gamma: nd1 / (S * sigmaRT),
    theta: theta / 365,    // per day
    vega:  (S * nd1 * Math.sqrt(T)) / 100,  // per 1 vol pt
    rho:   rho / 100,      // per 1 pct rate
  };
}

// Per-leg BS Greeks at spot S, IV (percent), DTE (days), risk-free r (decimal).
// Returns { delta, gamma, theta, vega } scaled to per-day theta and per-1-vol-pt vega.
function legGreeks(leg, S, ivPct, dte, r = 0.015) {
  const { type, side, strike: K, qty } = leg;
  const T = Math.max(dte / 365, 1e-6);
  const sigma = Math.max(ivPct / 100, 1e-4);
  const sigmaRT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sigmaRT;
  const d2 = d1 - sigmaRT;
  const sign = side === 'long' ? 1 : -1;
  const nd1 = normalPdf(d1);
  let delta, theta;
  if (type === 'call') {
    delta = normalCdf(d1);
    theta = (-S * nd1 * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normalCdf(d2);
  } else {
    delta = normalCdf(d1) - 1;
    theta = (-S * nd1 * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normalCdf(-d2);
  }
  const gamma = nd1 / (S * sigmaRT);
  const vega = S * nd1 * Math.sqrt(T);
  return {
    delta: sign * qty * delta,
    gamma: sign * qty * gamma,
    theta: sign * qty * theta / 365,   // per day
    vega:  sign * qty * vega / 100,    // per 1 vol pt
  };
}

// Portfolio-level Greeks: sum of per-leg Greeks at given spot/IV/DTE.
function portfolioGreeks(legs, S, ivPct, dte, r = 0.015) {
  const acc = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    const g = legGreeks(l, S, ivPct, dte, r);
    acc.delta += g.delta; acc.gamma += g.gamma; acc.theta += g.theta; acc.vega += g.vega;
  }
  return acc;
}

// Lognormal P&L distribution at expiry: integrate over standard normal grid.
// Returns { buckets: [{ pnl, weight }], pop, expectedPnl, p10, p90 }.
function pnlDistribution(legs, spot, ivPct, dte, opts = {}) {
  const N = opts.N || 200;          // sample points along z grid
  const zMax = opts.zMax || 3.5;    // ±zMax std devs
  const sigma = (ivPct / 100) * Math.sqrt(Math.max(dte, 0.5) / 365);
  // Lognormal: S_T = spot * exp(sigma * z - sigma^2/2). Drift assumed 0 (martingale under Q).
  const samples = [];
  let totalW = 0;
  for (let i = 0; i < N; i++) {
    const z = -zMax + (2 * zMax * i) / (N - 1);
    const ST = spot * Math.exp(sigma * z - sigma * sigma / 2);
    const pnl = legs.reduce((a, l) => a + legPayoff(l, ST), 0);
    const w = normalPdf(z);
    samples.push({ z, ST, pnl, w });
    totalW += w;
  }
  // normalize weights
  for (const s of samples) s.w /= totalW;
  // Bucket P&L into histogram bins
  const pnls = samples.map((s) => s.pnl);
  const lo = Math.min(...pnls), hi = Math.max(...pnls);
  const span = Math.max(hi - lo, 1);
  const nBins = opts.bins || 30;
  const buckets = Array.from({ length: nBins }, (_, i) => ({
    pnl: lo + ((i + 0.5) / nBins) * span,
    pnlLo: lo + (i / nBins) * span,
    pnlHi: lo + ((i + 1) / nBins) * span,
    weight: 0,
  }));
  for (const s of samples) {
    let bi = Math.floor(((s.pnl - lo) / span) * nBins);
    if (bi >= nBins) bi = nBins - 1;
    if (bi < 0) bi = 0;
    buckets[bi].weight += s.w;
  }
  // Stats
  let pop = 0, expected = 0;
  for (const s of samples) {
    expected += s.pnl * s.w;
    if (s.pnl >= 0) pop += s.w;
  }
  // Sorted samples for percentiles
  const sorted = samples.slice().sort((a, b) => a.pnl - b.pnl);
  function pctile(q) {
    let cum = 0;
    for (const s of sorted) { cum += s.w; if (cum >= q) return s.pnl; }
    return sorted[sorted.length - 1].pnl;
  }
  return { buckets, pop, expectedPnl: expected, p10: pctile(0.1), p90: pctile(0.9), lo, hi };
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity / data quality scoring.
// Given chain rows (from genChain) and the user's legs, returns:
//   { level: 'good' | 'warn' | 'bad', score, badLegs: [strike,...] }
// "Bad" criteria: no matching strike in chain, OR bid-ask spread / mid > 0.30, OR OI < 50.
function legLiquidity(leg, rows) {
  const r = rows.find((rr) => rr.strike === leg.strike);
  if (!r) return { level: 'bad', reason: 'strike not listed' };
  const side = leg.type === 'call' ? r.call : r.put;
  const mid = (side.bid + side.ask) / 2;
  if (mid <= 0) return { level: 'bad', reason: 'no quote' };
  const spread = (side.ask - side.bid) / mid;
  if (side.oi < 50 || spread > 0.30) return { level: 'warn', reason: 'thin / wide spread' };
  return { level: 'good', reason: 'ok' };
}
function dataQuality(legs, rows) {
  if (!legs || legs.length === 0 || !rows || rows.length === 0) {
    return { level: 'good', label: 'no legs', bad: 0, warn: 0, total: 0 };
  }
  let bad = 0, warn = 0;
  const badLegs = [];
  for (const l of legs) {
    const q = legLiquidity(l, rows);
    if (q.level === 'bad') { bad++; badLegs.push(l.strike); }
    else if (q.level === 'warn') warn++;
  }
  const total = legs.length;
  let level = 'good';
  let label = 'all liquid';
  if (bad / total >= 0.5) { level = 'bad'; label = 'mostly illiquid'; }
  else if (bad > 0 || warn / total >= 0.5) { level = 'warn'; label = 'some thin legs'; }
  return { level, label, bad, warn, total, badLegs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-section: P&L vs spot at fixed DTE
function CrossSection({ theme = 'light', height = 110, width = 320, dte = 30 }) {
  const W = width, H = height, pad = 12;
  const N = 60;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const x = -1 + (2 * i) / N;
    const y = window.OptionsSurface.pnlValue(x, 1 - dte / 60);
    pts.push([pad + (i / N) * (W - pad * 2), H / 2 - y * (H / 2 - pad) * 1.6]);
  }
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const stroke = theme === 'dark' ? '#cdd3df' : '#1d1d22';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke={axis} strokeDasharray="2 3" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sliders
function Slider({ label, value, min, max, step = 1, onChange, suffix = '', theme = 'light', format }) {
  const dark = theme === 'dark';
  const trackBg = dark ? 'rgba(255,255,255,0.10)' : 'rgba(20,20,40,0.08)';
  const fill = dark ? '#cdd3df' : '#2a2a35';
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, opacity: 0.7, letterSpacing: 0.4, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</span>
        <span className="tnum" style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, SF Mono, monospace', whiteSpace: 'nowrap' }}>
          {format ? format(value) : value}{suffix}
        </span>
      </div>
      <div style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, height: 4, background: trackBg, borderRadius: 999 }} />
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, background: fill, borderRadius: 999, opacity: 0.85 }} />
        <input
          type="range"
          min={min} max={max} step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
        />
        <div style={{
          position: 'absolute', left: `calc(${pct}% - 8px)`, width: 16, height: 16, borderRadius: 16,
          background: dark ? 'linear-gradient(180deg,#fff,#cfd5e1)' : 'linear-gradient(180deg,#fff,#e2e2e8)',
          boxShadow: dark ? '0 2px 6px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4)' : '0 2px 4px rgba(20,30,60,0.18), 0 0 0 0.5px rgba(20,30,60,0.18)',
          pointerEvents: 'none',
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leg editor (compact rows)
function LegEditor({ legs, onChange, theme = 'light' }) {
  const dark = theme === 'dark';
  const headerColor = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
  const rowBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.55)';
  const rowBorder = dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.06)';
  function update(i, patch) {
    const next = legs.map((l, k) => (k === i ? { ...l, ...patch } : l));
    onChange(next);
  }
  function remove(i) {
    onChange(legs.filter((_, k) => k !== i));
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '54px 46px 1fr 1fr 32px 24px', gap: 6, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: headerColor, padding: '0 4px' }}>
        <span>Side</span><span>Type</span><span>Strike</span><span>Premium</span><span style={{ textAlign: 'right' }}>Qty</span><span></span>
      </div>
      {legs.map((leg, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '54px 46px 1fr 1fr 32px 24px', gap: 6,
          padding: '8px 6px 8px 8px', borderRadius: 10, background: rowBg, border: `1px solid ${rowBorder}`, alignItems: 'center'
        }}>
          <button
            onClick={() => update(i, { side: leg.side === 'long' ? 'short' : 'long' })}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              padding: '4px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: leg.side === 'long'
                ? (dark ? 'rgba(240,192,104,0.20)' : 'rgba(217,154,44,0.15)')
                : (dark ? 'rgba(95,163,212,0.20)' : 'rgba(58,127,184,0.15)'),
              color: leg.side === 'long'
                ? (dark ? '#f0c068' : '#a06f1f')
                : (dark ? '#5fa3d4' : '#2a5e8c'),
            }}
          >{leg.side === 'long' ? '+ LONG' : '− SHORT'}</button>
          <button
            onClick={() => update(i, { type: leg.type === 'call' ? 'put' : 'call' })}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              padding: '4px 4px', borderRadius: 6, border: `1px solid ${rowBorder}`, cursor: 'pointer',
              background: 'transparent', color: dark ? '#e8eaef' : '#1d1d22',
            }}
          >{leg.type}</button>
          <NumField value={leg.strike} step={1} onChange={(v) => update(i, { strike: v })} dark={dark} />
          <NumField value={leg.premium} step={0.05} onChange={(v) => update(i, { premium: v })} dark={dark} />
          <NumField value={leg.qty} step={1} onChange={(v) => update(i, { qty: v })} dark={dark} align="right" />
          <button
            onClick={() => remove(i)}
            aria-label="remove leg"
            title="remove leg"
            style={{
              width: 22, height: 22, borderRadius: 11, padding: 0,
              border: `1px solid ${rowBorder}`,
              background: 'transparent',
              color: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
              cursor: 'pointer',
              fontSize: 13, lineHeight: 1, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

function NumField({ value, step = 1, onChange, dark, align = 'left' }) {
  return (
    <input
      type="number" value={value} step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width: '100%', background: 'transparent', border: 'none', outline: 'none',
        color: dark ? '#e8eaef' : '#1d1d22', fontFamily: 'ui-monospace, SF Mono, monospace',
        fontSize: 13, fontWeight: 500, textAlign: align, padding: 0, fontVariantNumeric: 'tabular-nums',
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Greeks chip (one row)
function GreekChip({ label, value, theme = 'light', emphasis }) {
  const dark = theme === 'dark';
  const bg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.6)';
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(20,30,60,0.06)';
  return (
    <div style={{
      flex: 1, padding: '10px 12px', borderRadius: 12, background: bg, border: `1px solid ${border}`,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.6 }}>{label}</div>
      <div className="tnum" style={{
        fontSize: 18, fontWeight: 600, marginTop: 2, fontFamily: 'ui-monospace, SF Mono, monospace',
        color: emphasis === 'up' ? (dark ? '#f0c068' : '#a06f1f')
             : emphasis === 'down' ? (dark ? '#5fa3d4' : '#2a5e8c')
             : 'inherit',
      }}>{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy presets — same shape across directions
const STRATEGIES = [
  { id: 'bull-call', name: 'Bull Call Spread', tag: 'Defined risk · Bullish' },
  { id: 'bear-put', name: 'Bear Put Spread', tag: 'Defined risk · Bearish' },
  { id: 'iron-condor', name: 'Iron Condor', tag: 'Range-bound' },
  { id: 'straddle', name: 'Long Straddle', tag: 'High volatility' },
  { id: 'covered-call', name: 'Covered Call', tag: 'Income · Mildly bullish' },
  { id: 'butterfly', name: 'Long Butterfly', tag: 'Pinned · Low vol' },
];

const DEFAULT_LEGS = [
  { side: 'long', type: 'call', strike: 480, premium: 6.20, qty: 1 },
  { side: 'short', type: 'call', strike: 500, premium: 2.40, qty: 1 },
];

// 3D surface mount helper that respects React lifecycle.
function Surface3DMount({ theme = 'dark', height = 360, scheme = 'diverging', density = 'comfortable', onHover }) {
  const ref = useRef(null);
  const apiRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let pollId = 0;
    function tryMount() {
      if (cancelled) return;
      const el = ref.current;
      if (!el || !window.OptionsSurface || !window.THREE) {
        pollId = setTimeout(tryMount, 60); return;
      }
      if (el.clientWidth < 4 || el.clientHeight < 4) {
        pollId = setTimeout(tryMount, 60); return;
      }
      try {
        apiRef.current = window.OptionsSurface.make({ container: el, theme, scheme, onHover });
      } catch (e) { console.error('Surface3DMount failed', e); }
    }
    tryMount();
    return () => {
      cancelled = true; clearTimeout(pollId);
      if (apiRef.current) { try { apiRef.current.destroy(); } catch (_) {} apiRef.current = null; }
    };
  }, [theme]);
  // Live update scheme without remount
  useEffect(() => {
    if (apiRef.current && apiRef.current.setScheme) apiRef.current.setScheme(scheme);
  }, [scheme]);
  return <div ref={ref} style={{ width: '100%', height, borderRadius: 14, overflow: 'hidden', position: 'relative' }} />;
}

Object.assign(window, {
  Glass, PayoffChart, CrossSection, Slider, LegEditor, NumField, GreekChip, Surface3DMount,
  STRATEGIES, DEFAULT_LEGS,
  legPayoff, normalPdf, normalCdf, legGreeks, portfolioGreeks, pnlDistribution,
  bsPrice, bsGreeks,
  legLiquidity, dataQuality,
  useViewport,
});
