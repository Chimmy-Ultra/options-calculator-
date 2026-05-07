// Shared atoms used across all three directions.
// Glass primitive, payoff chart, cross-section chart, leg editor, sliders.

const { useState, useEffect, useRef, useMemo } = React;

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
  // rangePct = ±% around spot. Default 8% (much tighter than old 30%).
  const xs = useMemo(() => {
    const arr = [];
    const lo = spot * (1 - rangePct), hi = spot * (1 + rangePct);
    for (let i = 0; i <= 80; i++) arr.push(lo + (i / 80) * (hi - lo));
    return arr;
  }, [spot, rangePct]);
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
      {showCone && (
        <g>
          <rect x={xat(twoSigDown)} y={pad/2} width={Math.max(0, xat(twoSigUp) - xat(twoSigDown))} height={H - pad} fill={coneColor} fillOpacity="0.5" />
          <rect x={xat(oneSigDown)} y={pad/2} width={Math.max(0, xat(oneSigUp) - xat(oneSigDown))} height={H - pad} fill={coneColor} />
        </g>
      )}
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '52px 52px 1fr 1fr 36px', gap: 8, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: headerColor, padding: '0 4px' }}>
        <span>Side</span><span>Type</span><span>Strike</span><span>Premium</span><span style={{ textAlign: 'right' }}>Qty</span>
      </div>
      {legs.map((leg, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '52px 52px 1fr 1fr 36px', gap: 8,
          padding: '8px 8px', borderRadius: 10, background: rowBg, border: `1px solid ${rowBorder}`, alignItems: 'center'
        }}>
          <button
            onClick={() => update(i, { side: leg.side === 'long' ? 'short' : 'long' })}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              padding: '4px 6px', borderRadius: 6, border: 'none', cursor: 'pointer',
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
              padding: '4px 6px', borderRadius: 6, border: `1px solid ${rowBorder}`, cursor: 'pointer',
              background: 'transparent', color: dark ? '#e8eaef' : '#1d1d22',
            }}
          >{leg.type}</button>
          <NumField value={leg.strike} step={1} onChange={(v) => update(i, { strike: v })} dark={dark} />
          <NumField value={leg.premium} step={0.05} onChange={(v) => update(i, { premium: v })} dark={dark} />
          <NumField value={leg.qty} step={1} onChange={(v) => update(i, { qty: v })} dark={dark} align="right" />
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

Object.assign(window, { Glass, PayoffChart, CrossSection, Slider, LegEditor, NumField, GreekChip, Surface3DMount, STRATEGIES, DEFAULT_LEGS, legPayoff });
