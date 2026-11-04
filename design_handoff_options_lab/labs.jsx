// labs.jsx — the 關卡 page's 「✨ 實驗室精選」 block (2026-11): two showpieces
// built only from data the snapshot already carries.
//  1. 市場隱含機率地圖 — the settlement-price distribution the option market
//     prices for every listed expiry (Breeden–Litzenberger: the density is
//     the second derivative of the call price in strike), drawn as ridgelines,
//     with a price cursor that reads P(settle above / below) per expiry.
//  2. 籌碼指標回測 — whether 散戶多空比 / P/C / 外資 positioning has said
//     anything about TX's next day and next five days so far.
// Exports on window.* like the other .jsx files; hooks are aliased (classic
// scripts share one global scope).
const { useState: lbS, useMemo: lbM, useRef: lbR, useEffect: lbE } = React;

const LB_UP = '#ef5350', LB_DOWN = '#26a69a', LB_GOLD = '#f0c068';
const lbN = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const lbPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v > 0.995 || v < 0.005 ? 1 : 0)}%`);

// Width of an element, kept current (charts draw at 1 viewBox unit = 1px).
// A callback ref, so an element that only appears once the data has loaded
// is still measured.
function useLbWidth(init = 800) {
  const [el, setEl] = lbS(null);
  const [w, setW] = lbS(init);
  lbE(() => {
    if (!el || !window.ResizeObserver) return undefined;
    const ro = new ResizeObserver((es) => { const x = Math.round(es[0].contentRect.width); if (x > 0) setW(x); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

// ───────────────────────────────────────────── 1. implied distribution
function lbSolve3(A, b) {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    [m[i], m[p]] = [m[p], m[i]];
    if (Math.abs(m[i][i]) < 1e-14) return null;
    for (let j = i + 1; j < 3; j++) { const f = m[j][i] / m[i][i]; for (let k = i; k < 4; k++) m[j][k] -= f * m[i][k]; }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { let s = m[i][3]; for (let k = i + 1; k < 3; k++) s -= m[i][k] * x[k]; x[i] = s / m[i][i]; }
  return x;
}

// The risk-neutral density of the settlement price for one expiry.
// Smile: total variance w(k) = σ²T in log-moneyness k = ln(K/F), fitted as a
// quadratic by vega-weighted least squares on each strike's out-of-the-money
// IV (the snapshot inverts IV from 結算價). Smooth by construction, so its
// second derivative is a usable density; wings are floored and any negative
// slice clipped, then the curve is renormalised to integrate to one.
// Check on 2026/11/04: every expiry's mean lands within 0.1% of its forward.
function lbDensity(chain, T) {
  const F = chain && chain.forward;
  if (!(F > 0) || !(T > 0) || !chain.rows) return null;
  const pts = [];
  for (const r of chain.rows) {
    const side = r.strike >= F ? 'call' : 'put';
    const iv = r[side] && r[side].iv;
    if (iv > 3 && iv < 250) pts.push({ k: Math.log(r.strike / F), w: (iv / 100) ** 2 * T });
  }
  if (pts.length < 5) return null;
  const atm = pts.reduce((a, b) => (Math.abs(b.k) < Math.abs(a.k) ? b : a));
  const sd = Math.sqrt(atm.w);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bb = [0, 0, 0];
  for (const p of pts) {
    if (Math.abs(p.k) > 3.5 * sd) continue;
    const wt = Math.exp(-p.k * p.k / (2 * (1.6 * sd) ** 2));
    const v = [1, p.k, p.k * p.k];
    for (let i = 0; i < 3; i++) { bb[i] += wt * v[i] * p.w; for (let j = 0; j < 3; j++) S[i][j] += wt * v[i] * v[j]; }
  }
  const sol = lbSolve3(S, bb);
  if (!sol) return null;
  const [a, b] = sol, c = Math.max(0, sol[2]);
  const wf = (k) => Math.max(a + b * k + c * k * k, 0.15 * atm.w);
  const N = window.normalCdf;
  const n = 420, lo = F * Math.exp(-5.5 * sd), hi = F * Math.exp(4.5 * sd), h = (hi - lo) / (n - 1);
  const K = [], C = [];
  for (let i = 0; i < n; i++) {
    const k = lo + i * h, w = wf(Math.log(k / F)), s = Math.sqrt(w);
    const d1 = (Math.log(F / k) + w / 2) / s;
    K.push(k); C.push(F * N(d1) - k * N(d1 - s));
  }
  const f = K.map((_, i) => (i === 0 || i === n - 1 ? 0 : Math.max(0, (C[i - 1] - 2 * C[i] + C[i + 1]) / (h * h))));
  const tot = f.reduce((x, y) => x + y, 0) * h;
  if (!(tot > 0)) return null;
  const pdf = f.map((v) => v / tot);
  let acc = 0;
  const cdf = pdf.map((v) => (acc += v * h));
  const q = (p) => K[Math.max(0, cdf.findIndex((x) => x >= p))];
  const imax = pdf.indexOf(Math.max(...pdf));
  // Lognormal at the ATM variance, for the comparison outline.
  const ln = K.map((k) => { const z = (Math.log(k / F) + atm.w / 2) / sd; return Math.exp(-z * z / 2) / (k * sd * Math.sqrt(2 * Math.PI)); });
  const above = (x) => {
    if (x <= K[0]) return 1;
    if (x >= K[n - 1]) return 0;
    const i = Math.min(n - 2, Math.floor((x - lo) / h));
    const c0 = cdf[i], c1 = cdf[i + 1];
    return Math.max(0, Math.min(1, 1 - (c0 + (c1 - c0) * ((x - K[i]) / h))));
  };
  return { F, sd, atmIv: Math.sqrt(atm.w / T) * 100, K, pdf, ln, mode: K[imax], q16: q(0.16), q84: q(0.84), q025: q(0.025), q975: q(0.975), mean: K.reduce((s, k, i) => s + k * pdf[i] * h, 0), above };
}

function ImpliedDistCard({ E, spot, marks = [], light }) {
  const [boxRef, w] = useLbWidth(900);
  const [pin, setPin] = lbS(null);
  const [hoverX, setHoverX] = lbS(null);
  const sets = lbM(() => {
    if (!E || !E.chains || !E.expiries || !E.date) return [];
    const d0 = new Date(`${E.date.replace(/\//g, '-')}T13:45:00+08:00`);
    return E.expiries.map((x) => {
      const ex = new Date(`${x.id.slice(0, 4)}-${x.id.slice(4, 6)}-${x.id.slice(6)}T13:30:00+08:00`);
      const days = Math.max((ex - d0) / 864e5, 0.5);
      const d = lbDensity(E.chains[x.id], days / 365);
      return d ? { ...x, days: Math.round(days), d } : null;
    }).filter(Boolean);
  }, [E]);
  if (!sets.length) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>需要期交所選擇權報價表（每個交易日 16:30 後更新）。</div>;
  const lo = Math.min(...sets.map((s) => s.d.q025)), hi = Math.max(...sets.map((s) => s.d.q975));
  const pad = (hi - lo) * 0.04;
  const x0 = lo - pad, x1 = hi + pad;
  const pl = 132, pr = 16, rowH = 54, top = 64, H = top + rowH * sets.length + 34;
  const X = (k) => pl + (k - x0) / (x1 - x0) * (w - pl - pr);
  const kOf = (px) => x0 + (px - pl) / (w - pl - pr) * (x1 - x0);
  const cur = hoverX != null ? hoverX : pin != null ? pin : Math.round(spot / 50) * 50;
  const grid = light ? 'rgba(20,30,50,0.10)' : 'rgba(255,255,255,0.09)';
  const txt = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const step = (x1 - x0) > 12000 ? 2000 : (x1 - x0) > 5000 ? 1000 : 500;
  const ticks = [];
  for (let t = Math.ceil(x0 / step) * step; t <= x1; t += step) ticks.push(t);
  const hues = ['#4d82ff', '#6f74ff', '#8b67f5', '#a35ee6', '#bb56d4', '#d04fbf'];
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    setHoverX(px >= pl && px <= w - pr ? Math.round(kOf(px) / 10) * 10 : null);
  };
  const front = sets[0];
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5, marginBottom: 4 }}>
        市場認為 {front.date} 結算最可能落在 <span style={{ color: 'var(--blue)' }}>{lbN(Math.round(front.d.mode / 10) * 10)}</span> 附近，
        68% 機率在 {lbN(Math.round(front.d.q16 / 10) * 10)} – {lbN(Math.round(front.d.q84 / 10) * 10)} 之間
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        游標移到圖上任何價位，右邊就算出每個到期日結算在那個價位以上／以下的機率；點一下可以固定。
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={pin == null ? 'on' : ''} onClick={() => setPin(null)}>現價 {lbN(spot)}</button>
        {marks.map((m) => <button key={m.label} className={pin === m.price ? 'on' : ''} onClick={() => setPin(m.price)}>{m.label} {lbN(m.price)}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 16, alignItems: 'start' }}>
        <div ref={boxRef} style={{ minWidth: 0 }}>
          <svg width={w} height={H} style={{ display: 'block', fontFamily: 'var(--font-mono)', cursor: 'crosshair' }}
            onMouseMove={onMove} onMouseLeave={() => setHoverX(null)} onClick={() => { if (hoverX != null) setPin(hoverX); }}>
            <defs>
              {sets.map((s, i) => (
                <linearGradient key={s.id} id={`lbg-${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={hues[i % hues.length]} stopOpacity="0.55" />
                  <stop offset="1" stopColor={hues[i % hues.length]} stopOpacity="0.05" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={X(t)} x2={X(t)} y1={16} y2={H - 26} stroke={grid} />
                <text x={X(t)} y={H - 10} fontSize="11" fill={txt} textAnchor="middle">{lbN(t)}</text>
              </g>
            ))}
            {sets.map((s, i) => {
              const base = top + rowH * (i + 1);
              const peak = Math.max(...s.d.pdf);
              const hy = rowH * 1.5;
              const pts = s.d.K.map((k, j) => (k >= x0 && k <= x1 ? `${X(k).toFixed(1)},${(base - s.d.pdf[j] / peak * hy).toFixed(1)}` : null)).filter(Boolean);
              // Both curves integrate to one, so the same scale compares them fairly.
              const lnPts = s.d.K.map((k, j) => (k >= x0 && k <= x1 ? `${X(k).toFixed(1)},${(base - Math.min(s.d.ln[j] / peak, 1.25) * hy).toFixed(1)}` : null)).filter(Boolean);
              return (
                <g key={s.id}>
                  <polygon points={`${pts[0].split(',')[0]},${base} ${pts.join(' ')} ${pts[pts.length - 1].split(',')[0]},${base}`} fill={`url(#lbg-${i})`} />
                  <polyline points={lnPts.join(' ')} fill="none" stroke={txt} strokeWidth="1" strokeDasharray="3 3" />
                  <polyline points={pts.join(' ')} fill="none" stroke={hues[i % hues.length]} strokeWidth="2" strokeLinejoin="round" />
                  <line x1={X(s.d.q16)} x2={X(s.d.q84)} y1={base + 0.5} y2={base + 0.5} stroke={hues[i % hues.length]} strokeWidth="4" strokeLinecap="round" opacity="0.8" />
                  <text x={pl - 10} y={base - 14} fontSize="13" fontWeight="700" fill="var(--text)" textAnchor="end" fontFamily="var(--font-display)">{s.date} {s.type === 'monthly' ? '月選' : s.label}</text>
                  <text x={pl - 10} y={base} fontSize="11" fill={txt} textAnchor="end">剩 {s.days} 天 · IV {s.d.atmIv.toFixed(0)}%</text>
                </g>
              );
            })}
            <line x1={X(spot)} x2={X(spot)} y1={16} y2={H - 26} stroke={LB_GOLD} strokeWidth="1.5" />
            <text x={X(spot)} y={12} fontSize="11" fontWeight="700" fill={LB_GOLD} textAnchor="middle">現價 {lbN(spot)}</text>
            {cur !== spot && cur >= x0 && cur <= x1 && <>
              <line x1={X(cur)} x2={X(cur)} y1={16} y2={H - 26} stroke="var(--text)" strokeWidth="1" strokeDasharray="4 3" />
              <text x={X(cur) + 4} y={H - 30} fontSize="11" fontWeight="700" fill="var(--text)">{lbN(cur)}</text>
            </>}
          </svg>
        </div>
        <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', background: 'var(--panel2)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>結算價在 <span className="mono" style={{ color: 'var(--blue)' }}>{lbN(cur)}</span> 的</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 12px', fontSize: 12.5, alignItems: 'baseline' }}>
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>到期</span>
            <span style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'right' }}>以上</span>
            <span style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'right' }}>以下</span>
            {sets.map((s) => {
              const up = s.d.above(cur);
              return [
                <span key={`${s.id}a`}>{s.date} {s.type === 'monthly' ? '月選' : s.label}</span>,
                <b key={`${s.id}b`} className="mono tnum" style={{ color: LB_UP, textAlign: 'right' }}>{lbPct(up)}</b>,
                <b key={`${s.id}c`} className="mono tnum" style={{ color: LB_DOWN, textAlign: 'right' }}>{lbPct(1 - up)}</b>,
              ];
            })}
          </div>
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>
            最可能結算價：{sets.map((s) => `${s.label} ${lbN(Math.round(s.d.mode / 10) * 10)}`).join(' · ')}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
        彩色山形 = 選擇權報價隱含的結算價分布（Breeden–Litzenberger：買權價格對履約價的二次微分），底下的粗線是 68% 區間；灰色虛線 = 只用價平 IV 的常態假設。
        彩色曲線左邊比虛線厚，代表市場替「大跌」付了比較多的保險費。這是風險中立機率，不是預測。資料：期交所 {E.date} 各履約價結算價反推的 IV。
      </div>
    </div>
  );
}

