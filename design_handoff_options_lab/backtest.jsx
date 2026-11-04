// backtest.jsx — 策略回測 workspace (2026-11). Describe a daily TX strategy as
// rules, run it over years of TAIFEX history, read the result.
//
// Data: window.BT_DATA (backtest-data.js — TX front-month day bars plus P/C,
// 外資 net, 小台散戶多空比 and TXO dealer gamma (gex: total, zero-gamma level,
// call / put walls), refreshed by the daily job); without it
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
  { id: 'gex', label: '總 GEX（億／1%）', unit: '億' },
  { id: 'zeroGamma', label: '零 Gamma 價位', unit: '點' },
  { id: 'callWall', label: 'Call Gamma 牆', unit: '點' },
  { id: 'putWall', label: 'Put Gamma 牆', unit: '點' },
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
    gex: [],
  };
}

// Series arrays aligned with the bars (null where unknown).
function btMakeCalc(D) {
  const n = D.bars.length;
  const date = D.bars.map((b) => b[0]), o = D.bars.map((b) => b[1]), h = D.bars.map((b) => b[2]), l = D.bars.map((b) => b[3]), c = D.bars.map((b) => b[4]), v = D.bars.map((b) => b[5]);
  const byDate = (rows, j = 1) => { const m = {}; (rows || []).forEach((r) => { m[r[0]] = r[j]; }); return date.map((d) => (m[d] != null ? m[d] : null)); };
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
    else if (s.id === 'gex') a = byDate(D.gex, 1);
    else if (s.id === 'zeroGamma') a = byDate(D.gex, 2);
    else if (s.id === 'callWall') a = byDate(D.gex, 3);
    else if (s.id === 'putWall') a = byDate(D.gex, 4);
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

// opt (used by the health check): calc = a btMakeCalc to reuse, range =
// [i0, i1] to test over, randomEntry = { p, rng } replaces the entry rules
// with a coin flip each flat day.
function btRun(D, st, slip = 1, opt = {}) {
  const calc = opt.calc || btMakeCalc(D);
  const { n, date, o, h, l, c } = calc;
  const ct = BT_CONTRACTS[st.contract] || BT_CONTRACTS.MTX, q = Math.max(1, st.qty || 1), dir = st.side === 'short' ? -1 : 1;
  const fee = (px) => (ct.commission + px * ct.mult * 0.00002 + slip * ct.mult) * q;
  const ent = (st.entry && st.entry.all) || [], exAny = (st.exit && st.exit.any) || [];
  const sl = st.exit && st.exit.stopLoss > 0 ? st.exit.stopLoss : null, tp = st.exit && st.exit.takeProfit > 0 ? st.exit.takeProfit : null;
  const hold = st.exit && st.exit.holdDays > 0 ? Math.round(st.exit.holdDays) : null;
  let i0 = 0, i1 = n - 1;
  // Start where every series the rules read has data (外資 / 散戶 history
  // begins in 2023, a 60-day average needs 60 days), so the comparison with
  // holding covers the same span the strategy could trade.
  const used = [];
  ent.concat(exAny).forEach((x) => { used.push(x.left); if (typeof x.right !== 'number') used.push(x.right); });
  used.forEach((sr) => { const a = calc.get(sr); const k = a.findIndex((v) => v != null); if (k > i0) i0 = k; });
  if (st.from) { const k = date.findIndex((d) => d >= st.from); if (k > i0) i0 = k; }
  if (st.to) { for (let k = n - 1; k >= 0; k--) if (date[k] <= st.to) { i1 = k; break; } }
  if (opt.range) [i0, i1] = opt.range;
  const rnd = opt.randomEntry;
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
    if (!pos && !pendingEntry && i < i1 && (rnd ? rnd.rng() < rnd.p : ent.length && ent.every((x) => btCond(calc, x, i)))) pendingEntry = true;
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

// ── 策略健檢: does the result survive the usual traps? Each check re-runs
// the engine over the same window (opt.range) on the same series cache.
function btRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const BT_RANDOM_RUNS = 200;
function btTweaks(st) {
  // Each numeric parameter moved ±20%, one at a time.
  const out = [], clone = () => JSON.parse(JSON.stringify(st));
  [['entry', 'all', '進場'], ['exit', 'any', '出場']].forEach(([a, b, lab]) => ((st[a] && st[a][b]) || []).forEach((c, k) => {
    if (typeof c.right === 'number' && c.right !== 0 && c.left.id !== 'weekday') {
      [0.8, 1.2].forEach((f) => { const s2 = clone(); s2[a][b][k].right = +(c.right * f).toPrecision(4); out.push({ label: `${lab}門檻 ${btN(c.right, 2).replace(/\.00$/, '')}→${btN(s2[a][b][k].right, 2).replace(/\.00$/, '')}`, st: s2 }); });
    }
    ['left', 'right'].forEach((side) => {
      const x = c[side];
      if (!x || typeof x !== 'object' || !btDef(x.id).n) return;
      const n0 = x.n || btDef(x.id).n;
      [0.8, 1.2].forEach((f) => {
        const n2 = Math.max(2, Math.round(n0 * f));
        if (n2 === n0) return;
        const s2 = clone(); s2[a][b][k][side].n = n2;
        out.push({ label: `${btSeriesText(x)}→${n2} 日`, st: s2 });
      });
    });
  }));
  [['stopLoss', '停損', '點'], ['takeProfit', '停利', '點'], ['holdDays', '持有', '天']].forEach(([k, lab, u]) => {
    const v = st.exit && st.exit[k];
    if (!(v > 0)) return;
    [0.8, 1.2].forEach((f) => {
      const v2 = Math.max(1, Math.round(v * f));
      if (v2 === v) return;
      const s2 = clone(); s2.exit[k] = v2;
      out.push({ label: `${lab} ${v}→${v2} ${u}`, st: s2 });
    });
  });
  return out;
}
function btHealth(D, st, slip, R) {
  if (!R || !R.n) return null;
  const calc = btMakeCalc(D), range = [R.i0, R.i1];
  const run = (s2, sl = slip, extra = {}) => btRun(D, s2, sl, { calc, range, ...extra });
  const checks = [];
  const add = (id, name, status, value, text) => checks.push({ id, name, status, value, text });
  const profit = R.total > 0;
  add('n', '交易次數', R.n >= 30 ? 'good' : R.n >= 10 ? 'warn' : 'bad', `${R.n} 筆`,
    R.n >= 30 ? '樣本夠多，統計上比較可信' : '交易太少，結果很可能只是運氣；放寬條件或拉長期間');
  const mid = R.date[Math.floor((R.i0 + R.i1) / 2)];
  const h1 = R.trades.filter((t) => t.in < mid).reduce((a, t) => a + t.pnl, 0), h2 = R.trades.filter((t) => t.in >= mid).reduce((a, t) => a + t.pnl, 0);
  add('half', '前後半段', h1 > 0 && h2 > 0 ? 'good' : h1 <= 0 && h2 <= 0 ? 'bad' : 'warn', `前 ${btNT(h1)} · 後 ${btNT(h2)}`,
    h1 > 0 && h2 > 0 ? `以 ${mid} 切兩半，兩段都賺` : h1 <= 0 && h2 <= 0 ? '兩段都沒賺' : `以 ${mid} 切兩半，只有一段賺 —— 可能只適合某種行情`);
  const years = [];
  let prevEq = 0;
  for (let i = R.i0; i <= R.i1; i++) {
    const y = R.date[i].slice(0, 4), last = i === R.i1 || R.date[i + 1].slice(0, 4) !== y;
    if (last) { const e = R.equity[i] || 0; years.push({ y, pnl: e - prevEq }); prevEq = e; }
  }
  const active = years.filter((x) => Math.abs(x.pnl) > 1), posY = active.filter((x) => x.pnl > 0).length;
  const yr = active.length ? posY / active.length : 0;
  add('years', '逐年表現', yr >= 2 / 3 ? 'good' : yr >= 0.5 ? 'warn' : 'bad', `${posY}/${active.length} 年賺錢`,
    yr >= 2 / 3 ? '大部分年份都賺' : '賺錢的年份不夠多，績效集中在某幾年');
  const tw = btTweaks(st).map((t) => ({ ...t, total: run(t.st).total }));
  if (!tw.length) add('param', '參數敏感度', 'na', '—', '這個策略沒有可以微調的數字參數');
  else if (!profit) add('param', '參數敏感度', 'na', '—', '原策略虧損，這項不用看');
  else {
    const ok = tw.filter((t) => t.total > 0).length, worst = tw.reduce((a, t) => (t.total < a.total ? t : a));
    const f = ok / tw.length;
    add('param', '參數敏感度', f >= 0.8 ? 'good' : f >= 0.5 ? 'warn' : 'bad', `${ok}/${tw.length} 組仍賺錢`,
      `每個參數各調 ±20%；最差是「${worst.label}」${btNT(worst.total)}${f < 0.8 ? ' —— 參數稍微一動就變差，可能是調出來的' : ''}`);
  }
  const c3 = run(st, slip + 2);
  add('cost', '成本加重', !profit ? 'na' : c3.total > 0 ? 'good' : 'warn', btNT(c3.total),
    !profit ? '原策略虧損，這項不用看' : c3.total > 0 ? '每邊滑價再多 2 點仍然賺錢' : '每邊滑價多 2 點就虧 —— 實單很難賺到');
  if (!profit) add('conc', '獲利集中度', 'na', '—', '原策略虧損，這項不用看');
  else if (R.n <= 3) add('conc', '獲利集中度', 'warn', `${R.n} 筆`, '筆數太少，看不出集中度');
  else {
    const top = R.trades.slice().sort((a, b) => b.pnl - a.pnl).slice(0, 3).reduce((a, t) => a + t.pnl, 0);
    add('conc', '獲利集中度', R.total - top > 0 ? 'good' : 'warn', `拿掉前 3 筆 ${btNT(R.total - top)}`,
      R.total - top > 0 ? '拿掉最賺的 3 筆仍然賺錢' : '拿掉最賺的 3 筆就變虧 —— 獲利靠少數幾筆');
  }
  let rand = null;
  if ((st.entry && st.entry.all || []).length) {
    const flat = Math.max(1, R.days - R.trades.reduce((a, t) => a + t.days, 0));
    const rng = btRng(20261105), p = Math.min(0.9, R.n / flat), totals = [];
    for (let k = 0; k < BT_RANDOM_RUNS; k++) totals.push(run(st, slip, { randomEntry: { p, rng } }).total);
    const beat = totals.filter((x) => x < R.total).length / totals.length;
    rand = { totals, beat };
    add('rand', '和隨機進場比', beat >= 0.9 ? 'good' : beat >= 0.7 ? 'warn' : 'bad', `贏過 ${Math.round(beat * 100)}%`,
      `同方向、同出場規則，隨機挑進場日（交易次數相近）跑 ${BT_RANDOM_RUNS} 次${beat < 0.9 ? ' —— 進場條件的價值不明顯' : '，進場條件確實有加分'}`);
  }
  const ratio = R.mdd < 0 ? R.total / -R.mdd : (profit ? Infinity : 0);
  add('dd', '報酬回撤比', ratio >= 3 ? 'good' : ratio >= 1 ? 'warn' : 'bad', !profit ? '虧損' : Number.isFinite(ratio) ? `${ratio.toFixed(1)} 倍` : '沒有回撤',
    !profit ? '整段期間是虧的' : ratio >= 3 ? '總獲利是最大回撤的 3 倍以上' : '總獲利 ÷ 最大回撤偏低：要扛很深的回撤才拿得到這些獲利');
  const scored = checks.filter((c) => c.status !== 'na');
  const score = scored.reduce((a, c) => a + (c.status === 'good' ? 2 : c.status === 'warn' ? 1 : 0), 0) / (2 * scored.length || 1);
  const grade = !profit || score < 0.45 ? ['D', '不建議'] : score >= 0.85 ? ['A', '穩健'] : score >= 0.65 ? ['B', '尚可'] : ['C', '有疑慮'];
  return { checks, years, rand, score, grade };
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

// ── AI box: a Chinese description → the strategy JSON above, via Claude.
// The owner's own API key is kept in this browser only (localStorage) and the
// request goes straight from the browser to api.anthropic.com — no backend.
// The SDK is loaded on first use (window.loadAnthropic, index.html).
const BT_AI_KEY = 'optionsLab.anthropicKey.v1';
const BT_AI_MODEL = 'claude-opus-5-5';
const BT_AI_PRICE = { in: 4, out: 20, cacheW: 5, cacheR: 0.2 }; // US$ / 1M tokens, for the cost line only
const btAiLoadKey = () => { try { return localStorage.getItem(BT_AI_KEY) || ''; } catch (e) { return ''; } };
const BT_AI_SERIES_DOC = {
  close: '當日收盤價（點）',
  open: '當日開盤價（點）',
  ma: 'N 日簡單移動平均（收盤價，點）',
  ema: 'N 日指數移動平均（收盤價，點）',
  hh: '前 N 個交易日（不含當天）的最高價（點）；close > hh 代表突破 N 日新高',
  ll: '前 N 個交易日（不含當天）的最低價（點）；close < ll 代表跌破 N 日新低',
  ret: '最近 N 日收盤漲跌幅（%，-2 代表跌 2%）',
  gap: '當天開盤相對前一天收盤的跳空（%）',
  rsi: 'Wilder RSI(N)，0–100',
  range: '當天最高減最低（點）',
  volume: '當天成交量（口）',
  pc: '台指選擇權 P/C 未平倉比，用比值表示（1.2 代表 120%）',
  fx: '外資台指期淨未平倉（口；正數淨多、負數淨空）',
  fxChg: '外資台指期淨未平倉 N 日增減（口；正數代表變得更偏多）',
  retail: '小台散戶多空比（%；正數散戶偏多、負數偏空）',
  weekday: '星期幾（1 = 週一 … 5 = 週五）',
  gex: '台指選擇權所有到期月份加總的造市商 Gamma 曝險（NT$ 億／指數每動 1%）；正數 = 造市商多 Gamma，避險會壓抑波動；負數 = 空 Gamma，波動容易放大。研究上主要預測波動大小，不是方向',
  zeroGamma: '零 Gamma 價位（點）：總 GEX 由正轉負的指數價位；收盤在它之上 = 正 Gamma 區，之下 = 負 Gamma 區（現價上下 10% 內找不到時當天沒有值）',
  callWall: 'Call Gamma 牆（點）：Call 的 Gamma 曝險最大的履約價，常被當成上方壓力',
  putWall: 'Put Gamma 牆（點）：Put 的 Gamma 曝險最大的履約價，常被當成下方支撐',
};
// Engine rules and series, shared by both prompts below.
const BT_AI_ENGINE = [
  '資料：台指期近月日盤日 K（TX）。所有條件在每個交易日收盤時判斷。',
  '',
  '引擎規則：',
  '- entry.all：全部成立（AND）的那天收盤後，隔天開盤進場。同一時間最多一筆部位，不加碼、不反手。整個策略只做多或只放空（side）。',
  '- exit.stopLoss / exit.takeProfit：以進場價為準的點數，用當天最高最低判斷。',
  '- exit.holdDays：持有到第 N 天收盤出場（進場那天算第 1 天）。',
  '- exit.any：任一成立的那天收盤後，隔天開盤出場。',
  '- 沒有給的出場條件填 null 或空陣列。',
  '- contract：TX 大台（每點 200 元）、MTX 小台（每點 50 元）。沒講就用 MTX、qty 1。',
  '- from / to：回測期間 YYYY/MM/DD，沒講就 null。',
  '',
  '條件格式：{ left: 序列, op, right: 序列或數字 }。op：> < >= <=，crossAbove = 今天在上面且昨天不在上面（向上穿越、站上），crossBelow = 跌破。',
  '序列 { id, n }：n 只用在有 N 的序列，其他填 null。可用序列：',
  ...BT_SERIES.map((s) => `- ${s.id}${s.n ? `（N，預設 ${s.n}）` : ''}：${BT_AI_SERIES_DOC[s.id] || s.label}`),
  '',
  '換算：',
  '- 「站上 / 突破 / 跌破 某均線」用 crossAbove / crossBelow；「在均線之上 / 之下」用 > / <。',
  '- 停損停利給百分比：用使用者訊息裡的最近收盤價換成點數（四捨五入到 10 點）。給金額：小台 ÷ 50、大台 ÷ 200 換成點數。',
  '- 「黃金交叉」= 短均線 crossAbove 長均線；MACD 翻正 ≈ ema(12) crossAbove ema(26)。',
  '- 「跌破零 Gamma / 進入負 Gamma」= close crossBelow zeroGamma；「在正 Gamma 區」= close > zeroGamma；「GEX 轉負」= gex crossBelow 0。GEX 研究上預測的是波動大小不是方向；拿它決定做多或放空時，在 notes（或檢討的 issues）提醒這一點。',
  '- 使用者說「很高、偏多、大增」但沒給數字時，參考訊息裡的資料範圍選一個合理門檻。',
].join('\n');
const BT_AI_SYSTEM = [
  '你把台灣使用者用中文描述的台指期交易策略，轉成回測引擎看得懂的 JSON。只輸出符合 schema 的 JSON。',
  '',
  BT_AI_ENGINE,
  '',
  'notes：用繁體中文短句列出你做的每個假設或換算（例如「「散戶很偏多」設為 > 30%」）；沒有就空陣列。',
  'unsupported：描述裡引擎做不到、被你省略或近似的部分（例如「或」條件、分 K、KD、布林通道、選擇權、其他商品、加碼），一句一項；沒有就空陣列。',
  '如果整段描述都不是可以回測的台指期策略（例如在問問題、選擇權組合、個股），ok 填 false，把原因寫在 notes，其他欄位照 schema 隨便填合法值。否則 ok 填 true。',
  '如果使用者是在修改「目前的策略」（例如「停損改 200」「改成大台」），從目前的策略開始，只改他說的地方。',
  'name：10 個字以內的繁體中文策略名稱。',
].join('\n');
const BT_AI_REVIEW_SYSTEM = [
  '你是嚴格但務實的台指期量化策略顧問。使用者會給你一個策略、它在歷史資料上的回測結果和健檢結果，你用繁體中文（台灣用語）回覆，只輸出符合 schema 的 JSON。',
  '',
  'summary：2–4 句白話，說這個策略在賭什麼、哪裡有效、最大的問題。',
  'issues：最多 4 點，每點一句，具體指出問題並引用數字。',
  'variants：最多 3 個改良版，strategy 用同一個格式。原則：',
  '- 目標是更穩健（通過更多健檢、回撤更小、前後半段都賺、贏過隨機進場），不是把歷史績效調到最高。',
  '- 每個改動要有交易邏輯上的理由，不要把門檻微調到剛好符合過去；門檻用整數或常見值。',
  '- 至少一個版本比原版更簡單或條件更少。版本之間要有明顯差異（例如加趨勢濾網、改出場方式、換方向、換進場訊號）。',
  '- 只能用下面引擎支援的序列和規則；保留原策略的 from / to、contract 和 qty。',
  '- title：8 個字以內；why：一兩句說改了什麼、想改善哪一項健檢；strategy.name 和 title 一樣。',
  '- 你看不到改良版的結果，網站會自動幫每個版本回測和健檢，所以不要預測績效數字。',
  '',
  BT_AI_ENGINE,
].join('\n');
const btAiNullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
const BT_AI_SERIES_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string', enum: BT_SERIES.map((s) => s.id) }, n: btAiNullable('integer') },
  required: ['id', 'n'], additionalProperties: false,
};
const BT_AI_COND_SCHEMA = {
  type: 'object',
  properties: { left: BT_AI_SERIES_SCHEMA, op: { type: 'string', enum: BT_OPS.map((o) => o.id) }, right: { anyOf: [{ type: 'number' }, BT_AI_SERIES_SCHEMA] } },
  required: ['left', 'op', 'right'], additionalProperties: false,
};
const BT_AI_STRATEGY_PROPS = {
  name: { type: 'string' },
  side: { type: 'string', enum: ['long', 'short'] },
  contract: { type: 'string', enum: Object.keys(BT_CONTRACTS) },
  qty: { type: 'integer' },
  entry: { type: 'object', properties: { all: { type: 'array', items: BT_AI_COND_SCHEMA } }, required: ['all'], additionalProperties: false },
  exit: {
    type: 'object',
    properties: { holdDays: btAiNullable('integer'), stopLoss: btAiNullable('number'), takeProfit: btAiNullable('number'), any: { type: 'array', items: BT_AI_COND_SCHEMA } },
    required: ['holdDays', 'stopLoss', 'takeProfit', 'any'], additionalProperties: false,
  },
  from: btAiNullable('string'),
  to: btAiNullable('string'),
};
const BT_AI_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, ...BT_AI_STRATEGY_PROPS, notes: { type: 'array', items: { type: 'string' } }, unsupported: { type: 'array', items: { type: 'string' } } },
  required: ['ok', ...Object.keys(BT_AI_STRATEGY_PROPS), 'notes', 'unsupported'],
  additionalProperties: false,
};
const BT_AI_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    variants: { type: 'array', items: {
      type: 'object',
      properties: { title: { type: 'string' }, why: { type: 'string' }, strategy: { type: 'object', properties: BT_AI_STRATEGY_PROPS, required: Object.keys(BT_AI_STRATEGY_PROPS), additionalProperties: false } },
      required: ['title', 'why', 'strategy'], additionalProperties: false,
    } },
  },
  required: ['summary', 'issues', 'variants'],
  additionalProperties: false,
};

