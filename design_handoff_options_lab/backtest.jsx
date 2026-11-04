// backtest.jsx — 策略回測 workspace (2026-11). Describe a daily TX strategy as
// rules, run it over years of TAIFEX history, read the result.
//
// Data: window.BT_DATA (backtest-data.js — TX front-month day bars plus P/C,
// 外資 net and 小台散戶多空比 from 2020, refreshed by the daily job); without it
// the snapshot's ~8 months of bars and taifex-history.js stand in.
//
// Strategy JSON (also the target format for the natural-language parser):
//   { name, side: 'long'|'short', contract: 'TX'|'MTX', qty,
//     entry: { all: [Cond] },                 // checked at day t's close
//     exit:  { holdDays, stopLoss, takeProfit, any: [Cond] },
//     from, to }                              // optional YYYY/MM/DD bounds
//   Cond   = { left: Series, op: '>'|'<'|'>='|'<='|'crossAbove'|'crossBelow', right: Series | number }
//   Series = { id, n? }  (ids in BT_SERIES)
// Execution — no look-ahead: a signal at day t's close enters at day t+1's
// open. Stop / target are checked on each held day's high / low against the
// entry (a gap through the level fills at the open; if both are touched the
// same day the stop is assumed first). holdDays exits at the close of the Nth
// held day; an exit condition true at a close exits at the next open. Costs
// per contract per side: commission + 期交稅 (0.002% of contract value) +
// slippage in points. Equity is marked to market at every close.
const { useState: btS, useMemo: btM, useEffect: btE } = React;

