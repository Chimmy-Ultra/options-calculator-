// labs.jsx — the 關卡 page's 「✨ 實驗室精選」 block (2026-11): two showpieces
// built only from data the snapshot already carries.
//  1. 市場隱含機率地圖 — the settlement-price distribution the option market
//     prices for every listed expiry (Breeden–Litzenberger: the density is
//     the second derivative of the call price in strike), drawn as ridgelines,
//     with a price cursor that reads P(settle above / below) per expiry.
//  2. 當沖重播練習場 — the latest session replayed minute by minute with the
//     future hidden; buy / sell 小台 as it plays and get a scorecard.
// Exports on window.* like the other .jsx files; hooks are aliased (classic
// scripts share one global scope).
const { useState: lbS, useMemo: lbM, useRef: lbR, useEffect: lbE } = React;

const LB_UP = '#ef5350', LB_DOWN = '#26a69a', LB_GOLD = '#f0c068';
const lbN = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const lbPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v > 0.995 || v < 0.005 ? 1 : 0)}%`);

// Width of an element, kept current (charts draw at 1 viewBox unit = 1px).
function useLbWidth(init = 800) {
  const ref = lbR(null);
  const [w, setW] = lbS(init);
  lbE(() => {
    const el = ref.current;
    if (!el || !window.ResizeObserver) return undefined;
    const ro = new ResizeObserver((es) => { const x = Math.round(es[0].contentRect.width); if (x > 0) setW(x); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
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

// ───────────────────────────────────────────── 2. day-trade replay
const LB_SPEEDS = [{ id: 2, label: '慢' }, { id: 6, label: '中' }, { id: 15, label: '快' }, { id: 40, label: '極速' }];
const LB_MULT = 50; // 小台 NT$ per point
// Round-trip cost estimate per contract per side: NT$20 commission + 期交稅
// 0.002% of contract value.
const lbFee = (px) => 20 + Math.round(px * LB_MULT * 0.00002);
function bestOf(key) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return Number.isFinite(v) ? v : null; } catch (e) { return null; } }

function ReplayCard({ I, levels = [], light }) {
  const [full, setFull] = lbS(false);
  const [idx, setIdx] = lbS(0);
  const [playing, setPlaying] = lbS(false);
  const [speed, setSpeed] = lbS(6);
  const [pos, setPos] = lbS(0);          // signed contracts
  const [avg, setAvg] = lbS(0);
  const [realized, setRealized] = lbS(0);
  const [fees, setFees] = lbS(0);
  const [trades, setTrades] = lbS([]);   // closed round trips {pnl}
  const [fills, setFills] = lbS([]);     // {i, side}
  const [boxRef, w] = useLbWidth(900);
  const hoverRef = lbR(false);
  const bars = lbM(() => {
    if (!I || !I.day || !I.day.bars) return [];
    const src = (full && I.night && I.night.bars ? I.night.bars : []).concat(I.day.bars);
    return src.map((b) => ({ t: `${b[0].slice(0, 2)}:${b[0].slice(2, 4)}`, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
  }, [I, full]);
  const n = bars.length;
  const reset = () => { setIdx(0); setPlaying(false); setPos(0); setAvg(0); setRealized(0); setFees(0); setTrades([]); setFills([]); };
  lbE(() => { reset(); }, [I, full]);
  lbE(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setIdx((i) => { if (i >= n - 1) { setPlaying(false); return i; } return i + 1; }), 1000 / speed);
    return () => clearInterval(t);
  }, [playing, speed, n]);
  const px = n ? bars[idx].c : 0;
  const trade = (dir, atClose = false) => { // dir +1 buy, −1 sell, 0 flatten
    if (!n || (idx >= n - 1 && !atClose)) return;
    const q = dir === 0 ? -Math.sign(pos) * Math.abs(pos) : dir;
    if (!q) return;
    let p = pos, a = avg, real = realized, closed = [];
    for (let k = 0; k < Math.abs(q); k++) {
      const s = Math.sign(q);
      if (p !== 0 && Math.sign(p) !== s) { const pnl = (px - a) * Math.sign(p) * LB_MULT; real += pnl; closed.push(pnl); p += s; if (p === 0) a = 0; }
      else { a = (a * Math.abs(p) + px) / (Math.abs(p) + 1); p += s; }
    }
    if (Math.abs(p) > 5) return; // keep it to five contracts
    setPos(p); setAvg(a); setRealized(real); setFees((f) => f + Math.abs(q) * lbFee(px));
    if (closed.length) setTrades((t) => t.concat(closed.map((x) => ({ pnl: x }))));
    setFills((f) => f.concat([{ i: idx, side: Math.sign(q) }]));
  };
  lbE(() => {
    const onKey = (e) => {
      if (!hoverRef.current || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); setPlaying((v) => !v); }
      else if (k === 'b') trade(1);
      else if (k === 's') trade(-1);
      else if (k === 'f') trade(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Personal best per session and session type, in this browser only.
  const bestKey = `optionsLab.replayBest.${I && I.date}.${full ? 'full' : 'day'}`;
  const doneNow = n > 0 && idx >= n - 1;
  // At the close an open position is flattened at the last price (a day
  // trade doesn't carry overnight), then the score is final.
  lbE(() => { if (doneNow && pos !== 0) trade(0, true); }, [doneNow, pos]);
  lbE(() => {
    if (!doneNow || pos !== 0 || !trades.length) return;
    const score = Math.round(realized - fees);
    const prev = bestOf(bestKey);
    if (prev == null || score > prev) { try { localStorage.setItem(bestKey, JSON.stringify(score)); } catch (e) { /* storage off */ } }
  }, [doneNow, pos, trades.length]);
  if (!n) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>沒有逐筆資料（期交所逐筆檔或永豐逐筆）。</div>;
  const unreal = pos ? (px - avg) * pos * LB_MULT : 0;
  const net = realized + unreal - fees;
  const done = idx >= n - 1;
  // y range: what has been seen so far (never shrinks), plus the levels near it.
  const seen = bars.slice(0, idx + 1);
  let yLo = Math.min(...seen.map((b) => b.l)), yHi = Math.max(...seen.map((b) => b.h));
  const span0 = Math.max(yHi - yLo, bars[0].o * 0.006);
  const mid = (yLo + yHi) / 2;
  yLo = Math.min(yLo, mid - span0 / 2); yHi = Math.max(yHi, mid + span0 / 2);
  const near = levels.filter((l) => l.price > yLo - span0 * 0.35 && l.price < yHi + span0 * 0.35);
  near.forEach((l) => { yLo = Math.min(yLo, l.price); yHi = Math.max(yHi, l.price); });
  const padY = (yHi - yLo) * 0.08;
  yLo -= padY; yHi += padY;
  const H = 300, pl = 8, pr = 74, pt = 10, pb = 22;
  const band = (w - pl - pr) / n;
  const X = (i) => pl + band * (i + 0.5);
  const Y = (v) => pt + (yHi - v) / (yHi - yLo) * (H - pt - pb);
  const txt = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  // Levels crossed so far, newest first.
  const events = [];
  for (let i = 1; i <= idx; i++) {
    for (const l of levels) {
      if (bars[i].l <= l.price && bars[i].h >= l.price && !(bars[i - 1].l <= l.price && bars[i - 1].h >= l.price)
        && !events.some((e) => e.l === l && i - e.i < 15)) events.push({ t: bars[i].t, l, i });
    }
  }
  const wins = trades.filter((x) => x.pnl > 0).length;
  const hold = (bars[n - 1].c - bars[0].o) * LB_MULT - 2 * lbFee(bars[0].o);
  let best = 0;
  { let lo = Infinity, hi = -Infinity; for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); best = Math.max(best, (b.h - lo), (hi - b.l)); } }
  const bestScore = bestOf(bestKey);
  const btn = (label, onClick, bg, disabled) => (
    <button onClick={onClick} disabled={disabled} style={{ border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 14, fontWeight: 800, cursor: disabled ? 'default' : 'pointer',
      background: bg, color: '#fff', fontFamily: 'inherit', opacity: disabled ? 0.4 : 1, minWidth: 92 }}>{label}</button>
  );
  const nt = (v) => <span style={{ color: v > 0 ? LB_UP : v < 0 ? LB_DOWN : 'var(--text)' }}>{v > 0 ? '+' : v < 0 ? '−' : ''}NT${lbN(Math.abs(Math.round(v)))}</span>;
  return (
    <div onMouseEnter={() => { hoverRef.current = true; }} onMouseLeave={() => { hoverRef.current = false; }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
        把 {I.date.slice(4, 6)}/{I.date.slice(6)} {full ? '全日盤' : '日盤'} 重播一次，看不到未來，你來操作一口小台
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        按播放後每一根 K 棒是一分鐘。快捷鍵（游標在這張卡上時）：空白鍵 播放／暫停、B 買進、S 賣出、F 全部平倉。最多 5 口，以每根收盤價成交，小台每點 NT$50。
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={() => (done ? (reset(), setPlaying(true)) : setPlaying((v) => !v))} style={{ border: 'none', borderRadius: 999, width: 42, height: 42, fontSize: 16, cursor: 'pointer', background: 'var(--text)', color: 'var(--bg)' }}
          title="播放／暫停（空白鍵）">{playing ? '❚❚' : done ? '↺' : '▶'}</button>
        <div className="chips">
          {LB_SPEEDS.map((s) => <button key={s.id} className={speed === s.id ? 'on' : ''} onClick={() => setSpeed(s.id)}>{s.label}</button>)}
          <span className="sep" />
          <button className={!full ? 'on' : ''} onClick={() => setFull(false)}>日盤</button>
          <button className={full ? 'on' : ''} onClick={() => setFull(true)}>全日盤</button>
          <span className="sep" />
          <button onClick={reset}>重來</button>
        </div>
        <span style={{ flex: 1 }} />
        <span className="mono tnum" style={{ fontSize: 13, color: 'var(--text2)' }}>{bars[idx].t} · 第 {idx + 1}/{n} 分鐘</span>
        <span className="mono tnum" style={{ fontSize: 24, fontWeight: 800 }}>{lbN(px)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 16, alignItems: 'start' }}>
        <div ref={boxRef} style={{ minWidth: 0 }}>
          <svg width={w} height={H} style={{ display: 'block', fontFamily: 'var(--font-mono)' }}>
            {levels.map((l) => l.price > yLo && l.price < yHi && (
              <g key={l.label}>
                <line x1={pl} x2={w - pr} y1={Y(l.price)} y2={Y(l.price)} stroke={l.color} strokeDasharray="5 4" strokeOpacity="0.8" />
                <text x={w - pr + 4} y={Y(l.price) + 4} fontSize="11" fontWeight="700" fill={l.color}>{l.label}</text>
              </g>
            ))}
            {seen.map((b, i) => {
              const up = b.c >= b.o, col = up ? LB_UP : LB_DOWN;
              return (
                <g key={i}>
                  <line x1={X(i)} x2={X(i)} y1={Y(b.h)} y2={Y(b.l)} stroke={col} />
                  <rect x={X(i) - Math.max(0.5, band * 0.35)} width={Math.max(1, band * 0.7)} y={Y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(Y(b.o) - Y(b.c)))} fill={col} />
                </g>
              );
            })}
            {pos !== 0 && <line x1={pl} x2={w - pr} y1={Y(avg)} y2={Y(avg)} stroke={LB_GOLD} strokeWidth="1.5" />}
            {pos !== 0 && <text x={pl + 4} y={Y(avg) - 5} fontSize="11" fontWeight="700" fill={LB_GOLD}>持倉均價 {lbN(avg, 0)}</text>}
            {fills.map((f, k) => (
              <text key={k} x={X(f.i)} y={f.side > 0 ? Y(bars[f.i].l) + 15 : Y(bars[f.i].h) - 6} fontSize="13" fontWeight="900" textAnchor="middle" fill={f.side > 0 ? LB_UP : LB_DOWN}>{f.side > 0 ? '▲' : '▼'}</text>
            ))}
            <line x1={X(idx)} x2={w - pr} y1={Y(px)} y2={Y(px)} stroke="var(--text)" strokeOpacity="0.5" strokeDasharray="2 3" />
            <rect x={w - pr + 2} y={Y(px) - 9} width={pr - 4} height={18} rx="4" fill="var(--text)" />
            <text x={w - pr + pr / 2} y={Y(px) + 4} fontSize="11.5" fontWeight="800" fill="var(--bg)" textAnchor="middle">{lbN(px)}</text>
            {[0, Math.round(n / 4), Math.round(n / 2), Math.round(3 * n / 4), n - 1].map((i) => <text key={i} x={X(i)} y={H - 5} fontSize="10.5" fill={txt} textAnchor="middle">{bars[i].t}</text>)}
          </svg>
          <div style={{ display: 'flex', gap: 10, marginTop: 10, justifyContent: 'center' }}>
            {btn('買進 B', () => trade(1), LB_UP, pos >= 5 || done)}
            {btn('賣出 S', () => trade(-1), LB_DOWN, pos <= -5 || done)}
            {btn('平倉 F', () => trade(0), '#64748b', pos === 0 || done)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', background: 'var(--panel2)' }}>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>淨損益（已扣手續費、期交稅）</div>
            <div className="mono tnum" style={{ fontSize: 26, fontWeight: 800, margin: '2px 0 6px' }}>{nt(net)}</div>
            <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px' }}>
              <span style={{ color: 'var(--muted)' }}>部位</span><b>{pos === 0 ? '空手' : `${pos > 0 ? '多' : '空'} ${Math.abs(pos)} 口 @ ${lbN(avg, 0)}`}</b>
              <span style={{ color: 'var(--muted)' }}>未實現</span><span className="mono">{nt(unreal)}</span>
              <span style={{ color: 'var(--muted)' }}>已實現</span><span className="mono">{nt(realized)}</span>
              <span style={{ color: 'var(--muted)' }}>成本</span><span className="mono">NT${lbN(fees)}</span>
            </div>
          </div>
          <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', background: 'var(--panel2)', minHeight: 96 }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>盤中事件</div>
            {events.length ? events.slice(-4).reverse().map((e, k) => (
              <div key={k} className="mono" style={{ fontSize: 12, padding: '2px 0', opacity: k ? 0.7 : 1 }}>{e.t} 碰到 <b style={{ color: e.l.color }}>{e.l.label}</b> {lbN(e.l.price)}</div>
            )) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>還沒碰到任何關鍵價位</div>}
          </div>
          {done && (
            <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', border: `1px solid ${LB_GOLD}` }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>收盤成績單 🏁</div>
              <div style={{ fontSize: 12.5, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
                <span style={{ color: 'var(--muted)' }}>你的結果</span><b className="mono">{nt(net)}</b>
                <span style={{ color: 'var(--muted)' }}>交易</span><span>{trades.length} 筆 · 勝率 {trades.length ? Math.round(wins / trades.length * 100) : 0}%</span>
                <span style={{ color: 'var(--muted)' }}>開盤買抱到收</span><span className="mono">{nt(hold)}</span>
                <span style={{ color: 'var(--muted)' }}>事後諸葛一筆</span><span className="mono">{nt(best * LB_MULT)}</span>
                {bestScore != null && <><span style={{ color: 'var(--muted)' }}>你的最佳</span><span className="mono">{nt(Math.max(bestScore, trades.length && pos === 0 ? net : -Infinity))}</span></>}
                {!trades.length && <span style={{ gridColumn: '1 / -1', color: 'var(--muted)' }}>這次沒有交易 — 按 ↺ 再來一次</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The block itself: a section title and the two cards.
function LabsShowcase({ P, spot, I, replayLevels = [], marks = [], light }) {
  const E = window.TAIFEX_EOD && window.TAIFEX_EOD.product === P.id ? window.TAIFEX_EOD : null;
  if (P.oiSource !== 'taifex') return null;
  return (
    <div>
      <div className="sec-title">✨ 實驗室精選<small>用期交所資料做的兩個小實驗</small></div>
      <div className="card" style={{ padding: '18px 20px', marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>🔮 市場隱含機率地圖</div>
        <ImpliedDistCard E={E} spot={spot} marks={marks} light={light} />
      </div>
      <div className="card" style={{ padding: '18px 20px', marginBottom: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>🎮 當沖重播練習場</div>
        <ReplayCard I={I} levels={replayLevels} light={light} />
      </div>
    </div>
  );
}

Object.assign(window, { lbDensity, ImpliedDistCard, ReplayCard, LabsShowcase });