// What the model sees besides the fixed instructions: the data it can test
// against (so thresholds land inside real ranges) and the strategy on screen.
const btAiStrip = ({ name, side, contract, qty, entry, exit, from, to }) => ({ name, side, contract, qty, entry, exit, from: from || null, to: to || null });
function btAiDataLines(D) {
  const rng = (rows) => {
    const v = (rows || []).map((r) => r[1]).filter((x) => x != null);
    return v.length ? `${rows[0][0]} 起，最小 ${Math.min(...v)}、最大 ${Math.max(...v)}、最新 ${v[v.length - 1]}` : '沒有資料';
  };
  const last = D.bars[D.bars.length - 1];
  return [
    `資料：日 K ${D.bars[0][0]} – ${last[0]}，最近收盤 ${last[4]} 點。`,
    `pc：${rng(D.pc)}。fx：${rng(D.fx)}。retail：${rng(D.retail)}。gex：${rng(D.gex)}。`,
  ];
}
function btAiUserMsg(text, cur, D) {
  return [
    ...btAiDataLines(D),
    `目前畫面上的策略：${JSON.stringify(btAiStrip(cur))}`,
    '',
    `使用者的描述：${text}`,
  ].join('\n');
}
function btAiReviewMsg(st, R, H, D) {
  const ct = BT_CONTRACTS[st.contract] || BT_CONTRACTS.MTX;
  const mark = { good: '通過', warn: '注意', bad: '不及格', na: '不適用' };
  return [
    ...btAiDataLines(D),
    `策略：${JSON.stringify(btAiStrip(st))}`,
    `白話：${btStrategyText(st)}`,
    `回測期間 ${R.from} – ${R.to}，${R.days} 個交易日，每口${ct.label}每點 NT$${ct.mult}，已扣手續費、期交稅、滑價。`,
    `結果：總損益 ${btNT(R.total)}；交易 ${R.n} 筆；勝率 ${Math.round(R.winRate * 100)}%；平均賺 ${btNT(R.avgWin)}、平均賠 ${btNT(R.avgLoss)}；獲利因子 ${Number.isFinite(R.pf) ? R.pf.toFixed(2) : '∞'}；最大回撤 ${btNT(R.mdd)}；最長連賠 ${R.worstStreak} 筆；在場時間 ${Math.round(R.exposure * 100)}%；同期間同方向一直抱著 ${btNT(R.bh)}。`,
    `逐年損益：${H.years.map((y) => `${y.y} ${btNT(y.pnl)}`).join('、')}`,
    `健檢等級 ${H.grade[0]}（${H.grade[1]}）：`,
    ...H.checks.map((c) => `- ${c.name}：${mark[c.status]} · ${c.value} · ${c.text}`),
  ].join('\n');
}