const BT_UP = '#ef5350', BT_DOWN = '#26a69a', BT_GOLD = '#f0c068';
const BT_CONTRACTS = {
  TX: { label: '大台', mult: 200, commission: 60 },
  MTX: { label: '小台', mult: 50, commission: 20 },
};
const BT_SERIES = [
  { id: 'close', label: '收盤價', unit: '點' },
  { id: 'open', label: '開盤價', unit: '點' },
  { id: 'ma', label: '均線', n: 20, unit: '點', nLabel: '日' },
  { id: 'ema', label: '指數均線', n: 20, unit: '點', nLabel: '日' },
  { id: 'hh', label: '前 N 日最高價', n: 20, unit: '點', nLabel: '日' },
  { id: 'll', label: '前 N 日最低價', n: 20, unit: '點', nLabel: '日' },
  { id: 'ret', label: 'N 日漲跌幅', n: 1, unit: '%', nLabel: '日' },
  { id: 'gap', label: '開盤跳空', unit: '%' },
  { id: 'rsi', label: 'RSI', n: 14, unit: '', nLabel: '日' },
  { id: 'range', label: '當日振幅', unit: '點' },
  { id: 'volume', label: '成交量', unit: '口' },
  { id: 'pc', label: 'P/C 未平倉比', unit: '' },
  { id: 'fx', label: '外資期貨淨部位', unit: '口' },
  { id: 'fxChg', label: '外資淨部位 N 日增減', n: 1, unit: '口', nLabel: '日' },
  { id: 'retail', label: '散戶多空比 · 小台', unit: '%' },
  { id: 'weekday', label: '星期（1 = 週一）', unit: '' },
];
const BT_OPS = [
  { id: '>', label: '大於' }, { id: '<', label: '小於' }, { id: '>=', label: '大於等於' }, { id: '<=', label: '小於等於' },
  { id: 'crossAbove', label: '向上穿越' }, { id: 'crossBelow', label: '向下跌破' },
];
const btDef = (id) => BT_SERIES.find((s) => s.id === id) || BT_SERIES[0];
const btN = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const btNT = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}NT$${btN(Math.abs(Math.round(v)))}`;
function btSeriesText(s) {
  const d = btDef(s.id), n = s.n || d.n;
  if (s.id === 'ma') return `${n} 日均線`;
  if (s.id === 'ema') return `${n} 日指數均線`;
  if (s.id === 'hh') return `前 ${n} 日最高價`;
  if (s.id === 'll') return `前 ${n} 日最低價`;
  if (s.id === 'ret') return `${n} 日漲跌幅`;
  if (s.id === 'rsi') return `RSI(${n})`;
  if (s.id === 'fxChg') return `外資淨部位 ${n} 日增減`;
  return d.label;
}
function btCondText(c) {
  const op = (BT_OPS.find((o) => o.id === c.op) || BT_OPS[0]).label;
  const r = typeof c.right === 'number' ? `${btN(c.right, Math.abs(c.right) < 10 && c.right % 1 ? 2 : 0)}${btDef(c.left.id).unit === '%' ? '%' : ''}` : btSeriesText(c.right);
  return `${btSeriesText(c.left)} ${op} ${r}`;
}
function btStrategyText(st) {
  const ct = BT_CONTRACTS[st.contract] || BT_CONTRACTS.MTX;
  const ent = (st.entry && st.entry.all || []).map(btCondText).join('，且 ') || '（沒有進場條件）';
  const ex = [];
  if (st.exit && st.exit.stopLoss) ex.push(`停損 ${st.exit.stopLoss} 點`);
  if (st.exit && st.exit.takeProfit) ex.push(`停利 ${st.exit.takeProfit} 點`);
  if (st.exit && st.exit.holdDays) ex.push(`最多持有 ${st.exit.holdDays} 天`);
  (st.exit && st.exit.any || []).forEach((c) => ex.push(`${btCondText(c)} 就出場`));
  return `當 ${ent} 時，隔天開盤${st.side === 'short' ? '放空' : '買進'} ${st.qty || 1} 口${ct.label}${ex.length ? `；${ex.join('、')}` : '；沒有設出場條件（會一直抱到資料結束）'}。`;
}

// ── data
function btData() {
  const B = window.BT_DATA;
  if (B && B.bars && B.bars.length > 50) return { src: 'full', ...B };
  const E = window.TAIFEX_EOD, H = window.TAIFEX_HISTORY;
  if (!E || !E.bars) return null;
  const d8 = (t) => { const s = String(t); return `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`; };
  return {
    src: 'short',
    bars: E.bars.map((b) => [d8(b.t), b.o, b.h, b.l, b.c, b.v]),
    pc: H && H.pc ? H.pc.map((r) => [r[0], r[1]]) : [],
    fx: H && H.fx ? H.fx.map((r) => [r[0], r[1]]) : [],
    retail: H && H.retail && H.retail.MTX ? H.retail.MTX.map((r) => [r[0], r[1]]) : [],
  };
}

// Series arrays aligned with the bars (null where unknown).
function btMakeCalc(D) {
  const n = D.bars.length;
  const date = D.bars.map((b) => b[0]), o = D.bars.map((b) => b[1]), h = D.bars.map((b) => b[2]), l = D.bars.map((b) => b[3]), c = D.bars.map((b) => b[4]), v = D.bars.map((b) => b[5]);
  const byDate = (rows) => { const m = {}; (rows || []).forEach((r) => { m[r[0]] = r[1]; }); return date.map((d) => (m[d] != null ? m[d] : null)); };
  const cache = {};
  const get = (s) => {
    const def = btDef(s.id), k = Math.max(1, Math.round(s.n || def.n || 1));
    const key = `${s.id}:${k}`;
    if (cache[key]) return cache[key];
    let a = new Array(n).fill(null);
    if (s.id === 'close') a = c; else if (s.id === 'open') a = o; else if (s.id === 'volume') a = v;
    else if (s.id === 'range') a = h.map((x, i) => x - l[i]);
    else if (s.id === 'ma') { let sum = 0; for (let i = 0; i < n; i++) { sum += c[i]; if (i >= k) sum -= c[i - k]; if (i >= k - 1) a[i] = sum / k; } }
    else if (s.id === 'ema') { const al = 2 / (k + 1); let e = null; for (let i = 0; i < n; i++) { e = e == null ? c[i] : e + al * (c[i] - e); if (i >= k - 1) a[i] = e; } }
    else if (s.id === 'hh' || s.id === 'll') { for (let i = k; i < n; i++) { let x = s.id === 'hh' ? -Infinity : Infinity; for (let j = i - k; j < i; j++) x = s.id === 'hh' ? Math.max(x, h[j]) : Math.min(x, l[j]); a[i] = x; } }
    else if (s.id === 'ret') { for (let i = k; i < n; i++) a[i] = (c[i] / c[i - k] - 1) * 100; }
    else if (s.id === 'gap') { for (let i = 1; i < n; i++) a[i] = (o[i] / c[i - 1] - 1) * 100; }
    else if (s.id === 'rsi') { let ag = 0, al = 0; for (let i = 1; i < n; i++) { const d = c[i] - c[i - 1], g = Math.max(d, 0), lo = Math.max(-d, 0); if (i <= k) { ag += g / k; al += lo / k; } else { ag = (ag * (k - 1) + g) / k; al = (al * (k - 1) + lo) / k; } if (i >= k) a[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else if (s.id === 'pc') a = byDate(D.pc);
    else if (s.id === 'fx') a = byDate(D.fx);
    else if (s.id === 'retail') a = byDate(D.retail);
    else if (s.id === 'fxChg') { const f = byDate(D.fx); for (let i = k; i < n; i++) a[i] = f[i] != null && f[i - k] != null ? f[i] - f[i - k] : null; }
    else if (s.id === 'weekday') a = date.map((d) => new Date(`${d.replace(/\//g, '-')}T12:00:00+08:00`).getDay());
    cache[key] = a;
    return a;
  };
  return { n, date, o, h, l, c, get };
}