// ───────────────────────────────────────────── 2. positioning backtest
// Do the positioning numbers say anything about what TX does next? For each
// indicator, sessions are split into thirds by its value; the top and bottom
// thirds are compared on the next session's and the next five sessions'
// close-to-close return of the TX front month (day session). The gap is
// tested with Welch's t; five-day windows overlap, so their t is divided by
// √5 (overlapping returns share four of five days). |t| < 2 reads as no
// reliable difference. Sources: taifex-history.js (retail since 2026-07,
// P/C since 2026-07, 外資 since 2026-09) and the snapshot's daily bars.
function lbStats(a) {
  const n = a.length;
  if (!n) return null;
  const m = a.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
  return { n, m, sd, up: a.filter((x) => x > 0).length / n };
}
function lbBacktest(rows, bars) {
  const ix = {};
  bars.forEach((b, i) => { const t = String(b.t); ix[`${t.slice(0, 4)}/${t.slice(4, 6)}/${t.slice(6, 8)}`] = i; });
  const fwd = (d, k) => { const i = ix[d]; return (i == null || i + k >= bars.length) ? null : (bars[i + k].c / bars[i].c - 1) * 100; };
  const pts = rows.map(([d, v]) => ({ d, v, r1: fwd(d, 1), r5: fwd(d, 5) })).filter((p) => Number.isFinite(p.v) && p.r1 != null);
  if (pts.length < 15) return null;
  const vs = pts.map((p) => p.v).sort((a, b) => a - b);
  const lo = vs[Math.floor(vs.length / 3)], hi = vs[Math.floor(2 * vs.length / 3)];
  const side = (f, key) => lbStats(pts.filter(f).map((p) => p[key]).filter((x) => x != null));
  const res = {};
  for (const [key, adj] of [['r1', 1], ['r5', Math.sqrt(5)]]) {
    const H = side((p) => p.v >= hi, key), L = side((p) => p.v <= lo, key);
    const se = H && L && H.n > 1 && L.n > 1 ? Math.sqrt(H.sd ** 2 / H.n + L.sd ** 2 / L.n) : null;
    res[key] = { hi: H, lo: L, t: se ? (H.m - L.m) / se / adj : null };
  }
  return { n: pts.length, lo, hi, pts, from: pts[0].d, to: pts[pts.length - 1].d, ...res };
}