// The schema guarantees the shape; this keeps what the engine can run.
function btAiNormalize(o) {
  const ids = new Set(BT_SERIES.map((s) => s.id)), ops = new Set(BT_OPS.map((x) => x.id));
  const dropped = [];
  const ser = (x) => {
    if (!x || !ids.has(x.id)) return null;
    const d = btDef(x.id);
    return d.n ? { id: x.id, n: Math.max(1, Math.min(250, Math.round(x.n || d.n))) } : { id: x.id };
  };
  const cond = (c) => {
    const left = ser(c.left), right = typeof c.right === 'number' ? (Number.isFinite(c.right) ? c.right : null) : ser(c.right);
    if (!left || right == null || !ops.has(c.op)) { dropped.push('有一個條件格式不對，已略過'); return null; }
    return { left, op: c.op, right };
  };
  const pos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const day = (v) => { const m = typeof v === 'string' && v.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/); return m ? `${m[1]}/${m[2]}/${m[3]}` : null; };
  const st = {
    name: String(o.name || 'AI 策略').slice(0, 20),
    side: o.side === 'short' ? 'short' : 'long',
    contract: BT_CONTRACTS[o.contract] ? o.contract : 'MTX',
    qty: Math.max(1, Math.min(20, Math.round(o.qty) || 1)),
    entry: { all: ((o.entry && o.entry.all) || []).map(cond).filter(Boolean) },
    exit: {
      holdDays: pos(o.exit && o.exit.holdDays) && Math.round(o.exit.holdDays),
      stopLoss: pos(o.exit && o.exit.stopLoss),
      takeProfit: pos(o.exit && o.exit.takeProfit),
      any: ((o.exit && o.exit.any) || []).map(cond).filter(Boolean),
    },
    from: day(o.from), to: day(o.to),
  };
  return { ok: o.ok !== false && st.entry.all.length > 0, st, notes: (o.notes || []).concat(dropped), unsupported: o.unsupported || [] };
}

