// positioning.jsx — TAIFEX positioning, history and margin panels (desktop
// PanelGrid bodies). Every figure is read from an exchange block in the
// snapshot / proxy (taifex.py) or computed here from those numbers by a rule
// written next to it; nothing is filled in. Each panel leads with one plain
// sentence (value, direction, change vs the previous session) and puts the
// table under it. Exports on window.* like the other .jsx files; hooks are
// aliased (classic scripts share one global scope).
const { useState: psS, useMemo: psM, useRef: psR } = React;

const PS_UP = '#ef5350', PS_DOWN = '#26a69a', PS_GOLD = '#f0c068';
const psCol = (v) => (v > 0 ? PS_UP : v < 0 ? PS_DOWN : 'inherit');
const psN = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const psAbs = (v, dp = 0) => psN(v == null ? v : Math.abs(v), dp);
const psSigned = (v, dp = 0, unit = '') => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${psAbs(v, dp)}${unit}`);
const psMd = (d) => (d ? (d.includes('/') ? d.slice(5) : `${d.slice(4, 6)}/${d.slice(6, 8)}`) : '');
const psYi = (thousand) => (thousand == null ? null : thousand / 1e5); // 千元 → 億
const psDim = (light) => (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)');
const psCell = { fontFamily: 'var(--font-mono)', textAlign: 'right', whiteSpace: 'nowrap' };

function PsLead({ children }) {
  return <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4, marginBottom: 8 }}>{children}</div>;
}
function PsNote({ children, light }) {
  return <div className="mono" style={{ fontSize: 9.5, color: psDim(light), marginTop: 8, lineHeight: 1.5 }}>{children}</div>;
}
function PsEmpty({ children, light }) {
  return <div className="mono" style={{ fontSize: 11, color: psDim(light) }}>{children}</div>;
}
function PsSeg({ items, value, onChange }) {
  return (
    <span style={{ display: 'inline-flex', border: '1px solid var(--border)' }}>
      {items.map((it) => (
        <button key={it.id} onClick={() => onChange(it.id)} style={{
          border: 'none', padding: '2px 8px', fontSize: 10.5, cursor: 'pointer', fontFamily: 'inherit',
          background: value === it.id ? 'var(--panel2)' : 'transparent', color: value === it.id ? 'var(--text)' : 'var(--muted)', fontWeight: value === it.id ? 700 : 500,
        }}>{it.label}</button>
      ))}
    </span>
  );
}
// Two-layer figure: a large primary number with the secondary unit small underneath.
function PsTwo({ big, small, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: color || 'inherit', lineHeight: 1.15, whiteSpace: 'nowrap' }}>{big}</div>
      <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7, whiteSpace: 'nowrap' }}>{small}</div>
    </div>
  );
}
function PsTable({ head, rows, light, cols }) {
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, color: psDim(light), fontSize: 9.5, padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
        {head.map((h, i) => <span key={i} style={i ? { textAlign: 'right' } : null}>{h}</span>)}
      </div>
      {rows.map((r, j) => (
        <div key={j} style={{ display: 'grid', gridTemplateColumns: cols, gap: 6, padding: '2px 0', borderBottom: '1px solid var(--border)' }}>
          {r.map((c, i) => <span key={i} className={i ? 'tnum' : undefined} style={i ? psCell : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</span>)}
        </div>
      ))}
    </div>
  );
}
const psNetWord = (v) => (v > 0 ? '淨多' : v < 0 ? '淨空' : '持平');
const psMove = (v, unit) => (v == null ? '' : v === 0 ? '與前一交易日持平' : `比前一交易日往${v > 0 ? '多' : '空'}方移 ${psAbs(v)} ${unit}`);

// ── 1. 三大法人 TXO 買賣權 ─────────────────────────────────────────────────
const PS_WHO = { foreign: '外資', trust: '投信', dealer: '自營商' };
function OptInstPanel({ O, light }) {
  const [who, setWho] = psS('foreign');
  const I = O && O.inst;
  if (!I || !I.rows) return <PsEmpty light={light}>期交所選擇權三大法人資料未載入。</PsEmpty>;
  const r = I.rows[who] || I.rows.foreign;
  const c = r && r.call, p = r && r.put;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <PsSeg items={Object.keys(PS_WHO).map((k) => ({ id: k, label: PS_WHO[k] }))} value={who} onChange={setWho} />
      </div>
      {c && p && <PsLead>
        {PS_WHO[who]}買權<span style={{ color: psCol(c.netOi) }}>{psNetWord(c.netOi)} {psAbs(c.netOi)} 口</span>（{psMove(c.chgOi, '口')}），
        賣權<span style={{ color: psCol(p.netOi) }}>{psNetWord(p.netOi)} {psAbs(p.netOi)} 口</span>（{psMove(p.chgOi, '口')}）
      </PsLead>}
      <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr', gap: 6, alignItems: 'end', fontSize: 9.5, color: psDim(light), borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>
        <span>身份別</span><span style={{ textAlign: 'right' }}>買權淨未平倉（億 / 口）</span><span style={{ textAlign: 'right' }}>賣權淨未平倉（億 / 口）</span>
      </div>
      {Object.keys(PS_WHO).map((k) => {
        const x = I.rows[k];
        if (!x) return null;
        const cell = (s) => (s ? <PsTwo color={psCol(s.netAmt)} big={`${psSigned(psYi(s.netAmt), 2)}億`}
          small={<>{psSigned(s.netOi)} 口 · 較前日 <span style={{ color: psCol(s.chgOi) }}>{psSigned(s.chgOi)}</span></>} /> : '—');
        return (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr', gap: 6, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)', fontWeight: k === who ? 700 : 500 }}>
            <span style={{ fontSize: 11.5 }}>{PS_WHO[k]}</span>{cell(x.call)}{cell(x.put)}
          </div>
        );
      })}
      <div className="mono" style={{ fontSize: 9.5, color: psDim(light), margin: '8px 0 3px' }}>{PS_WHO[who]} · 近 {I.series.length} 個交易日</div>
      <PsTable light={light} cols="44px 1fr 1fr 1fr 1fr" head={['日期', '買權淨口', '買權淨億', '賣權淨口', '賣權淨億']}
        rows={I.series.slice().reverse().map((d) => {
          const v = d[who] || [];
          return [psMd(d.date), <span style={{ color: psCol(v[0]) }}>{psSigned(v[0])}</span>, psSigned(psYi(v[2]), 2),
            <span style={{ color: psCol(v[1]) }}>{psSigned(v[1])}</span>, psSigned(psYi(v[3]), 2)];
        })} />
      <PsNote light={light}>淨未平倉 = 買方未平倉 − 賣方未平倉（期交所「選擇權買賣權分計」）。契約金額為權利金市值，千元 ÷ 10 萬 = 億。買權淨多不等於看多、賣權淨多也不等於看空，要看是買方還是賣方部位。</PsNote>
    </div>
  );
}

// ── 2. 選擇權大額交易人 + 台指期前五大 / 特定法人 ──────────────────────────
const PS_LARGE_FILTERS = [{ id: 'all', label: '全部月份' }, { id: 'weekly', label: '週選' }, { id: 'front', label: '近月' }];
const PS_LARGE_ROWS = [['top5', '前五大'], ['top10', '前十大'], ['specific', '前十大中特定法人']];
function OptLargePanel({ O, M, light }) {
  const [f, setF] = psS('all');
  const L = O && O.large;
  const t10 = M && M.top10;
  const v = L && L.filters && (L.filters[f] || L.filters.all);
  const lbl = (PS_LARGE_FILTERS.find((x) => x.id === f) || {}).label;
  const side = (s, name) => {
    const g = v && v[s];
    if (!g) return null;
    return (<div style={{ marginTop: 6 }}>
      <div className="mono" style={{ fontSize: 9.5, color: psDim(light), marginBottom: 2 }}>{name} · 全市場未平倉 {psN(g.marketOi)} 口</div>
      <PsTable light={light} cols="1fr 72px 72px 1fr 64px" head={['', '買方（佔比）', '賣方（佔比）', '淨部位（佔比）', '淨較前日']}
        rows={PS_LARGE_ROWS.filter(([k]) => g[k]).map(([k, n]) => [n,
          `${psN(g[k].buy)} ${g[k].buyPct != null ? `${g[k].buyPct.toFixed(1)}%` : ''}`,
          `${psN(g[k].sell)} ${g[k].sellPct != null ? `${g[k].sellPct.toFixed(1)}%` : ''}`,
          <span style={{ color: psCol(g[k].net), fontWeight: 700 }}>{psSigned(g[k].net)}{g[k].netPct != null ? ` (${psSigned(g[k].netPct, 1)}%)` : ''}</span>,
          <span style={{ color: psCol(g[k].chg) }}>{psSigned(g[k].chg)}</span>])} />
    </div>);
  };
  const c10 = v && v.call && v.call.top10, p10 = v && v.put && v.put.top10;
  return (
    <div>
      {v ? <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
          <span className="mono" style={{ fontSize: 9.5, color: psDim(light) }}>{f === 'front' ? `近月 ${v.month}` : f === 'weekly' ? '所有週到期契約合計' : '所有契約合計'}</span>
          <PsSeg items={PS_LARGE_FILTERS.filter((x) => L.filters[x.id])} value={f} onChange={setF} />
        </div>
        {c10 && p10 && <PsLead>
          前十大交易人（{lbl}）買權<span style={{ color: psCol(c10.net) }}>{psNetWord(c10.net)} {psAbs(c10.net)} 口</span>
          {c10.netPct != null ? `（佔市場 ${Math.abs(c10.netPct).toFixed(1)}%）` : ''}，賣權<span style={{ color: psCol(p10.net) }}>{psNetWord(p10.net)} {psAbs(p10.net)} 口</span>
          {c10.chg != null ? `；買權淨部位${psMove(c10.chg, '口')}` : ''}
        </PsLead>}
        {side('call', '買權')}
        {side('put', '賣權')}
      </> : <PsEmpty light={light}>期交所選擇權大額交易人資料未載入。</PsEmpty>}
      <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
        <div className="mono" style={{ fontSize: 9.5, color: psDim(light), marginBottom: 4 }}>台指期大額交易人 · 近月 {t10 ? t10.month : ''} · {t10 ? psMd(t10.date) : ''}</div>
        {t10 ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[['前五大淨', t10.top5Net, null], ['前十大淨', t10.net, t10.chg], ['前十大中特定法人淨', t10.specificNet, null]].map(([n, val, chg]) => (
            <div key={n}>
              <div style={{ fontSize: 10, color: psDim(light) }}>{n}</div>
              <PsTwo color={psCol(val)} big={`${psSigned(val)} 口`} small={chg != null ? <>較前日 <span style={{ color: psCol(chg) }}>{psSigned(chg)}</span></> : (t10.marketOi ? `市場 OI ${psN(t10.marketOi)}` : '')} />
            </div>))}
        </div> : <PsEmpty light={light}>期交所期貨大額交易人資料未載入。</PsEmpty>}
      </div>
      <PsNote light={light}>期交所「大額交易人未沖銷部位結構」。佔比 = 部位 ÷ 全市場未沖銷部位。特定法人 = 前十大交易人中屬特定法人者（期交所交易人類別 1）。</PsNote>
    </div>
  );
}

// ── 3. P/C trend ───────────────────────────────────────────────────────────
// Series: the history file's P/C rows (any length) with the snapshot's series laid over by date.
function psPcSeries(M, H) {
  const by = {};
  ((H && H.pc) || []).forEach((r) => { by[r[0]] = { date: r[0], ratio: r[1], volRatio: r[2], putOi: r[3], callOi: r[4] }; });
  (((M && M.pcRatio) || {}).series || []).forEach((x) => { by[x.date] = { ...(by[x.date] || {}), ...x }; });
  return Object.keys(by).sort().map((d) => by[d]);
}
function PcTrendPanel({ M, H, light }) {
  const [mode, setMode] = psS('oi');
  const [hov, setHov] = psS(null);
  const svgRef = psR(null);
  const all = psM(() => psPcSeries(M, H), [M, H]);
  const key = mode === 'oi' ? 'ratio' : 'volRatio';
  const s = all.filter((x) => x[key] != null);
  if (s.length < 2) return <PsEmpty light={light}>P/C 歷史未載入。</PsEmpty>;
  const ma = s.map((_, i) => (i >= 19 ? s.slice(i - 19, i + 1).reduce((a, x) => a + x[key], 0) / 20 : null));
  const N = Math.min(63, s.length); // about three months of sessions
  const view = s.slice(-N), mav = ma.slice(-N);
  const last = view[view.length - 1], prev = view[view.length - 2], lastMa = mav[mav.length - 1];
  const W = 600, Ht = 150, pl = 34, pr = 50, pt = 8, pb = 18;
  const vals = view.map((x) => x[key]).concat(mav.filter((x) => x != null), [1]);
  const lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03;
  const X = (i) => pl + (i / Math.max(view.length - 1, 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (Ht - pt - pb);
  const path = (arr) => arr.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const ink = light ? 'rgba(20,30,50,0.85)' : 'rgba(255,255,255,0.88)';
  const grid = light ? 'rgba(20,30,50,0.12)' : 'rgba(255,255,255,0.10)';
  const name = mode === 'oi' ? '未平倉' : '成交量';
  const onMove = (e) => {
    const r = svgRef.current && svgRef.current.getBoundingClientRect();
    if (!r) return;
    const x = (e.clientX - r.left) / r.width * W;
    setHov(Math.max(0, Math.min(view.length - 1, Math.round((x - pl) / (W - pl - pr) * (view.length - 1)))));
  };
  const ticks = [lo, (lo + hi) / 2, hi];
  const hx = hov != null ? view[hov] : null;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <PsSeg items={[{ id: 'oi', label: '未平倉' }, { id: 'vol', label: '成交量' }]} value={mode} onChange={setMode} />
      </div>
      <PsLead>
        P/C {name}比 <span style={{ color: last[key] >= 1 ? PS_DOWN : PS_UP }}>{last[key].toFixed(2)}</span>
        {lastMa != null ? `，${last[key] >= lastMa ? '高於' : '低於'} 20 日均 ${lastMa.toFixed(2)}` : ''}
        {prev ? `；比前一交易日 ${psSigned(last[key] - prev[key], 2)}` : ''}
      </PsLead>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${Ht}`} width="100%" style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHov(null)} role="img" aria-label={`P/C ${name}比 近 ${view.length} 個交易日`}>
        {ticks.map((t, i) => <g key={i}><line x1={pl} x2={W - pr} y1={Y(t)} y2={Y(t)} stroke={grid} /><text x={pl - 4} y={Y(t) + 3} textAnchor="end" fontSize="9" fill={psDim(light)}>{t.toFixed(2)}</text></g>)}
        {lo < 1 && hi > 1 && <line x1={pl} x2={W - pr} y1={Y(1)} y2={Y(1)} stroke={psDim(light)} strokeDasharray="2 3" />}
        <polyline points={path(mav)} fill="none" stroke={psDim(light)} strokeWidth="1.5" strokeDasharray="4 3" />
        <polyline points={path(view.map((x) => x[key]))} fill="none" stroke={PS_GOLD} strokeWidth="2" strokeLinejoin="round" />
        <circle cx={X(view.length - 1)} cy={Y(last[key])} r="4" fill={PS_GOLD} />
        <text x={W - pr + 6} y={Y(last[key]) + 3} fontSize="9.5" fill={ink}>P/C {last[key].toFixed(2)}</text>
        {lastMa != null && <text x={W - pr + 6} y={Y(lastMa) + (Math.abs(Y(lastMa) - Y(last[key])) < 11 ? (Y(lastMa) > Y(last[key]) ? 13 : -7) : 3)} fontSize="9.5" fill={psDim(light)}>20日 {lastMa.toFixed(2)}</text>}
        <text x={pl} y={Ht - 4} fontSize="9" fill={psDim(light)}>{psMd(view[0].date)}</text>
        <text x={W - pr} y={Ht - 4} fontSize="9" fill={psDim(light)} textAnchor="end">{psMd(last.date)}</text>
        {hx && <g>
          <line x1={X(hov)} x2={X(hov)} y1={pt} y2={Ht - pb} stroke={psDim(light)} />
          <rect x={Math.min(X(hov) + 6, W - pr - 120)} y={pt} width="116" height="30" fill="var(--panel2)" stroke="var(--border)" />
          <text x={Math.min(X(hov) + 12, W - pr - 114)} y={pt + 12} fontSize="9.5" fill={ink}>{hx.date} P/C {hx[key].toFixed(2)}</text>
          <text x={Math.min(X(hov) + 12, W - pr - 114)} y={pt + 25} fontSize="9.5" fill={psDim(light)}>20日均 {mav[hov] != null ? mav[hov].toFixed(2) : '—（未滿 20 日）'}</text>
        </g>}
      </svg>
      <div className="mono" style={{ display: 'flex', gap: 12, fontSize: 9.5, color: psDim(light), margin: '2px 0 6px' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: PS_GOLD, verticalAlign: 'middle', marginRight: 4 }} />P/C {name}比</span>
        <span><span style={{ display: 'inline-block', width: 14, borderTop: `1.5px dashed ${psDim(light)}`, verticalAlign: 'middle', marginRight: 4 }} />20 日均</span>
        <span>近 {view.length} 個交易日（共存 {s.length} 日）</span>
      </div>
      <PsTable light={light} cols="44px 1fr 1fr 1fr 1fr" head={['日期', 'P/C 未平倉', 'P/C 成交量', '賣權 OI', '買權 OI']}
        rows={all.slice(-10).reverse().map((x) => [psMd(x.date), x.ratio != null ? x.ratio.toFixed(2) : '—', x.volRatio != null ? x.volRatio.toFixed(2) : '—', psN(x.putOi), psN(x.callOi)])} />
      <PsNote light={light}>期交所 Put/Call 比（賣權 ÷ 買權，全市場臺指選擇權）。1 以上（虛線）賣權部位多於買權。</PsNote>
    </div>
  );
}