const LB_INDICATORS = [
  { id: 'rmtx', name: '散戶多空比 · 小台', unit: '%', dp: 1, rows: (H) => (H.retail && H.retail.MTX || []).map((r) => [r[0], r[1]]), hint: '常被當反向指標：散戶越偏多，越容易跌' },
  { id: 'rtmf', name: '散戶多空比 · 微台', unit: '%', dp: 1, rows: (H) => (H.retail && H.retail.TMF || []).map((r) => [r[0], r[1]]), hint: '同上，微台散戶比重更高' },
  { id: 'pc', name: 'P/C 未平倉比', unit: '', dp: 2, rows: (H) => (H.pc || []).map((r) => [r[0], r[1]]), hint: '賣權多 = 避險或看空的人多' },
  { id: 'fx', name: '外資期貨淨部位', unit: '口', dp: 0, rows: (H) => (H.fx || []).map((r) => [r[0], r[1]]), hint: '負數 = 淨空單；越負越偏空' },
  { id: 'fxd', name: '外資淨部位 · 單日增減', unit: '口', dp: 0, rows: (H) => (H.fx || []).slice(1).map((r, i) => [r[0], r[1] - H.fx[i][1]]), hint: '當天加空還是回補' },
];

function BacktestCard({ H, bars, light }) {
  const [sel, setSel] = lbS('rmtx');
  const [boxRef, w] = useLbWidth(520);
  const results = lbM(() => (H && bars && bars.length ? LB_INDICATORS.map((ind) => ({ ind, r: lbBacktest(ind.rows(H), bars) })).filter((x) => x.r) : []), [H, bars]);
  if (!results.length) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>需要籌碼歷史和日 K（每個交易日 16:30 後更新）。</div>;
  const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`);
  const col = (v) => (v > 0 ? LB_UP : v < 0 ? LB_DOWN : 'var(--text)');
  const cell = (s) => (s ? <span><b className="mono tnum" style={{ color: col(s.m) }}>{pct(s.m)}</b><span style={{ color: 'var(--muted)', fontSize: 11 }}> · 漲 {Math.round(s.up * 100)}%</span></span> : '—');
  const verdict = (t) => (t == null ? { text: '樣本不足', c: 'var(--muted)' } : Math.abs(t) >= 2 ? { text: '有差異（待更多樣本確認）', c: LB_GOLD } : { text: '看不出差別', c: 'var(--muted)' });
  const any = results.some((x) => (x.r.r1.t != null && Math.abs(x.r.r1.t) >= 2) || (x.r.r5.t != null && Math.abs(x.r.r5.t) >= 2));
  const cur = results.find((x) => x.ind.id === sel) || results[0];
  // Scatter: indicator value vs next-5-session return, thirds shaded.
  const sp = cur.r.pts.filter((p) => p.r5 != null);
  const Hh = 230, pl = 52, pr = 14, pt = 12, pb = 30;
  const vx = sp.map((p) => p.v), vy = sp.map((p) => p.r5);
  const xLo = Math.min(...vx), xHi = Math.max(...vx), yAbs = Math.max(1, ...vy.map((v) => Math.abs(v))) * 1.1;
  const X = (v) => pl + (v - xLo) / ((xHi - xLo) || 1) * (w - pl - pr);
  const Y = (v) => pt + (yAbs - v) / (2 * yAbs) * (Hh - pt - pb);
  const txt = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const grid = light ? 'rgba(20,30,50,0.10)' : 'rgba(255,255,255,0.09)';
  const fmtV = (v) => `${lbN(v, cur.ind.dp)}${cur.ind.unit}`;
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5, marginBottom: 4 }}>
        {any ? '有指標出現差異，但樣本還少，先當參考就好' : '以目前的資料，這些籌碼指標都看不出能可靠預測台指接下來的漲跌'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
        把每個交易日依指標高低分成三等份，比較「最高三分之一」和「最低三分之一」之後台指期的表現。差距要大到統計上站得住（|t| ≥ 2）才算有意義；樣本每天自動增加，結論會跟著更新。
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.3fr) 66px repeat(4, minmax(128px, 1fr)) minmax(140px, 1fr)', gap: 0, fontSize: 12.5, minWidth: 900 }}>
          {['指標', '樣本', '偏高時 · 隔天', '偏低時 · 隔天', '偏高時 · 5 天後', '偏低時 · 5 天後', '結論'].map((h, k) => (
            <span key={h} style={{ fontSize: 11, color: 'var(--muted)', padding: `4px 12px 4px ${k ? 0 : 6}px`, borderBottom: '1px solid var(--border)' }}>{h}</span>
          ))}
          {results.map(({ ind, r }) => {
            const v1 = verdict(r.r1.t), v5 = verdict(r.r5.t);
            const on = ind.id === cur.ind.id;
            const rowStyle = { padding: '8px 12px 8px 0', borderBottom: '1px solid var(--border)', background: on ? 'var(--chip)' : 'transparent', cursor: 'pointer' };
            return [
              <span key={`${ind.id}0`} style={{ ...rowStyle, fontWeight: 700, paddingLeft: 6, borderRadius: '8px 0 0 8px' }} onClick={() => setSel(ind.id)}>{ind.name}</span>,
              <span key={`${ind.id}1`} className="mono" style={{ ...rowStyle, color: 'var(--text2)' }} onClick={() => setSel(ind.id)}>{r.n} 天</span>,
              <span key={`${ind.id}2`} style={rowStyle} onClick={() => setSel(ind.id)}>{cell(r.r1.hi)}</span>,
              <span key={`${ind.id}3`} style={rowStyle} onClick={() => setSel(ind.id)}>{cell(r.r1.lo)}</span>,
              <span key={`${ind.id}4`} style={rowStyle} onClick={() => setSel(ind.id)}>{cell(r.r5.hi)}</span>,
              <span key={`${ind.id}5`} style={rowStyle} onClick={() => setSel(ind.id)}>{cell(r.r5.lo)}</span>,
              <span key={`${ind.id}6`} style={{ ...rowStyle, borderRadius: '0 8px 8px 0', fontSize: 12 }} onClick={() => setSel(ind.id)}>
                <span style={{ color: v1.c }}>隔天 {v1.text}</span><br /><span style={{ color: v5.c }}>5 天 {v5.text}</span>
              </span>,
            ];
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div ref={boxRef} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{cur.ind.name} vs. 之後 5 天台指漲跌<span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginLeft: 8 }}>每一點是一天 · 點表格換指標</span></div>
          <svg width={w} height={Hh} style={{ display: 'block', fontFamily: 'var(--font-mono)' }}>
            <rect x={pl} y={pt} width={Math.max(0, X(cur.r.lo) - pl)} height={Hh - pt - pb} fill={LB_DOWN} fillOpacity="0.07" />
            <rect x={X(cur.r.hi)} y={pt} width={Math.max(0, w - pr - X(cur.r.hi))} height={Hh - pt - pb} fill={LB_UP} fillOpacity="0.07" />
            {[-yAbs * 0.8, -yAbs * 0.4, 0, yAbs * 0.4, yAbs * 0.8].map((v) => (
              <g key={v}>
                <line x1={pl} x2={w - pr} y1={Y(v)} y2={Y(v)} stroke={grid} strokeWidth={v === 0 ? 1.4 : 1} />
                <text x={pl - 6} y={Y(v) + 3.5} fontSize="10.5" fill={txt} textAnchor="end">{v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(1)}%</text>
              </g>
            ))}
            {sp.map((p) => <circle key={p.d} cx={X(p.v)} cy={Y(p.r5)} r="4" fill={p.r5 >= 0 ? LB_UP : LB_DOWN} fillOpacity="0.75" />)}
            <text x={pl} y={Hh - 8} fontSize="10.5" fill={txt}>{fmtV(xLo)}</text>
            <text x={w - pr} y={Hh - 8} fontSize="10.5" fill={txt} textAnchor="end">{fmtV(xHi)}</text>
            <text x={(pl + w - pr) / 2} y={Hh - 8} fontSize="10.5" fill={txt} textAnchor="middle">← 偏低三分之一　　{cur.ind.name}　　偏高三分之一 →</text>
          </svg>
        </div>
        <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', background: 'var(--panel2)', fontSize: 12.5, lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{cur.ind.name}</div>
          <div style={{ color: 'var(--text2)' }}>{cur.ind.hint}</div>
          <div style={{ marginTop: 6 }}>偏高 = {fmtV(cur.r.hi)} 以上 · 偏低 = {fmtV(cur.r.lo)} 以下</div>
          <div>資料 {cur.r.from} – {cur.r.to}，共 {cur.r.n} 天</div>
          <div style={{ marginTop: 6 }}>隔天 t = {cur.r.r1.t != null ? cur.r.r1.t.toFixed(2) : '—'} · 5 天 t = {cur.r.r5.t != null ? cur.r.r5.t.toFixed(2) : '—'}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
        方法：指標是當天收盤後公布的數字，報酬是台指期近月日盤收盤到下一個（或第 5 個）交易日收盤。t 為 Welch 檢定；5 天報酬彼此重疊，t 已除以 √5 校正。幾個月的資料只能看出很大的效果，「看不出差別」不代表指標沒用，只代表目前證據不夠。
      </div>
    </div>
  );
}

// The block itself: a section title and the two cards.
function LabsShowcase({ P, spot, H, bars, marks = [], light }) {
  const E = window.TAIFEX_EOD && window.TAIFEX_EOD.product === P.id ? window.TAIFEX_EOD : null;
  if (P.oiSource !== 'taifex') return null;
  return (
    <div>
      <div className="sec-title">✨ 實驗室精選<small>用期交所資料做的兩個分析</small></div>
      <div className="card" style={{ padding: '18px 20px', marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>🔮 市場隱含機率地圖</div>
        <ImpliedDistCard E={E} spot={spot} marks={marks} light={light} />
      </div>
      <div className="card" style={{ padding: '18px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>📊 籌碼指標回測：這些數字真的有用嗎？</div>
        <BacktestCard H={H} bars={bars} light={light} />
      </div>
    </div>
  );
}

Object.assign(window, { lbDensity, ImpliedDistCard, lbBacktest, BacktestCard, LabsShowcase });