let btSdk = null;
async function btAiCall(key, system, schema, content, maxTokens) {
  if (!btSdk) {
    if (!window.loadAnthropic) throw new Error('AI 元件載入器不在（請重新整理頁面）');
    try { btSdk = await window.loadAnthropic(); } catch (e) { throw new Error('AI 元件載入失敗：可能是網路擋住了 jsdelivr / esm.sh，換個網路再試'); }
  }
  const SDK = btSdk;
  const client = new SDK.default({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  let res;
  try {
    res = await client.messages.create({
      model: BT_AI_MODEL,
      max_tokens: maxTokens,
      cache_control: { type: 'ephemeral' },
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof SDK.AuthenticationError) throw new Error('金鑰不對或已停用。到 Claude Console 的 API Keys 重新建立一把再貼上。');
    if (e instanceof SDK.PermissionDeniedError) throw new Error('這把金鑰沒有權限使用這個模型。');
    if (e instanceof SDK.RateLimitError) throw new Error('請求太頻繁或達到用量上限，稍等一下再試。');
    if (e instanceof SDK.BadRequestError) throw new Error(`Anthropic 拒絕了這次請求（額度用完時也是這個錯誤）：${(e.error && e.error.error && e.error.error.message) || e.message}`);
    if (e instanceof SDK.APIConnectionError) throw new Error('連不上 Anthropic，檢查一下網路再試。');
    if (e instanceof SDK.InternalServerError) throw new Error('Anthropic 暫時忙碌，過一下再試。');
    throw e;
  }
  const u = res.usage || {};
  const cost = ((u.input_tokens || 0) * BT_AI_PRICE.in + (u.output_tokens || 0) * BT_AI_PRICE.out
    + (u.cache_creation_input_tokens || 0) * BT_AI_PRICE.cacheW + (u.cache_read_input_tokens || 0) * BT_AI_PRICE.cacheR) / 1e6;
  if (res.stop_reason === 'refusal') throw new Error('AI 拒絕處理這次的內容，換個說法再試。');
  if (res.stop_reason === 'max_tokens') throw new Error('AI 的回答太長沒寫完，再試一次。');
  const block = res.content.find((b) => b.type === 'text');
  if (!block) throw new Error('AI 沒有回傳結果，再試一次。');
  return { json: JSON.parse(block.text), cost };
}
async function btAiParse(key, text, cur, D) {
  const { json, cost } = await btAiCall(key, BT_AI_SYSTEM, BT_AI_SCHEMA, btAiUserMsg(text, cur, D), 8000);
  return { ...btAiNormalize(json), cost };
}
async function btAiReview(key, st, R, H, D) {
  const { json, cost } = await btAiCall(key, BT_AI_REVIEW_SYSTEM, BT_AI_REVIEW_SCHEMA, btAiReviewMsg(st, R, H, D), 16000);
  const variants = (json.variants || []).slice(0, 3).map((v) => {
    const x = btAiNormalize({ ...v.strategy, ok: true });
    return { title: String(v.title || '').slice(0, 16), why: v.why || '', st: { ...x.st, name: String(v.title || x.st.name).slice(0, 20) } };
  }).filter((v) => v.st.entry.all.length);
  return { summary: json.summary || '', issues: (json.issues || []).slice(0, 4), variants, cost };
}

const BT_AI_EXAMPLES = [
  '散戶多空比超過 30% 而且收盤跌破 20 日均線，隔天放空一口小台，停損 300 點，最多抱 5 天',
  '外資淨空單比 5 天前多 5000 口以上就放空大台，停利 400 點、停損 200 點',
  'RSI 跌破 25 就買進，RSI 回到 50 以上出場，停損 2%',
];

function BtAsk({ st, D, onApply, aiKey: key, setAiKey: setKey, keyOpen, setKeyOpen }) {
  const [text, setText] = btS('');
  const [draft, setDraft] = btS('');
  const [busy, setBusy] = btS(false);
  const [err, setErr] = btS('');
  const [out, setOut] = btS(null); // { notes, unsupported, cost, prev, ok }
  const saveKey = () => {
    const k = draft.trim();
    if (!k) return;
    try { localStorage.setItem(BT_AI_KEY, k); } catch (e) { /* storage off: keep it for this visit */ }
    setKey(k); setDraft(''); setKeyOpen(false); setErr('');
  };
  const dropKey = () => { try { localStorage.removeItem(BT_AI_KEY); } catch (e) { /* storage off */ } setKey(''); };
  const run = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (!key) { setKeyOpen(true); return; }
    setBusy(true); setErr(''); setOut(null);
    try {
      const r = await btAiParse(key, t, st, D);
      if (r.ok) { setOut({ ...r, prev: st }); onApply(r.st); } else setOut({ ...r, prev: null });
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };
  const link = { background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 };
  return (
    <div id="bt-ask" className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>✍️ 用中文描述你的策略<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginLeft: 8 }}>AI 會轉成下面的條件並直接回測</span></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
          placeholder="例：散戶多空比超過 30%，而且收盤跌破 20 日均線，隔天放空一口小台，停損 300 點，最多抱 5 天（也可以說「停損改 200」來修改目前的策略）"
          style={{ ...btInput, flex: 1, resize: 'vertical', fontSize: 13.5, lineHeight: 1.5 }} />
        <button onClick={run} disabled={busy || !text.trim()}
          style={{ border: 'none', borderRadius: 10, padding: '0 18px', fontWeight: 800, fontSize: 14, fontFamily: 'inherit', cursor: busy || !text.trim() ? 'default' : 'pointer',
            background: busy || !text.trim() ? 'var(--chip)' : 'var(--blue)', color: busy || !text.trim() ? 'var(--muted)' : '#fff' }}>
          {busy ? '解析中…' : '用 AI 解析並回測'}
        </button>
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {BT_AI_EXAMPLES.map((x) => <button key={x} onClick={() => setText(x)} title={x}>{x.length > 22 ? `${x.slice(0, 22)}…` : x}</button>)}
      </div>
      {err && <div style={{ fontSize: 12.5, marginTop: 8, color: BT_UP }}>⚠️ {err}</div>}
      {out && (
        <div style={{ fontSize: 12.5, marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--panel2)', lineHeight: 1.65 }}>
          {!out.ok && <div style={{ fontWeight: 700 }}>這段描述沒辦法變成回測條件。</div>}
          {out.notes.length > 0 && <div><b>{out.ok ? 'AI 的理解：' : '原因：'}</b>{out.notes.join('；')}</div>}
          {out.unsupported.length > 0 && <div style={{ color: BT_GOLD }}><b>回測做不到、已省略的部分：</b>{out.unsupported.join('；')}</div>}
          <div style={{ color: 'var(--muted)', marginTop: 2 }}>
            {out.ok ? '已套用到下面的策略設定，可以再手動調整。' : ''}本次約 US${out.cost.toFixed(3)}
            {out.prev && <> · <button style={link} onClick={() => { onApply(out.prev); setOut(null); }}>還原成上一個策略</button></>}
          </div>
        </div>
      )}
      <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text2)' }}>
        {key ? <>🔑 已設定 Claude API 金鑰（只存在這台瀏覽器）· <button style={link} onClick={() => setKeyOpen((v) => !v)}>更換</button> · <button style={link} onClick={dropKey}>移除</button></>
          : <>🔑 第一次使用要先設定 Claude API 金鑰 · <button style={link} onClick={() => setKeyOpen((v) => !v)}>設定金鑰</button></>}
      </div>
      {keyOpen && (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, lineHeight: 1.7, color: 'var(--text2)' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }}
              placeholder="sk-ant-…" autoComplete="off" spellCheck={false} style={{ ...btInput, flex: 1 }} />
            <button onClick={saveKey} disabled={!draft.trim()} style={{ ...btInput, cursor: 'pointer', fontWeight: 700 }}>儲存</button>
          </div>
          金鑰到 <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>Claude Console → API Keys</a> 建立。
          Max 方案每月附的 API 額度要先在 claude.ai 的「設定 → 帳單」連結 Console 組織才會入帳。
          金鑰只存在這台瀏覽器，解析時直接送到 Anthropic，不經過這個網站的伺服器；建議在 Console 開一個專用 workspace 並設每月上限。
        </div>
      )}
    </div>
  );
}