// ── 6a. 散戶多空比 (小台 / 微台) ───────────────────────────────────────────
function RetailPanel({ M, light }) {
  const R = M && M.retail;
  if (!R) return <PsEmpty light={light}>期交所小台／微台資料未載入。</PsEmpty>;
  const ks = ['MTX', 'TMF'].filter((k) => R[k]);
  const a = R[ks[0]];
  return (
    <div>
      {a && <PsLead>{a.label}散戶多空比 <span style={{ color: psCol(a.ratio) }}>{psSigned(a.ratio, 2, '%')}</span>，散戶{a.ratio > 0 ? '偏多' : a.ratio < 0 ? '偏空' : '中性'}
        {a.chg != null ? `；比前一交易日${a.chg >= 0 ? '升' : '降'} ${Math.abs(a.chg).toFixed(2)} 個百分點` : ''}</PsLead>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ks.length}, 1fr)`, gap: 10 }}>
        {ks.map((k) => {
          const x = R[k];
          return (
            <div key={k}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{x.label} <span className="mono" style={{ fontSize: 9, color: psDim(light) }}>{k}</span></div>
              <PsTwo color={psCol(x.ratio)} big={psSigned(x.ratio, 2, '%')} small={<>散戶淨 {psSigned(x.retailNet)} 口 · 全市場 OI {psN(x.oi)} 口</>} />
              <div style={{ marginTop: 4 }}>
                <PsTable light={light} cols="40px 1fr 1fr" head={['日期', '多空比', '法人淨']}
                  rows={x.series.slice(-5).reverse().map((d) => [psMd(d.date), <span style={{ color: psCol(d.ratio) }}>{psSigned(d.ratio, 2, '%')}</span>, psSigned(d.instNet)])} />
              </div>
            </div>
          );
        })}
      </div>
      <PsNote light={light}>散戶多空比 = (散戶多單 − 散戶空單) ÷ 全市場未平倉，散戶 = 全市場 − 三大法人；分子化簡為 −(三大法人淨未平倉)。未平倉為期交所每日行情各月份（含週）一般盤合計，法人為期交所「區分各期貨契約」三大法人。</PsNote>
    </div>
  );
}

// ── 6d. 日夜盤拆解 ─────────────────────────────────────────────────────────
function SessionsPanel({ S, light }) {
  if (!S || !S.night || !S.day) return <PsEmpty light={light}>期交所台指期日夜盤資料未載入。</PsEmpty>;
  const n = S.night, d = S.day;
  const word = (v) => (v > 0 ? '漲' : v < 0 ? '跌' : '平');
  return (
    <div>
      <PsLead>
        夜盤收 {psN(n.c)}，比前日結算{word(n.chg)} <span style={{ color: psCol(n.chg) }}>{psAbs(n.chg)}</span> 點；
        日盤{d.gap > 0 ? '跳空開高' : d.gap < 0 ? '跳空開低' : '平開'} <span style={{ color: psCol(d.gap) }}>{psAbs(d.gap)}</span> 點，
        收 {psN(d.c)}，比夜盤收{word(d.chg)} <span style={{ color: psCol(d.chg) }}>{psAbs(d.chg)}</span> 點
      </PsLead>
      <PsTable light={light} cols="40px 1fr 1fr 1fr 1fr 1fr 1fr" head={['時段', '開', '高', '低', '收', '漲跌', '開盤跳空']}
        rows={[
          ['夜盤', psN(n.o), psN(n.h), psN(n.l), psN(n.c), <span style={{ color: psCol(n.chg) }}>{psSigned(n.chg)}</span>, <span style={{ color: psCol(n.gap) }}>{psSigned(n.gap)}</span>],
          ['日盤', psN(d.o), psN(d.h), psN(d.l), psN(d.c), <span style={{ color: psCol(d.chg) }}>{psSigned(d.chg)}</span>, <span style={{ color: psCol(d.gap) }}>{psSigned(d.gap)}</span>],
        ]} />
      <div className="tnum mono" style={{ fontSize: 10.5, marginTop: 6 }}>基準：夜盤對 {psMd(S.prevDate)} 結算 {psN(S.prevSettle)}，日盤對夜盤收 {psN(n.c)}</div>
      <div className="tnum mono" style={{ fontSize: 10.5, marginTop: 2 }}>
        全日：日盤收對前日結算 <span style={{ color: psCol(d.chgVsSettle) }}>{psSigned(d.chgVsSettle)}</span> 點 · 今日結算 {psN(S.settle)} · 量 夜 {psN(n.v)} / 日 {psN(d.v)} 口
      </div>
      <PsNote light={light}>期交所期貨每日行情，{S.month} 近月。期交所把前一營業日 15:00 到 05:00 的夜盤記在本交易日（{psMd(S.date)}）。本交易日收盤後的夜盤要到次日 05:00 才結束，不在這張表。</PsNote>
    </div>
  );
}

// ── 6c. 除息點數 ───────────────────────────────────────────────────────────
function DividendsPanel({ Dv, light }) {
  if (!Dv || !Dv.byExpiry) return <PsEmpty light={light}>證交所除權息預告表或期交所權重未載入。</PsEmpty>;
  const mon = Dv.byExpiry.find((e) => /^\d{6}$/.test(e.month)) || Dv.byExpiry[0];
  const last = Dv.byExpiry[Dv.byExpiry.length - 1];
  return (
    <div>
      <PsLead>
        已公告的除息，到 {mon.label}（{psMd(mon.id)}）約 <span style={{ color: PS_GOLD }}>{psN(mon.points, 2)}</span> 點
        {Dv.items.length ? `，共 ${Dv.items.length} 檔成分股` : '，期間內沒有成分股除息'}{Dv.pending.length ? `；另 ${Dv.pending.length} 檔金額未公告` : ''}
      </PsLead>
      <PsTable light={light} cols="56px 1fr 1fr 1fr" head={['契約', '到期', '累計除息點', '未公告檔數']}
        rows={Dv.byExpiry.map((e) => [e.label, psMd(e.id), psN(e.points, 2), e.pending || '—'])} />
      {Dv.items.length > 0 && <div style={{ marginTop: 6 }}>
        <PsTable light={light} cols="44px 1.4fr 1fr 1fr 1fr 1fr" head={['除息日', '個股', '現金股利', '前收', '權重', '點數']}
          rows={Dv.items.map((i) => [psMd(i.date), `${i.code} ${i.name}`, psN(i.cash, 2), psN(i.close, 2), `${i.weight}%`, psN(i.points, 2)])} />
      </div>}
      <PsNote light={light}>
        推算，不是交易所公告值：期交所沒有公布除息點數預估，這裡用證交所「除權除息預告表」的現金股利 ÷ 前收（證交所 {psMd(Dv.closeDate)}）× 期交所成分股權重（{Dv.weightsDate}）× 加權指數 {psN(Dv.index, 2)}，加總除息日落在各契約最後交易日（含）之前的成分股。預告表只列已公告、即將除息的個股，所以遠月數字只含目前已知的部分（到 {last.label} 也是同一批）。
      </PsNote>
    </div>
  );
}

// ── 5. Settlement history ──────────────────────────────────────────────────
function SettleHistPanel({ H, light }) {
  const S = H && H.settle;
  if (!S || !S.length) return <PsEmpty light={light}>沒有結算歷史（taifex-history.js 未載入）。</PsEmpty>;
  const rows = S.slice().reverse();
  const a = rows[0];
  const lbl = (m) => (m.length > 6 ? m.slice(6) : `${m.slice(4, 6)}月`);
  return (
    <div>
      <PsLead>
        上一次結算 {lbl(a.month)}（{psMd(a.date)}）最後結算價 <span style={{ color: PS_GOLD }}>{psN(a.fsp)}</span>，
        買權 {a.callWorthless != null ? `${a.callWorthless.toFixed(1)}%` : '—'}、賣權 {a.putWorthless != null ? `${a.putWorthless.toFixed(1)}%` : '—'} 的未平倉歸零
      </PsLead>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        <PsTable light={light} cols="44px 64px 1fr 1fr 1fr 1fr 1fr" head={['結算日', '契約', '結算價', '買權 OI', '買權歸零', '賣權 OI', '賣權歸零']}
          rows={rows.map((x) => [psMd(x.date), x.month, psN(x.fsp), psN(x.callOi), x.callWorthless != null ? `${x.callWorthless.toFixed(1)}%` : '—', psN(x.putOi), x.putWorthless != null ? `${x.putWorthless.toFixed(1)}%` : '—'])} />
      </div>
      <PsNote light={light}>結算價：期交所「最後結算價—指數選擇權」。歸零比例 = 到期日當天收盤的未平倉中，買權履約價 ≥ 結算價、賣權履約價 ≤ 結算價的口數占比（期交所每日行情，以未平倉加權）。共 {S.length} 個契約，{psMd(S[0].date)} 起。</PsNote>
    </div>
  );
}

// ── 5. 30-day IV history ───────────────────────────────────────────────────
function IvHistPanel({ H, light }) {
  const D = H && H.days;
  if (!D || !D.length) return <PsEmpty light={light}>沒有 IV 歷史（taifex-history.js 未載入）。</PsEmpty>;
  const withCm = D.filter((d) => d.cm30 != null);
  const rows = D.slice().reverse();
  const a = withCm[withCm.length - 1], b = withCm[withCm.length - 2];
  return (
    <div>
      {a ? <PsLead>
        30 天恆定到期 IV <span style={{ color: PS_GOLD }}>{a.cm30.toFixed(2)}%</span>（{psMd(a.date)}）
        {b ? `，比前一筆（${psMd(b.date)}）${psSigned(a.cm30 - b.cm30, 2)} 個百分點` : `；目前只存了 ${withCm.length} 天，每個交易日累積一筆`}
      </PsLead> : <PsLead>還沒有可算的 30 天 IV：已存 {D.length} 天，都沒有跨過 30 天的到期</PsLead>}
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        <PsTable light={light} cols="44px 1fr 1.6fr 1fr" head={['日期', '30 天 IV', '內插用的到期', '最近到期 ATM IV']}
          rows={rows.map((d) => [psMd(d.date),
            d.cm30 != null ? `${d.cm30.toFixed(2)}%` : '—',
            d.cm30 != null ? d.cm30Pair.map(psMd).join(' ↔ ') : <span style={{ color: psDim(light) }}>{d.term ? '沒有跨過 30 天的到期' : '當日只存近 5 個到期'}</span>,
            d.exp && d.exp[0] && d.exp[0].iv != null ? `${d.exp[0].iv.toFixed(2)}% ${d.exp[0].label}` : '—'])} />
      </div>
      <PsNote light={light}>30 天 IV：在 30 天兩側最近的兩個到期之間，以總變異數 σ²·t 對天數線性內插（VIX 的作法），各到期 ATM IV 由期交所結算價以 Black-76 對該到期的平價遠期反推。{H.from} 到 {H.to} 共 {D.length} 天，其中 {withCm.length} 天可算；{D.length - withCm.length} 天是當時的快照只存最近 5 個週／月選，沒有超過 30 天的到期可以內插，所以留白不外推。</PsNote>
    </div>
  );
}

// ── 6b. Settle-above / below probability per strike ─────────────────────────
// N(d2) under Black-76 on the expiry's forward at each strike's own IV (the
// out-of-the-money side's, which is the side that trades). A settlement
// probability, not a touch probability; the touch column is the reflection-
// principle approximation ≈ 2 × the probability of settling beyond the strike.
function ProbPanel({ rows, fwd, fwdSrc, dte, P, light }) {
  const [touch, setTouch] = psS(false);
  if (!rows || !rows.length || !(fwd > 0) || !(dte > 0)) return <PsEmpty light={light}>沒有報價表或到期天數。</PsEmpty>;
  const T = dte / 365;
  const N = window.normalCdf;
  const list = rows.map((r) => {
    const side = r.strike >= fwd ? 'call' : 'put';
    const iv = (r[side] && r[side].iv > 0) ? r[side].iv : null;
    if (!iv) return null;
    const s = iv / 100 * Math.sqrt(T);
    const d2 = (Math.log(fwd / r.strike) - s * s / 2) / s;
    const up = N(d2);
    return { k: r.strike, iv, side, up, dn: 1 - up };
  }).filter(Boolean);
  if (!list.length) return <PsEmpty light={light}>報價表沒有 IV。</PsEmpty>;
  const atm = list.reduce((a, b) => (Math.abs(b.k - fwd) < Math.abs(a.k - fwd) ? b : a));
  const i0 = list.indexOf(atm);
  const view = list.slice(Math.max(0, i0 - 8), i0 + 9);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const tch = (x) => pct(Math.min(1, 2 * (x.k >= fwd ? x.up : x.dn)));
  const fk = (k) => window.fmtStrike ? window.fmtStrike(k, P.strikeStep) : psN(k);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <PsSeg items={[{ id: 'off', label: '只看結算' }, { id: 'on', label: '加上觸及近似' }]} value={touch ? 'on' : 'off'} onChange={(v) => setTouch(v === 'on')} />
      </div>
      <PsLead>到期收在價平 {fk(atm.k)} 上方的機率約 {pct(atm.up)}、下方 {pct(atm.dn)}（這是到期收在哪裡的機率，不是盤中碰到的機率）</PsLead>
      <PsTable light={light} cols={touch ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr'} head={['履約價', 'IV', '收在上方', '收在下方'].concat(touch ? ['觸及≈'] : [])}
        rows={view.map((x) => [<span style={{ fontWeight: x === atm ? 700 : 500, color: x === atm ? PS_GOLD : 'inherit' }}>{fk(x.k)}</span>,
          `${x.iv.toFixed(1)}% ${x.side === 'call' ? 'C' : 'P'}`, pct(x.up), pct(x.dn)].concat(touch ? [tch(x)] : []))} />
      <PsNote light={light}>收在上方 = N(d2)，Black-76，遠期 {psN(fwd, 1)}（{fwdSrc}），{dte} 天，每個履約價用自己的 IV（價外那一側）。這是風險中立機率，不是預測。{touch ? '觸及≈ 是反射原理近似：觸及機率 ≈ 2 × 到期收在該價之外的機率，上限 100%，只是近似。' : ''}</PsNote>
    </div>
  );
}

// ── 4. Exchange margin for short option legs ───────────────────────────────
// TAIFEX margingReqIndexOpt (verified 2026/11/02):
//   short call / put  = 權利金市值 + MAX(A − 價外值, B)
//   價外值 call = MAX((K − 標的指數) × 50, 0); put = MAX((標的指數 − K) × 50, 0)
//   credit vertical (same expiry) = 履約價差 × 50; debit vertical = none
//   short straddle / strangle = MAX(call, put margin) + the lower side's 權利金市值 + C
// Calendars (long leg further out) use a rule tied to the TX clearing margin
// and are left as single legs here; futures legs are not options and are skipped.
function computeMargin({ legs, rows, dte, M, P, idx, spot, iv, level }) {
  const V = M.values, mult = M.mult || P.mult;
  const A = V.A[level], B = V.B[level], C = V.C ? V.C[level] : 0;
  const units = [];
  (legs || []).forEach((l, li) => {
    if (l.type !== 'call' && l.type !== 'put') return;
    const ld = Number.isFinite(l.dte) ? l.dte : dte;
    let px = null, src = '理論價';
    if (ld === dte && rows) {
      const r = rows.find((x) => x.strike === l.strike);
      if (r && r[l.type] && r[l.type].last > 0) { px = r[l.type].last; src = '報價表'; }
    }
    if (px == null) px = window.bsPrice(l.type, spot, l.strike, iv, ld, 0.015, P.model);
    for (let q = 0; q < l.qty; q++) units.push({ li, side: l.side, type: l.type, k: l.strike, dte: ld, px, src, used: false });
  });
  const name = (u) => `${u.side === 'short' ? '賣' : '買'} ${psN(u.k)} ${u.type === 'call' ? '買權' : '賣權'}${u.dte !== dte ? `（${u.dte} 天）` : ''}`;
  const naked = (u) => {
    const otm = Math.max((u.type === 'call' ? u.k - idx : idx - u.k) * mult, 0);
    const prem = u.px * mult;
    const m = prem + Math.max(A - otm, B);
    return { m, prem, otm, steps: `權利金 ${psN(u.px, 1)}×${mult} = ${psN(prem)} ＋ max(A ${psN(A)} − 價外 ${psN(otm)}, B ${psN(B)}) = ${psN(Math.max(A - otm, B))}` };
  };
  const shorts = units.filter((u) => u.side === 'short').map((u) => ({ u, n: naked(u) })).sort((a, b) => b.n.m - a.n.m);
  const groups = [];
  const left = [];
  shorts.forEach(({ u, n }) => {
    let best = null;
    units.forEach((l) => {
      if (l.used || l.side !== 'long' || l.type !== u.type || l.dte !== u.dte) return;
      const debit = u.type === 'call' ? l.k <= u.k : l.k >= u.k;
      const m = debit ? 0 : Math.abs(l.k - u.k) * mult;
      if (!best || m < best.m) best = { l, m, debit };
    });
    if (best && best.m < n.m) {
      best.l.used = true; u.used = true;
      groups.push({ kind: best.debit ? '價差（買方較價內）' : '價差（收權利金）', legs: `${name(u)} ＋ ${name(best.l)}`, m: best.m,
        steps: best.debit ? '買進部位較價內、同到期：不收保證金' : `同到期，履約價差 ${psN(Math.abs(best.l.k - u.k))} × ${mult} = ${psN(best.m)}` });
    } else left.push({ u, n });
  });
  const lc = left.filter((x) => x.u.type === 'call'), lp = left.filter((x) => x.u.type === 'put');
  const single = [];
  lc.forEach((c) => {
    const pi = lp.findIndex((p) => p.u.dte === c.u.dte);
    if (pi < 0) { single.push(c); return; }
    const p = lp.splice(pi, 1)[0];
    const hi = c.n.m >= p.n.m ? c : p, lo = hi === c ? p : c;
    const m = hi.n.m + lo.n.prem + C;
    groups.push({ kind: c.u.k === p.u.k ? '跨式' : '勒式', legs: `${name(c.u)} ＋ ${name(p.u)}`, m,
      steps: `max(${psN(c.n.m)}, ${psN(p.n.m)}) ＋ 較低方權利金 ${psN(lo.n.prem)} ＋ C ${psN(C)} = ${psN(m)}` });
  });
  single.concat(lp).forEach(({ u, n }) => groups.push({ kind: '單一部位', legs: name(u), m: n.m, steps: `${n.steps} → ${psN(n.m)}` }));
  // collapse identical groups (one per lot) into a count
  const out = [];
  groups.forEach((g) => {
    const same = out.find((x) => x.legs === g.legs && x.steps === g.steps);
    if (same) same.n += 1; else out.push({ ...g, n: 1 });
  });
  const calendars = units.some((u) => u.side === 'long' && !u.used && units.some((s) => s.side === 'short' && s.type === u.type && s.dte !== u.dte));
  return { groups: out, total: groups.reduce((a, g) => a + g.m, 0), shorts: shorts.length, calendars, srcs: [...new Set(units.map((u) => u.src))] };
}
function MarginPanel({ legs, rows, dte, M, P, idx, idxLabel, spot, iv, light }) {
  const [level, setLevel] = psS('initial');
  if (!M || !M.values || !M.values.A || !M.values.B) return <PsEmpty light={light}>{P.id === 'txo' ? '期交所保證金一覽表未載入。' : '期交所保證金只有臺指選擇權。'}</PsEmpty>;
  const R = computeMargin({ legs, rows, dte, M, P, idx, spot, iv, level });
  const other = computeMargin({ legs, rows, dte, M, P, idx, spot, iv, level: level === 'initial' ? 'maintenance' : 'initial' });
  const lvName = { initial: '原始', maintenance: '維持' };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <PsSeg items={[{ id: 'initial', label: '原始保證金' }, { id: 'maintenance', label: '維持保證金' }]} value={level} onChange={setLevel} />
      </div>
      {R.shorts ? <>
        <PsLead>這個部位的期交所{lvName[level]}保證金約 <span style={{ color: PS_GOLD }}>NT${psN(R.total)}</span>
          <span className="mono" style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.7 }}>（{lvName[level === 'initial' ? 'maintenance' : 'initial']} NT${psN(other.total)}）</span></PsLead>
        {R.groups.map((g, i) => (
          <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
              <span><span className="mono" style={{ fontSize: 9.5, color: psDim(light), marginRight: 4 }}>{g.kind}</span>{g.legs}{g.n > 1 ? ` ×${g.n}` : ''}</span>
              <span className="tnum" style={{ ...psCell, fontWeight: 700 }}>{psN(g.m * g.n)}</span>
            </div>
            <div className="mono tnum" style={{ fontSize: 9.5, color: psDim(light), marginTop: 2 }}>{g.steps}</div>
          </div>
        ))}
      </> : <PsLead>這個部位沒有賣出選擇權，買方不收保證金</PsLead>}
      <PsNote light={light}>
        期交所臺指選擇權風險保證金（{lvName[level]}）：A {psN(M.values.A[level])} · B {psN(M.values.B[level])}{M.values.C ? ` · C ${psN(M.values.C[level])}` : ''}，更新日期 {M.date}。價外值以標的指數 {psN(idx, 2)}（{idxLabel}）計。
        權利金市值用{R.srcs.join('／') || '—'}價。規則：期交所「股價指數選擇權契約各種組合部位之保證金收取方式」——單一賣方 = 權利金市值 + max(A − 價外值, B)；同到期價差 = 履約價差 × {M.mult}（買方較價內者不收）；跨式／勒式 = 較高一方保證金 + 較低方權利金市值 + C（C 值只適用自然人等身分碼）。組合只在比單一部位低時採用。
        {R.calendars ? ' 跨到期的時間價差按單一部位計，沒有套用期交所時間價差規則。' : ''} 券商可能另外加收。
      </PsNote>
    </div>
  );
}

Object.assign(window, { OptInstPanel, OptLargePanel, PcTrendPanel, RetailPanel, SessionsPanel, DividendsPanel, SettleHistPanel, IvHistPanel, ProbPanel, MarginPanel, computeMargin });