function btCond(calc, cond, i) {
  const L = calc.get(cond.left);
  const R = typeof cond.right === 'number' ? null : calc.get(cond.right);
  const r = (j) => (R ? R[j] : cond.right);
  const a = L[i], b = r(i);
  if (a == null || b == null) return false;
  if (cond.op === '>') return a > b;
  if (cond.op === '<') return a < b;
  if (cond.op === '>=') return a >= b;
  if (cond.op === '<=') return a <= b;
  if (i < 1 || L[i - 1] == null || r(i - 1) == null) return false;
  if (cond.op === 'crossAbove') return a > b && L[i - 1] <= r(i - 1);
  if (cond.op === 'crossBelow') return a < b && L[i - 1] >= r(i - 1);
  return false;
}

function btRun(D, st, slip = 1) {
  const calc = btMakeCalc(D);
  const { n, date, o, h, l, c } = calc;
  const ct = BT_CONTRACTS[st.contract] || BT_CONTRACTS.MTX, q = Math.max(1, st.qty || 1), dir = st.side === 'short' ? -1 : 1;
  const fee = (px) => (ct.commission + px * ct.mult * 0.00002 + slip * ct.mult) * q;
  const ent = (st.entry && st.entry.all) || [], exAny = (st.exit && st.exit.any) || [];
  const sl = st.exit && st.exit.stopLoss > 0 ? st.exit.stopLoss : null, tp = st.exit && st.exit.takeProfit > 0 ? st.exit.takeProfit : null;
  const hold = st.exit && st.exit.holdDays > 0 ? Math.round(st.exit.holdDays) : null;
  let i0 = 0, i1 = n - 1;
  if (st.from) { const k = date.findIndex((d) => d >= st.from); if (k >= 0) i0 = k; }
  if (st.to) { for (let k = n - 1; k >= 0; k--) if (date[k] <= st.to) { i1 = k; break; } }
  const trades = [], equity = new Array(n).fill(null);
  let pos = null, realized = 0, pendingEntry = false, pendingExit = false;
  for (let i = i0; i <= i1; i++) {
    // Orders decided at yesterday's close fill at today's open.
    if (pos && pendingExit) { closeAt(i, o[i], '出場條件'); pendingExit = false; }
    if (!pos && pendingEntry) { pos = { i, px: o[i] }; realized -= fee(o[i]); pendingEntry = false; }
    if (pos) {
      const stopPx = sl ? pos.px - dir * sl : null, tgtPx = tp ? pos.px + dir * tp : null;
      const hitStop = stopPx != null && (dir > 0 ? l[i] <= stopPx : h[i] >= stopPx);
      const hitTgt = tgtPx != null && (dir > 0 ? h[i] >= tgtPx : l[i] <= tgtPx);
      if (hitStop) closeAt(i, i > pos.i && (dir > 0 ? o[i] < stopPx : o[i] > stopPx) ? o[i] : stopPx, '停損');
      else if (hitTgt) closeAt(i, i > pos.i && (dir > 0 ? o[i] > tgtPx : o[i] < tgtPx) ? o[i] : tgtPx, '停利');
      else if (hold && i - pos.i + 1 >= hold) closeAt(i, c[i], `持有 ${hold} 天`);
      else if (exAny.length && exAny.some((x) => btCond(calc, x, i))) { if (i < i1) pendingExit = true; else closeAt(i, c[i], '出場條件'); }
    }
    if (!pos && !pendingEntry && i < i1 && ent.length && ent.every((x) => btCond(calc, x, i))) pendingEntry = true;
    equity[i] = realized + (pos ? (c[i] - pos.px) * dir * ct.mult * q : 0);
  }
  if (pos) closeAt(i1, c[i1], '資料結束');
  if (i1 >= i0) equity[i1] = realized;
  function closeAt(i, px, why) {
    const pts = (px - pos.px) * dir;
    const pnl = pts * ct.mult * q - fee(px);
    realized += pts * ct.mult * q - fee(px);
    trades.push({ in: date[pos.i], out: date[i], inPx: pos.px, outPx: px, pts, pnl: pnl - fee(pos.px), days: i - pos.i + 1, why });
    pos = null;
  }
  // Stats
  const eq = equity.slice(i0, i1 + 1).map((x) => (x == null ? 0 : x));
  let peak = 0, mdd = 0;
  eq.forEach((x) => { peak = Math.max(peak, x); mdd = Math.min(mdd, x - peak); });
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const sum = (a) => a.reduce((s, t) => s + t.pnl, 0);
  let streak = 0, worst = 0;
  trades.forEach((t) => { streak = t.pnl <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); });
  const inMkt = trades.reduce((s, t) => s + t.days, 0);
  const bh = (c[i1] - o[i0]) * dir * ct.mult * q - fee(o[i0]) - fee(c[i1]);
  const bhCurve = date.map((_, i) => (i < i0 || i > i1 ? null : (c[i] - o[i0]) * dir * ct.mult * q - fee(o[i0])));
  return {
    trades, equity, bhCurve, i0, i1, date, close: c,
    total: realized, n: trades.length, winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0,
    pf: losses.length && sum(losses) !== 0 ? sum(wins) / -sum(losses) : (wins.length ? Infinity : 0),
    mdd, worstStreak: worst, exposure: (i1 - i0 + 1) ? inMkt / (i1 - i0 + 1) : 0, bh,
    from: date[i0], to: date[i1], days: i1 - i0 + 1,
  };
}