// ── 策略健檢 card
const BT_STATUS = {
  good: { c: 'var(--blue)', s: '✓', t: '通過' },
  warn: { c: BT_GOLD, s: '!', t: '注意' },
  bad: { c: BT_UP, s: '✕', t: '不及格' },
  na: { c: 'var(--muted)', s: '–', t: '不適用' },
};
const BT_GRADE_C = { A: 'var(--blue)', B: 'var(--blue)', C: BT_GOLD, D: BT_UP };
function BtGrade({ H, size = 28 }) {
  const c = BT_GRADE_C[H.grade[0]];
  return <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}><b style={{ fontSize: size, fontWeight: 900, color: c, lineHeight: 1 }}>{H.grade[0]}</b><span style={{ fontSize: size > 20 ? 13 : 11.5, fontWeight: 700, color: c }}>{H.grade[1]}</span></span>;
}
// Where the strategy lands among the random-entry runs.
function BtRandHist({ H, R, light }) {
  const [ref, w] = btUseWidth(600);
  const v = H.rand.totals, lo = Math.min(R.total, ...v), hi = Math.max(R.total, ...v), nb = 32;
  const bins = new Array(nb).fill(0), bi = (x) => Math.min(nb - 1, Math.floor((x - lo) / ((hi - lo) || 1) * nb));
  v.forEach((x) => { bins[bi(x)] += 1; });
  const top = Math.max(...bins), Hh = 54, bw = w / nb, X = (x) => (x - lo) / ((hi - lo) || 1) * w;
  const txt = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const zx = lo < 0 && hi > 0 ? X(0) : null;
  return (
    <div ref={ref} style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>隨機進場 {v.length} 次的總損益分佈 · <span style={{ color: 'var(--blue)', fontWeight: 700 }}>藍線是你的策略</span></div>
      <svg width={w} height={Hh + 16} style={{ display: 'block', fontFamily: 'var(--font-mono)' }}>
        {bins.map((n, k) => <rect key={k} x={k * bw + 1} y={Hh - (n / top) * Hh} width={Math.max(1, bw - 2)} height={(n / top) * Hh} fill={txt} opacity="0.45" />)}
        {zx != null && <line x1={zx} x2={zx} y1={0} y2={Hh} stroke={txt} strokeDasharray="2 3" />}
        <line x1={X(R.total)} x2={X(R.total)} y1={0} y2={Hh} stroke="var(--blue)" strokeWidth="2.5" />
        <text x={2} y={Hh + 13} fontSize="10.5" fill={txt}>{btNT(lo)}</text>
        {zx != null && <text x={zx} y={Hh + 13} fontSize="10.5" fill={txt} textAnchor="middle">0</text>}
        <text x={w - 2} y={Hh + 13} fontSize="10.5" fill={txt} textAnchor="end">{btNT(hi)}</text>
      </svg>
    </div>
  );
}
function BtHealthCard({ H, busy, light, R }) {
  if (!H) return busy ? <div className="card" style={{ padding: '16px 18px', fontSize: 13, color: 'var(--muted)' }}>🩺 策略健檢中…</div> : null;
  const cnt = (k) => H.checks.filter((c) => c.status === k).length;
  return (
    <div className="card" style={{ padding: '16px 18px', opacity: busy ? 0.6 : 1, transition: 'opacity .2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>🩺 策略健檢</div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{H.checks.length} 項：通過 {cnt('good')} · 注意 {cnt('warn')} · 不及格 {cnt('bad')}{cnt('na') ? ` · 不適用 ${cnt('na')}` : ''}{busy ? ' · 更新中…' : ''}</span>
        <span style={{ marginLeft: 'auto' }}><BtGrade H={H} /></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '22px 84px minmax(110px, max-content) minmax(0, 1fr)', columnGap: 10, rowGap: 0, alignItems: 'center', fontSize: 12.5 }}>
        {H.checks.map((c) => {
          const m = BT_STATUS[c.status];
          const cell = { padding: '7px 0', borderBottom: '1px solid var(--border)' };
          return [
            <span key={`${c.id}i`} style={{ ...cell, display: 'flex' }}><b title={m.t} style={{ width: 18, height: 18, borderRadius: 9, background: m.c, color: '#fff', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{m.s}</b></span>,
            <span key={`${c.id}n`} style={{ ...cell, fontWeight: 700 }}>{c.name}</span>,
            <span key={`${c.id}v`} className="mono tnum" style={{ ...cell, whiteSpace: 'nowrap', color: m.c, fontWeight: 700 }}>{c.value}</span>,
            <span key={`${c.id}t`} style={{ ...cell, color: 'var(--text2)' }}>{c.text}</span>,
          ];
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: 'var(--text2)', marginRight: 2 }}>逐年損益</span>
        {H.years.map((y) => <span key={y.y} className="mono tnum" style={{ padding: '3px 8px', borderRadius: 8, background: 'var(--panel2)', color: y.pnl > 0 ? BT_UP : y.pnl < 0 ? BT_DOWN : 'var(--muted)' }}>{y.y} {btNT(y.pnl)}</span>)}
      </div>
      {H.rand && <BtRandHist H={H} R={R} light={light} />}
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>不偷看未來：收盤判斷、隔天開盤成交。健檢用的是同一段歷史，全部通過也不保證未來會賺。</div>
    </div>
  );
}

// ── AI 檢討與改良: Claude reads the result and the health check, proposes up
// to three variants; each variant is backtested and checked here, so the
// numbers on screen are the engine's, not the model's.
function BtReview({ st, R, H, D, slip, aiKey, askKey, onApply }) {
  const [busy, setBusy] = btS(false);
  const [err, setErr] = btS('');
  const [rv, setRv] = btS(null);
  const run = async () => {
    if (!aiKey) { askKey(); return; }
    if (!H || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await btAiReview(aiKey, st, R, H, D);
      const variants = r.variants.map((v) => { const R2 = btRun(D, v.st, slip); return { ...v, R: R2, H: R2.n ? btHealth(D, v.st, slip, R2) : null }; });
      setRv({ ...r, variants, base: { st, R, H } });
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  };
  const cur = JSON.stringify(btAiStrip(st));
  const same = (x) => JSON.stringify(btAiStrip(x)) === cur;
  const col = (v) => (v > 0 ? BT_UP : v < 0 ? BT_DOWN : 'var(--text)');
  const link = { background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 };
  const off = busy || !H;
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>🤖 AI 檢討與改良</div>
        <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1, minWidth: 200 }}>AI 讀完回測和健檢，指出問題並提出最多 3 個改良版；每個版本網站都會自動回測和健檢</span>
        <button onClick={run} disabled={off}
          style={{ border: 'none', borderRadius: 10, padding: '9px 16px', fontWeight: 800, fontSize: 13.5, fontFamily: 'inherit', cursor: off ? 'default' : 'pointer', background: off ? 'var(--chip)' : 'var(--blue)', color: off ? 'var(--muted)' : '#fff' }}>
          {busy ? 'AI 思考中…（約半分鐘）' : rv ? '重新檢討目前的策略' : '請 AI 檢討並提出改良版'}
        </button>
      </div>
      {!aiKey && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>需要 Claude API 金鑰 · <button style={link} onClick={askKey}>到最上面設定</button></div>}
      {err && <div style={{ fontSize: 12.5, marginTop: 8, color: BT_UP }}>⚠️ {err}</div>}
      {rv && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>{rv.summary}</div>
          {rv.issues.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text2)' }}>{rv.issues.map((x, k) => <li key={k}>{x}</li>)}</ul>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginTop: 12 }}>
            {rv.variants.map((v, k) => {
              const on = same(v.st), d = v.R.total - rv.base.R.total;
              const row = (lab, val, color) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border)' }}><span style={{ color: 'var(--text2)' }}>{lab}</span><span className="mono tnum" style={{ fontWeight: 700, color: color || 'var(--text)' }}>{val}</span></div>;
              return (
                <div key={k} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--panel2)', border: on ? '2px solid var(--blue)' : '2px solid transparent', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 14 }}>{v.title}</b><span style={{ marginLeft: 'auto' }}>{v.H ? <BtGrade H={v.H} size={18} /> : null}</span></div>
                  <div style={{ color: 'var(--text2)', lineHeight: 1.55 }}>{v.why}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.5 }}>{btStrategyText(v.st)}</div>
                  {v.R.n ? <div>
                    {row('總損益', <>{btNT(v.R.total)} <span style={{ fontSize: 11, color: col(d) }}>（{d >= 0 ? '多' : '少'} {btNT(Math.abs(d)).replace(/^[+−]/, '')}）</span></>, col(v.R.total))}
                    {row('交易次數', `${v.R.n} 筆`)}
                    {row('勝率', `${Math.round(v.R.winRate * 100)}%`)}
                    {row('獲利因子', Number.isFinite(v.R.pf) ? v.R.pf.toFixed(2) : '∞')}
                    {row('最大回撤', btNT(v.R.mdd), BT_DOWN)}
                  </div> : <div style={{ color: 'var(--muted)' }}>這個版本在回測期間一次都沒進場。</div>}
                  <button onClick={() => onApply(v.st)} disabled={on}
                    style={{ ...btInput, marginTop: 'auto', cursor: on ? 'default' : 'pointer', fontWeight: 700, textAlign: 'center', background: on ? 'var(--chip)' : 'var(--panel)', color: on ? 'var(--muted)' : 'var(--blue)' }}>
                    {on ? '使用中' : '套用這個版本'}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
            本次約 US${rv.cost.toFixed(3)} · 原版「{rv.base.st.name}」{btNT(rv.base.R.total)}、健檢 {rv.base.H.grade.join(' ')}
            {!same(rv.base.st) && <> · <button style={link} onClick={() => onApply(rv.base.st)}>回到原版</button></>}
            <br />改良版是看同一段歷史想出來的，挑版本時優先看健檢等級和前後半段，而不是總損益最高的那個。
          </div>
        </div>
      )}
    </div>
  );
}

