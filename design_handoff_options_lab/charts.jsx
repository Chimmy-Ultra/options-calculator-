// Mini-charts and gauges for the Obsidian options calc.
// Theta decay, IV smile, Probability of Profit gauge, Scenario timeline.

const { useMemo: useMemoM } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Theta decay curve — value of position vs. days remaining
function ThetaDecay({ theme = 'dark', height = 90, width = 280, dte = 30 }) {
  const W = width, H = height, pad = 14;
  const N = 40;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const d = (i / N) * 90; // days remaining
    // simple convex decay model: value = a * sqrt(d) + b
    const v = 0.18 * Math.sqrt(d / 90) + 0.02;
    pts.push([pad + (i / N) * (W - pad * 2), H - pad - v * (H - pad * 2) * 4.0]);
  }
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fillPath = `${path} L${pts[pts.length-1][0]},${H-pad} L${pts[0][0]},${H-pad} Z`;
  const stroke = theme === 'dark' ? '#f0c068' : '#a06f1f';
  const fill = theme === 'dark' ? 'rgba(240,192,104,0.18)' : 'rgba(217,154,44,0.18)';
  const axis = theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const txt = theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
  // Marker at current dte
  const mx = pad + (dte / 90) * (W - pad * 2);
  const myIdx = Math.round((dte / 90) * N);
  const my = pts[myIdx]?.[1] ?? H/2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      <line x1={pad} x2={W-pad} y1={H-pad} y2={H-pad} stroke={axis} />
      <path d={fillPath} fill={fill} />
      <path d={path} stroke={stroke} strokeWidth="1.5" fill="none" />
      <line x1={mx} x2={mx} y1={pad/2} y2={H-pad} stroke={txt} strokeDasharray="2 3" strokeOpacity="0.5" />
      <circle cx={mx} cy={my} r="3.5" fill={stroke} stroke={theme === 'dark' ? '#0c0e14' : '#fff'} strokeWidth="1.5" />
      <text x={pad} y={H-3} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace">0d</text>
      <text x={W-pad} y={H-3} fontSize="9" fill={txt} fontFamily="ui-monospace, SF Mono, monospace" textAnchor="end">90d</text>
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

Object.assign(window, { ThetaDecay, IVSmile, POPGauge, ScenarioTimeline });