// ── presets (examples to start from)
const BT_PRESETS = [
  { name: '散戶偏多就放空', side: 'short', contract: 'MTX', qty: 1,
    entry: { all: [{ left: { id: 'retail' }, op: '>', right: 30 }] }, exit: { holdDays: 3, stopLoss: 300, takeProfit: null, any: [] } },
  { name: '跌破 20 日均線放空', side: 'short', contract: 'MTX', qty: 1,
    entry: { all: [{ left: { id: 'close' }, op: 'crossBelow', right: { id: 'ma', n: 20 } }] }, exit: { holdDays: null, stopLoss: 400, takeProfit: null, any: [{ left: { id: 'close' }, op: 'crossAbove', right: { id: 'ma', n: 20 } }] } },
  { name: 'RSI 超賣搶反彈', side: 'long', contract: 'MTX', qty: 1,
    entry: { all: [{ left: { id: 'rsi', n: 14 }, op: '<', right: 30 }] }, exit: { holdDays: 5, stopLoss: 400, takeProfit: 600, any: [] } },
  { name: '突破 20 日新高追多', side: 'long', contract: 'MTX', qty: 1,
    entry: { all: [{ left: { id: 'close' }, op: '>', right: { id: 'hh', n: 20 } }] }, exit: { holdDays: 10, stopLoss: 500, takeProfit: null, any: [] } },
  { name: 'P/C 偏高做多', side: 'long', contract: 'MTX', qty: 1,
    entry: { all: [{ left: { id: 'pc' }, op: '>', right: 1.2 }] }, exit: { holdDays: 5, stopLoss: 400, takeProfit: null, any: [] } },
];
const BT_SAVE_KEY = 'optionsLab.strategies.v1';
const btLoadSaved = () => { try { const a = JSON.parse(localStorage.getItem(BT_SAVE_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

// ── UI pieces
const btInput = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12.5 };

function BtSeriesPick({ value, onChange, allowNumber, number, onNumber }) {
  const isNum = allowNumber && typeof number === 'number';
  const d = btDef(value ? value.id : 'close');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select value={isNum ? '__num' : (value ? value.id : 'close')} style={btInput} onChange={(e) => {
        if (e.target.value === '__num') onNumber(0); else { const dd = btDef(e.target.value); onChange({ id: dd.id, ...(dd.n ? { n: dd.n } : {}) }); }
      }}>
        {allowNumber && <option value="__num">數值</option>}
        {BT_SERIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      {isNum && <input type="number" value={number} step="any" onChange={(e) => onNumber(e.target.value === '' ? 0 : +e.target.value)} style={{ ...btInput, width: 96 }} />}
      {!isNum && d.n && <span style={{ fontSize: 12, color: 'var(--text2)' }}>N =<input type="number" min="1" value={value.n || d.n} onChange={(e) => onChange({ ...value, n: Math.max(1, +e.target.value || 1) })} style={{ ...btInput, width: 56, marginLeft: 4 }} /></span>}
    </span>
  );
}
function BtCondRow({ cond, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
      <BtSeriesPick value={cond.left} onChange={(left) => onChange({ ...cond, left })} />
      <select value={cond.op} onChange={(e) => onChange({ ...cond, op: e.target.value })} style={btInput}>
        {BT_OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <BtSeriesPick allowNumber value={typeof cond.right === 'number' ? null : cond.right} number={typeof cond.right === 'number' ? cond.right : undefined}
        onChange={(right) => onChange({ ...cond, right })} onNumber={(right) => onChange({ ...cond, right })} />
      <button onClick={onRemove} title="刪除條件" style={{ ...btInput, cursor: 'pointer', padding: '4px 10px' }}>×</button>
    </div>
  );
}
function BtCondList({ title, conds, onChange, note }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}<span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', marginLeft: 8 }}>{note}</span></div>
      {conds.map((c, k) => <BtCondRow key={k} cond={c} onChange={(x) => onChange(conds.map((y, j) => (j === k ? x : y)))} onRemove={() => onChange(conds.filter((_, j) => j !== k))} />)}
      <button onClick={() => onChange(conds.concat([{ left: { id: 'close' }, op: '>', right: { id: 'ma', n: 20 } }]))} style={{ ...btInput, cursor: 'pointer', marginTop: 4 }}>＋ 條件</button>
    </div>
  );
}

function btUseWidth(init = 800) {
  const [el, setEl] = btS(null);
  const [w, setW] = btS(init);
  btE(() => {
    if (!el || !window.ResizeObserver) return undefined;
    const ro = new ResizeObserver((es) => { const x = Math.round(es[0].contentRect.width); if (x > 0) setW(x); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

function BtEquityChart({ R, light }) {
  const [ref, w] = btUseWidth(900);
  const [hover, setHover] = btS(null);
  const idx = []; for (let i = R.i0; i <= R.i1; i++) idx.push(i);
  const eq = idx.map((i) => R.equity[i] || 0), bh = idx.map((i) => R.bhCurve[i] || 0);
  const H = 260, pl = 84, pr = 16, pt = 12, pb = 26;
  const lo = Math.min(0, ...eq, ...bh), hi = Math.max(0, ...eq, ...bh), pad = (hi - lo) * 0.06 || 1;
  const X = (k) => pl + (k / Math.max(1, idx.length - 1)) * (w - pl - pr);
  const Y = (v) => pt + (hi + pad - v) / (hi - lo + 2 * pad) * (H - pt - pb);
  const line = (a) => a.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  let peak = -Infinity; const dd = eq.map((v) => { peak = Math.max(peak, v); return v - peak; });
  const txt = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const grid = light ? 'rgba(20,30,50,0.10)' : 'rgba(255,255,255,0.09)';
  // Round tick values (1 / 2 / 5 × 10^k) inside the plotted range.
  const span = hi - lo + 2 * pad, raw = span / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const stepV = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
  const ticks = [];
  for (let t = Math.ceil((lo - pad) / stepV) * stepV; t <= hi + pad; t += stepV) ticks.push(t);
  const years = []; let lastY = null;
  idx.forEach((i, k) => { const y = R.date[i].slice(0, 4); if (y !== lastY) { years.push({ k, y }); lastY = y; } });
  const showYears = years.length > 1 ? years : [{ k: 0, y: R.date[idx[0]] }, { k: idx.length - 1, y: R.date[idx[idx.length - 1]] }];
  return (
    <div ref={ref}>
      <svg width={w} height={H} style={{ display: 'block', fontFamily: 'var(--font-mono)' }}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const k = Math.round((e.clientX - r.left - pl) / (w - pl - pr) * (idx.length - 1)); setHover(k >= 0 && k < idx.length ? k : null); }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={pl} x2={w - pr} y1={Y(t)} y2={Y(t)} stroke={grid} /><text x={pl - 6} y={Y(t) + 3.5} fontSize="10.5" fill={txt} textAnchor="end">{btNT(t)}</text></g>)}
        <line x1={pl} x2={w - pr} y1={Y(0)} y2={Y(0)} stroke={txt} strokeOpacity="0.6" />
        <polygon points={`${X(0)},${Y(eq[0])} ${dd.map((d, k) => `${X(k).toFixed(1)},${Y(eq[k] - d).toFixed(1)}`).join(' ')} ${dd.map((d, k) => `${X(k).toFixed(1)},${Y(eq[k]).toFixed(1)}`).reverse().join(' ')}`} fill={BT_DOWN} fillOpacity="0.12" />
        <polyline points={line(bh)} fill="none" stroke={txt} strokeWidth="1.2" strokeDasharray="4 3" />
        <polyline points={line(eq)} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" />
        {showYears.map((y) => <text key={y.k} x={X(y.k)} y={H - 6} fontSize="10.5" fill={txt} textAnchor={y.k === 0 ? 'start' : 'middle'}>{y.y}</text>)}
        {hover != null && <>
          <line x1={X(hover)} x2={X(hover)} y1={pt} y2={H - pb} stroke={txt} strokeDasharray="3 3" />
          <text x={Math.min(X(hover) + 6, w - 220)} y={pt + 12} fontSize="11.5" fill="var(--text)">{R.date[idx[hover]]} · 策略 {btNT(eq[hover])} · 買進持有 {btNT(bh[hover])}</text>
        </>}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--text2)', marginTop: 4 }}>
        <span><i style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--blue)', verticalAlign: 'middle', marginRight: 5 }} />策略累計損益</span>
        <span><i style={{ display: 'inline-block', width: 14, height: 0, borderTop: `2px dashed ${txt}`, verticalAlign: 'middle', marginRight: 5 }} />同期間同方向一直抱著</span>
        <span><i style={{ display: 'inline-block', width: 12, height: 10, background: BT_DOWN, opacity: 0.25, verticalAlign: 'middle', marginRight: 5 }} />從高點回落（回撤）</span>
      </div>
    </div>
  );
}

function BtStat({ label, value, color, sub }) {
  return (
    <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', background: 'var(--panel2)' }}>
      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</div>
      <div className="mono tnum" style={{ fontSize: 19, fontWeight: 800, color: color || 'var(--text)', marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Natural-language box. Phase 2 (a Claude call that turns the description
// into the strategy JSON above) needs an API key the owner supplies; until
// then the box shows the idea and the form below does the work.
function BtAsk() {
  return (
    <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>✍️ 用中文描述你的策略<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginLeft: 8 }}>AI 解析 · 設定中</span></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <textarea disabled rows={2}
          placeholder="例：散戶多空比超過 30%，而且收盤跌破 20 日均線，隔天放空一口小台，停損 300 點，最多抱 5 天"
          style={{ ...btInput, flex: 1, resize: 'none', fontSize: 13.5, lineHeight: 1.5, opacity: 0.7 }} />
        <button disabled style={{ border: 'none', borderRadius: 10, padding: '0 18px', fontWeight: 800, fontSize: 14, background: 'var(--chip)', color: 'var(--muted)', fontFamily: 'inherit' }}>用 AI 解析並回測</button>
      </div>
      <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text2)' }}>這一步需要接上 Claude API（第二階段）。現在請用下面的「策略設定」組合條件，或先點一個範例策略。</div>
    </div>
  );
}

function BacktestWorkspace({ P, light }) {
  const D = btM(() => btData(), []);
  const [st, setSt] = btS(() => JSON.parse(JSON.stringify(BT_PRESETS[0])));
  const [slip, setSlip] = btS(1);
  const [saved, setSaved] = btS(btLoadSaved);
  const R = btM(() => (D ? btRun(D, st, slip) : null), [D, st, slip]);
  const set = (patch) => setSt((x) => ({ ...x, ...patch }));
  const setExit = (patch) => setSt((x) => ({ ...x, exit: { ...(x.exit || {}), ...patch } }));
  if (P.oiSource !== 'taifex') return <div className="card" style={{ padding: 20 }}>策略回測目前只支援台指期（台指選）。請在左上角切換商品。</div>;
  if (!D) return <div className="card" style={{ padding: 20 }}>回測資料載入中…</div>;
  const save = () => {
    const name = (st.name || '我的策略').trim();
    const next = saved.filter((x) => x.name !== name).concat([{ ...st, name }]);
    setSaved(next);
    try { localStorage.setItem(BT_SAVE_KEY, JSON.stringify(next)); } catch (e) { /* storage off */ }
  };
  const col = (v) => (v > 0 ? BT_UP : v < 0 ? BT_DOWN : 'var(--text)');
  const ct = BT_CONTRACTS[st.contract] || BT_CONTRACTS.MTX;
  return (
    <div style={{ maxWidth: 1400 }}>
      <BtAsk />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 520px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <div className="card" style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>⚙️ 策略設定</div>
          <div className="chips" style={{ marginBottom: 12 }}>
            {BT_PRESETS.map((p) => <button key={p.name} className={st.name === p.name ? 'on' : ''} onClick={() => setSt(JSON.parse(JSON.stringify(p)))}>{p.name}</button>)}
            {saved.map((p) => <button key={`s-${p.name}`} className={st.name === p.name ? 'on' : ''} onClick={() => setSt(JSON.parse(JSON.stringify(p)))}>★ {p.name}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input value={st.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="策略名稱" style={{ ...btInput, flex: 1, minWidth: 140 }} />
            <button onClick={save} style={{ ...btInput, cursor: 'pointer' }}>儲存</button>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="seg">
              <button className={st.side === 'long' ? 'on' : ''} onClick={() => set({ side: 'long' })}>做多</button>
              <button className={st.side === 'short' ? 'on' : ''} onClick={() => set({ side: 'short' })}>放空</button>
            </div>
            <div className="seg">
              {Object.entries(BT_CONTRACTS).map(([k, v]) => <button key={k} className={st.contract === k ? 'on' : ''} onClick={() => set({ contract: k })}>{v.label}</button>)}
            </div>
            <span style={{ fontSize: 12.5 }}>口數 <input type="number" min="1" max="20" value={st.qty || 1} onChange={(e) => set({ qty: Math.max(1, Math.min(20, +e.target.value || 1)) })} style={{ ...btInput, width: 56 }} /></span>
          </div>
          <BtCondList title="進場條件" note="全部成立 → 隔天開盤進場" conds={(st.entry && st.entry.all) || []} onChange={(all) => set({ entry: { all } })} />
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>出場</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, marginBottom: 6 }}>
            {[['stopLoss', '停損', '點'], ['takeProfit', '停利', '點'], ['holdDays', '最多持有', '天']].map(([k, lab, u]) => (
              <span key={k}>{lab} <input type="number" min="0" value={(st.exit && st.exit[k]) || ''} placeholder="不設" onChange={(e) => setExit({ [k]: e.target.value === '' ? null : Math.max(0, +e.target.value) })} style={{ ...btInput, width: 70 }} /> {u}</span>
            ))}
          </div>
          <BtCondList title="出場條件" note="任一成立 → 隔天開盤出場" conds={(st.exit && st.exit.any) || []} onChange={(any) => setExit({ any })} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text2)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <span>期間 <input type="date" value={(st.from || '').replace(/\//g, '-')} onChange={(e) => set({ from: e.target.value ? e.target.value.replace(/-/g, '/') : null })} style={btInput} /> ～ <input type="date" value={(st.to || '').replace(/\//g, '-')} onChange={(e) => set({ to: e.target.value ? e.target.value.replace(/-/g, '/') : null })} style={btInput} /></span>
            <span>滑價 <input type="number" min="0" value={slip} onChange={(e) => setSlip(Math.max(0, +e.target.value || 0))} style={{ ...btInput, width: 56 }} /> 點／邊</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>策略內容</div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.6 }}>{btStrategyText(st)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              資料 {R.from} – {R.to}（{btN(R.days)} 個交易日）{D.src === 'short' ? ' · 目前只有約 8 個月日 K，歷史資料補齊後會自動延伸到 2020 年' : ''} · 每口{ct.label}每點 NT${ct.mult} · 已扣手續費、期交稅、滑價
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <BtStat label="總損益" value={btNT(R.total)} color={col(R.total)} sub={`一直抱著：${btNT(R.bh)}`} />
            <BtStat label="交易次數" value={btN(R.n)} sub={`在場時間 ${Math.round(R.exposure * 100)}%`} />
            <BtStat label="勝率" value={`${Math.round(R.winRate * 100)}%`} sub={`平均賺 ${btNT(R.avgWin)}`} />
            <BtStat label="平均每筆" value={R.n ? btNT(R.total / R.n) : '—'} color={col(R.total)} sub={`平均賠 ${btNT(R.avgLoss)}`} />
            <BtStat label="獲利因子" value={Number.isFinite(R.pf) ? R.pf.toFixed(2) : R.n ? '∞' : '—'} sub="總賺 ÷ 總賠，>1 才有賺" />
            <BtStat label="最大回撤" value={btNT(R.mdd)} color={BT_DOWN} sub={`最長連賠 ${R.worstStreak} 筆`} />
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>📈 權益曲線</div>
            {R.n ? <BtEquityChart R={R} light={light} /> : <div style={{ fontSize: 13, color: 'var(--muted)' }}>這段期間條件一次都沒成立，沒有交易。試著放寬條件。</div>}
          </div>
          {R.n > 0 && (
            <div className="card" style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>🧾 交易明細<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginLeft: 8 }}>最近 {Math.min(R.n, 40)} 筆</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 70px 1fr 1fr', fontSize: 12.5, gap: 0 }}>
                {['進場', '出場', '進場價', '出場價', '天數', '點數', '損益（淨）'].map((h) => <span key={h} style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>{h}</span>)}
                {R.trades.slice(-40).reverse().map((t, k) => [
                  <span key={`${k}a`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{t.in}</span>,
                  <span key={`${k}b`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{t.out}<span style={{ color: 'var(--muted)', fontSize: 10.5 }}> {t.why}</span></span>,
                  <span key={`${k}c`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{btN(t.inPx)}</span>,
                  <span key={`${k}d`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{btN(t.outPx)}</span>,
                  <span key={`${k}e`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>{t.days}</span>,
                  <span key={`${k}f`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)', color: col(t.pts) }}>{t.pts > 0 ? '+' : ''}{btN(t.pts)}</span>,
                  <span key={`${k}g`} className="mono" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)', color: col(t.pnl), fontWeight: 700 }}>{btNT(t.pnl)}</span>,
                ])}
              </div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
            規則：收盤後判斷條件，隔天開盤成交，不偷看未來。停損、停利用當天最高最低價判斷，跳空穿過就用開盤價；同一天兩個都碰到時算停損（保守）。回測漂亮不代表未來會賺 —— 條件調得越細，越容易只是剛好符合過去。
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BT_SERIES, BT_OPS, BT_PRESETS, btData, btRun, btStrategyText, BacktestWorkspace });
