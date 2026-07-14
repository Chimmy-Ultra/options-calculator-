// Mini-charts and gauges for the Obsidian options calc.
// Theta decay, IV smile, Probability of Profit gauge, Scenario timeline.

const { useMemo: useMemoM } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Theta decay curve — option's remaining time value as time flows forward.
// X axis: 0 = now (left) → dte days from now = expiry (right).
// Y axis: remaining time value (drops to 0 at expiry).
// This is the natural reading direction (time → moves left → right) so the curve
// visibly DECAYS instead of looking like it's growing.
function ThetaDecay({ theme = 'dark', height = 90, width = 280, dte = 17, dteMax = 30 }) {
  const W = width, H = height, pad = 14;
  const N = 40;
  // X = time elapsed from now [0, dte]. At t=0 → daysRemaining=dte (full value).
  // At t=dte → daysRemaining=0 (zero time value).
  const baseDays = Math.max(1, dteMax);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * dte;             // days elapsed
    const remaining = dte - t;           // days to expiry
    // sqrt-decay: time value ≈ k * sqrt(daysRemaining)
    const v = 0.18 * Math.sqrt(remaining / baseDays) + 0.02;
    pts.push([pad + (i / N) * (W - pad * 2), H - pad - v * (H - pad * 2) * 4.0]);
  }
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fillPath = `${path} L${pts[pts.length-1][0]},${H-pad} L${pts[0][0]},${H-pad} Z`;
  const stroke = theme === 'dark' ? '#f0c068' : '#a06f1f';
  const fill = theme === 'dark' ? 'rgba(240,192,104,0.18)' : 'rgba(217,154,44,0.18)';
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  // Marker at t=0 (now). Lives on the left edge of the chart.
  const mx = pts[0][0];
  const my = pts[0][1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      <line x1={pad} x2={W-pad} y1={H-pad} y2={H-pad} stroke={axis} />
      <path d={fillPath} fill={fill} />
      <path d={path} stroke={stroke} strokeWidth="1.5" fill="none" />
      <line x1={mx} x2={mx} y1={pad/2} y2={H-pad} stroke={txt} strokeDasharray="2 3" strokeOpacity="0.5" />
      <circle cx={mx} cy={my} r="3.5" fill={stroke} stroke={theme === 'dark' ? '#0c0e14' : '#fff'} strokeWidth="1.5" />
      <text x={pad} y={H-3} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">now</text>
      <text x={W-pad} y={H-3} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="end">expiry · {dte}d</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IV smile mini chart
function IVSmile({ theme = 'dark', height = 80, width = 280, iv = 28 }) {
  const W = width, H = height, pad = 12;
  const N = 30;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const moneyness = -1 + (2 * i) / N; // -1 OTM put .. +1 OTM call
    // Smile curve: parabola + slight skew
    const smile = (iv / 100) + 0.06 * moneyness * moneyness - 0.03 * moneyness;
    pts.push([pad + (i / N) * (W - pad * 2), H - pad - smile * 110]);
  }
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const stroke = theme === 'dark' ? '#a78bfa' : '#7c3aed';
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  // ATM marker
  const mid = pts[Math.round(N / 2)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      <line x1={pad} x2={W-pad} y1={H-pad} y2={H-pad} stroke={axis} />
      <line x1={W/2} x2={W/2} y1={pad/2} y2={H-pad} stroke={axis} strokeDasharray="2 3" />
      <path d={path} stroke={stroke} strokeWidth="1.5" fill="none" />
      <circle cx={mid[0]} cy={mid[1]} r="3" fill={stroke} stroke={theme === 'dark' ? '#0c0e14' : '#fff'} strokeWidth="1.5" />
      <text x={pad} y={H-2} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">−ITM</text>
      <text x={W/2} y={H-2} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="middle">ATM</text>
      <text x={W-pad} y={H-2} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="end">+OTM</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Probability of Profit gauge — semicircle
function POPGauge({ theme = 'dark', size = 110, value = 0.68 }) {
  const W = size, H = size * 0.62;
  const cx = W / 2, cy = H * 0.95, r = W * 0.42;
  const start = Math.PI, end = 2 * Math.PI;
  const t = Math.max(0, Math.min(1, value));
  const a = start + (end - start) * t;
  const arc = (from, to, color, width = 6) => {
    const x1 = cx + Math.cos(from) * r, y1 = cy + Math.sin(from) * r;
    const x2 = cx + Math.cos(to) * r, y2 = cy + Math.sin(to) * r;
    const large = (to - from) > Math.PI ? 1 : 0;
    return <path d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" />;
  };
  const trackColor = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(20,30,60,0.10)';
  const fillColor = t > 0.5 ? (theme === 'dark' ? '#f0c068' : '#a06f1f') : (theme === 'dark' ? '#5fa3d4' : '#2a5e8c');
  const txt = theme === 'dark' ? '#fff' : '#1d1d22';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {arc(start, end, trackColor, 6)}
      {arc(start, a, fillColor, 6)}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="600" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{Math.round(t * 100)}%</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario timeline — horizontal lane with dots
function ScenarioTimeline({ theme = 'dark', items, current }) {
  const dark = theme === 'dark';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '10px 0 4px', position: 'relative' }}>
      <div style={{ position: 'absolute', left: 8, right: 8, height: 1, top: 22, background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(20,30,60,0.10)' }} />
      {items.map((it, i) => {
        const isCurrent = i === current;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 9, opacity: 0.55, marginBottom: 6, fontFamily: 'ui-monospace, SF Mono, monospace' }}>{it.t}</div>
            <div style={{
              width: isCurrent ? 12 : 8, height: isCurrent ? 12 : 8, borderRadius: 999,
              background: it.pnl >= 0
                ? (dark ? '#f0c068' : '#a06f1f')
                : (dark ? '#5fa3d4' : '#2a5e8c'),
              boxShadow: isCurrent ? `0 0 0 4px ${dark ? 'rgba(240,192,104,0.20)' : 'rgba(217,154,44,0.18)'}` : 'none',
              transition: 'all .2s',
            }} />
            <div className="tnum" style={{ fontSize: 10, marginTop: 6, fontFamily: 'ui-monospace, SF Mono, monospace', color: it.pnl >= 0 ? (dark ? '#f0c068' : '#a06f1f') : (dark ? '#5fa3d4' : '#2a5e8c') }}>
              {it.pnl >= 0 ? '+' : ''}${it.pnl}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Greeks Profile — overlays Δ/Γ/Θ/V curves vs. spot.
// Each greek normalized to its own max-abs in range so all 4 fit one chart;
// absolute values at current spot shown in side legend.
function GreeksProfile({ legs, spot, iv = 24, dte = 17, theme = 'dark', height = 160, width = 304, model = 'bs', r = 0.015 }) {
  const W = width, H = height, pad = 18;
  const N = 60;
  const rangePct = 0.08;

  const series = useMemoM(() => {
    const xs = [];
    const dArr = [], gArr = [], tArr = [], vArr = [];
    const lo = spot * (1 - rangePct), hi = spot * (1 + rangePct);
    for (let i = 0; i <= N; i++) {
      const S = lo + (i / N) * (hi - lo);
      xs.push(S);
      const g = window.portfolioGreeks(legs, S, iv, dte, r, model);
      dArr.push(g.delta); gArr.push(g.gamma); tArr.push(g.theta); vArr.push(g.vega);
    }
    return { xs, delta: dArr, gamma: gArr, theta: tArr, vega: vArr };
  }, [legs, spot, iv, dte, model, r]);

  const colors = {
    delta: '#ef5350',  // red
    gamma: '#a78bfa',  // purple
    theta: '#26a69a',  // teal
    vega:  '#f0c068',  // gold
  };
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)';

  const x = (i) => pad + (i / N) * (W - pad * 2);
  function pathFor(arr) {
    const m = Math.max(...arr.map(Math.abs), 1e-9);
    const y = (v) => H / 2 - (v / m) * (H / 2 - pad);
    return arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  }

  const spotIdx = Math.round(N / 2);
  const valAt = (arr) => arr[spotIdx];

  // Format helpers
  const fmt = {
    delta: (v) => (v >= 0 ? '+' : '') + v.toFixed(2),
    gamma: (v) => v.toFixed(4),
    theta: (v) => (v >= 0 ? '+' : '') + v.toFixed(2),
    vega:  (v) => (v >= 0 ? '+' : '') + v.toFixed(2),
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* zero axis */}
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke={axis} strokeDasharray="2 3" />
        {/* spot vertical */}
        <line x1={x(spotIdx)} x2={x(spotIdx)} y1={pad / 2} y2={H - pad / 2} stroke={txt} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.6" />
        {/* curves */}
        <path d={pathFor(series.delta)} fill="none" stroke={colors.delta} strokeWidth="1.8" strokeOpacity="0.95" />
        <path d={pathFor(series.gamma)} fill="none" stroke={colors.gamma} strokeWidth="1.8" strokeOpacity="0.95" />
        <path d={pathFor(series.theta)} fill="none" stroke={colors.theta} strokeWidth="1.8" strokeOpacity="0.95" />
        <path d={pathFor(series.vega)}  fill="none" stroke={colors.vega}  strokeWidth="1.8" strokeOpacity="0.95" />
        {/* axis labels */}
        <text x={pad} y={H - 4} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{Math.round(series.xs[0])}</text>
        <text x={W - pad} y={H - 4} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="end">{Math.round(series.xs[N])}</text>
        <text x={x(spotIdx)} y={H - 4} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="middle">spot</text>
      </svg>
      {/* current-spot legend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
        {[
          { k: 'delta', label: 'Δ', val: fmt.delta(valAt(series.delta)) },
          { k: 'gamma', label: 'Γ', val: fmt.gamma(valAt(series.gamma)) },
          { k: 'theta', label: 'Θ', val: fmt.theta(valAt(series.theta)) },
          { k: 'vega',  label: 'V', val: fmt.vega(valAt(series.vega)) },
        ].map((it) => (
          <div key={it.k} style={{
            padding: '5px 7px', borderRadius: 6,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${colors[it.k]}33`,
          }}>
            <div style={{ fontSize: 9, opacity: 0.65, fontWeight: 600, color: colors[it.k] }}>{it.label}</div>
            <div className="tnum" style={{ fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 600 }}>{it.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L Distribution Histogram — lognormal expected-P&L distribution at expiry.
// Profit buckets red, loss buckets teal. Vertical zero line. Stats row above.
function PnLDistribution({ legs, spot, iv = 24, dte = 17, theme = 'dark', height = 160, width = 304, ntdMult = 50, cur = 'NT$' }) {
  const W = width, H = height, pad = 14;
  const dist = useMemoM(() => window.pnlDistribution(legs, spot, iv, dte), [legs, spot, iv, dte]);
  const buckets = dist.buckets;
  const maxW = Math.max(...buckets.map((b) => b.weight), 1e-9);
  const lo = dist.lo, hi = dist.hi;
  const span = Math.max(hi - lo, 1);
  const xat = (pnl) => pad + ((pnl - lo) / span) * (W - pad * 2);
  const upColor = '#ef5350';
  const downColor = '#26a69a';
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)';
  const barW = (W - pad * 2) / buckets.length - 1;
  const popPct = Math.round(dist.pop * 100);
  const ePnlNTD = Math.round(dist.expectedPnl * ntdMult);
  const p10NTD = Math.round(dist.p10 * ntdMult);
  const p90NTD = Math.round(dist.p90 * ntdMult);

  return (
    <div>
      {/* stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 10, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
        <span><span style={{ opacity: 0.55 }}>POP </span><span style={{ color: '#f0c068', fontWeight: 700 }}>{popPct}%</span></span>
        <span><span style={{ opacity: 0.55 }}>E[P&L] </span><span style={{ color: ePnlNTD >= 0 ? upColor : downColor, fontWeight: 600 }}>{ePnlNTD >= 0 ? '+' : ''}{cur}{ePnlNTD.toLocaleString()}</span></span>
        <span><span style={{ opacity: 0.55 }}>P10 </span><span style={{ color: downColor, fontWeight: 600 }}>{cur}{p10NTD.toLocaleString()}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* baseline */}
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke={axis} />
        {/* zero P&L vertical line */}
        {lo <= 0 && hi >= 0 && (
          <line x1={xat(0)} x2={xat(0)} y1={pad / 2} y2={H - pad} stroke={txt} strokeDasharray="3 3" strokeOpacity="0.55" />
        )}
        {/* bars */}
        {buckets.map((b, i) => {
          const h = (b.weight / maxW) * (H - pad * 2);
          const xLeft = xat(b.pnlLo) + 0.5;
          const w = Math.max(0.5, xat(b.pnlHi) - xat(b.pnlLo) - 1);
          const isProfit = b.pnl >= 0;
          return (
            <rect key={i}
              x={xLeft} y={H - pad - h}
              width={w} height={Math.max(h, 0.5)}
              fill={isProfit ? upColor : downColor}
              fillOpacity={isProfit ? 0.55 : 0.55}
            />
          );
        })}
        {/* p10/p90 ticks */}
        <line x1={xat(dist.p10)} x2={xat(dist.p10)} y1={H - pad - 4} y2={H - pad + 2} stroke={txt} strokeWidth="1.2" />
        <line x1={xat(dist.p90)} x2={xat(dist.p90)} y1={H - pad - 4} y2={H - pad + 2} stroke={txt} strokeWidth="1.2" />
        {/* end labels */}
        <text x={pad} y={H - 2} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{cur}{Math.round(lo * ntdMult).toLocaleString()}</text>
        <text x={W - pad} y={H - 2} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="end">{cur}{Math.round(hi * ntdMult).toLocaleString()}</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OI Profile — mirrored horizontal bars: Call OI (left, red) vs Put OI (right, teal).
// Reads chain rows from window.genChain(spot, contract). ATM row highlighted.
function OIProfile({ spot, contract = 'monthly', theme = 'dark', height, maxRows = 13, rows: rowsProp }) {
  const genRows = useMemoM(() => {
    if (rowsProp && rowsProp.length) return [];
    if (!window.genChain) return [];
    return window.genChain({ spot, contract });
  }, [spot, contract, rowsProp]);
  const rows = (rowsProp && rowsProp.length) ? rowsProp : genRows;
  // Center on ATM, take ±maxRows/2
  const center = rows.findIndex((r) => r.atm);
  const half = Math.floor(maxRows / 2);
  const visible = center >= 0
    ? rows.slice(Math.max(0, center - half), Math.min(rows.length, center + half + 1))
    : rows.slice(0, maxRows);
  const maxOI = Math.max(...visible.flatMap((r) => [r.call.oi, r.put.oi]), 1);
  const upColor = '#ef5350', downColor = '#26a69a';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.50)';
  const rowH = 16;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, opacity: 0.55, marginBottom: 6, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>
        <span style={{ color: upColor }}>Call OI</span>
        <span>Strike</span>
        <span style={{ color: downColor }}>Put OI</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visible.map((r) => {
          const cw = (r.call.oi / maxOI) * 100;
          const pw = (r.put.oi  / maxOI) * 100;
          return (
            <div key={r.strike} style={{
              display: 'grid', gridTemplateColumns: '1fr 56px 1fr', alignItems: 'center', gap: 6,
              height: rowH, position: 'relative',
              padding: r.atm ? '2px 0' : 0,
              borderRadius: r.atm ? 4 : 0,
              background: r.atm ? 'rgba(240,192,104,0.08)' : 'transparent',
              border: r.atm ? '1px solid rgba(240,192,104,0.25)' : '1px solid transparent',
            }} title={`Strike ${r.strike} · Call OI ${r.call.oi.toLocaleString()} · Put OI ${r.put.oi.toLocaleString()}`}>
              {/* Call bar — grows to the LEFT */}
              <div style={{ height: 8, position: 'relative' }}>
                <div style={{
                  position: 'absolute', right: 0, top: 0, bottom: 0,
                  width: `${cw}%`,
                  background: `linear-gradient(270deg, ${upColor}cc, ${upColor}55)`,
                  borderRadius: '4px 0 0 4px',
                }} />
              </div>
              {/* Strike label */}
              <div style={{
                fontSize: 11, fontFamily: 'ui-monospace, SF Mono, monospace',
                fontWeight: r.atm ? 700 : 500, textAlign: 'center',
                color: r.atm ? '#f7d394' : '#e8eaef',
                fontVariantNumeric: 'tabular-nums',
              }}>{r.strike}</div>
              {/* Put bar — grows to the RIGHT */}
              <div style={{ height: 8, position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${pw}%`,
                  background: `linear-gradient(90deg, ${downColor}cc, ${downColor}55)`,
                  borderRadius: '0 4px 4px 0',
                }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, opacity: 0.45, fontFamily: 'ui-monospace, SF Mono, monospace', textAlign: 'right' }}>
        max OI in view: {maxOI.toLocaleString()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Data quality indicator pill (🟢 / 🟡 / 🔴)
function DataQualityPill({ quality }) {
  if (!quality) return null;
  const dotColor = quality.level === 'good' ? '#4dd0c8' : quality.level === 'warn' ? '#f0c068' : '#ef5350';
  const ringBg   = quality.level === 'good' ? 'rgba(77,208,200,0.10)' : quality.level === 'warn' ? 'rgba(240,192,104,0.10)' : 'rgba(239,83,80,0.10)';
  const border   = quality.level === 'good' ? 'rgba(77,208,200,0.30)' : quality.level === 'warn' ? 'rgba(240,192,104,0.35)' : 'rgba(239,83,80,0.35)';
  const fmtLabel = quality.total === 0 ? '—' :
    `${quality.total - quality.bad - quality.warn}/${quality.total} liquid${quality.bad ? ` · ${quality.bad} bad` : ''}${quality.warn ? ` · ${quality.warn} thin` : ''}`;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 9px', borderRadius: 999,
      background: ringBg, border: `1px solid ${border}`,
      fontSize: 10, fontFamily: 'ui-monospace, SF Mono, monospace',
    }} title={quality.label}>
      <span style={{
        width: 7, height: 7, borderRadius: 4, background: dotColor,
        boxShadow: `0 0 6px ${dotColor}`,
      }} />
      <span style={{ opacity: 0.8 }}>{fmtLabel}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L Attribution — first-order decomposition of current P&L vs. a baseline
// (default baseline: spot=21850, iv=24%) into spot / IV / theta-per-day buckets.
//
//   spot impact ≈ Δ * (currentSpot - baseSpot)        (× 50 NTD/pt)
//   iv impact   ≈ V * (currentIV - baseIV)            (V is per-vol-pt, × 50)
//   theta /day  ≈ Θ                                   (Θ is per-day, × 50)
//
// Renders 3 horizontal diverging bars centered on a 0-line; red = profit, teal = loss.
function PnLAttribution({ legs, spot, iv, dte, theme = 'dark', height = 150, width = 304, baseSpot = 21850, baseIv = 24, ntdMult = 50, cur = 'NT$', model = 'bs', r = 0.015 }) {
  const W = width, H = height, pad = 14;
  const pg = useMemoM(() => window.portfolioGreeks
    ? window.portfolioGreeks(legs, spot, iv, dte, r, model)
    : { delta: 0, gamma: 0, theta: 0, vega: 0 }, [legs, spot, iv, dte, model, r]);
  const dSpot = spot - baseSpot;
  const dIv   = iv   - baseIv;
  const items = [
    { key: 'spot',  label: 'Spot Δ',   sub: `${baseSpot.toLocaleString()} → ${spot.toLocaleString()} (${dSpot >= 0 ? '+' : ''}${dSpot})`, value: pg.delta * dSpot * ntdMult },
    { key: 'iv',    label: 'IV Δ',     sub: `${baseIv}% → ${iv}% (${dIv >= 0 ? '+' : ''}${dIv.toFixed(1)})`, value: pg.vega * dIv * ntdMult },
    { key: 'theta', label: 'Θ /day',   sub: 'time decay if held 1 day',                                       value: pg.theta * ntdMult },
  ];
  const maxAbs = Math.max(...items.map((it) => Math.abs(it.value)), 1);
  const upColor = '#ef5350', downColor = '#26a69a';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)';
  const rowH = (H - pad * 2) / items.length;
  const cx = W / 2;
  const halfW = (W / 2) - pad;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* zero line */}
      <line x1={cx} x2={cx} y1={pad/2} y2={H - pad/2} stroke={axis} strokeDasharray="2 3" />
      {items.map((it, i) => {
        const yMid = pad + rowH * i + rowH / 2;
        const barH = Math.max(8, rowH * 0.35);
        const w = (Math.abs(it.value) / maxAbs) * halfW;
        const x = it.value >= 0 ? cx : cx - w;
        const color = it.value >= 0 ? upColor : downColor;
        return (
          <g key={it.key}>
            {/* bar */}
            <rect x={x} y={yMid - barH/2} width={Math.max(0, w)} height={barH} fill={color} fillOpacity="0.55" rx="3" />
            {/* label (left) */}
            <text x={pad} y={yMid - 4} fontSize="11" fontWeight="600" fill={theme === 'dark' ? '#e8eaef' : '#1d1d22'} fontFamily="ui-monospace, SF Mono, monospace">{it.label}</text>
            <text x={pad} y={yMid + 9} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{it.sub}</text>
            {/* value (right) */}
            <text x={W - pad} y={yMid + 4} fontSize="12" fontWeight="700" textAnchor="end" fill={color} fontFamily="ui-monospace, SF Mono, monospace">
              {it.value >= 0 ? '+' : ''}{cur}{Math.round(it.value).toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Max Pain — for each strike K (a hypothetical settlement price), compute total
// in-the-money payout to all option holders weighted by current OI:
//
//   pain(K) = Σ_i [ OI_call(K_i) * max(K - K_i, 0)  +  OI_put(K_i) * max(K_i - K, 0) ]
//
// The strike K* that minimises pain(K) = "max pain price" — the level where
// option WRITERS lose the least, i.e. where market makers theoretically want
// settlement to land. Classic TXO settlement-day indicator.
function MaxPain({ spot, contract = 'monthly', theme = 'dark', height = 160, width = 304, ntdMult = 50, cur = 'NT$', rows: rowsProp }) {
  const genRows = useMemoM(() => {
    if (rowsProp && rowsProp.length) return [];
    return window.genChain ? window.genChain({ spot, contract }) : [];
  }, [spot, contract, rowsProp]);
  const rows = (rowsProp && rowsProp.length) ? rowsProp : genRows;
  const pains = useMemoM(() => rows.map((rk) => {
    let p = 0;
    for (const ri of rows) {
      if (rk.strike > ri.strike) p += ri.call.oi * (rk.strike - ri.strike);
      if (rk.strike < ri.strike) p += ri.put.oi  * (ri.strike - rk.strike);
    }
    return { strike: rk.strike, pain: p, atm: rk.atm };
  }), [rows]);
  if (pains.length === 0) return null;
  const minIdx = pains.reduce((bi, p, i, a) => p.pain < a[bi].pain ? i : bi, 0);
  const maxPainStrike = pains[minIdx].strike;
  const W = width, H = height, pad = 16;
  const maxP = Math.max(...pains.map((p) => p.pain), 1);
  const barW = Math.max(2, (W - pad * 2) / pains.length - 2);
  const xat = (i) => pad + (i + 0.5) * ((W - pad * 2) / pains.length);
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const barColor = theme === 'dark' ? '#5fa3d4' : '#2a5e8c';
  const minColor = '#f0c068'; // gold for max pain strike
  const minPainNTD = pains[minIdx].pain * ntdMult;
  const distance = maxPainStrike - spot;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 10, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
        <span><span style={{ opacity: 0.55 }}>max pain </span><span style={{ color: minColor, fontWeight: 700, fontSize: 12 }}>{maxPainStrike}</span></span>
        <span><span style={{ opacity: 0.55 }}>vs spot </span><span style={{ color: distance >= 0 ? '#ef5350' : '#26a69a', fontWeight: 600 }}>{distance >= 0 ? '+' : ''}{distance}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* baseline */}
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke={axis} />
        {/* spot line */}
        {(() => {
          const spotIdx = pains.findIndex((p) => p.strike >= spot);
          if (spotIdx < 0) return null;
          const sx = xat(spotIdx);
          return (
            <g>
              <line x1={sx} x2={sx} y1={pad/2} y2={H - pad} stroke={txt} strokeDasharray="3 3" strokeOpacity="0.7" />
              <text x={sx} y={pad - 2} fontSize="9" fill={txt} textAnchor="middle" fontFamily="ui-monospace, SF Mono, monospace">spot</text>
            </g>
          );
        })()}
        {/* bars */}
        {pains.map((p, i) => {
          const h = (p.pain / maxP) * (H - pad * 2);
          const x = xat(i) - barW / 2;
          const isMin = i === minIdx;
          return (
            <g key={p.strike}>
              <rect
                x={x} y={H - pad - h}
                width={barW} height={Math.max(h, 0.5)}
                fill={isMin ? minColor : barColor}
                fillOpacity={isMin ? 0.85 : 0.55}
                rx="1.5"
              />
              {isMin && (
                <text x={xat(i)} y={Math.max(pad + 8, H - pad - h - 4)} fontSize="9" fill={minColor} textAnchor="middle" fontWeight="700" fontFamily="ui-monospace, SF Mono, monospace">↓</text>
              )}
            </g>
          );
        })}
        {/* x-axis labels: low / atm / high */}
        <text x={pad} y={H - 3} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{pains[0].strike}</text>
        <text x={W - pad} y={H - 3} fontSize="9" fill={txt} textAnchor="end" fontFamily="ui-monospace, SF Mono, monospace">{pains[pains.length - 1].strike}</text>
      </svg>
      <div style={{ marginTop: 4, fontSize: 9, opacity: 0.45, fontFamily: 'ui-monospace, SF Mono, monospace', textAlign: 'right' }}>
        min pain = {cur}{Math.round(minPainNTD).toLocaleString()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OptionPricer — single-contract Black-Scholes calculator (moomoo-style).
// Pick a strike + call/put, see theoretical price + full Greeks (Δ Γ V Θ Ρ).
// Manages its own type / strike / r state internally; reads spot+iv from props
// so users can sync to the global TXO_SPOT / IV slider with the "最新" buttons.
function OptionPricer({ spot, iv, dte, defaultR = 1.5, theme = 'dark', accent = '#7c5cf0', product, rows }) {
  const dark = theme === 'dark';
  // Auto pricer: spot / DTE come from the current market context (props); the IV
  // is pulled from the option-chain smile at the chosen strike, so price + Greeks
  // compute live with no manual entry. Remount on product change via key.
  const P = product || (window.getProduct && window.getProduct('txo'))
    || { cur: 'NT$', mult: 50, strikeStep: 50, model: 'bs', r: defaultR, unitLabel: '×50 NTD/pt' };
  const r = (P.r != null ? P.r : defaultR) / 100;
  const step = P.strikeStep;
  const atm = Math.round(spot / step) * step;
  const [type, setType] = React.useState('call');
  const [strike, setStrike] = React.useState(atm);
  const [marketPx, setMarketPx] = React.useState('');

  const kMin = (rows && rows.length) ? rows[0].strike : atm - 8 * step;
  const kMax = (rows && rows.length) ? rows[rows.length - 1].strike : atm + 8 * step;

  // IV at the chosen strike, pulled from the smile (nearest chain row); the chain
  // already carries the real (or mock) per-strike IV. Falls back to the ATM iv.
  const strikeIv = useMemoM(() => {
    if (rows && rows.length) {
      let best = rows[0], bd = Infinity;
      for (const row of rows) { const d = Math.abs(row.strike - strike); if (d < bd) { bd = d; best = row; } }
      const v = type === 'call' ? best.call.iv : best.put.iv;
      if (v) return v;
    }
    return iv;
  }, [rows, strike, type, iv]);

  const result = useMemoM(() => {
    const price = window.bsPrice ? window.bsPrice(type, spot, strike, strikeIv, dte, r, P.model) : 0;
    const g = window.bsGreeks
      ? window.bsGreeks(type, spot, strike, strikeIv, dte, r, P.model)
      : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    return { price, ...g };
  }, [type, spot, strike, strikeIv, dte, r, P.model]);

  const mp = parseFloat(marketPx);
  const hasMarket = !isNaN(mp) && mp > 0;
  const mispricingPct = hasMarket ? ((result.price - mp) / mp) * 100 : null;

  const labelStyle = { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.55, fontWeight: 600 };
  const fieldBg = dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,60,0.05)';
  const fieldBorder = dark ? 'rgba(255,255,255,0.10)' : 'rgba(20,30,60,0.10)';
  const fieldStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: `1px solid ${fieldBorder}`, background: fieldBg,
    color: dark ? '#e8eaef' : '#1d1d22',
    fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 13, fontWeight: 600,
    fontVariantNumeric: 'tabular-nums', outline: 'none',
  };
  const upColor = '#ef5350', downColor = '#26a69a';
  const fmtK = (k) => (step < 1 ? k.toFixed(2) : String(Math.round(k)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${fieldBorder}` }}>
        {[
          { id: 'call', label: 'CALL', color: upColor },
          { id: 'put',  label: 'PUT',  color: downColor },
        ].map((opt) => {
          const active = type === opt.id;
          return (
            <button key={opt.id} onClick={() => setType(opt.id)} style={{
              flex: 1, padding: '8px 4px', border: 'none', cursor: 'pointer',
              background: active ? `${opt.color}33` : 'transparent',
              color: active ? opt.color : (dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'),
              fontWeight: 700, fontSize: 11, letterSpacing: 0.3, fontFamily: 'inherit',
            }}>{opt.label}</button>
          );
        })}
      </div>

      {/* Strike slider — IV auto-pulled from the smile; spot / DTE from context */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={labelStyle}>Strike</span>
          <span className="tnum" style={{ fontSize: 13, fontWeight: 600, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
            {fmtK(strike)}{strike === atm ? ' · ATM' : ''}
          </span>
        </div>
        <input type="range" min={kMin} max={kMax} step={step} value={strike}
          onChange={(e) => setStrike(parseFloat(e.target.value))} style={{ width: '100%', accentColor: accent }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.5, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
          <span>{fmtK(kMin)}</span>
          <span>spot {spot.toLocaleString()} · {dte}d · IV {strikeIv.toFixed(1)}%</span>
          <span>{fmtK(kMax)}</span>
        </div>
      </div>

      {/* Big theoretical price card */}
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: 'linear-gradient(155deg, rgba(80,90,115,0.42) 0%, rgba(28,34,48,0.36) 100%)',
        border: `1px solid ${fieldBorder}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={labelStyle}>Theoretical price</div>
            <div className="tnum" style={{
              fontSize: 30, fontWeight: 700, letterSpacing: -0.6,
              fontFamily: 'ui-monospace, SF Mono, monospace', lineHeight: 1.05,
              color: dark ? '#e8eaef' : '#1d1d22',
            }}>{result.price.toFixed(2)}</div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
              ≈ {P.cur}{Math.round(result.price * P.mult).toLocaleString()} ({type === 'call' ? 'CALL' : 'PUT'} K={fmtK(strike)})
            </div>
          </div>
          {hasMarket && (
            <div style={{ textAlign: 'right' }}>
              <div style={labelStyle}>vs market</div>
              <div className="tnum" style={{
                fontSize: 18, fontWeight: 700, fontFamily: 'ui-monospace, SF Mono, monospace',
                color: mispricingPct >= 0 ? upColor : downColor,
              }}>{mispricingPct >= 0 ? '+' : ''}{mispricingPct.toFixed(2)}%</div>
              <div style={{ fontSize: 9, opacity: 0.45, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
                {mispricingPct >= 0 ? 'model > market (maybe cheap)' : 'model < market (maybe rich)'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Optional market price comparison */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>Market price (optional — check cheap / rich)</span>
        <input type="number" value={marketPx} onChange={(e) => setMarketPx(e.target.value)}
          placeholder="Enter market price…" style={fieldStyle} step="0.01" />
      </div>

      {/* Greeks row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
        {[
          { k: 'delta', l: 'Δ', v: result.delta, fmt: (x) => (x >= 0 ? '+' : '') + x.toFixed(3) },
          { k: 'gamma', l: 'Γ', v: result.gamma, fmt: (x) => x.toFixed(4) },
          { k: 'vega',  l: 'V', v: result.vega,  fmt: (x) => (x >= 0 ? '+' : '') + x.toFixed(3) },
          { k: 'theta', l: 'Θ', v: result.theta, fmt: (x) => (x >= 0 ? '+' : '') + x.toFixed(3) },
          { k: 'rho',   l: 'ρ', v: result.rho,   fmt: (x) => (x >= 0 ? '+' : '') + x.toFixed(4) },
        ].map((g) => (
          <div key={g.k} style={{
            padding: '8px 4px', borderRadius: 8, textAlign: 'center',
            background: fieldBg, border: `1px solid ${fieldBorder}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, fontFamily: 'ui-monospace, SF Mono, monospace' }}>{g.l}</div>
            <div className="tnum" style={{
              fontSize: 12, fontWeight: 700, marginTop: 2, fontFamily: 'ui-monospace, SF Mono, monospace',
              color: g.v > 0 ? upColor : g.v < 0 ? downColor : (dark ? '#e8eaef' : '#1d1d22'),
            }}>{g.fmt(g.v)}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 9, opacity: 0.4, fontFamily: 'ui-monospace, SF Mono, monospace', textAlign: 'right' }}>
        {P.model === 'b76' ? 'Black-76 · futures option' : 'Black-Scholes · European'} · {P.unitLabel}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// K 線（蠟燭圖）。mock 用 genBars 的隨機漫步；live 模式吃 IB /api/bars 的歷史 K。
// 台式配色：紅漲（收 >= 開）、綠跌 — 跟期權鏈同一套語意。
// volScale：把每根的波動縮放到對應週期（日=1、4時≈0.5、1時≈0.4），日內 K 才不會過度誇張。
function genBars({ spot, n = 60, volScale = 1, product }) {
  const ivPct = (product && product.defaultIv) || 24;
  const dailyVol = (ivPct / 100) / Math.sqrt(252) * volScale;
  // 從現價往回走隨機漫步，最後一根收在 spot
  const closes = [spot];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] / (1 + dailyVol * (Math.random() * 2 - 1) * 1.2));
  }
  closes.reverse();
  const bars = [];
  for (let i = 0; i < n; i++) {
    const c = closes[i];
    const o = i === 0 ? c * (1 + dailyVol * (Math.random() - 0.5)) : closes[i - 1];
    bars.push({
      t: '',
      o,
      h: Math.max(o, c) * (1 + dailyVol * Math.random() * 0.6),
      l: Math.min(o, c) * (1 - dailyVol * Math.random() * 0.6),
      c,
      v: Math.round(1000 + Math.random() * 4000),
    });
  }
  return bars;
}

function KBarChart({ bars, theme = 'dark', height = 160, width = 304 }) {
  if (!bars || bars.length === 0) return null;
  const W = width, H = height, padL = 6, padR = 46, padT = 8;
  const volH = Math.round(H * 0.16);
  const priceH = H - volH - padT - 8;
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const span = Math.max(hi - lo, 1e-9);
  const maxV = Math.max(...bars.map((b) => b.v), 1);
  const n = bars.length;
  const slot = (W - padL - padR) / n;
  const cw = Math.max(1.5, slot * 0.65);
  const x = (i) => padL + i * slot + slot / 2;
  const y = (p) => padT + (1 - (p - lo) / span) * priceH;
  const up = '#ef5350', down = '#26a69a'; // 台式：紅漲綠跌
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  const last = bars[n - 1];
  const lastUp = last.c >= last.o;
  const dec = hi >= 5000 ? 0 : hi >= 100 ? 1 : 2;
  const fmt = (p) => p.toFixed(dec);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* 最新收盤虛線 + 右側價標 */}
      <line x1={padL} x2={W - padR + 4} y1={y(last.c)} y2={y(last.c)}
        stroke={lastUp ? up : down} strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.55" />
      <text x={W - padR + 6} y={y(last.c) + 3.5} fontSize="10" fontWeight="700"
        fill={lastUp ? up : down} fontFamily="ui-monospace, SF Mono, monospace">{fmt(last.c)}</text>
      {/* 高低價標 */}
      <text x={W - padR + 6} y={padT + 8} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{fmt(hi)}</text>
      <text x={W - padR + 6} y={padT + priceH} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">{fmt(lo)}</text>
      {bars.map((b, i) => {
        const isUp = b.c >= b.o;
        const col = isUp ? up : down;
        const top = y(Math.max(b.o, b.c));
        const bot = y(Math.min(b.o, b.c));
        const vh = (b.v / maxV) * volH;
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
            <rect x={x(i) - cw / 2} y={top} width={cw} height={Math.max(1, bot - top)} fill={col} />
            <rect x={x(i) - cw / 2} y={H - 4 - vh} width={cw} height={Math.max(0.5, vh)} fill={col} fillOpacity="0.45" />
          </g>
        );
      })}
      {/* 首尾日期（live 才有） */}
      {bars[0].t && (
        <text x={padL} y={H - 6 - volH} fontSize="8" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">
          {bars[0].t.slice(4, 6)}/{bars[0].t.slice(6, 8)}
        </text>
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PriceChart — full-width chart for the top-level Chart tab (from the design
// mockup): candles + MA5/MA20 overlays + volume + RSI(14) subchart + OHLC
// readout. Taiwan colors: red = up, teal = down. Renders from the same `bars`
// array as KBarChart (live IB history or genBars mock).
function PriceChart({ bars, theme = 'dark', code = '', periodLabel = '', sourceLabel = '' }) {
  const dark = theme === 'dark';
  if (!bars || bars.length < 2) return null;
  const W = 768, H = 282, plotW = 720, pTop = 12, pBot = 196, vTop = 210, vBot = 274;
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const pMin = Math.min(...bars.map((b) => b.l)) * 0.998;
  const pMax = Math.max(...bars.map((b) => b.h)) * 1.002;
  const y = (p) => pTop + ((pMax - p) / (pMax - pMin)) * (pBot - pTop);
  const xw = plotW / n;
  const cx = (i) => i * xw + xw / 2;
  const bw = Math.min(7, Math.max(2, xw * 0.62));
  const vMax = Math.max(...bars.map((b) => b.v), 1);
  const up = '#ef5350', down = '#26a69a';
  const txt = dark ? 'rgba(255,255,255,0.55)' : 'rgba(20,30,50,0.55)';
  const grid = dark ? 'rgba(255,255,255,0.10)' : 'rgba(20,30,50,0.12)';
  const dec = pMax >= 5000 ? 0 : pMax >= 100 ? 1 : 2;
  const fmt = (p) => p.toFixed(dec);

  // simple moving average polyline (starts at bar k-1)
  const maPts = (k) => {
    const pts = [];
    for (let i = k - 1; i < n; i++) {
      let s = 0;
      for (let j = i - k + 1; j <= i; j++) s += closes[j];
      pts.push(cx(i).toFixed(1) + ',' + y(s / k).toFixed(1));
    }
    return pts.join(' ');
  };

  // RSI(14), Wilder smoothing; mapped into the 66px-high subchart
  const rsiPts = [];
  let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0), lo = Math.max(-d, 0);
    if (i <= 14) { ag += g / 14; al += lo / 14; }
    else { ag = (ag * 13 + g) / 14; al = (al * 13 + lo) / 14; }
    if (i >= 14) {
      const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
      rsiPts.push(cx(i).toFixed(1) + ',' + (8 + ((100 - rsi) / 100) * 52).toFixed(1));
    }
  }
  const rsiY = (v) => 8 + ((100 - v) / 100) * 52;

  const last = bars[n - 1];
  const lastUp = last.c >= last.o;
  const lastY = y(last.c);
  // Hide a grid price label if it would collide with the gold last-price label.
  const gridLines = [0.12, 0.37, 0.62, 0.87].map((f) => {
    const p = pMin + f * (pMax - pMin);
    const gy = y(p);
    return { y: gy, lab: fmt(p), hideLabel: Math.abs(gy - lastY) < 11 };
  });

  return (
    <div>
      {/* OHLC readout + overlay legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.6, fontWeight: 600 }}>
          {code}{periodLabel ? ` · ${periodLabel}` : ''}
        </span>
        <span className="tnum" style={{ fontSize: 11, fontFamily: 'ui-monospace, SF Mono, monospace', opacity: 0.85, display: 'inline-flex', gap: 12 }}>
          <span><span style={{ opacity: 0.5 }}>O</span> {fmt(last.o)}</span>
          <span><span style={{ opacity: 0.5 }}>H</span> {fmt(last.h)}</span>
          <span><span style={{ opacity: 0.5 }}>L</span> {fmt(last.l)}</span>
          <span><span style={{ opacity: 0.5 }}>C</span> <b style={{ color: lastUp ? up : down }}>{fmt(last.c)}</b></span>
        </span>
        <span style={{ display: 'inline-flex', gap: 10, fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', opacity: 0.8 }}>
          <span><i style={{ display: 'inline-block', width: 14, height: 2, background: '#f0c068', verticalAlign: 'middle', marginRight: 4 }} />MA5</span>
          <span><i style={{ display: 'inline-block', width: 14, height: 2, background: '#5fa3d4', verticalAlign: 'middle', marginRight: 4 }} />MA20</span>
          <span><i style={{ display: 'inline-block', width: 14, height: 2, background: '#a78bfa', verticalAlign: 'middle', marginRight: 4 }} />RSI 14</span>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', fontFamily: 'ui-monospace, Menlo, monospace' }}>
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1="0" x2={plotW} y1={g.y} y2={g.y} stroke={grid} strokeDasharray="2 4" />
            {!g.hideLabel && <text x={plotW + 6} y={g.y + 3} fontSize="9" fill={txt}>{g.lab}</text>}
          </g>
        ))}
        {bars.map((b, i) => {
          const isUp = b.c >= b.o;
          const col = isUp ? up : down;
          const top = y(Math.max(b.o, b.c));
          const bh = Math.max(1.2, Math.abs(y(b.o) - y(b.c)));
          const vh = (b.v / vMax) * (vBot - vTop);
          return (
            <g key={i}>
              <line x1={cx(i)} x2={cx(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
              <rect x={cx(i) - bw / 2} y={top} width={bw} height={bh} fill={col} rx="1" />
              <rect x={cx(i) - bw / 2} y={vBot - vh} width={bw} height={Math.max(0.5, vh)} fill={col} fillOpacity="0.45" />
            </g>
          );
        })}
        <polyline points={maPts(5)} fill="none" stroke="#f0c068" strokeWidth="1.4" strokeLinejoin="round" />
        <polyline points={maPts(20)} fill="none" stroke="#5fa3d4" strokeWidth="1.4" strokeLinejoin="round" />
        <line x1="0" x2={plotW} y1={y(last.c)} y2={y(last.c)} stroke="#f0c068" strokeWidth="0.8" strokeDasharray="4 3" strokeOpacity="0.7" />
        <text x={plotW + 6} y={y(last.c) + 3.5} fontSize="10" fontWeight="700" fill="#f0c068">{fmt(last.c)}</text>
      </svg>

      <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600, margin: '10px 0 4px' }}>RSI · 14</div>
      <svg viewBox={`0 0 ${W} 66`} width="100%" style={{ display: 'block', fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <line x1="0" x2={plotW} y1={rsiY(70)} y2={rsiY(70)} stroke={grid} strokeDasharray="2 4" />
        <line x1="0" x2={plotW} y1={rsiY(30)} y2={rsiY(30)} stroke={grid} strokeDasharray="2 4" />
        <text x={plotW + 6} y={rsiY(70) + 3} fontSize="9" fill={txt}>70</text>
        <text x={plotW + 6} y={rsiY(30) + 3} fontSize="9" fill={txt}>30</text>
        <polyline points={rsiPts.join(' ')} fill="none" stroke="#a78bfa" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>

      {sourceLabel && (
        <div style={{ marginTop: 12, fontSize: 10, opacity: 0.5, fontFamily: 'ui-monospace, Menlo, monospace' }}>{sourceLabel}</div>
      )}
    </div>
  );
}

Object.assign(window, { ThetaDecay, IVSmile, POPGauge, ScenarioTimeline, GreeksProfile, PnLDistribution, OIProfile, DataQualityPill, PnLAttribution, MaxPain, OptionPricer, genBars, KBarChart, PriceChart });