function BacktestWorkspace({ P, light }) {
  const D = btM(() => btData(), []);
  const [st, setSt] = btS(() => JSON.parse(JSON.stringify(BT_PRESETS[0])));
  const [slip, setSlip] = btS(1);
  const [saved, setSaved] = btS(btLoadSaved);
  const R = btM(() => (D ? btRun(D, st, slip) : null), [D, st, slip]);
  const [aiKey, setAiKey] = btS(btAiLoadKey);
  const [keyOpen, setKeyOpen] = btS(false);
  // The health check re-runs the engine a few hundred times — wait until the
  // form stops changing, keep the last result on screen meanwhile.
  const [H, setH] = btS(null);
  const [hBusy, setHBusy] = btS(false);
  btE(() => {
    if (!D || !R) return undefined;
    setHBusy(true);
    const t = setTimeout(() => { setH(btHealth(D, st, slip, R)); setHBusy(false); }, 350);
    return () => clearTimeout(t);
  }, [D, R]);
  const askKey = () => { setKeyOpen(true); const el = document.getElementById('bt-ask'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const apply = (x) => setSt(JSON.parse(JSON.stringify(x)));
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
      <BtAsk st={st} D={D} onApply={apply} aiKey={aiKey} setAiKey={setAiKey} keyOpen={keyOpen} setKeyOpen={setKeyOpen} />
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
              回測期間 {R.from} – {R.to}（{btN(R.days)} 個交易日，從條件用到的資料都有的那天開始）{D.src === 'short' ? ' · 目前只有約 8 個月日 K' : ''} · 每口{ct.label}每點 NT${ct.mult} · 已扣手續費、期交稅、滑價
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
          {R.n > 0 && <BtHealthCard H={H} busy={hBusy} light={light} R={R} />}
          {R.n > 0 && <BtReview st={st} R={R} H={hBusy ? null : H} D={D} slip={slip} aiKey={aiKey} askKey={askKey} onApply={apply} />}
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

Object.assign(window, { BT_SERIES, BT_OPS, BT_PRESETS, btData, btRun, btHealth, btStrategyText, BacktestWorkspace });
