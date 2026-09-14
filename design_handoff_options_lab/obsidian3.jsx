// OBSIDIAN v3 — TXO options lab. Multi-workspace: Chain / Calculator / IV Surface / Compare.

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

// Live data providers, keyed by the product's `live` field (products.js).
const BROKER = { ib: 'IB', sinopac: 'SinoPac' };
// What the live badge says: the source's own label when the probe supplied one
// (the TAIFEX end-of-day snapshot: "TAIFEX 09/11 EOD"), else the broker name.
function liveLabel(live, P) {
  return (live && live.health && live.health.label) || BROKER[P.live] || 'live';
}
// The same badge in the terminal chrome's words: 期交所 09/11 收盤 / 永豐 即時 / IB 即時.
function liveLabelZh(live, P) {
  if (!live) return '模擬';
  if (live.health && live.health.source === 'eod') {
    // TAIFEX snapshot → 期交所 09/11 收盤; IB snapshot → its own label with the capture time (IB 09/13 23:40Z 快照).
    return P.live === 'ib' ? `${live.health.label || 'IB'} 快照` : `期交所 ${(live.health.asOf || '').slice(5)} 收盤`;
  }
  return `${P.live === 'sinopac' ? '永豐' : P.live === 'ib' ? 'IB' : '即時'} 即時`;
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scheme": "diverging",
  "density": "comfortable",
  "accentHue": 250,
  "showAuroraBlobs": true,
  "showProbCone": true
}/*EDITMODE-END*/;

const DENSITY = {
  compact:    { gap: 10, panelPad: 14 },
  comfortable:{ gap: 14, panelPad: 18 },
  spacious:   { gap: 18, panelPad: 22 },
};

// K 線週期。bar/duration 直接餵給 IB reqHistoricalData（server 白名單內）；
// n/volScale 給 mock 用（沒接 IB 時的隨機漫步根數與波動縮放）。
// K-line periods. All three read daily bars (the one series every source —
// TAIFEX snapshot, Shioaji, IB — can serve); 週 / 月 are aggregated client-side
// in the `bars` memo (`agg`). Intraday frequencies live in the 當日走勢 panel.
const K_PERIODS = [
  { id: 'D', label: '日', bar: '1 day', duration: '3 M', n: 60, volScale: 1, agg: null },
  { id: 'W', label: '週', bar: '1 day', duration: '1 Y', n: 250, volScale: 1, agg: 'week' },
  { id: 'M', label: '月', bar: '1 day', duration: '2 Y', n: 250, volScale: 1, agg: 'month' },
];
// Daily bars → weekly (ISO week) or monthly OHLC. t = YYYYMMDD; other stamps pass through unaggregated.
function aggBars(bars, unit) {
  if (!unit || !bars || !bars.length) return bars;
  const key = (t) => {
    const st = String(t);
    if (!/^\d{8}/.test(st)) return null;
    if (unit === 'month') return st.slice(0, 6);
    const d = new Date(Date.UTC(+st.slice(0, 4), +st.slice(4, 6) - 1, +st.slice(6, 8)));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return `${d.getUTCFullYear()}W${String(Math.ceil(((d - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  };
  const out = [];
  let cur = null, curKey = null;
  for (const b of bars) {
    const k = key(b.t);
    if (k == null) return bars;
    if (cur && k === curKey) { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v || 0; }
    else { cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }; curKey = k; out.push(cur); }
  }
  return out;
}

// TXO market state（其他商品的合約規格在 products.js 的 window.PRODUCTS）
const TXO_SPOT = 21850;
const STRIKE_STEP = 50;
// Default legs: a bull-call spread（ATM+1 檔 / ATM+5 檔），premium 用該商品的
// 定價模型（TXO=BS、穀物=Black-76）在 default spot/iv 與預設到期日算出。
function defaultLegsFor(P, dte) {
  const st = P.strikeStep;
  const k1 = Math.round((P.defaultSpot + st) / st) * st;
  return [
    _mkLeg('long',  'call', P.defaultSpot, k1, P.defaultIv, dte, P),
    _mkLeg('short', 'call', P.defaultSpot, k1 + 4 * st, P.defaultIv, dte, P),
  ];
}
// 商品的到期日清單：live（IB 真實到期日）> 商品 mock > TXO 週/月選。
function productExpiries(P, liveExpiries) {
  if (liveExpiries && liveExpiries.length) return liveExpiries;
  return P.mockExpiries || TXO_EXPIRIES;
}
function defaultExpiryFor(P) {
  const exps = P.mockExpiries || TXO_EXPIRIES;
  return (P.id === 'txo' && exps.find((e) => e.id === 'm')) || exps[0];
}

// TXO 週選/月選到期。台指 2022 起加了週五週選（之前漏掉），所以現在是
// W (週三) + F (週五) 雙軌。第三個禮拜三 = 月選結算 (M, 金點)。
const TXO_EXPIRIES = [
  { id: 'w1', label: 'W1', dte: 4,  type: 'weekly',  dow: 'wed', date: '5/13' },
  { id: 'f1', label: 'F1', dte: 6,  type: 'weekly',  dow: 'fri', date: '5/15' },
  { id: 'm',  label: 'M',  dte: 11, type: 'monthly', dow: 'wed', date: '5/20' },
  { id: 'f2', label: 'F2', dte: 13, type: 'weekly',  dow: 'fri', date: '5/22' },
  { id: 'w3', label: 'W3', dte: 18, type: 'weekly',  dow: 'wed', date: '5/27' },
  { id: 'f3', label: 'F3', dte: 20, type: 'weekly',  dow: 'fri', date: '5/29' },
  { id: 'w4', label: 'W4', dte: 25, type: 'weekly',  dow: 'wed', date: '6/03' },
];


// ── Persistence (①). One localStorage key; every value is hard-validated on
// restore so corrupt or stale JSON can never crash the app — any doubt falls
// back to the built-in defaults. The key is read once per page load.
const LS_KEY = 'optionsLab.v1';
let _savedCache; // undefined = not read yet; null = nothing / invalid saved
function readSaved() {
  if (_savedCache !== undefined) return _savedCache;
  try {
    const raw = localStorage.getItem(LS_KEY);
    _savedCache = raw ? JSON.parse(raw) : null;
  } catch (e) { _savedCache = null; }
  return _savedCache;
}
function validLeg(l) {
  return l && (l.side === 'long' || l.side === 'short')
    && (l.type === 'call' || l.type === 'put')
    && Number.isFinite(l.strike) && Number.isFinite(l.premium)
    && Number.isFinite(l.qty) && l.qty >= 1;
}
function sanitizeLegs(arr) {
  if (!Array.isArray(arr)) return null;
  const clean = arr.filter(validLeg).map((l) => {
    const out = { side: l.side, type: l.type, strike: l.strike, premium: l.premium, qty: l.qty };
    if (Number.isFinite(l.dte)) out.dte = l.dte;
    return out;
  });
  return clean.length ? clean : null;
}
function initialProductId() {
  const s = readSaved();
  return (s && s.productId && window.PRODUCTS.some((p) => p.id === s.productId)) ? s.productId : 'txo';
}

function Glass2({ tone = 'panel', radius = 0, padding = 12, style, children, ...rest }) {
  // Flat terminal panel: solid ground, 1px border, square corners. `tone`
  // picks the ground (panel / chip / raised share the second shade). The
  // padding is exported as CSS variables so an Eyebrow inside can bleed to
  // the edges as the panel's header bar.
  const pad = typeof padding === 'number' ? `${padding}px` : String(padding);
  const parts = pad.trim().split(/\s+/);
  const ppy = parts[0], ppx = parts.length > 1 ? parts[1] : parts[0];
  return (
    <div className={`g2 g2-${tone}`} style={{
      padding, position: 'relative', overflow: 'hidden', color: 'var(--text)',
      background: tone === 'panel' ? 'var(--panel)' : 'var(--panel2)', border: '1px solid var(--border)',
      '--ppx': ppx, '--ppy': ppy, ...style,
    }} {...rest}>
      {children}
    </div>
  );
}

function Eyebrow({ children, right, hk }) {
  const HT = window.HelpTip; // desktop-only hover help (⑧a); pass hk to enable
  const label = (hk && HT) ? <HT k={hk}>{children}</HT> : children;
  // The panel's header bar: bleeds to the panel edges (see Glass2's --ppx/--ppy).
  return (
    <div className="pg-handle" style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 30, padding: '0 12px',
      margin: 'calc(-1 * var(--ppy, 12px)) calc(-1 * var(--ppx, 12px)) 10px', background: 'var(--panel2)', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, whiteSpace: 'nowrap', textTransform: 'none' }}>{label}</span>
      <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, whiteSpace: 'nowrap' }}>{right}</span>
    </div>
  );
}

// Workspace tabs
function WorkspaceTabs({ value, onChange }) {
  // Desktop tabs, in the terminal's words; the active one carries a gold underline.
  const items = [
    { id: 'levels', label: '關卡' },
    { id: 'chain',  label: '報價表' },
    { id: 'chart',  label: 'K線' },
    { id: 'calc',   label: '策略' },
    { id: 'lab',    label: '實驗室' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', alignSelf: 'stretch' }}>
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button key={it.id} onClick={() => onChange(it.id)} style={{
            padding: '0 14px', display: 'flex', alignItems: 'center', fontSize: 13, whiteSpace: 'nowrap',
            fontWeight: active ? 700 : 500, color: active ? 'var(--text)' : 'var(--text2)',
            background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? 'var(--gold)' : 'transparent'}`,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{it.label}</button>
        );
      })}
    </div>
  );
}

// Product dropdown (design ⑥) — replaces the native select with a custom menu
// listing each product's name + reference spot. Shows live IB / mock badge.
function ProductDropdown({ productId, P, spot, chg, live, open, setOpen, onPick }) {
  const fmtSpot = (v) => v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 2 : v < 1000 ? 2 : 0 });
  const col = chg == null ? 'var(--text)' : chg >= 0 ? '#ef5350' : '#26a69a';
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 25 }} />}
      <div onClick={() => setOpen(!open)} title="切換商品" style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap', cursor: 'pointer' }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{P.nameZh || P.name} {P.code} ▾</span>
        <span className="mono tnum" style={{ fontSize: 18, fontWeight: 700, color: col }}>{fmtSpot(spot)}</span>
        {chg != null && <span className="mono tnum" style={{ fontSize: 12, color: col, fontWeight: 600 }}>{chg >= 0 ? '▲' : '▼'}{fmtSpot(Math.abs(chg))}{chg.pct != null ? '' : ''}</span>}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', left: 0, zIndex: 30, width: 250, padding: 4,
          background: 'var(--panel2)', border: '1px solid var(--border)', boxShadow: '0 12px 28px rgba(0,0,0,0.45)', color: 'var(--text)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {window.PRODUCTS.map((p) => (
            <button key={p.id} onClick={() => onPick(p.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: 'none', textAlign: 'left', cursor: 'pointer',
              background: p.id === productId ? 'var(--seg-on)' : 'transparent', color: 'inherit', fontFamily: 'inherit',
            }}>
              <span className="mono" style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', background: 'var(--seg-on)', minWidth: 30, textAlign: 'center' }}>{p.code}</span>
              <span style={{ fontSize: 11, flex: 1 }}>{p.nameZh || p.name}<span style={{ color: 'var(--muted)', marginLeft: 6 }}>{p.name}</span></span>
              <span className="tnum" style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>{fmtSpot(p.defaultSpot)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Expiry strip — overflow scroll on narrow desktop windows, plain flex when
// there's room. expiries 由商品決定（TXO 週/月選、穀物月份、或 IB 真實到期日）。
function ExpiryStrip({ value, onChange, expiries = TXO_EXPIRIES }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4, whiteSpace: 'nowrap' }}>到期日</span>
      {expiries.map((e) => {
        const active = e.id === value;
        const isMonthly = e.type === 'monthly';
        return (
          <button key={e.id} onClick={() => onChange(e.id)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 26, flexShrink: 0,
            border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`, background: active ? 'rgba(240,192,104,0.12)' : 'transparent',
            color: active ? 'var(--text)' : 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="mono tnum" style={{ fontWeight: 600 }}>{e.date}</span>
            <span>{isMonthly ? '月選' : e.label}</span>
            {e.dte != null && <span className="mono tnum" style={{ color: 'var(--muted)' }}>{e.dte}天</span>}
          </button>
        );
      })}
    </div>
  );
}

// K-line period toggle (Daily / 4H / 1H) — small segmented control.
function Seg({ items, value, onChange }) {
  return (
    <div className="seg">
      {items.map((it) => (
        <button key={it.id} className={it.id === value ? 'on' : ''} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}
// K-line period toggle (日 / 4H / 1H).
function KPeriodToggle({ value, onChange }) {
  return <Seg items={K_PERIODS} value={value} onChange={onChange} />;
}

// 日盤 / 全日盤 toggle for the K-line. 全日盤 folds the night session into the
// trading day it belongs to (TAIFEX books the after-hours session under the
// next business day), so one bar = 15:00 → 13:45.
function KSessionToggle({ value, onChange }) {
  return <Seg items={[{ id: 'day', label: '日盤' }, { id: 'full', label: '全日盤' }]} value={value} onChange={onChange} />;
}

// Collapsible global What-if rail (design ⑦, owner-revised to be tucked away).
// Collapsed = a small pill with a spot/IV readout; expanded = Spot + IV sliders.
function WhatIfRail({ P, spot, setSpot, spotMin, spotMax, iv, setIv, open, setOpen, theme, light }) {
  if (!open) {
    return (
      <Glass2 tone="chip" padding="7px 12px" onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 15, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>模擬情境</span>
        <span className="tnum" style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{P.code} {spot.toLocaleString()} · IV {iv}%</span>
      </Glass2>
    );
  }
  return (
    <Glass2 tone="raised" padding="10px 16px"
      style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 15, width: 520, maxWidth: 'calc(100vw - 24px)', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 18, alignItems: 'center', boxShadow: '0 12px 28px rgba(0,0,0,0.45)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>模擬情境</span>
        <button onClick={() => setOpen(false)} title="收合" style={{ fontSize: 13, lineHeight: 1, padding: '2px 7px', border: '1px solid var(--border)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
      </div>
      <Slider label={`現價 · ${P.code}`} value={spot} min={spotMin} max={spotMax} step={P.spotStep} onChange={setSpot} format={(v) => v.toLocaleString()} theme={theme} />
      <Slider label="IV" value={iv} min={P.ivMin} max={P.ivMax} step={0.5} suffix="%" onChange={setIv} theme={theme} />
    </Glass2>
  );
}

// Settlement countdown
function SettlementCountdown({ dte, note = '13:30' }) {
  const isSettleDay = dte <= 0;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 11, color: 'var(--text2)',
      border: `1px solid ${isSettleDay ? '#ef5350' : 'var(--border)'}`, background: isSettleDay ? 'rgba(239,83,80,0.12)' : 'transparent' }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: isSettleDay ? '#ef5350' : 'var(--gold)' }} />
      <span>距結算</span>
      <span className="mono tnum" style={{ fontSize: 12, fontWeight: 700, color: isSettleDay ? '#ef5350' : 'var(--text)' }}>{dte} 天</span>
      <span>· {note}</span>
    </div>
  );
}

// Freshness stamp (②) — shows the time of the last successful live fetch and
// turns amber "STALE" once the data is older than 45s. Its own 1s ticker keeps
// the re-render local to the chip. Only rendered for live IB products.
function FreshnessChip({ lastLiveAt }) {
  const [, tick] = uS(0);
  uE(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!lastLiveAt) return null;
  const stale = (Date.now() - lastLiveAt) > 45000;
  const d = new Date(lastLiveAt);
  const hhmmss = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  return (
    <span className="mono" title={stale ? 'live data may be stale — last update shown' : 'last live update'} style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.4, fontFamily: 'var(--font-mono)',
      color: stale ? '#f0c068' : 'inherit', opacity: stale ? 0.8 : 0.5,
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {stale && <span style={{ fontWeight: 800 }}>延遲</span>}{hhmmss}
    </span>
  );
}

// ───────────────────────────────────────────────── ADJUSTABLE PANEL GRID
// Every desktop tab is a set of panels on a 12-column grid (react-grid-layout
// from the CDN, window.ReactGridLayout). With 調整版面 on, panels drag by their
// header bar and resize from the bottom-right corner; the arrangement is saved
// per tab under optionsLab.layout.v1 and 重設 restores the tab's defaults.
// Without the library (offline, blocked CDN) the panels stack in default order.
const RGL = (window.ReactGridLayout && window.ReactGridLayout.WidthProvider) ? window.ReactGridLayout.WidthProvider(window.ReactGridLayout) : null;
const LAYOUT_KEY = 'optionsLab.layout.v1';
function readLayouts() { try { const o = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (e) { return {}; } }
function writeLayouts(all) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(all)); } catch (e) { /* storage disabled */ } }
function clearLayout(tab) { const all = readLayouts(); delete all[tab]; writeLayouts(all); }
// A saved arrangement is used only where it names the current panels with sane numbers.
function resolveLayout(saved, defaults) {
  const byId = {};
  (Array.isArray(saved) ? saved : []).forEach((l) => { if (l && typeof l.i === 'string') byId[l.i] = l; });
  return defaults.map((d) => {
    const v = byId[d.i];
    const ok = v && [v.x, v.y, v.w, v.h].every((n) => Number.isFinite(n) && n >= 0) && v.w >= 1 && v.h >= 1;
    return ok ? { i: d.i, x: v.x, y: v.y, w: Math.min(12, v.w), h: v.h, minW: d.minW || 2, minH: d.minH || 3 } : { minW: 2, minH: 3, ...d };
  });
}
function PanelGrid({ tab, panels, defaults, grid }) {
  const editing = !!(grid && grid.editing), resetToken = grid ? grid.resetToken : 0;
  const [layout, setLayout] = uS(() => resolveLayout(readLayouts()[tab], defaults));
  uE(() => { setLayout(resolveLayout(readLayouts()[tab], defaults)); }, [tab, resetToken]);
  const onLayoutChange = (l) => {
    setLayout(l);
    const all = readLayouts();
    all[tab] = l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    writeLayouts(all);
  };
  const item = (p) => (
    <div key={p.i} className="pg-item">
      <Glass2 tone={p.tone || 'panel'} padding={p.pad != null ? p.pad : 12}>
        <Eyebrow hk={p.hk} right={p.right}>{p.title}</Eyebrow>
        <div className="pg-body">{p.body}</div>
      </Glass2>
    </div>
  );
  if (!RGL) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{panels.map(item)}</div>;
  return (
    <RGL className={`pg${editing ? ' pg-editing' : ''}`} layout={layout} cols={12} rowHeight={30} margin={[8, 8]} containerPadding={[0, 0]}
      isDraggable={editing} isResizable={editing} draggableHandle=".pg-handle" compactType="vertical" onLayoutChange={onLayoutChange}>
      {panels.map(item)}
    </RGL>
  );
}
// Default arrangements (12 columns × 30px rows, 8px gutters).
const GRID_DEFAULTS = {
  levels: [
    { i: 'strip',  x: 0, y: 0,  w: 12, h: 4 },
    { i: 'ladder', x: 0, y: 4,  w: 4,  h: 19 },
    { i: 'range',  x: 0, y: 23, w: 4,  h: 10 },
    { i: 'keylevels', x: 0, y: 33, w: 4, h: 17 },
    { i: 'kline',  x: 4, y: 4,  w: 8,  h: 14 },
    { i: 'oi',       x: 4, y: 18, w: 8,  h: 10 },
    { i: 'intraday', x: 4, y: 28, w: 8,  h: 12 },
    { i: 'top20',    x: 4, y: 40, w: 8,  h: 8 },
    { i: 'gex',      x: 4, y: 48, w: 8,  h: 11 },
    { i: 'premarket', x: 0, y: 50, w: 4, h: 8 },
    { i: 'twse',      x: 0, y: 58, w: 4, h: 9 },
  ],
  chart: [{ i: 'kline', x: 0, y: 0, w: 12, h: 19 }],
  chain: [
    { i: 'chain',   x: 0, y: 0,  w: 8, h: 24 },
    { i: 'whatif',  x: 8, y: 0,  w: 4, h: 6 },
    { i: 'payoff',  x: 8, y: 6,  w: 4, h: 7 },
    { i: 'greeks',  x: 8, y: 13, w: 4, h: 5 },
    { i: 'legs',    x: 8, y: 18, w: 4, h: 8 },
    { i: 'oiprof',  x: 0, y: 24, w: 6, h: 9 },
    { i: 'maxpain', x: 6, y: 26, w: 6, h: 8 },
  ],
  calc: [
    { i: 'legs',     x: 0, y: 0,  w: 3, h: 7 },
    { i: 'pricer',   x: 0, y: 7,  w: 3, h: 14 },
    { i: 'payoff',   x: 3, y: 0,  w: 6, h: 14 },
    { i: 'heat',     x: 3, y: 14, w: 6, h: 13 },
    { i: 'pnl',      x: 9, y: 0,  w: 3, h: 7 },
    { i: 'analysis', x: 9, y: 7,  w: 3, h: 9 },
    { i: 'greeks',   x: 9, y: 16, w: 3, h: 6 },
  ],
  'lab-iv': [
    { i: 'surface', x: 0, y: 0,  w: 9, h: 24 },
    { i: 'hv',      x: 9, y: 0,  w: 3, h: 11 },
    { i: 'term',    x: 9, y: 11, w: 3, h: 7 },
    { i: 'skew',    x: 9, y: 18, w: 3, h: 4 },
    { i: 'help',    x: 9, y: 22, w: 3, h: 3 },
  ],
};
const gridCap = (txt) => <span className="mono" style={{ fontSize: 9, opacity: 0.6 }}>{txt}</span>;
const expCap = (e) => `${e.date} ${e.type === 'monthly' ? '月選' : e.label} · ${e.dte} 天`;
const GRID_BODY = { position: 'absolute', top: 90, left: 12, right: 12, bottom: 12, zIndex: 5, overflowY: 'auto', overflowX: 'hidden' };

function Obsidian3() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [workspace, setWorkspace] = uS(() => {
    const s = readSaved();
    return (s && ['levels', 'chain', 'chart', 'calc', 'lab', 'iv', 'pricer'].includes(s.workspace)) ? s.workspace : 'levels';
  });
  // Lab sub-view: '3d' P&L surface | 'iv' IV surface. A workspace saved as the
  // old top-level 'iv' tab lands on the IV sub-view.
  const [labView, setLabView] = uS(() => { const s = readSaved(); return (s && s.workspace === 'iv') ? 'iv' : '3d'; });
  const [productId, setProductId] = uS(initialProductId);
  const P = window.getProduct(productId);
  const [live, setLive] = uS(null);         // { quote, expiries, health } — IB proxy 抓到的
  const [liveRows, setLiveRows] = uS(null); // 當前到期日的 IB 期權鏈 rows
  const [oiData, setOiData] = uS(null);     // per-strike OI for the current expiry (TAIFEX via proxy; products with oiSource)
  const [marketData, setMarketData] = uS(null); // daily positioning (P/C ratio, 外資, top-10) — same source
  const [top20Data, setTop20Data] = uS(null);   // 權值股 TOP20: TAIFEX index weights + TWSE daily quotes
  const [intradayData, setIntradayData] = uS(null); // 1-min bars + 成本線 + 多空差額 (Shioaji ticks live, TAIFEX tick file otherwise)
  const [twseData, setTwseData] = uS(null);         // 台股籌碼日報: TWSE 三大法人 + 融資融券 (previous session)
  const [premarketData, setPremarketData] = uS(null); // 盤前脈絡: ES / NQ / SOX / VIX / TSM ADR / 2330 / USDTWD via the proxy's IB session
  const [lastLiveAt, setLastLiveAt] = uS(null); // ② timestamp of last successful live fetch
  const [liveBars, setLiveBars] = uS(null); // 近月期貨的 IB 歷史 K
  const [liveDayBars, setLiveDayBars] = uS(null); // daily 日盤 bars regardless of the K-line toggles — the 關卡價 input
  const [quoteNow, setQuoteNow] = uS(null); // latest live quote (last / open / high / low) — today's running range
  const [barPeriodId, setBarPeriodId] = uS('D'); // K 線週期：D / 4H / 1H
  const [barSession, setBarSession] = uS('day'); // 'day' 日盤 | 'full' 全日盤（含夜盤）— sources with a night session only
  const [theme, setTheme] = uS(() => {
    const s = readSaved();
    return (s && (s.theme === 'light' || s.theme === 'dark')) ? s.theme : 'dark';
  }); // 'dark' | 'light'（設計稿的 Light/Dark 切換）
  const [prodMenuOpen, setProdMenuOpen] = uS(false);
  const [layoutEdit, setLayoutEdit] = uS(false);  // 調整版面: panels drag / resize
  const [layoutReset, setLayoutReset] = uS(0);    // bumped by 重設 so the grid re-reads storage
  const [whatIfOpen, setWhatIfOpen] = uS(false); // collapsible What-if rail (owner: rarely used)
  // In-app help (⑧): drawer open state + one-time discoverability hint.
  const [helpOpen, setHelpOpen] = uS(false);
  const [helpHintSeen, setHelpHintSeen] = uS(() => { try { return localStorage.getItem('optionsLab.helpSeen') === '1'; } catch (e) { return true; } });
  function dismissHelpHint() {
    if (helpHintSeen) return;
    setHelpHintSeen(true);
    try { localStorage.setItem('optionsLab.helpSeen', '1'); } catch (e) { /* storage disabled */ }
  }
  const light = theme === 'light';
  // 亮色靠 body.light 的 CSS 覆蓋（tokens.css），圖表等元件則吃 theme prop 的 light 分支。
  uE(() => { document.body.classList.toggle('light', theme === 'light'); }, [theme]);
  uE(() => { setProdMenuOpen(false); }, [workspace]); // close product menu on tab change
  const [expiryId, setExpiryId] = uS(() => {
    const s = readSaved();
    const P0 = window.getProduct(initialProductId());
    const exps = productExpiries(P0, null); // live expiries unknown at mount → mock list
    if (s && s.expiryId && exps.some((e) => e.id === s.expiryId)) return s.expiryId;
    return defaultExpiryFor(P0).id;
  });
  const expiries = productExpiries(P, live && live.expiries);
  const expiry = expiries.find((e) => e.id === expiryId) || expiries[0];

  const [legs, setLegs] = uS(() => {
    const s = readSaved();
    const pid = initialProductId();
    const P0 = window.getProduct(pid);
    const saved = s && s.legsByProduct && sanitizeLegs(s.legsByProduct[pid]);
    return saved || defaultLegsFor(P0, defaultExpiryFor(P0).dte);
  });
  const [spot, setSpot] = uS(() => {
    const s = readSaved();
    const P0 = window.getProduct(initialProductId());
    const v = (s && Number.isFinite(s.spot)) ? s.spot : P0.defaultSpot;
    return Math.max(P0.spotMin, Math.min(P0.spotMax, v));
  });
  const [iv, setIv] = uS(() => {
    const s = readSaved();
    const P0 = window.getProduct(initialProductId());
    const v = (s && Number.isFinite(s.iv)) ? s.iv : P0.defaultIv;
    return Math.max(P0.ivMin, Math.min(P0.ivMax, v));
  });
  const [view, setView] = uS('payoff');
  const [hover, setHover] = uS(null);
  const [sliceFrac, setSliceFrac] = uS(1); // 0 = now, 1 = expiry

  // Persist working state (①), debounced. Must sit below every piece of state it
  // reads — the dependency array is evaluated during render, so declaring this
  // effect earlier would touch those consts in their temporal dead zone.
  // Legs are kept per-product so each product restores its own. Wrapped in
  // try/catch — quota / private mode must never crash the app. Tweaks, the
  // What-if rail and hover are intentionally not persisted.
  uE(() => {
    const id = setTimeout(() => {
      try {
        const prev = readSaved() || {};
        const legsByProduct = { ...(prev.legsByProduct || {}), [productId]: legs };
        const payload = { productId, expiryId, workspace, theme, spot, iv, legsByProduct };
        localStorage.setItem(LS_KEY, JSON.stringify(payload));
        _savedCache = payload; // keep the read cache in sync with the latest write
      } catch (e) { /* quota exceeded / storage disabled — skip */ }
    }, 400);
    return () => clearTimeout(id);
  }, [productId, expiryId, workspace, theme, spot, iv, legs]);

  const dte = expiry.dte;

  // 切商品：重設市場狀態 + 預設策略；live 數據下面的 effect 會重新抓。
  function switchProduct(id) {
    if (id === productId) return;
    const p = window.getProduct(id);
    const e0 = defaultExpiryFor(p);
    setProductId(id);
    setLive(null);
    setLiveRows(null);
    setOiData(null);
    setMarketData(null);
    setLiveBars(null);
    setLastLiveAt(null);
    setExpiryId(e0.id);
    setSpot(p.defaultSpot);
    setIv(p.defaultIv);
    setLegs(defaultLegsFor(p, e0.dte));
  }

  // IB live：商品有 ib 設定且本機 proxy（server/）活著 → 抓期貨報價 + 真實到期日。
  // proxy 不在 / IB 沒連線 → 安靜留在 mock。
  uE(() => {
    let dead = false;
    if (!P.live || !window.LiveData) return undefined;
    (async () => {
      const health = await window.LiveData.probe(P.id);
      if (dead || !health || !health.connected) return;
      const [quote, exps] = await Promise.all([
        window.LiveData.quote(P.id),
        window.LiveData.expiries(P.id),
      ]);
      if (dead) return;
      if (quote && quote.last > 0) { setSpot(quote.last); setLastLiveAt(Date.now()); }
      if (exps && exps.length) setExpiryId(exps[0].id);
      // K 棒交給下面的專屬 effect 抓（換週期會重抓，避免重複邏輯）。
      setLive({ quote, expiries: exps && exps.length ? exps : null, health });
      // Daily positioning (published once after the close) — one fetch per connect.
      if (P.oiSource && window.LiveData.market) {
        const m = await window.LiveData.market(P.id);
        if (!dead && m) setMarketData(m);
      }
    })();
    if (P.oiSource === 'taifex' && window.LiveData.top20) {
      (async () => {
        const t = await window.LiveData.top20(P.id);
        if (!dead && t && t.rows && t.rows.length) setTop20Data(t);
      })();
    }
    if (P.oiSource === 'taifex' && window.LiveData.intraday) {
      (async () => {
        const it = await window.LiveData.intraday(P.id);
        if (!dead && it && it.day && it.day.bars && it.day.bars.length) setIntradayData(it);
      })();
    }
    if (P.oiSource === 'taifex' && window.LiveData.twse) {
      (async () => {
        const w = await window.LiveData.twse(P.id);
        if (!dead && w && w.institutional && w.institutional.length) setTwseData(w);
      })();
    }
    if (P.oiSource === 'taifex' && window.LiveData.premarket) {
      (async () => {
        const pm = await window.LiveData.premarket(P.id);
        if (!dead && pm && pm.rows && pm.rows.length) setPremarketData(pm);
      })();
    }
    return () => { dead = true; };
  }, [productId]);

  // IB live：換到期日時抓該到期日的期權鏈；spot 跟著換成該鏈的標的期貨月份價。
  uE(() => {
    let dead = false;
    setLiveRows(null);
    setOiData(null);
    if (!live || !P.live || !window.LiveData) return undefined;
    (async () => {
      const chain = await window.LiveData.chain(P.id, expiryId);
      if (dead || !chain || !chain.rows || !chain.rows.length) return;
      setLiveRows(chain.rows);
      if (chain.underlying && chain.underlying.price > 0) setSpot(chain.underlying.price);
      setLastLiveAt(Date.now());
    })();
    // Full-range open interest for the Levels walls (TAIFEX daily report — the
    // previous session's numbers). Only products with an oiSource; null → the
    // walls fall back to the chain rows' own OI.
    if (P.oiSource && window.LiveData.oi) {
      (async () => {
        const oi = await window.LiveData.oi(P.id, expiryId);
        if (!dead && oi && oi.rows && oi.rows.length) setOiData(oi);
      })();
    }
    return () => { dead = true; };
  }, [live, expiryId]);

  // ② Live auto-refresh: while connected, re-pull the quote every 10s and the
  // option chain every 30s so intraday prices don't silently go stale. Paused
  // when the tab is hidden; refetches immediately on becoming visible again.
  uE(() => {
    if (!live || !P.live || !window.LiveData) return undefined;
    let dead = false;
    const pullQuote = async () => {
      if (document.hidden) return;
      const q = await window.LiveData.quote(P.id);
      if (dead || !q || !(q.last > 0)) return;
      setSpot(q.last);
      setQuoteNow(q);
      setLastLiveAt(Date.now());
    };
    const pullChain = async () => {
      if (document.hidden) return;
      const chain = await window.LiveData.chain(P.id, expiryId);
      if (dead || !chain || !chain.rows || !chain.rows.length) return;
      setLiveRows(chain.rows);
      if (chain.underlying && chain.underlying.price > 0) setSpot(chain.underlying.price);
      setLastLiveAt(Date.now());
    };
    const pullIntraday = async () => {
      if (document.hidden || !window.LiveData.intraday || (live.health && live.health.source === 'eod')) return;
      const it = await window.LiveData.intraday(P.id);
      if (dead || !it || !it.day || !it.day.bars || !it.day.bars.length) return;
      setIntradayData(it);
    };
    const pullPremarket = async () => {
      if (document.hidden || P.oiSource !== 'taifex' || !window.LiveData.premarket || (live.health && live.health.source === 'eod')) return;
      const pm = await window.LiveData.premarket(P.id);
      if (dead || !pm || !pm.rows || !pm.rows.length) return;
      setPremarketData(pm);
    };
    const qId = setInterval(pullQuote, 10000);
    const cId = setInterval(pullChain, 30000);
    const iId = setInterval(pullIntraday, 60000);
    const pmId = setInterval(pullPremarket, 60000);
    const onVis = () => { if (!document.hidden) { pullQuote(); pullChain(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; clearInterval(qId); clearInterval(cId); clearInterval(iId); clearInterval(pmId); document.removeEventListener('visibilitychange', onVis); };
  }, [live, productId, expiryId]);

  // IB live：K 線依所選週期抓歷史 K 棒。剛連上 + 每次換週期都會重抓；
  // 換週期時不清舊 bars（留著顯示直到新資料到，避免閃回 mock）。
  uE(() => {
    let dead = false;
    if (!live || !P.live || !window.LiveData) return undefined;
    const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
    (async () => {
      const hist = await window.LiveData.bars(P.id, { bar: per.bar, duration: per.duration, session: barSession });
      if (dead || !hist || !hist.bars || !hist.bars.length) return;
      setLiveBars(hist.bars);
      if (per.bar === '1 day' && barSession === 'day') setLiveDayBars(hist.bars);
    })();
    return () => { dead = true; };
  }, [live, barPeriodId, barSession]);
  // 關卡價 always reads the daily 日盤 series, whatever the K-line shows.
  uE(() => {
    let dead = false;
    if (!live || !P.live || !window.LiveData) { setLiveDayBars(null); return undefined; }
    (async () => {
      const hist = await window.LiveData.bars(P.id, { bar: '1 day', duration: '3 M', session: 'day' });
      if (dead || !hist || !hist.bars || !hist.bars.length) return;
      setLiveDayBars(hist.bars);
    })();
    return () => { dead = true; };
  }, [live, productId]);

  // live 報價可能落在預設 slider 範圍外 → 動態放寬邊界。
  const spotMin = Math.min(P.spotMin, Math.floor(spot * 0.9));
  const spotMax = Math.max(P.spotMax, Math.ceil(spot * 1.1));
  const D = DENSITY[t.density] || DENSITY.comfortable;
  const accent = `oklch(0.66 0.16 ${t.accentHue})`;
  const vp = useViewport();
  // On phone/fold, Compare is the only desktop-exclusive workspace (it needs the
  // multi-card grid to be useful). IV Surface is now mobile-friendly so it stays.
  uE(() => {
    if (vp.layout !== 'desk' && (workspace === 'compare' || workspace === 'chart' || workspace === 'levels' || workspace === 'lab')) setWorkspace('calc');
  }, [vp.layout]);
  // Desktop: Pricer/Compare tabs removed — redirect stale state to Chain; the
  // old IV Surface tab lives in Lab now.
  uE(() => {
    if (vp.layout === 'desk' && (workspace === 'pricer' || workspace === 'compare')) setWorkspace('chain');
    if (vp.layout === 'desk' && workspace === 'iv') setWorkspace('lab');
  }, [vp.layout, workspace]);

  // P&L numbers（點數 × 商品乘數）。Valued at the same front-expiry horizon as
  // PayoffChart (daysElapsed = sliceFrac · T0) so the number matches the curve.
  const pnlPts = uM(() => {
    const T0 = frontDte(legs, dte);
    return portfolioValuePts(legs, spot, iv, sliceFrac * T0, dte, P.r / 100, P.model)
      - portfolioCostPts(legs);
  }, [legs, spot, iv, dte, sliceFrac, productId]);
  const pnlNTD = pnlPts * P.mult;
  // Max profit / loss scanned at the front expiry (T0): near legs at intrinsic,
  // later legs keep time value. Single-expiry portfolios = Σ legPayoff as before.
  const maxProfit = uM(() => {
    const T0 = frontDte(legs, dte), cost = portfolioCostPts(legs);
    let m = -Infinity;
    for (let s = spot * 0.7; s <= spot * 1.3; s += P.strikeStep / 2) m = Math.max(m, portfolioValuePts(legs, s, iv, T0, dte, P.r / 100, P.model) - cost);
    return m * P.mult;
  }, [legs, spot, iv, dte, productId]);
  const maxLoss = uM(() => {
    const T0 = frontDte(legs, dte), cost = portfolioCostPts(legs);
    let m = Infinity;
    for (let s = spot * 0.7; s <= spot * 1.3; s += P.strikeStep / 2) m = Math.min(m, portfolioValuePts(legs, s, iv, T0, dte, P.r / 100, P.model) - cost);
    return m * P.mult;
  }, [legs, spot, iv, dte, productId]);

  // Live Greeks for the current portfolio (replaces hardcoded chips).
  const portfolioG = uM(() => portfolioGreeks(legs, spot, iv, dte, P.r / 100, P.model), [legs, spot, iv, dte, productId]);
  // Real POP from lognormal P&L distribution (replaces hardcoded 0.68).
  const popValue = uM(() => pnlDistribution(legs, spot, iv, dte, { r: P.r / 100, model: P.model }).pop, [legs, spot, iv, dte, productId]);
  // Estimated round-trip commission + tax (currency). The two P&L cards show
  // net-of-fees numbers; charts stay gross (they show the theoretical structure).
  const fees = uM(() => estFees(legs, P), [legs, productId]);
  // 期權鏈 rows：live（IB）優先，否則 mock。所有吃 chain 的元件都從這裡拿。
  const chainRows = uM(() => {
    if (liveRows && liveRows.length) return liveRows;
    return window.genChain ? window.genChain({ spot, contract: expiry.type, dte, product: P }) : [];
  }, [liveRows, spot, expiry.type, dte, productId]);
  const quality = uM(() => dataQuality(legs, chainRows), [legs, chainRows]);
  // Levels (價平和 band + max-OI walls) from the rows on screen + the OI table.
  const levels = uM(() => computeLevels({ spot, rows: chainRows, oi: oiData, P, iv, dte }), [spot, chainRows, oiData, productId, iv, dte]);
  // Dealer gamma exposure for the expiry on screen (the full TAIFEX strike
  // range when loaded, else the chain rows).
  const gex = uM(() => computeGex({ spot, oiRows: levels.oiRows, chainRows, iv, dte, P }), [spot, levels, chainRows, iv, dte, productId]);
  // 關卡價 from the daily 日盤 bars: live series when connected, else the mock
  // walk (labelled). Today's running high / low come from the live quote when
  // the source reports them; otherwise the last bar's own range stands in.
  const dayBars = uM(() => {
    if (liveDayBars && liveDayBars.length) return liveDayBars;
    if (liveBars && liveBars.length) return null; // connected but no daily 日盤 series yet — never mix in mock
    return window.genBars ? window.genBars({ spot: P.defaultSpot, n: 60, volScale: 1, product: P }) : null;
  }, [liveDayBars, liveBars, productId]);
  const keyLevels = uM(() => computeKeyLevels({ bars: dayBars, today: taipeiDate(), profile: intradayData && intradayData.day ? intradayData.day.profile : null }), [dayBars, intradayData]);
  const rangeLevels = uM(() => {
    const q = quoteNow || (live && live.quote);
    const today = (q && q.high > 0 && q.low > 0) ? { date: taipeiDate(), high: q.high, low: q.low } : { date: taipeiDate() };
    return computeRangeLevels({ bars: dayBars, today });
  }, [dayBars, quoteNow, live]);
  // K 線：live（IB 日K）優先，否則 mock 隨機漫步。
  // 刻意不依賴 spot — 拉 slider 屬於情境模擬，不該重繪歷史走勢。
  const bars = uM(() => {
    const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
    if (liveBars && liveBars.length) return aggBars(liveBars, per.agg);
    const mock = window.genBars ? window.genBars({ spot, n: per.n, volScale: per.volScale, product: P }) : [];
    return aggBars(mock, per.agg);
  }, [liveBars, productId, barPeriodId]);

  // 20-day historical (realized) volatility, annualized %, from daily closes.
  // Live daily bars when available; otherwise a mock walk at the product's
  // default vol (so mock mode reads roughly "fairly priced"). Compared against
  // ATM IV in the IV workspace — the classic premium rich / cheap gauge.
  const hvLive = !!(liveDayBars && liveDayBars.length);
  const hv20 = uM(() => {
    const daily = dayBars || [];
    const closes = daily.map((b) => b.c).filter((c) => c > 0);
    if (closes.length < 21) return null;
    const rets = [];
    for (let i = closes.length - 20; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varr = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
    return Math.sqrt(varr * 252) * 100;
  }, [dayBars]);

  // Add leg from chain
  // One click on the chain = one lot of that contract. A contract is the same
  // one when strike, call / put AND expiry all match (legs without their own
  // dte follow the workspace dte, so calendars stay separate). Clicking the
  // side already held adds a lot and averages the entry premium; clicking the
  // opposite side takes one off and drops the leg once the position is flat —
  // 平倉, rather than stacking a second leg that merely nets to zero.
  function addLegFromChain(leg) {
    setLegs((prev) => {
      const i = prev.findIndex((l) => l.strike === leg.strike && l.type === leg.type
        && (l.dte == null ? leg.dte : l.dte) === leg.dte);
      if (i < 0) return [...prev, leg];
      const cur = prev[i];
      if (cur.side === leg.side) {
        const qty = cur.qty + leg.qty;
        const premium = (cur.premium * cur.qty + leg.premium * leg.qty) / qty;
        return prev.map((l, j) => (j === i ? { ...l, qty, premium: Math.round(premium * 100) / 100 } : l));
      }
      const qty = cur.qty - leg.qty;
      if (qty <= 0) return prev.filter((_, j) => j !== i);
      return prev.map((l, j) => (j === i ? { ...l, qty } : l));
    });
  }

  // ── Mobile / foldable layout — completely different shell.
  if (vp.layout !== 'desk') {
    return (
      <MobileApp
        vp={vp}
        workspace={workspace} setWorkspace={setWorkspace}
        theme={theme} setTheme={setTheme}
        helpOpen={helpOpen} setHelpOpen={setHelpOpen}
        P={P} switchProduct={switchProduct} live={live}
        lastLiveAt={lastLiveAt} fees={fees}
        expiries={expiries} chainRows={chainRows}
        bars={bars} barsLive={!!liveBars}
        barPeriodId={barPeriodId} setBarPeriodId={setBarPeriodId}
        spotMin={spotMin} spotMax={spotMax}
        expiryId={expiryId} setExpiryId={setExpiryId} expiry={expiry}
        legs={legs} setLegs={setLegs} addLegFromChain={addLegFromChain}
        spot={spot} setSpot={setSpot}
        iv={iv} setIv={setIv}
        dte={dte}
        view={view} setView={setView}
        sliceFrac={sliceFrac} setSliceFrac={setSliceFrac}
        pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss}
        portfolioG={portfolioG} popValue={popValue} quality={quality}
        accent={accent} t={t} setTweak={setTweak}
      />
    );
  }

  const gridTab = workspace === 'lab' ? (labView === 'iv' ? 'lab-iv' : null) : workspace;
  const grid = { editing: layoutEdit && !!gridTab, resetToken: layoutReset };
  const qNow = quoteNow || (live && live.quote);
  const spotChgTop = (qNow && qNow.last > 0 && qNow.close > 0) ? qNow.last - qNow.close : null;
  return (
    <div style={{
      width: '100%', minHeight: '100vh', position: 'relative', overflow: 'hidden',
      fontFamily: 'var(--font-display)', color: 'var(--text)', background: 'var(--bg)', fontSize: 12,
    }}>
      {/* Top bar: brand · tabs · (right) product + price, data source, settlement, theme, help.
          Sits above the expiry row: the product menu inside must win the stacking order. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 44, display: 'flex', alignItems: 'stretch', gap: 12, padding: '0 12px', background: 'var(--panel2)', borderBottom: '1px solid var(--border)', zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
          <div style={{ width: 10, height: 10, background: 'var(--gold)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5 }}>Options Lab</span>
        </div>
        <WorkspaceTabs value={workspace} onChange={setWorkspace} />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
          <ProductDropdown
            productId={productId} P={P} spot={spot} chg={spotChgTop} live={live}
            open={prodMenuOpen} setOpen={setProdMenuOpen}
            onPick={(id) => { switchProduct(id); setProdMenuOpen(false); }}
          />
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}
            title={live ? (live.health && live.health.source === 'eod' ? `${P.live === 'ib' ? 'IB 快照' : '期交所前一交易日'}資料（${live.health.asOf}），沒有即時報價` : `${BROKER[P.live]} 已連線`) : '沒有本機資料代理 — 模擬資料'}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: live ? '#26a69a' : 'var(--muted)' }} />
            {P.live ? liveLabelZh(live, P) : '模擬'}
            {live && P.live && !(live.health && live.health.source === 'eod') && <FreshnessChip lastLiveAt={lastLiveAt} />}
          </div>
          <DataQualityPill quality={quality} />
          <SettlementCountdown dte={dte} note={P.settleNote} />
          <button onClick={() => setTheme(light ? 'dark' : 'light')} title="切換 亮色 / 深色" style={{ padding: '4px 8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {light ? '☀ 亮色' : '☾ 深色'}
          </button>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => { setHelpOpen((v) => !v); dismissHelpHint(); }} title="說明 — 這些數字怎麼讀" style={{ padding: '4px 9px', border: `1px solid ${helpOpen ? 'var(--gold)' : 'var(--border)'}`, background: 'transparent', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>?</button>
            {!helpHintSeen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 20, whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: 'rgba(240,192,104,0.16)', border: '1px solid rgba(240,192,104,0.4)',
                fontSize: 10, fontWeight: 600, color: light ? '#8a6410' : '#f7d394',
              }}>
                第一次用？按 <b>?</b> 看說明
                <button onClick={(e) => { e.stopPropagation(); dismissHelpHint(); }} title="關閉" style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, fontFamily: 'inherit' }}>×</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expiry row — second row; tab-specific controls on the right */}
      <div style={{ position: 'absolute', top: 44, left: 0, right: 0, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 12px', borderBottom: '1px solid var(--border)', zIndex: 10 }}>
        <ExpiryStrip value={expiryId} onChange={setExpiryId} expiries={expiries} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {workspace === 'lab' && <LabToggle value={labView} onChange={setLabView} />}
          {gridTab && (<>
            <Seg items={[{ id: 'lock', label: '鎖定版面' }, { id: 'edit', label: '調整版面' }]} value={layoutEdit ? 'edit' : 'lock'} onChange={(v) => setLayoutEdit(v === 'edit')} />
            {layoutEdit && <button style={miniBtn} title="回到這個分頁的預設版面" onClick={() => { clearLayout(gridTab); setLayoutReset((n) => n + 1); }}>重設</button>}
          </>)}
          <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{P.unitLabel}</span>
        </div>
      </div>

      {/* WORKSPACE BODY */}
      {workspace === 'levels' && (
        <LevelsWorkspace
          P={P} theme={theme} light={light} spot={spot} expiry={expiry} levels={levels} live={live} market={marketData}
          rangeLevels={rangeLevels} dayBarsLive={!!liveDayBars} gex={gex} grid={grid} top20={top20Data} intraday={intradayData} keyLevels={keyLevels} twse={twseData} premarket={premarketData}
          bars={bars} barsLive={!!liveBars} barPeriodId={barPeriodId} setBarPeriodId={setBarPeriodId}
          barSession={barSession} setBarSession={setBarSession}
          D={D}
        />
      )}
      {workspace === 'calc' && (
        <CalcWorkspace
          P={P} theme={theme} light={light} rows={chainRows} expiries={expiries} live={live}
          legs={legs} setLegs={setLegs}
          spot={spot} setSpot={setSpot}
          spotMin={spotMin} spotMax={spotMax}
          iv={iv} setIv={setIv}
          dte={dte}
          sliceFrac={sliceFrac} setSliceFrac={setSliceFrac}
          view={view} setView={setView}
          pnlPts={pnlPts} pnlNTD={pnlNTD}
          maxProfit={maxProfit} maxLoss={maxLoss} fees={fees}
          accent={accent} D={D} t={t}
          portfolioG={portfolioG} popValue={popValue} quality={quality} grid={grid}
        />
      )}
      {workspace === 'lab' && labView === '3d' && (
        <LabSurface P={P} theme={theme} light={light} t={t} spot={spot} dte={dte} legs={legs} hover={hover} setHover={setHover} D={D} />
      )}
      {workspace === 'lab' && labView === 'iv' && (
        <IVWorkspace D={D} P={P} spot={spot} iv={iv} expiry={expiry} expiries={expiries} rows={chainRows} hv20={hv20} hvLive={hvLive} dayBars={dayBars} live={live} light={light} theme={theme} grid={grid} />
      )}
      {workspace === 'chain' && (
        <ChainWorkspace
          P={P} rows={chainRows} theme={theme}
          spot={spot} setSpot={setSpot} expiry={expiry} expiries={expiries}
          onAddLeg={addLegFromChain}
          legs={legs} setLegs={setLegs}
          iv={iv} setIv={setIv} dte={dte}
          pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss} fees={fees}
          popValue={popValue} portfolioG={portfolioG}
          accent={accent} t={t} D={D}
          quality={quality} grid={grid} hv20={hv20}
        />
      )}
      {workspace === 'chart' && (
        <ChartWorkspace
          P={P} bars={bars} barsLive={!!liveBars} live={live} theme={theme} light={light}
          barPeriodId={barPeriodId} setBarPeriodId={setBarPeriodId}
          barSession={barSession} setBarSession={setBarSession}
          cone={levels.atmIv ? { ivPct: levels.atmIv, days: expiry.dte, label: expiry.label } : null}
          D={D} grid={grid}
        />
      )}

      {/* Global collapsible What-if rail — on every tab */}
      <WhatIfRail
        P={P} spot={spot} setSpot={setSpot} spotMin={spotMin} spotMax={spotMax}
        iv={iv} setIv={setIv} open={whatIfOpen} setOpen={setWhatIfOpen} theme={theme} light={light}
      />

      {/* In-app help drawer (⑧) */}
      {window.HelpDrawer && <window.HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} workspace={workspace} />}

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Surface">
          <TweakRadio label="Color scheme" value={t.scheme} onChange={(v) => setTweak('scheme', v)}
            options={[
              { value: 'diverging', label: 'Diverging' },
              { value: 'aurora', label: 'Aurora' },
              { value: 'viridis', label: 'Viridis' },
              { value: 'classic', label: 'Classic' },
            ]} />
        </TweakSection>
        <TweakSection title="Layout">
          <TweakRadio label="Density" value={t.density} onChange={(v) => setTweak('density', v)}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Cozy' },
              { value: 'spacious', label: 'Roomy' },
            ]} />
        </TweakSection>
        <TweakSection title="Accent">
          <TweakSlider label="Hue" value={t.accentHue} min={0} max={360} step={1} suffix="°" onChange={(v) => setTweak('accentHue', v)} />
          <TweakToggle label="Aurora background" value={t.showAuroraBlobs} onChange={(v) => setTweak('showAuroraBlobs', v)} />
          <TweakToggle label="Probability cone" value={t.showProbCone} onChange={(v) => setTweak('showProbCone', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ───────────────────────────────────────────────── CALCULATOR WORKSPACE
function CalcWorkspace({ P, theme = 'dark', rows, expiries, live, legs, setLegs, spot, setSpot, spotMin, spotMax, iv, setIv, dte, sliceFrac, setSliceFrac, view, setView, pnlPts, pnlNTD, maxProfit, maxLoss, fees = 0, accent, D, t, portfolioG, popValue, quality, grid }) {
  const light = theme === 'light';
  // Net of estimated round-trip fees (⑤). Charts stay gross.
  const netPnl = pnlNTD - fees;
  const netMaxProfit = maxProfit - fees;
  const netMaxLoss = maxLoss - fees;
  // IB position import (④): replace the working legs with the real portfolio.
  const canImport = !!(live && P.livePositions && window.LiveData && window.LiveData.positions);
  const [importing, setImporting] = uS(false);
  const [importNote, setImportNote] = uS(null);
  async function importPositions() {
    setImporting(true);
    const res = await window.LiveData.positions(P.id);
    setImporting(false);
    if (res && res.positions && res.positions.length) {
      setLegs(res.positions.map((pp) => ({
        side: pp.side, type: pp.type, strike: pp.strike,
        premium: pp.premium, qty: pp.qty, dte: pp.dte != null ? pp.dte : dte,
      })));
      setImportNote(`已載入 ${res.positions.length} 筆部位`);
    } else {
      setImportNote(`${BROKER[P.live]} 沒有部位`);
    }
    setTimeout(() => setImportNote(null), 3500);
  }
  // The right column's analysis tabs no longer include Payoff (it is the centre
  // panel now); a saved 'payoff' view shows the P&L cross-section instead.
  const rv = view === 'payoff' ? 'cross' : view;

  const analysisTabs = [
    { id: 'cross', label: '損益' },
    { id: 'greeks', label: '希臘值' },
    { id: 'dist', label: '分布' },
    { id: 'attr', label: '歸因' },
    { id: 'theta', label: '時間' },
    { id: 'iv', label: 'IV' },
  ];
  const analysisTitle = { cross: '損益 vs 現價', greeks: '希臘值曲線 · Δ Γ Θ V 對現價', dist: '損益分布 · 對數常態', attr: '損益歸因 · 漲跌從哪來', theta: '時間價值衰減', iv: 'IV 微笑曲線' }[rv] || '分析';
  const panels = [
    { i: 'legs', title: `部位明細${legs.length ? ` · ${legs.length} 筆` : ''}`,
      right: (
        <div style={{ display: 'flex', gap: 4 }}>
          {canImport && <button style={miniBtn} disabled={importing} onClick={importPositions} title={`載入 ${BROKER[P.live]} 帳戶的真實部位`}>{importing ? '…' : `⟳ ${BROKER[P.live]}`}</button>}
          <StrategyMenu P={P} spot={spot} iv={iv} dte={dte} onPick={setLegs} light={light} />
          <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>＋ 新增</button>
        </div>
      ),
      body: (<>
        <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
        {importNote && <div style={{ fontSize: 10, opacity: 0.6, marginTop: 6, fontFamily: 'var(--font-mono)' }}>{importNote}</div>}
      </>) },
    { i: 'pricer', title: '理論價試算', hk: 'pricer', right: gridCap(P.model === 'b76' ? 'Black-76' : 'Black-Scholes'),
      body: <OptionPricer key={P.id} product={P} spot={spot} iv={iv} dte={dte} rows={rows} theme={theme} accent={accent} /> },
    { i: 'payoff', hk: 'payoff', title: <>到期損益圖 {t.showProbCone && <span style={{ color: '#a78bfa', fontWeight: 500, marginLeft: 4 }}>· 1σ/2σ 機率錐</span>}</>,
      right: gridCap(`${sliceFrac >= 0.99 ? '到期時' : sliceFrac <= 0.01 ? '現在' : `時間 ${(sliceFrac * 100).toFixed(0)}%`} · ${legs.length} 筆部位`),
      body: (<>
        <PayoffChart legs={legs} spot={spot} theme={theme} height={320} width={720} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={sliceFrac} rangePct={0.08} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, opacity: 0.6, fontWeight: 600, marginBottom: 4 }}>
            <span>損益日期</span>
            <span className="mono">今天 → 到期</span>
          </div>
          <input type="range" min="0" max="1" step="0.01" value={sliceFrac} onChange={(e) => setSliceFrac(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: accent }} />
        </div>
      </>) },
    { i: 'heat', title: '損益表 · 價格 × 日期', hk: 'pnlheat', right: gridCap(`IV ${iv.toFixed(1)}% 固定 · ${P.cur} · 毛損益`),
      body: legs.length ? <window.PnLHeatmap legs={legs} spot={spot} iv={iv} dte={dte} P={P} theme={theme} /> : <div style={{ fontSize: 11, opacity: 0.5, padding: '12px 0' }}>先加入部位。</div> },
    { i: 'pnl', title: '目前損益', hk: 'pnlnow', tone: 'raised', right: gridCap(fees > 0 ? `已扣估計手續費 ${P.cur}${Math.round(fees).toLocaleString()}` : ''),
      body: (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="tnum" style={{
              fontSize: 30, fontWeight: 700, letterSpacing: -0.6,
              color: netPnl >= 0 ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)') : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)'),
              fontFamily: 'var(--font-mono)', lineHeight: 1,
            }}>
              {netPnl >= 0 ? '+' : ''}{P.cur}{Math.abs(Math.round(netPnl)).toLocaleString()}
            </div>
            <div className="tnum" style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
              {pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} 點 {P.unitLabel}
            </div>
            <div className="tnum" style={{ fontSize: 11, opacity: 0.6, marginTop: 8, whiteSpace: 'nowrap' }}>
              最大獲利 <span style={{ color: '#f0c068' }}>+{P.cur}{Math.round(netMaxProfit).toLocaleString()}</span>
              <span style={{ opacity: 0.4 }}> · </span>
              最大虧損 <span style={{ color: '#5fa3d4' }}>{P.cur}{Math.round(netMaxLoss).toLocaleString()}</span>
            </div>
          </div>
          <div style={{ width: 96, flexShrink: 0 }}>
            <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, textAlign: 'center' }}>獲利機率</div>
            <POPGauge theme={theme} size={96} value={popValue} />
          </div>
        </div>
      ) },
    { i: 'analysis', title: analysisTitle, right: gridCap(rv === 'greeks' ? `${dte} 天 · IV ${iv}%` : rv === 'dist' ? '到期時' : rv === 'attr' ? '相對基準' : rv === 'iv' ? `價平 IV ${iv}%` : `${dte} 天`),
      body: (<>
        <div className="seg" style={{ display: 'flex', marginBottom: 8 }}>
          {analysisTabs.map((tab) => <button key={tab.id} className={rv === tab.id ? 'on' : ''} style={{ flex: 1 }} onClick={() => setView(tab.id)}>{tab.label}</button>)}
        </div>
        {rv === 'cross' && <CrossSection theme={theme} dte={dte} height={140} width={304} />}
        {rv === 'greeks' && <GreeksProfile legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={140} width={304} model={P.model} r={P.r / 100} />}
        {rv === 'dist' && <PnLDistribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={140} width={304} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />}
        {rv === 'attr' && <PnLAttribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={150} width={304} baseSpot={P.defaultSpot} baseIv={P.defaultIv} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />}
        {rv === 'theta' && (<>
          <ThetaDecay theme={theme} dte={dte} height={140} width={304} />
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>目前到期天數下每日約 −{P.cur}{(0.12 * P.mult * 100).toFixed(0)}</div>
        </>)}
        {rv === 'iv' && <IVSmile theme={theme} iv={iv} height={140} width={304} />}
      </>) },
    { i: 'greeks', title: '部位希臘值', right: <DataQualityPill quality={quality} />,
      body: (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
          <GreekChip label="Delta · Δ" helpKey="delta" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Gamma · Γ" helpKey="gamma" value={portfolioG.gamma.toFixed(4)} theme={theme} />
          <GreekChip label="Theta · Θ" helpKey="theta" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Vega · V" helpKey="vega" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
        </div>
      ) },
  ];
  return (
    <div style={GRID_BODY}>
      <PanelGrid tab="calc" panels={panels} defaults={GRID_DEFAULTS.calc} grid={grid} />
    </div>
  );
}

// ───────────────────────────────────────────────── LAB WORKSPACE
// Research views demoted from the working tabs (owner request, 2026-09): the
// 3D P&L surface that used to be the Calculator's backdrop, and the IV
// surface that used to be its own tab. The sub-view toggle sits in the
// expiry row so neither view has to make room for it.
function LabToggle({ value, onChange }) {
  return <Seg items={[{ id: '3d', label: '3D 損益曲面' }, { id: 'iv', label: 'IV 曲面' }]} value={value} onChange={onChange} />;
}

// The 3D surface is still the stylised OptionsSurface (it does not read the
// legs) — the caption says so, so nobody mistakes it for the position's P&L.
function LabSurface({ P, theme = 'dark', light = false, t, spot, dte, legs, hover, setHover, D }) {
  const hoverInfo = uM(() => {
    if (!hover) return null;
    const spotAt = (spot * (1 + hover.xn * 0.18)).toFixed(0);
    const dteAt = (dte * (1 - hover.yn)).toFixed(0);
    const pnlAt = (hover.v * 1000 * P.mult).toFixed(0); // approx points × mult
    return { spotAt, dteAt, pnlAt };
  }, [hover, spot, dte, P]);
  return (
    <>
      <div style={{ position: 'absolute', inset: '110px 0 0 0' }}>
        <Surface3DMount theme={theme} height="100%" scheme={t.scheme} onHover={setHover} />
      </div>
      {hoverInfo && (
        <div style={{
          position: 'absolute', top: 130, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
          padding: '8px 14px', borderRadius: 0,
          background: 'rgba(20,24,34,0.85)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.12)',
          fontSize: 12, fontFamily: 'var(--font-mono)',
          display: 'flex', gap: 14, alignItems: 'center', pointerEvents: 'none',
        }}>
          <span><span style={{ opacity: 0.55 }}>價格 </span>{parseInt(hoverInfo.spotAt).toLocaleString()}</span>
          <span style={{ opacity: 0.3 }}>·</span>
          <span><span style={{ opacity: 0.55 }}>剩 </span>{hoverInfo.dteAt} 天</span>
          <span style={{ opacity: 0.3 }}>·</span>
          <span style={{ color: parseFloat(hoverInfo.pnlAt) >= 0 ? '#f0c068' : '#5fa3d4', fontWeight: 600 }}>
            {P.cur}{parseFloat(hoverInfo.pnlAt) >= 0 ? '+' : ''}{Math.round(parseFloat(hoverInfo.pnlAt)).toLocaleString()}
          </span>
        </div>
      )}
      <Glass2 tone="panel" padding={D.panelPad} style={{ position: 'absolute', bottom: 24, left: 24, zIndex: 5, width: 300 }}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{P.code} · {dte} 天</span>}>3D 損益曲面</Eyebrow>
        <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.8 }}>
          橫軸＝標的價格，縱深＝時間流逝（前緣今天、後緣到期），高度與顏色＝損益。拖曳旋轉、滾輪縮放。
        </div>
        <div style={{ fontSize: 10, marginTop: 8, opacity: 0.55, lineHeight: 1.5 }}>
          示意用曲面，尚未接上目前的 {legs.length} 筆部位；部位的真實損益看「策略」分頁的到期損益圖。
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 9, opacity: 0.55, fontWeight: 600 }}>損益</span>
          <span className="tnum" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#5fa3d4' }}>−15K</span>
          <div style={{ flex: 1, height: 8, borderRadius: 4,
            background: t.scheme === 'aurora' ? 'linear-gradient(90deg, oklch(0.65 0.18 220), oklch(0.70 0.16 290), oklch(0.70 0.18 350))'
                     : t.scheme === 'viridis' ? 'linear-gradient(90deg, #440154, #21918c, #fde725)'
                     : t.scheme === 'classic' ? 'linear-gradient(90deg, #d94d4d, #4d4d59, #4dc870)'
                     :                          'linear-gradient(90deg, #5fa3d4, #4d4d59, #f0c068)',
          }} />
          <span className="tnum" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f0c068' }}>+45K</span>
        </div>
      </Glass2>
    </>
  );
}

// ───────────────────────────────────────────────── CHAIN WORKSPACE
// P&L what-if card (design ⑤) — compact hero + POP gauge + max profit/loss tiles.
function WhatIfCard({ P, pnlPts, pnlNTD, maxProfit, maxLoss, popValue, fees = 0, theme, light, D, bare = false }) {
  // Net of estimated round-trip fees (⑤).
  const netPnl = pnlNTD - fees;
  const netMaxProfit = maxProfit - fees;
  const netMaxLoss = maxLoss - fees;
  const profit = netPnl >= 0;
  const heroColor = profit
    ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)')
    : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)');
  const tile = { padding: '7px 10px', borderRadius: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' };
  const inner = (<>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {!bare && <Eyebrow hk="pnlwhatif">部位損益試算 · {P.code}</Eyebrow>}
          <div className="tnum" style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.05, marginTop: 3, fontFamily: 'var(--font-mono)', color: heroColor }}>
            {profit ? '+' : ''}{P.cur}{Math.abs(Math.round(netPnl)).toLocaleString()}
          </div>
          <div className="tnum" style={{ fontSize: 9, opacity: 0.5, marginTop: 3 }}>{pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} 點 {P.unitLabel}{fees > 0 ? ` · 已扣估計手續費 ${P.cur}${Math.round(fees).toLocaleString()}` : ''}</div>
        </div>
        <div style={{ width: 74, flexShrink: 0 }}>
          <POPGauge theme={theme} size={74} value={popValue} />
          <div style={{ textAlign: 'center', fontSize: 9, opacity: 0.6, marginTop: 3, whiteSpace: 'nowrap' }}>獲利機率</div>
        </div>
      </div>
      <div style={{ height: 1, background: light ? 'rgba(20,30,50,0.10)' : 'rgba(255,255,255,0.10)', margin: '10px 0 9px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="lt-tile" style={tile}>
          <div style={{ fontSize: 9, opacity: 0.6 }}>最大獲利</div>
          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: 'var(--font-mono)', color: '#f0c068' }}>+{P.cur}{Math.round(netMaxProfit).toLocaleString()}</div>
        </div>
        <div className="lt-tile" style={tile}>
          <div style={{ fontSize: 9, opacity: 0.6 }}>最大虧損</div>
          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: 'var(--font-mono)', color: '#5fa3d4' }}>{P.cur}{Math.round(netMaxLoss).toLocaleString()}</div>
        </div>
      </div>
  </>);
  if (bare) return inner;
  return <Glass2 tone="raised" padding="14px 14px 12px">{inner}</Glass2>;
}

// Chain-tab layout switcher (design ③): SIDE / WIDE / SPLIT.
const CHAIN_LAYOUTS = {
  a: { label: '側欄', cols: 'minmax(460px,1fr) minmax(340px,392px)', areas: "'chain pnl' 'chain payoff' 'chain greeks' 'chain legs'" },
  b: { label: '全寬', cols: '1fr 1fr',            areas: "'chain chain' 'pnl payoff' 'greeks legs'" },
  c: { label: '分割', cols: '1.1fr 1fr 1fr',      areas: "'chain chain chain' 'payoff pnl legs' 'greeks greeks greeks'" },
};
function LayoutToggle({ value, onChange }) {
  return <Seg items={Object.keys(CHAIN_LAYOUTS).map((k) => ({ id: k, label: CHAIN_LAYOUTS[k].label }))} value={value} onChange={onChange} />;
}

function ChainWorkspace({ P, rows, theme = 'dark', spot, setSpot, expiry, expiries, onAddLeg, legs, setLegs,
  iv, setIv, dte, pnlPts, pnlNTD, maxProfit, maxLoss, fees = 0, popValue, portfolioG, accent, t, D, quality, grid, hv20 = null }) {
  const light = theme === 'light';
  const credit = legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0);
  const greekGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
      <GreekChip label="Delta · Δ" helpKey="delta" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
      <GreekChip label="Gamma · Γ" helpKey="gamma" value={portfolioG.gamma.toFixed(4)} theme={theme} />
      <GreekChip label="Theta · Θ" helpKey="theta" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
      <GreekChip label="Vega · V" helpKey="vega" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
    </div>
  );
  const panels = [
    { i: 'chain', title: `${P.nameZh || P.name} T 字報價 · ${P.code}`, right: gridCap(expCap(expiry)),
      body: <OptionChain spot={spot} contract={expiry.type} dte={expiry.dte} product={P} rows={rows} legs={legs} onAddLeg={onAddLeg} theme={theme} hv20={hv20} /> },
    { i: 'whatif', title: `部位損益試算 · ${P.code}`, hk: 'pnlwhatif', tone: 'raised',
      body: <WhatIfCard bare P={P} pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss} fees={fees} popValue={popValue} theme={theme} light={light} D={D} /> },
    { i: 'payoff', title: <>到期損益圖 {t.showProbCone && <span style={{ color: '#a78bfa', fontWeight: 500, marginLeft: 4 }}>· 1σ/2σ 機率錐</span>}</>, right: gridCap('到期時'),
      body: <PayoffChart legs={legs} spot={spot} theme={theme} height={150} width={304} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={1} rangePct={0.08} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} /> },
    { i: 'greeks', title: '部位希臘值', right: <DataQualityPill quality={quality} />, body: greekGrid },
    { i: 'legs', title: `部位明細 · ${legs.length} 筆`,
      right: (
        <div style={{ display: 'flex', gap: 4 }}>
          <StrategyMenu P={P} spot={spot} iv={iv} dte={dte} onPick={setLegs} light={light} />
          <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>＋ 新增</button>
          {legs.length > 0 && <button style={miniBtn} onClick={() => setLegs([])}>清空</button>}
        </div>
      ),
      body: (<>
        {legs.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, opacity: 0.5 }}>點報價表任一列加入部位</div>
        ) : (
          <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6, marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          <span>{credit >= 0 ? '淨收入' : '淨支出'}</span>
          <span>{credit >= 0 ? '+' : ''}{P.cur}{Math.round(credit * P.mult).toLocaleString()}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
          {[
            { label: '跌 5%、IV +15', spot: -5, iv: 15 },
            { label: '崩跌 10%', spot: -10, iv: 21 },
          ].map((sc, i) => (
            <button key={i} onClick={() => {
              setSpot(Math.round(P.defaultSpot * (1 + sc.spot / 100) / P.spotStep) * P.spotStep);
              setIv(Math.max(P.ivMin, Math.min(P.ivMax, P.defaultIv + sc.iv)));
            }} style={{ ...miniBtn, padding: '7px 6px' }}>{sc.label}</button>
          ))}
        </div>
      </>) },
    { i: 'oiprof', title: '各履約價未平倉', right: gridCap(expCap(expiry)),
      body: <OIProfile spot={spot} contract={expiry.type} rows={rows} theme={theme} maxRows={11} /> },
    { i: 'maxpain', title: '最大痛苦點', right: gridCap('結算價'),
      body: <MaxPain spot={spot} contract={expiry.type} rows={rows} ntdMult={P.mult} cur={P.cur} theme={theme} height={150} width={520} /> },
  ];
  return (
    <div style={GRID_BODY}>
      <PanelGrid tab="chain" panels={panels} defaults={GRID_DEFAULTS.chain} grid={grid} />
    </div>
  );
}

// ───────────────────────────────────────────────── LEVELS WORKSPACE
// The day-trading read (docs/daytrade-redesign.md §4): one price ladder with
// spot in the middle, the ATM straddle (價平和) band and the max-OI walls
// (壓力 / 支撐), the same lines overlaid on the K-line, and the OI table with
// its change column. Every number is derived from the rows already on screen
// plus the OI table the proxy serves (TAIFEX, previous session) — no extra
// pricing path.

// atm = chain row nearest spot; straddle = its call + put premium; the walls =
// max call / put OI over the OI table (full strike range when TAIFEX data is
// loaded, else the chain rows' own OI — IB or mock). prevStraddle = the same
// two contracts' previous-session settlement prices (TAIFEX), the 前盤價平和
// the straddle is compared against.
function computeLevels({ spot, rows, oi, P, iv, dte }) {
  let atm = null;
  for (const r of rows) if (!atm || Math.abs(r.strike - spot) < Math.abs(atm.strike - spot)) atm = r;
  const straddle = (atm && atm.call.last > 0 && atm.put.last > 0) ? atm.call.last + atm.put.last : null;
  // Expected move (tastytrade / thinkorswim idiom): 1σ = S · IV · √(T/365) with
  // the ATM IV from the chain (average of the call and put) — the workspace IV
  // when the chain carries none. The straddle × 0.85 rule of thumb rides along.
  const atmIv = (atm && atm.call.iv > 0 && atm.put.iv > 0) ? (atm.call.iv + atm.put.iv) / 2 : (iv > 0 ? iv : null);
  const sigma1 = (atmIv && dte > 0) ? spot * (atmIv / 100) * Math.sqrt(dte / 365) : null;
  // Reference = the session before the premiums on screen: TAIFEX's latest
  // settlement under a live feed, or the previous session's settlement when
  // the premiums themselves are the end-of-day snapshot (prevSettle).
  let prevStraddle = null;
  if (oi && oi.rows && atm) {
    const r = oi.rows.find((x) => x.strike === atm.strike);
    const ref = (x) => (x.prevSettle != null ? x.prevSettle : x.settle);
    if (r && ref(r.call) != null && ref(r.put) != null) prevStraddle = ref(r.call) + ref(r.put);
  }
  const oiRows = (oi && oi.rows && oi.rows.length) ? oi.rows : rows;
  const wall = (side) => {
    let best = null;
    for (const r of oiRows) if (r[side].oi > 0 && (!best || r[side].oi > best[side].oi)) best = r;
    return best ? { strike: best.strike, oi: best[side].oi, oiChg: best[side].oiChg } : null;
  };
  const totals = (oi && oi.totals) ? oi.totals : {
    callOi: oiRows.reduce((a, r) => a + r.call.oi, 0),
    putOi: oiRows.reduce((a, r) => a + r.put.oi, 0),
  };
  // Max pain: the settlement price that minimises what option holders collect
  // (Σ call OI · max(0, S − K) + Σ put OI · max(0, K − S)) — optioncharts.io's
  // definition, evaluated at each listed strike.
  let maxPain = null;
  if (oiRows.length > 1) {
    let best = null;
    for (const rk of oiRows) {
      let pain = 0;
      for (const ri of oiRows) {
        if (rk.strike > ri.strike) pain += ri.call.oi * (rk.strike - ri.strike);
        if (rk.strike < ri.strike) pain += ri.put.oi * (ri.strike - rk.strike);
      }
      if (!best || pain < best.pain) best = { strike: rk.strike, pain };
    }
    if (best && best.pain > 0) maxPain = best;
  }
  return {
    atm, straddle, prevStraddle, atmIv, sigma1, maxPain,
    resistance: wall('call'), support: wall('put'),
    totals, oiRows,
    oiSource: oi ? oi.source : null, oiDate: oi ? oi.date : null,
  };
}

const LEVEL_COLORS = { up: '#ef5350', down: '#26a69a', band: '#a78bfa', spot: '#f0c068', range: '#60a5fa', gex: '#fb923c' };

// Dealer gamma exposure per strike — SqueezeMetrics' GEX as SpotGamma shows it:
//   GEX_i = γ_i · OI_i · multiplier · S² · 0.01, calls +, puts −
// (currency per 1% move of the underlying), under the white paper's inventory
// convention that dealers are long the calls customers sold and short the puts
// customers bought. Gamma from the same pricing model as everything else, at
// the strike's own chain IV (nearest chain strike's IV outside the chain, the
// workspace IV when the chain carries none). Call Wall / Put Wall = the strike
// with the largest call / put gamma·OI; flip = the spot where total GEX
// re-priced across a grid crosses zero (LuxAlgo's statement of the SpotGamma
// definition). One expiry at a time — the chain on screen.
function computeGex({ spot, oiRows, chainRows, iv, dte, P }) {
  if (!oiRows || oiRows.length < 2 || !(spot > 0) || !(dte > 0)) return null;
  const r = P.r / 100, model = P.model, mult = P.mult;
  const ivAt = (K) => {
    let best = null;
    for (const c of chainRows || []) {
      const v = (c.call.iv > 0 && c.put.iv > 0) ? (c.call.iv + c.put.iv) / 2 : (c.call.iv > 0 ? c.call.iv : c.put.iv);
      if (!(v > 0)) continue;
      if (!best || Math.abs(c.strike - K) < Math.abs(best.strike - K)) best = { strike: c.strike, iv: v };
    }
    return best ? best.iv : (iv > 0 ? iv : null);
  };
  const scale = (S) => mult * S * S * 0.01;
  const rows = [];
  for (const o of oiRows) {
    const v = ivAt(o.strike);
    if (!(v > 0)) continue;
    const g = bsGreeks('call', spot, o.strike, v, dte, r, model).gamma;
    const call = g * o.call.oi * scale(spot);
    const put = -g * o.put.oi * scale(spot);
    rows.push({ strike: o.strike, iv: v, call, put, net: call + put });
  }
  if (!rows.length) return null;
  const total = rows.reduce((a, x) => a + x.net, 0);
  const callWall = rows.reduce((a, x) => (x.call > (a ? a.call : 0) ? x : a), null);
  const putWall = rows.reduce((a, x) => (x.put < (a ? a.put : 0) ? x : a), null);
  // Flip: total GEX as a function of spot, nearest zero crossing to spot.
  let flip = null, prev = null;
  const step = Math.max(P.strikeStep / 2, spot * 0.001);
  for (let S = spot * 0.9; S <= spot * 1.1; S += step) {
    let tot = 0;
    for (const x of rows) {
      const o = oiRows.find((q) => q.strike === x.strike);
      const g = bsGreeks('call', S, x.strike, x.iv, dte, r, model).gamma;
      tot += g * (o.call.oi - o.put.oi) * scale(S);
    }
    if (prev && Math.sign(prev.tot) !== Math.sign(tot) && tot !== 0) {
      const z = prev.S + (S - prev.S) * (prev.tot / (prev.tot - tot));
      if (flip == null || Math.abs(z - spot) < Math.abs(flip - spot)) flip = z;
    }
    prev = { S, tot };
  }
  return { rows, total, callWall, putWall, flip };
}

// Money in the product's currency at the scale GEX comes in: 億 for NT$, M for US$.
function fmtBig(v, P) {
  if (v == null || !Number.isFinite(v)) return '—';
  const big = P.cur === 'NT$' ? 1e8 : 1e6, unit = P.cur === 'NT$' ? '億' : 'M';
  const a = Math.abs(v) / big;
  return `${v < 0 ? '−' : ''}${a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2)}${unit}`;
}

// Net GEX by strike, centred on the ATM strike like the OI table: positive
// (dealers long gamma — they sell rallies and buy dips, damping) grows to the
// right in call red, negative (short gamma — hedging chases the move) to the
// left in put teal. Walls and the flip are called out.
function GexProfile({ P, spot, G, theme = 'dark', light = false, maxRows = 15 }) {
  const txt = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const rows = G.rows;
  let ci = 0;
  for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].strike - spot) < Math.abs(rows[ci].strike - spot)) ci = i;
  const half = Math.floor(maxRows / 2);
  const visible = rows.slice(Math.max(0, ci - half), Math.min(rows.length, ci + half + 1));
  const maxAbs = Math.max(...visible.map((x) => Math.abs(x.net)), 1e-9);
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, opacity: 0.55, marginBottom: 6, fontWeight: 600, letterSpacing: 0.4 }}>
        <span style={{ color: LEVEL_COLORS.down }}>− 空 Gamma（追價）</span>
        <span>履約價 · 淨 GEX / 1%</span>
        <span style={{ color: LEVEL_COLORS.up }}>+ 多 Gamma（壓抑）</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visible.map((x) => {
          const w = (Math.abs(x.net) / maxAbs) * 100;
          const pos = x.net >= 0;
          const isCW = G.callWall && x.strike === G.callWall.strike, isPW = G.putWall && x.strike === G.putWall.strike;
          const atm = x.strike === rows[ci].strike;
          return (
            <div key={x.strike} title={`${x.strike} · Call ${fmtBig(x.call, P)} · Put ${fmtBig(x.put, P)} · IV ${x.iv.toFixed(1)}%`}
              style={{ display: 'grid', gridTemplateColumns: '1fr 56px 1fr', alignItems: 'center', gap: 6, height: 16, borderRadius: atm ? 4 : 0,
                background: atm ? 'rgba(240,192,104,0.08)' : 'transparent', border: atm ? '1px solid rgba(240,192,104,0.25)' : '1px solid transparent' }}>
              <div style={{ position: 'relative', height: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
                {!pos && <span className="tnum" style={{ fontSize: 9, color: isPW ? LEVEL_COLORS.down : txt, fontWeight: isPW ? 700 : 500, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtBig(x.net, P)}</span>}
                {!pos && <div style={{ width: `${w * 0.7}%`, height: 8, borderRadius: '4px 0 0 4px', background: isPW ? LEVEL_COLORS.down : `linear-gradient(270deg, ${LEVEL_COLORS.down}cc, ${LEVEL_COLORS.down}55)` }} />}
              </div>
              <div className="tnum" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textAlign: 'center', fontWeight: (atm || isCW || isPW) ? 700 : 500,
                color: atm ? '#f7d394' : isCW ? LEVEL_COLORS.up : isPW ? LEVEL_COLORS.down : 'inherit' }}>{x.strike}</div>
              <div style={{ position: 'relative', height: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                {pos && <div style={{ width: `${w * 0.7}%`, height: 8, borderRadius: '0 4px 4px 0', background: isCW ? LEVEL_COLORS.up : `linear-gradient(90deg, ${LEVEL_COLORS.up}cc, ${LEVEL_COLORS.up}55)` }} />}
                {pos && <span className="tnum" style={{ fontSize: 9, color: isCW ? LEVEL_COLORS.up : txt, fontWeight: isCW ? 700 : 500, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtBig(x.net, P)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 關卡價 — the range-derived targets of 自由人's 多空指南針 (一壘 / 二壘 /
// 三壘 / 全壘 / 場外, above and below). His public description: the app
// "tracks daily volume and range, takes the largest and smallest range of the
// last month, and derives the day's target levels" (CMoney product page).
// What we could verify against TAIFEX history (docs/daytrade-redesign.md §6):
//   一壘 below = today's high − the smallest daily range (day session) of the
//   previous ~20 sessions. Exact on both dated screenshots (2023/06/09: 16888 −
//   67 = 16821; 2024/08/28: 22211 − 170 = 22041); window anywhere in 14–26
//   sessions reproduces them, 20 = "一個月".
// The other four distances are this site's definition, chosen to match the one
// screenshot that shows all five within a point where a natural statistic
// does: 二壘 = 30th percentile (his own statistic: "二壘打出現的機率大約是
// 70%"), 三壘 = mean (124 vs his 124), 全壘 = mean + 1σ (164 vs his 164),
// 場外 = the largest range (244 vs his 260 — not his formula). Above-levels
// mirror below: today's low + the same distances.
// bars: daily OHLC in time order; today: { date, high, low } from the live
// quote when the session is running, else the last completed bar stands in.
const RANGE_LEVEL_N = 20;
const RANGE_LEVEL_NAMES = ['一壘', '二壘', '三壘', '全壘', '場外'];
function computeRangeLevels({ bars, today, N = RANGE_LEVEL_N }) {
  if (!bars || bars.length < N + 1) return null;
  const last = bars[bars.length - 1];
  // A bar dated today is the running session: its own range is not history.
  const lastIsToday = !!(today && today.date && String(last.t).slice(0, 8) === today.date);
  const hist = lastIsToday ? bars.slice(0, -1) : bars;
  if (hist.length < N) return null;
  const win = hist.slice(-N);
  const ranges = win.map((b) => b.h - b.l).filter((r) => Number.isFinite(r) && r > 0);
  if (ranges.length < N) return null;
  const sorted = [...ranges].sort((a, b) => a - b);
  const mean = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const sd = Math.sqrt(ranges.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ranges.length);
  const pct = (q) => { const pos = q * (sorted.length - 1), i = Math.floor(pos); return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (pos - i); };
  const dists = [sorted[0], pct(0.3), mean, mean + sd, sorted[sorted.length - 1]].map((d) => Math.round(d));
  // Base: the running session's high / low when we have it, else the last bar.
  const base = (today && today.high > 0 && today.low > 0)
    ? { high: today.high, low: today.low, date: today.date, running: true }
    : { high: last.h, low: last.l, date: String(last.t).slice(0, 8), running: lastIsToday };
  const up = dists.map((d, i) => ({ name: RANGE_LEVEL_NAMES[i], dist: d, price: base.low + d }));
  const down = dists.map((d, i) => ({ name: RANGE_LEVEL_NAMES[i], dist: d, price: base.high - d }));
  return { base, up, down, n: ranges.length, min: sorted[0], max: sorted[sorted.length - 1], mean, sd, from: String(win[0].t).slice(0, 8), to: String(win[win.length - 1].t).slice(0, 8) };
}

// 關鍵價位 — this site's own level set, each with the rate at which the
// exchange's own history reached it (no formula is taken on faith):
//   樞軸 (floor-trader pivots from the previous session's H / L / C):
//     P = (H+L+C)/3, R1 = 2P−L, S1 = 2P−H, R2 = P+(H−L), S2 = P−(H−L),
//     R3 = H+2(P−L), S3 = L−2(H−P)   (Person, A Complete Guide to Technical
//     Trading Tactics, 2004 — the CME floor convention)
//   前日高 / 前日低 / 前日收
// Hit rate = share of past sessions whose high reached the level (above) or
// whose low reached it (below), the level being recomputed from each
// session's predecessor; for P and 前日收, share of sessions whose range
// contained it. Sample = every completed session in the loaded daily bars.
// Volume-profile levels (POC / value area / VWAP) come from the previous
// session's ticks (server, `intraday.day.profile`) and carry no rate: only
// ~two weeks of tick files exist.
function computeKeyLevels({ bars, today, profile }) {
  if (!bars || bars.length < 3) return null;
  const last = bars[bars.length - 1];
  const lastIsToday = !!(today && String(last.t).slice(0, 8) === today);
  const hist = lastIsToday ? bars.slice(0, -1) : bars;
  if (hist.length < 3) return null;
  const pivots = (b) => {
    const P = (b.h + b.l + b.c) / 3, rng = b.h - b.l;
    return { P, R1: 2 * P - b.l, S1: 2 * P - b.h, R2: P + rng, S2: P - rng, R3: b.h + 2 * (P - b.l), S3: b.l - 2 * (b.h - P), PDH: b.h, PDL: b.l, PDC: b.c };
  };
  const keys = ['P', 'R1', 'R2', 'R3', 'S1', 'S2', 'S3', 'PDH', 'PDL', 'PDC'];
  const hits = {}; keys.forEach((k) => { hits[k] = 0; });
  let n = 0;
  for (let i = 1; i < hist.length; i++) {
    const lv = pivots(hist[i - 1]), t = hist[i];
    n++;
    if (t.l <= lv.P && lv.P <= t.h) hits.P++;
    if (t.l <= lv.PDC && lv.PDC <= t.h) hits.PDC++;
    ['R1', 'R2', 'R3', 'PDH'].forEach((k) => { if (t.h >= lv[k]) hits[k]++; });
    ['S1', 'S2', 'S3', 'PDL'].forEach((k) => { if (t.l <= lv[k]) hits[k]++; });
  }
  const prev = hist[hist.length - 1];
  const lv = pivots(prev);
  const NAMES = { P: '軸心', R1: '壓力一', R2: '壓力二', R3: '壓力三', S1: '支撐一', S2: '支撐二', S3: '支撐三', PDH: '前日高', PDL: '前日低', PDC: '前日收' };
  const levels = keys.map((k) => ({ key: k, name: NAMES[k], price: Math.round(lv[k]), hit: n ? hits[k] / n : null, group: 'pivot' }));
  if (profile) {
    levels.push({ key: 'POC', name: '前日量價中心', price: profile.poc, hit: null, group: 'profile' });
    levels.push({ key: 'VAH', name: '價值區上緣', price: profile.vah, hit: null, group: 'profile' });
    levels.push({ key: 'VAL', name: '價值區下緣', price: profile.val, hit: null, group: 'profile' });
    levels.push({ key: 'VWAP', name: '前日均價', price: Math.round(profile.vwap), hit: null, group: 'profile' });
  }
  return { levels, n, prevDate: String(prev.t).slice(0, 8), prev: { h: prev.h, l: prev.l, c: prev.c } };
}

// The list in price order with spot in the middle, a hit-rate bar per row.
function KeyLevelsPanel({ K, P, spot, light = false }) {
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  if (!K) return <div className="mono" style={{ fontSize: 11, color: dim }}>日K不足，無法計算。</div>;
  const fmtP = (v) => v.toLocaleString(undefined, { maximumFractionDigits: P.eighth ? 3 : P.strikeStep < 10 ? 2 : 0 });
  const rows = [...K.levels, { key: 'SPOT', name: `現價 ${P.code}`, price: spot, hit: null, group: 'spot' }].sort((a, b) => b.price - a.price);
  const col = (r) => r.group === 'spot' ? LEVEL_COLORS.spot : r.group === 'profile' ? LEVEL_COLORS.band : r.price > spot ? LEVEL_COLORS.up : r.price < spot ? LEVEL_COLORS.down : 'var(--text)';
  return (
    <div>
      <div className="mono tnum" style={{ fontSize: 9.5, color: dim, marginBottom: 6 }}>
        前日 {K.prevDate.slice(4, 6)}/{K.prevDate.slice(6)} 高 {fmtP(K.prev.h)} 低 {fmtP(K.prev.l)} 收 {fmtP(K.prev.c)} · 觸及率＝過去 {K.n} 個交易日中，隔日高／低碰到該價位的比例
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r) => {
          const d = r.price - spot;
          const isSpot = r.group === 'spot';
          return (
            <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto 74px', gap: 8, alignItems: 'center', padding: '3px 8px',
              background: isSpot ? 'rgba(240,192,104,0.08)' : 'transparent', border: `1px solid ${isSpot ? 'rgba(240,192,104,0.45)' : 'transparent'}` }}>
              <span style={{ fontSize: 11, fontWeight: isSpot ? 700 : 600, color: col(r), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span className="tnum" style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: col(r) }}>{fmtP(r.price)}</span>
              <span className="tnum" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: dim, whiteSpace: 'nowrap' }}>{isSpot ? '—' : `${d >= 0 ? '+' : '−'}${fmtP(Math.abs(d))}`}</span>
              <span className="tnum" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: dim, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                {r.hit != null ? (<>
                  <span style={{ width: 36, height: 5, background: 'var(--border)', position: 'relative' }}><span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(r.hit * 100)}%`, background: col(r) }} /></span>
                  {Math.round(r.hit * 100)}%
                </>) : (r.group === 'profile' ? '成交量分布' : '')}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mono" style={{ marginTop: 8, fontSize: 9.5, color: dim, lineHeight: 1.5 }}>
        樞軸＝場內交易員慣用公式（Person 2004）：軸心 (高+低+收)÷3、壓力一 2×軸心−低、支撐一 2×軸心−高、壓力／支撐二 軸心±(高−低)、三 高+2(軸心−低)／低−2(高−軸心)。量價中心／價值區＝前一日成交量分布（Market Profile，Steidlmayer 1986）：最大量價位與涵蓋七成成交量的價帶；前日均價＝成交量加權均價。觸及率是本站用期交所日K實算，不是他人宣稱。
      </div>
    </div>
  );
}

// Today's date in Taiwan (YYYYMMDD) — bars are stamped in exchange time.
function taipeiDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

// The two lists side by side, 場外 at the far ends and 一壘 nearest the base
// row in the middle — read it like a ladder. The next unreached level on
// each side is highlighted; reached ones dim.
function RangeLevelsPanel({ P, spot, R, light, sourceLabel }) {
  const fmtP = (v) => v.toLocaleString(undefined, { maximumFractionDigits: P.eighth ? 3 : P.strikeStep < 10 ? 2 : 0 });
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const line = light ? 'rgba(25,40,70,0.18)' : 'rgba(255,255,255,0.12)';
  if (!R) return <div className="mono" style={{ fontSize: 11, color: dim, padding: '6px 0' }}>需要 {RANGE_LEVEL_N + 1} 根以上的日K才能計算。</div>;
  const nextUp = R.up.find((l) => l.price > spot);
  const nextDown = [...R.down].find((l) => l.price < spot);
  const Row = ({ l, side, hot }) => {
    const reached = side === 'up' ? spot >= l.price : spot <= l.price;
    const col = side === 'up' ? LEVEL_COLORS.up : LEVEL_COLORS.down;
    const d = l.price - spot;
    return (
      <div title={`振幅 ${fmtP(l.dist)} 點`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 6, alignItems: 'baseline', padding: '4px 8px', borderRadius: 0, opacity: reached ? 0.45 : 1, whiteSpace: 'nowrap',
        background: hot ? (side === 'up' ? 'rgba(239,83,80,0.10)' : 'rgba(38,166,154,0.10)') : 'transparent', border: `1px solid ${hot ? col : 'transparent'}` }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: col }}>{l.name}</span>
        <span className="tnum" style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: reached ? dim : 'inherit' }}>{fmtP(l.price)}</span>
        <span className="tnum" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: dim }}>{`${d >= 0 ? '+' : '−'}${fmtP(Math.abs(d))}`}</span>
      </div>
    );
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: LEVEL_COLORS.up, margin: '0 8px 4px', whiteSpace: 'nowrap' }}>上方關卡價<div className="tnum" style={{ color: dim, fontWeight: 500, fontSize: 9.5 }}>{R.base.running ? '今' : '前'}低 {fmtP(R.base.low)} ＋ 振幅</div></div>
          {[...R.up].reverse().map((l) => <Row key={l.name} l={l} side="up" hot={nextUp && nextUp.name === l.name} />)}
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: LEVEL_COLORS.down, margin: '0 8px 4px', whiteSpace: 'nowrap' }}>下方關卡價<div className="tnum" style={{ color: dim, fontWeight: 500, fontSize: 9.5 }}>{R.base.running ? '今' : '前'}高 {fmtP(R.base.high)} － 振幅</div></div>
          {R.down.map((l) => <Row key={l.name} l={l} side="down" hot={nextDown && nextDown.name === l.name} />)}
        </div>
      </div>
      <div className="mono tnum" style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${line}`, fontSize: 9.5, color: dim, display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
        <span>近{R.n}日日盤振幅：最小 {fmtP(R.min)} · 三成分位 {fmtP(R.up[1].dist)} · 平均 {fmtP(Math.round(R.mean))} · 平均＋1σ {fmtP(R.up[3].dist)} · 最大 {fmtP(R.max)}</span>
        <span>{R.from.slice(4, 6)}/{R.from.slice(6)}–{R.to.slice(4, 6)}/{R.to.slice(6)} · {sourceLabel}</span>
        <span>一壘＝驗證自由人公式；其餘為本站統計定義</span>
      </div>
    </div>
  );
}


// Signed change, Taiwan colors (up = red, down = teal). fmt formats the magnitude.
function Chg({ v, fmt = (x) => x.toLocaleString(), suffix = '' }) {
  if (v == null || !Number.isFinite(v)) return null;
  const c = v > 0 ? LEVEL_COLORS.up : v < 0 ? LEVEL_COLORS.down : 'inherit';
  return <span style={{ color: c, fontWeight: 600 }}>{v > 0 ? '▲' : v < 0 ? '▼' : '—'}{fmt(Math.abs(v))}{suffix}</span>;
}

// 23-session sparkline for the put/call ratio: area fill, faint 1.0 line, emphasized last point.
function Spark({ series, w = 96, h = 30, light = false }) {
  if (!series || series.length < 2) return null;
  const vs = series.map((p) => p.ratio);
  const lo = Math.min(...vs, 1), hi = Math.max(...vs, 1);
  const x = (i) => (i / (vs.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - lo) / Math.max(hi - lo, 1e-9)) * (h - 6);
  const pts = vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = vs[vs.length - 1];
  const col = last >= 1 ? LEVEL_COLORS.down : LEVEL_COLORS.up;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <line x1="2" x2={w - 2} y1={y(1)} y2={y(1)} stroke={light ? 'rgba(20,30,50,0.25)' : 'rgba(255,255,255,0.22)'} strokeDasharray="2 3" />
      <polygon points={`${x(0)},${h - 3} ${pts} ${x(vs.length - 1)},${h - 3}`} fill={col} fillOpacity="0.12" />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx={x(vs.length - 1)} cy={y(last)} r="2.4" fill={col} />
    </svg>
  );
}

// One number of the strip, the way a Taiwanese day-trading terminal shows it:
// a short Chinese label, one big tabular figure in the reading's color, one
// line of context underneath (change vs the previous session, source).
function LevelTile({ label, hk, value, sub, color, right, light }) {
  const HT = window.HelpTip;
  return (
    <Glass2 tone="chip" radius={0} padding="10px 12px" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.62, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {(hk && HT) ? <HT k={hk}>{label}</HT> : label}
        </div>
        <div className="tnum" style={{ fontSize: 21, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'inherit', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{value}</div>
        {sub && <div className="tnum" style={{ fontSize: 10.5, marginTop: 4, opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)' }}>{sub}</div>}
      </div>
      {right}
    </Glass2>
  );
}

// The ladder: rows in price order, evenly spaced (a true price scale would
// squash the straddle band when a wall sits thousands of points away — the
// K-line beside it carries the real scale). Each row: price, what it is,
// distance from spot.
function LevelsLadder({ P, spot, L, G, costLine = null, light }) {
  const fmtP = (v) => v.toLocaleString(undefined, { maximumFractionDigits: P.eighth ? 3 : P.strikeStep < 10 ? 2 : 0 });
  const chg = (v) => (v == null ? '' : `（${v > 0 ? '+' : ''}${v.toLocaleString()}）`);
  const rows = [];
  if (L.resistance) rows.push({ price: L.resistance.strike, label: '壓力', detail: `Call OI 最大 ${L.resistance.oi.toLocaleString()}${chg(L.resistance.oiChg)}`, color: LEVEL_COLORS.up });
  if (L.straddle != null) {
    rows.push({ price: L.atm.strike + L.straddle, label: '價平＋價平和', detail: `${fmtP(L.atm.strike)} + ${window.fmtPx(L.straddle, P)}`, color: LEVEL_COLORS.band });
    rows.push({ price: L.atm.strike - L.straddle, label: '價平－價平和', detail: `${fmtP(L.atm.strike)} − ${window.fmtPx(L.straddle, P)}`, color: LEVEL_COLORS.band });
  }
  rows.push({ price: spot, label: `現價 ${P.code}`, detail: L.straddle != null ? `價平和 ${window.fmtPx(L.straddle, P)} · 價平 ${fmtP(L.atm.strike)}` : '沒有價平權利金', color: LEVEL_COLORS.spot, isSpot: true });
  if (L.support) rows.push({ price: L.support.strike, label: '支撐', detail: `Put OI 最大 ${L.support.oi.toLocaleString()}${chg(L.support.oiChg)}`, color: LEVEL_COLORS.down });
  if (L.maxPain) rows.push({ price: L.maxPain.strike, label: '最大痛苦點', detail: '買方到期損失最大的結算價', color: LEVEL_COLORS.gex });
  if (costLine != null) rows.push({ price: costLine.price, label: '成本線', detail: `（${costLine.running ? '今' : '前'}高 + 低）÷ 2 · 上多下空`, color: LEVEL_COLORS.spot });
  if (G) {
    if (G.callWall && G.callWall.call > 0) rows.push({ price: G.callWall.strike, label: 'Call Gamma 牆', detail: `Call γ·OI 最大 ${fmtBig(G.callWall.call, P)}/1%`, color: LEVEL_COLORS.gex });
    if (G.putWall && G.putWall.put < 0) rows.push({ price: G.putWall.strike, label: 'Put Gamma 牆', detail: `Put γ·OI 最大 ${fmtBig(G.putWall.put, P)}/1%`, color: LEVEL_COLORS.gex });
    if (G.flip != null) rows.push({ price: G.flip, label: '零 Gamma 翻轉', detail: `以上造市者多 Gamma、以下空 Gamma · 總 GEX ${fmtBig(G.total, P)}`, color: LEVEL_COLORS.gex });
  }
  rows.sort((a, b) => b.price - a.price);
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const line = light ? 'rgba(25,40,70,0.18)' : 'rgba(255,255,255,0.12)';
  return (
    <div style={{ position: 'relative', paddingLeft: 18 }}>
      <div aria-hidden style={{ position: 'absolute', left: 5, top: 10, bottom: 10, width: 2, background: line, borderRadius: 1 }} />
      {rows.map((r, i) => {
        const d = r.price - spot;
        const pct = spot > 0 ? (d / spot) * 100 : 0;
        return (
          <div key={i} style={{
            position: 'relative', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center',
            padding: r.isSpot ? '9px 10px' : '8px 10px', marginBottom: 6, borderRadius: 0,
            background: r.isSpot ? 'rgba(240,192,104,0.08)' : 'var(--panel2)',
            border: `1px solid ${r.isSpot ? 'rgba(240,192,104,0.45)' : 'var(--border)'}`,
          }}>
            <span aria-hidden style={{ position: 'absolute', left: -18, top: '50%', width: 10, height: 10, marginTop: -5, borderRadius: 5, background: r.color }} />
            <span className="tnum" style={{ fontSize: r.isSpot ? 20 : 17, fontWeight: 700, fontFamily: 'var(--font-mono)', color: r.color, minWidth: 82 }}>{fmtP(r.price)}</span>
            <span style={{ display: 'block', minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
              <div className="tnum" style={{ fontSize: 10.5, color: dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)' }}>{r.detail}</div>
            </span>
            <span className="tnum" style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', whiteSpace: 'nowrap', color: r.isSpot ? dim : (d >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down) }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{r.isSpot ? '—' : `${d >= 0 ? '+' : '−'}${fmtP(Math.abs(d))}`}</div>
              {!r.isSpot && <div style={{ fontSize: 9.5, opacity: 0.75 }}>{`${d >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`}</div>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// 當日走勢 — the 多空指南針 main screen in one panel: 1-minute closes with
// the 成本線 stepping on every new session high / low ((high + low) / 2),
// the open line, and below it the 多空差額 (running 外盤 − 內盤) with each
// minute's net as bars. Data: Shioaji ticks (real tick_type) when a session
// is connected, otherwise TAIFEX's daily tick file with the tick rule — the
// header says which. 日盤 / 夜盤 toggle when the file carries both.
// 1-minute rows → N-minute rows: OHLC, lots summed, cost = the period's last
// running value, net summed, cum = the period's last running total.
function aggMinutes(bars, freq) {
  if (!freq || freq <= 1 || !bars || !bars.length) return bars;
  const toMin = (hhmm) => (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(2));
  const start = toMin(bars[0][0]);
  const out = [];
  let cur = null, curKey = null;
  for (const b of bars) {
    let m = toMin(b[0]) - start;
    if (m < 0) m += 1440; // a night session crosses midnight
    const k = Math.floor(m / freq);
    if (cur && k === curKey) { cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.min(cur[3], b[3]); cur[4] = b[4]; cur[5] += b[5]; cur[6] = b[6]; cur[7] += b[7]; cur[8] = b[8]; }
    else { cur = [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]]; curKey = k; out.push(cur); }
  }
  return out;
}
const INTRADAY_FREQS = [1, 5, 15, 30, 60];
function IntradayPanel({ I, P, light = false }) {
  const [sess, setSess] = React.useState('day');
  const [freq, setFreq] = React.useState(1);
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  if (!I || !I.day || !I.day.bars || !I.day.bars.length) return <div className="mono" style={{ fontSize: 11, color: dim }}>沒有逐筆資料（期交所逐筆檔或永豐逐筆）。</div>;
  const S = (sess === 'night' && I.night && I.night.bars && I.night.bars.length) ? I.night : I.day;
  const bars = aggMinutes(S.bars, freq);
  const fmtP = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const W = 760, H = 250, pTop = 10, pBot = 144, fTop = 174, fBot = 240, padR = 58, plotW = W - padR;
  const n = bars.length;
  const x = (i) => (i + 0.5) * (plotW / n);
  const pMin = Math.min(...bars.map((b) => b[3])), pMax = Math.max(...bars.map((b) => b[2]));
  const y = (p) => pTop + ((pMax - p) / Math.max(pMax - pMin, 1)) * (pBot - pTop);
  const cums = bars.map((b) => b[8]); const nets = bars.map((b) => b[7]);
  const fMin = Math.min(0, ...cums), fMax = Math.max(0, ...cums);
  const fy = (v) => fTop + ((fMax - v) / Math.max(fMax - fMin, 1)) * (fBot - fTop);
  const netMax = Math.max(...nets.map(Math.abs), 1);
  const last = bars[n - 1];
  const open = bars[0][1];
  const closeCol = last[4] >= open ? LEVEL_COLORS.up : LEVEL_COLORS.down;
  const cumCol = last[8] >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down;
  const closePts = bars.map((b, i) => `${x(i).toFixed(1)},${y(b[4]).toFixed(1)}`).join(' ');
  // cost line as steps: horizontal at the minute's value, vertical at changes
  let costPath = '';
  bars.forEach((b, i) => { const X0 = (i * plotW / n).toFixed(1), X1 = ((i + 1) * plotW / n).toFixed(1), Y = y(b[6]).toFixed(1); costPath += (i === 0 ? `M${X0},${Y}` : ` L${X0},${Y}`) + ` L${X1},${Y}`; });
  const cumPts = bars.map((b, i) => `${x(i).toFixed(1)},${fy(b[8]).toFixed(1)}`).join(' ');
  const txt = dim, grid = light ? 'rgba(20,30,50,0.12)' : 'rgba(255,255,255,0.10)';
  const ticks = [];
  for (let i = 0; i < n; i++) if (i === 0 || bars[i][0].slice(0, 2) !== bars[i - 1][0].slice(0, 2)) ticks.push(i);
  const tag = (Y, label, col) => (<g><rect x={plotW + 2} y={Y - 6.5} width={54} height={13} fill={col} /><text x={plotW + 29} y={Y + 3} fontSize="9" fontWeight="700" fill="#fff" textAnchor="middle">{label}</text></g>);
  return (
    <div>
      <div className="mono tnum" style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, marginBottom: 4, flexWrap: 'wrap' }}>
        <span>成交價 <b style={{ color: closeCol, fontSize: 14 }}>{fmtP(last[4])}</b> <Chg v={last[4] - open} fmt={fmtP} /> <span style={{ color: dim }}>對開盤</span></span>
        <span>成本價 <b style={{ color: LEVEL_COLORS.spot, fontSize: 14 }}>{fmtP(Math.floor(S.cost + 0.5))}</b> <span style={{ color: dim }}>高 {fmtP(S.high)} 低 {fmtP(S.low)}</span></span>
        <span>多空差額 <b style={{ color: cumCol, fontSize: 14 }}>{last[8] > 0 ? '+' : ''}{last[8].toLocaleString()}</b> <span style={{ color: dim }}>外 {S.buy.toLocaleString()} 內 {S.sell.toLocaleString()}</span></span>
        <span style={{ color: dim }}>{freq === 1 ? '本分鐘' : `本 ${freq} 分`}淨量 <Chg v={last[7]} /></span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <Seg items={INTRADAY_FREQS.map((f) => ({ id: f, label: `${f}分` }))} value={freq} onChange={setFreq} />
          {I.night && I.night.bars && I.night.bars.length > 0 && <Seg items={[{ id: 'day', label: '日盤' }, { id: 'night', label: '夜盤' }]} value={sess} onChange={setSess} />}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', fontFamily: 'var(--font-mono)' }}>
        {[0.2, 0.5, 0.8].map((f, i) => { const p = pMin + f * (pMax - pMin); return <g key={i}><line x1="0" x2={plotW} y1={y(p)} y2={y(p)} stroke={grid} strokeDasharray="2 4" /><text x={plotW + 6} y={y(p) + 3} fontSize="9" fill={txt}>{fmtP(p)}</text></g>; })}
        {ticks.map((i) => <text key={i} x={x(i)} y={pBot + 10} fontSize="8.5" fill={txt} textAnchor="middle">{bars[i][0].slice(0, 2)}:{bars[i][0].slice(2)}</text>)}
        <line x1="0" x2={plotW} y1={y(open)} y2={y(open)} stroke={txt} strokeWidth="0.8" strokeDasharray="4 3" />
        <text x="3" y={y(open) - 3} fontSize="8.5" fill={txt}>開 {fmtP(open)}</text>
        {freq === 1
          ? <polyline points={closePts} fill="none" stroke={closeCol} strokeWidth="1.3" strokeLinejoin="round" />
          : bars.map((b, i) => { const up = b[4] >= b[1], col = up ? LEVEL_COLORS.up : LEVEL_COLORS.down, bw = Math.max(1.5, (plotW / n) * 0.6); return <g key={i}><line x1={x(i)} x2={x(i)} y1={y(b[2])} y2={y(b[3])} stroke={col} strokeWidth="1" /><rect x={x(i) - bw / 2} y={y(Math.max(b[1], b[4]))} width={bw} height={Math.max(1, Math.abs(y(b[1]) - y(b[4])))} fill={col} /></g>; })}
        <path d={costPath} fill="none" stroke={LEVEL_COLORS.spot} strokeWidth="1.5" />
        {tag(y(last[4]), fmtP(last[4]), closeCol)}
        {Math.abs(y(S.cost) - y(last[4])) > 13 && tag(y(S.cost), `成${fmtP(Math.floor(S.cost + 0.5))}`, LEVEL_COLORS.spot)}
        <text x="3" y={fTop - 5} fontSize="9" fontWeight="600" fill={txt}>多空差額（累計 外盤－內盤）</text>
        <line x1="0" x2={plotW} y1={fy(0)} y2={fy(0)} stroke={grid} />
        {bars.map((b, i) => { const h = Math.abs(b[7]) / netMax * 22; return <rect key={i} x={x(i) - (plotW / n) * 0.35} y={b[7] >= 0 ? fy(0) - h : fy(0)} width={(plotW / n) * 0.7} height={Math.max(h, 0.4)} fill={b[7] >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down} fillOpacity="0.55" />; })}
        <polyline points={cumPts} fill="none" stroke={LEVEL_COLORS.spot} strokeWidth="1.4" strokeLinejoin="round" />
        {Math.abs(fy(fMax) - fy(last[8])) > 12 && <text x={plotW + 6} y={fy(fMax) + 3} fontSize="9" fill={txt}>{fMax.toLocaleString()}</text>}
        {Math.abs(fy(fMin) - fy(last[8])) > 12 && <text x={plotW + 6} y={fy(fMin) + 3} fontSize="9" fill={txt}>{fMin.toLocaleString()}</text>}
        {tag(fy(last[8]), `${last[8] > 0 ? '+' : ''}${last[8].toLocaleString()}`, cumCol)}
      </svg>
      <div className="mono" style={{ marginTop: 6, fontSize: 9.5, color: dim }}>
        成本線＝（當節最高＋最低）÷2，自由人公式，逢新高新低才移動 · 多空差額＝每分鐘（外盤量－內盤量）累計{I.flow === 'tick-type' ? '，內外盤依交易所成交別' : '，此處以 tick rule（上漲成交＝外盤、下跌＝內盤）近似，非交易所內外盤'}
      </div>
    </div>
  );
}

// 權值股 TOP20 — the 多空指南針 "權值股 TOP20 日K型態圖" read: the twenty
// largest TAIEX constituents by index weight (TAIFEX's monthly 成分股暨市值比重
// table) with the previous session's move from TWSE's daily closing table.
// One bar per stock, red up / teal down, weight underneath; the header sums
// how many rose and the weight they carry.
function Top20Panel({ T, light = false }) {
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  if (!T || !T.rows || !T.rows.length) return <div className="mono" style={{ fontSize: 11, color: dim }}>沒有權值股資料（需要期交所權重表與證交所日行情）。</div>;
  const rows = T.rows.slice(0, 20);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.chgPct || 0)), 0.5);
  const up = rows.filter((r) => r.chgPct > 0).length, down = rows.filter((r) => r.chgPct < 0).length;
  const wUp = rows.filter((r) => r.chgPct > 0).reduce((a, r) => a + r.weight, 0);
  const wAll = rows.reduce((a, r) => a + r.weight, 0);
  const H = 110, mid = 52;
  return (
    <div>
      <div className="mono tnum" style={{ display: 'flex', gap: 14, fontSize: 10.5, color: dim, marginBottom: 6, flexWrap: 'wrap' }}>
        <span>上漲 <b style={{ color: LEVEL_COLORS.up }}>{up}</b> · 下跌 <b style={{ color: LEVEL_COLORS.down }}>{down}</b> · 平盤 {rows.length - up - down}</span>
        <span>上漲權重 {wUp.toFixed(1)}% / 前20合計 {wAll.toFixed(1)}%</span>
        <span>台積電 {rows[0] && rows[0].code === '2330' ? `${rows[0].chgPct >= 0 ? '+' : ''}${rows[0].chgPct.toFixed(2)}%` : '—'}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, gap: 3, alignItems: 'end' }}>
        {rows.map((r) => {
          const pct = r.chgPct || 0;
          const h = Math.max(2, Math.abs(pct) / maxAbs * (mid - 6));
          const col = pct > 0 ? LEVEL_COLORS.up : pct < 0 ? LEVEL_COLORS.down : dim;
          return (
            <div key={r.code} title={`${r.code} ${r.name} · 收 ${r.close} · ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% · 權重 ${r.weight.toFixed(2)}%`} style={{ minWidth: 0, textAlign: 'center' }}>
              <div className="tnum" style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: col, height: 12, lineHeight: '12px', whiteSpace: 'nowrap', overflow: 'hidden' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}</div>
              <div style={{ position: 'relative', height: H - 12 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: mid, height: 1, background: 'var(--border)' }} />
                <div style={{ position: 'absolute', left: '15%', right: '15%', height: h, background: col, top: pct >= 0 ? mid - h : mid + 1 }} />
              </div>
              <div style={{ fontSize: 10, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
              <div className="tnum" style={{ fontSize: 8.5, color: dim, fontFamily: 'var(--font-mono)' }}>{r.weight.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 盤前脈絡 — the overseas quotes a Taiwan day trader reads before 08:45. Rows
// follow the proxy's PREMARKET list; a row IB could not quote says so, and
// the ADR line is arithmetic on the rows (ADR × USD/TWD ÷ 5 shares).
const PREMARKET_ROWS = [
  { key: 'es', label: 'S&P 500 期指', dp: 2 },
  { key: 'nq', label: '那斯達克期指', dp: 2 },
  { key: 'sox', label: '費城半導體', dp: 1 },
  { key: 'vix', label: 'VIX 恐慌指數', dp: 2 },
  { key: 'tsm', label: '台積電 ADR (US$)', dp: 2 },
  { key: '2330', label: '台積電 (NT$)', dp: 0 },
  { key: 'usdtwd', label: '美元／台幣 (SGX 期貨)', dp: 3 },
];
const PREMARKET_STATUS = { 'no-data': '無報價', 'no-contract': '找不到合約' };
function PremarketPanel({ PM, light = false }) {
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  if (!PM || !PM.rows || !PM.rows.length) return <div className="mono" style={{ fontSize: 11, color: dim }}>沒有盤前資料（代理要連上 IB Gateway；部署站讀快照）。</div>;
  const by = {};
  PM.rows.forEach((r) => { by[r.key] = r; });
  const fmt = (v, dp) => (v == null ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const tsm = by.tsm, tw = by['2330'], fx = by.usdtwd;
  const implied = (tsm && tsm.last && fx && fx.last) ? tsm.last * fx.last / 5 : null;
  const prem = (implied && tw && tw.last) ? (implied / tw.last - 1) * 100 : null;
  const hhmm = (iso) => (iso ? iso.slice(5, 16).replace('T', ' ') : '');
  const mono = { fontFamily: 'var(--font-mono)', textAlign: 'right', whiteSpace: 'nowrap' };
  return (
    <div>
      {PREMARKET_ROWS.map((d) => {
        const r = by[d.key];
        const ok = !!(r && r.status === 'ok' && r.last != null);
        const tip = r ? `${r.localSymbol || r.symbol} · ${r.exchange}${ok ? ` · 高 ${fmt(r.high, d.dp)} · 低 ${fmt(r.low, d.dp)} · 前收 ${fmt(r.prevClose, d.dp)}` : ''}${r.time ? ` · ${hhmm(r.time)} UTC` : ''}` : '';
        return (
          <div key={d.key} title={tip} style={{ display: 'grid', gridTemplateColumns: '1fr auto 64px 72px', alignItems: 'baseline', gap: 8, fontSize: 11.5, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}<span className="mono" style={{ fontSize: 9, color: dim, marginLeft: 5 }}>{r && r.localSymbol ? r.localSymbol : ''}</span></span>
            <span className="tnum" style={{ ...mono, fontWeight: 700, fontSize: 13 }}>{ok ? fmt(r.last, d.dp) : '—'}</span>
            <span className="tnum" style={{ ...mono, fontSize: 10.5 }}>{ok ? <Chg v={r.chg} fmt={(x) => fmt(x, d.dp)} /> : <span style={{ color: dim }}>{r ? (PREMARKET_STATUS[r.status] || '無報價') : '未回報'}</span>}</span>
            <span className="tnum" style={{ ...mono, fontSize: 10.5 }}>{ok && r.chgPct != null ? <Chg v={r.chgPct} fmt={(x) => x.toFixed(2)} suffix="%" /> : ''}</span>
          </div>
        );
      })}
      <div className="mono tnum" style={{ marginTop: 8, fontSize: 10.5, color: dim, lineHeight: 1.5 }}>
        ADR 換算台股價 <b style={{ color: 'var(--text)' }}>{implied != null ? fmt(implied, 0) : '—'}</b>
        {prem != null ? <> · 對 2330 收盤 <Chg v={prem} fmt={(x) => x.toFixed(2)} suffix="%" /></> : ''}
        <span> · ADR × 匯率 ÷ 5（1 ADR = 5 股）</span>
      </div>
    </div>
  );
}

// 台股籌碼日報 — TWSE's after-close 三大法人 and margin tables, previous
// session. Money in 億 (NT$), lots in 張, the exchange's own row names.
const MARGIN_LABELS = { '融資(交易單位)': '融資餘額 (張)', '融券(交易單位)': '融券餘額 (張)', '融資金額(仟元)': '融資金額' };
function TwseFlowsPanel({ W, light = false }) {
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  if (!W || !W.institutional || !W.institutional.length) return <div className="mono" style={{ fontSize: 11, color: dim }}>沒有證交所籌碼資料。</div>;
  const yi = (v, dp = 1) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${(Math.abs(v) / 1e8).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}億`;
  const col = (v) => (v > 0 ? LEVEL_COLORS.up : v < 0 ? LEVEL_COLORS.down : 'inherit');
  const rows = W.institutional;
  const maxAbs = Math.max(...rows.filter((r) => r.name !== '合計').map((r) => Math.abs(r.net)), 1);
  const m = W.margin || {};
  const margin = Object.keys(m).map((k) => {
    const money = k.includes('金額');
    const d = m[k].today - m[k].prev;
    return { k, label: MARGIN_LABELS[k] || k, d,
      today: money ? `${Math.round(m[k].today * 1e3 / 1e8).toLocaleString()}億` : m[k].today.toLocaleString(),
      dText: money ? yi(d * 1e3) : `${d < 0 ? '−' : d > 0 ? '+' : ''}${Math.abs(d).toLocaleString()} 張` };
  });
  const cell = { fontFamily: 'var(--font-mono)', textAlign: 'right', whiteSpace: 'nowrap' };
  return (
    <div>
      <div className="mono" style={{ fontSize: 9.5, color: dim, marginBottom: 3 }}>三大法人買賣超（億元）</div>
      {rows.map((r) => {
        const total = r.name === '合計';
        const w = total ? 0 : Math.abs(r.net) / maxAbs * 50;
        return (
          <div key={r.name} title={`買進 ${(r.buy / 1e8).toFixed(1)}億 · 賣出 ${(r.sell / 1e8).toFixed(1)}億`} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 1fr', alignItems: 'center', gap: 8, fontSize: 11, padding: '2px 0', borderTop: total ? '1px solid var(--border)' : 'none', fontWeight: total ? 700 : 500 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
            <span className="tnum" style={{ ...cell, color: col(r.net), fontWeight: 700 }}>{yi(r.net)}</span>
            <div style={{ position: 'relative', height: 8 }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
              {!total && <div style={{ position: 'absolute', top: 1, bottom: 1, background: col(r.net), left: r.net >= 0 ? '50%' : `${50 - w}%`, width: `${w}%` }} />}
            </div>
          </div>
        );
      })}
      {margin.length > 0 && <>
        <div className="mono" style={{ fontSize: 9.5, color: dim, margin: '8px 0 3px' }}>融資融券餘額 · 較前日</div>
        {margin.map((x) => (
          <div key={x.k} style={{ display: 'grid', gridTemplateColumns: '1fr 92px 96px', gap: 8, fontSize: 11, padding: '2px 0' }}>
            <span>{x.label}</span>
            <span className="tnum" style={cell}>{x.today}</span>
            <span className="tnum" style={{ ...cell, color: col(x.d), fontWeight: 600 }}>{x.dText}</span>
          </div>
        ))}
      </>}
    </div>
  );
}

function LevelsWorkspace({ P, theme = 'dark', light = false, spot, expiry, levels: L, live, market: M, rangeLevels: R, dayBarsLive, gex: G, bars, barsLive, barPeriodId, setBarPeriodId, barSession, setBarSession, D, grid, top20: T, intraday: I, keyLevels: K, twse: W, premarket: PM }) {
  const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
  const fmtP = (v) => v.toLocaleString(undefined, { maximumFractionDigits: P.eighth ? 3 : P.strikeStep < 10 ? 2 : 0 });
  const chg = (v) => (v == null ? '' : `（${v > 0 ? '+' : ''}${v.toLocaleString()}）`);
  const isLive = !!(live && P.live);
  // What the OI numbers are: TAIFEX daily report (dated), the live chain, or mock.
  const oiLabel = L.oiSource === 'taifex' ? `● 期交所 ${L.oiDate}（前一交易日）`
    : isLive ? `● ${liveLabel(live, P)} 鏈上 OI（±8 檔）`
    : '○ 模擬資料';
  const straddleDelta = (L.straddle != null && L.prevStraddle != null) ? L.straddle - L.prevStraddle : null;
  const pcExpiry = L.totals.callOi > 0 ? L.totals.putOi / L.totals.callOi : null;
  const q = live && live.quote;
  const spotChg = (q && q.last > 0 && q.close > 0) ? q.last - q.close : null;
  // K-line overlays: the four option-derived levels (spot has its own tag).
  // Only the walls and 成本線 are drawn (plus the gold last price, which
  // PriceChart adds itself). Owner's call, 2026-09-14: eight lines buried the
  // candles and six of them sat within a few hundred points of spot. 價平±和
  // came off because the probability cone already draws that band and reads
  // better; 零Gamma because it rests on the dealer-inventory assumption rather
  // than on exchange data; 一壘 because the 關卡價 panel lists all of them.
  // Every one of these still has its own row in the ladder and its own panel.
  const chartLevels = [];
  if (L.resistance) chartLevels.push({ price: L.resistance.strike, label: '壓力 Call OI最大', color: LEVEL_COLORS.up });
  if (L.support) chartLevels.push({ price: L.support.strike, label: '支撐 Put OI最大', color: LEVEL_COLORS.down });
  // The nearer unreached 一壘 for the strip tile — his header's 「距一壘 … 差 N 點」.
  const near1B = (() => {
    if (!R) return null;
    const cands = [{ side: '上', price: R.up[0].price }, { side: '下', price: R.down[0].price }]
      .filter((c) => (c.side === '上' ? c.price > spot : c.price < spot));
    if (!cands.length) return null;
    return cands.reduce((a, b) => (Math.abs(a.price - spot) <= Math.abs(b.price - spot) ? a : b));
  })();
  const rangeSource = dayBarsLive ? `● ${liveLabel(live, P)} 日K` : '○ 模擬日K';
  // 成本線 (自由人): (session high + session low) / 2, rounded half up — steps
  // whenever the session prints a new high or low. Same base as 關卡價.
  const cost = R ? Math.floor((R.base.high + R.base.low) / 2 + 0.5) : null;
  if (cost != null) chartLevels.push({ price: cost, label: '成本', color: LEVEL_COLORS.spot });
  // OI table centered on the strike nearest spot, walls highlighted.
  let atmK = null;
  for (const r of L.oiRows) if (atmK == null || Math.abs(r.strike - spot) < Math.abs(atmK - spot)) atmK = r.strike;
  const oiRows = L.oiRows.map((r) => ({ ...r, atm: r.strike === atmK }));
  const walls = { call: L.resistance ? L.resistance.strike : null, put: L.support ? L.support.strike : null };
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const pc = M && M.pcRatio, fx = M && M.foreign, t10 = M && M.top10;
  const noMkt = isLive ? '期交所資料未載入' : '模擬模式沒有籌碼資料';
  const tiles = (<>
        <LevelTile label={`現價 ${P.code}`} value={fmtP(spot)} color={spotChg == null ? LEVEL_COLORS.spot : spotChg >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down}
          sub={spotChg != null ? <><Chg v={spotChg} fmt={(x) => fmtP(x)} /> {q.chgPct != null ? `（${q.chgPct >= 0 ? '+' : ''}${q.chgPct}%）` : ''}</> : (isLive ? liveLabel(live, P) : '模擬')} light={light} />
        <LevelTile label="價平和" hk="straddle" color={LEVEL_COLORS.band}
          value={L.straddle != null ? window.fmtPx(L.straddle, P) : '—'}
          sub={L.atm ? <>價平 {fmtP(L.atm.strike)}{straddleDelta != null ? <> · 流失 <Chg v={straddleDelta} fmt={(x) => window.fmtPx(x, P)} /></> : ''}</> : '沒有鏈資料'} light={light} />
        <LevelTile label="壓力" hk="resistance" color={LEVEL_COLORS.up}
          value={L.resistance ? fmtP(L.resistance.strike) : '—'}
          sub={L.resistance ? `Call OI ${L.resistance.oi.toLocaleString()}${chg(L.resistance.oiChg)}` : '沒有 OI'} light={light} />
        <LevelTile label="支撐" hk="support" color={LEVEL_COLORS.down}
          value={L.support ? fmtP(L.support.strike) : '—'}
          sub={L.support ? `Put OI ${L.support.oi.toLocaleString()}${chg(L.support.oiChg)}` : '沒有 OI'} light={light} />
        <LevelTile label="外資期貨淨部位" hk="foreign"
          value={fx ? `${fx.net > 0 ? '+' : ''}${fx.net.toLocaleString()}` : '—'}
          color={fx ? (fx.net >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down) : undefined}
          sub={fx ? <>較前日 <Chg v={fx.chg} /></> : noMkt} light={light} />
        <LevelTile label="十大交易人淨部位" hk="top10"
          value={t10 ? `${t10.net > 0 ? '+' : ''}${t10.net.toLocaleString()}` : '—'}
          color={t10 ? (t10.net >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down) : undefined}
          sub={t10 ? <>較前日 <Chg v={t10.chg} /></> : noMkt} light={light} />
        <LevelTile label="預期波動 ±1σ" hk="expmove" color={LEVEL_COLORS.band}
          value={L.sigma1 != null ? `±${fmtP(Math.round(L.sigma1))}` : '—'}
          sub={L.sigma1 != null ? <>{fmtP(Math.round(spot - L.sigma1))}–{fmtP(Math.round(spot + L.sigma1))} · IV {L.atmIv.toFixed(1)}% · {expiry.dte} 天{L.straddle != null ? ` · 價平和×0.85 ${window.fmtPx(L.straddle * 0.85, P)}` : ''}</> : '沒有 IV'} light={light} />
        <LevelTile label="成本價" hk="costline" color={LEVEL_COLORS.spot}
          value={cost != null ? fmtP(cost) : '—'}
          sub={R ? <>{R.base.running ? '今' : '前'}高 {fmtP(R.base.high)} ＋ 低 {fmtP(R.base.low)} ÷ 2 · 現價{spot >= cost ? '在上' : '在下'} <Chg v={spot - cost} fmt={(x) => fmtP(x)} /></> : '日K不足'} light={light} />
        <LevelTile label="距一壘" hk="rangelevels" color={LEVEL_COLORS.range}
          value={near1B ? fmtP(near1B.price) : '—'}
          sub={near1B ? <>{near1B.side}方一壘 · 差 <b>{fmtP(Math.abs(near1B.price - spot))}</b> 點</> : (R ? '兩側一壘皆已到達' : '日K不足')} light={light} />
        <LevelTile label="P/C 比（全市場）" hk="pcratio"
          value={pc ? pc.ratio.toFixed(2) : '—'}
          color={pc ? (pc.ratio >= 1 ? LEVEL_COLORS.down : LEVEL_COLORS.up) : undefined}
          sub={pc ? <>較前日 <Chg v={pc.chg} fmt={(x) => x.toFixed(2)} /></> : noMkt}
          right={pc ? <Spark series={pc.series} w={64} light={light} /> : null} light={light} />
  </>);
  const panels = [
    { i: 'strip', title: '關卡 · 籌碼', right: gridCap(`${isLive ? liveLabel(live, P) : '模擬'} · 籌碼為前一交易日`), pad: 8,
      body: <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>{tiles}</div> },
    { i: 'ladder', title: `關卡 · ${P.nameZh || P.name}`, right: gridCap(expCap(expiry)),
      body: (<>
        <LevelsLadder P={P} spot={spot} L={L} G={G} costLine={cost != null ? { price: cost, running: R.base.running } : null} light={light} />
        <div className="mono" style={{ marginTop: 8, fontSize: 9.5, color: dim, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>{oiLabel}</span>
          <span>權利金：{isLive ? `● ${liveLabel(live, P)}` : '○ 模擬'}</span>
        </div>
      </>) },
    { i: 'range', title: '關卡價 · 振幅', hk: 'rangelevels', right: gridCap(`近${RANGE_LEVEL_N}日振幅`),
      body: <RangeLevelsPanel P={P} spot={spot} R={R} light={light} sourceLabel={rangeSource} /> },
    { i: 'keylevels', title: '關鍵價位 · 歷史觸及率', hk: 'keylevels', right: gridCap(K ? `樣本 ${K.n} 日 · ${rangeSource}` : ''),
      body: <KeyLevelsPanel K={K} P={P} spot={spot} light={light} /> },
    { i: 'kline', title: <>台指期 {barSession === 'full' ? '全日盤' : '日盤'} {per.label}K · 關卡價位<span style={{ color: 'var(--text2)', fontWeight: 500, marginLeft: 4 }}>· {barsLive ? liveLabel(live, P) : '模擬'}</span></>,
      right: <div style={{ display: 'flex', gap: 8 }}><KSessionToggle value={barSession} onChange={setBarSession} /><KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} /></div>,
      body: <PriceChart bars={bars} theme={theme} code={P.code} periodLabel={`${per.label}K`} levels={chartLevels}
              cone={L.atmIv ? { ivPct: L.atmIv, days: expiry.dte, label: expiry.label } : null} /> },
    { i: 'oi', title: '各履約價未平倉 · 對前日增減', hk: 'oichg', right: gridCap(`${pcExpiry != null ? `本到期日 P/C ${pcExpiry.toFixed(2)} · ` : ''}${oiLabel}`),
      body: <OIProfile spot={spot} contract={expiry.type} rows={oiRows} theme={theme} maxRows={15} showChange walls={walls} /> },
    { i: 'intraday', title: <>{I && I.night ? '' : ''}當日走勢 · 成本線 · 多空差額</>, hk: 'intraday',
      right: gridCap(I ? `${I.flow === 'tick-type' ? '永豐逐筆 · 內外盤' : '期交所逐筆 · tick rule 近似內外盤'} · ${I.date.slice(4, 6)}/${I.date.slice(6)} ${I.month}` : ''),
      body: <IntradayPanel I={I} P={P} light={light} /> },
    { i: 'top20', title: '權值股 TOP20 · 當日漲跌', hk: 'top20',
      right: gridCap(T ? `權重 期交所 ${T.weightsDate} · 行情 證交所 ${T.date.slice(0, 4)}/${T.date.slice(4, 6)}/${T.date.slice(6)}` : ''),
      body: <Top20Panel T={T} light={light} /> },
    { i: 'premarket', title: '盤前脈絡 · 美股期指 · 台積電 ADR · 匯率', hk: 'premarket',
      right: gridCap(PM ? `${PM.source === 'ib' ? 'IB' : PM.source} · ${({ 1: '即時', 2: '凍結', 3: '延遲', 4: '延遲凍結' })[PM.marketDataType] || ''} · ${PM.asOf ? PM.asOf.slice(5, 16).replace('T', ' ') : ''}` : ''),
      body: <PremarketPanel PM={PM} light={light} /> },
    { i: 'twse', title: '台股籌碼日報 · 三大法人 · 融資融券', hk: 'twseflows',
      right: gridCap(W ? `證交所 ${W.date.slice(0, 4)}/${W.date.slice(4, 6)}/${W.date.slice(6)} · 前一交易日` : ''),
      body: <TwseFlowsPanel W={W} light={light} /> },
    { i: 'gex', title: 'Gamma 曝險 · 各履約價（本到期日）', hk: 'gex',
      right: <span className="mono tnum" style={{ fontSize: 9.5, opacity: 0.7 }}>{G ? <>總 GEX <b style={{ color: G.total >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down }}>{fmtBig(G.total, P)}</b>/1%{G.flip != null ? ` · 零 Gamma ${fmtP(Math.round(G.flip))}` : ''} · </> : ''}{oiLabel}</span>,
      body: (<>
        {G ? <GexProfile P={P} spot={spot} G={G} theme={theme} light={light} maxRows={15} /> : <div className="mono" style={{ fontSize: 11, color: dim }}>沒有 OI 或 IV，無法計算。</div>}
        <div className="mono" style={{ marginTop: 8, fontSize: 9.5, color: dim }}>
          GEX = γ × OI × {P.mult} × S² × 1%，Call 為正、Put 為負（SqueezeMetrics 的造市者存貨慣例：Call 多 Gamma／Put 空 Gamma）。零 Gamma 以上造市者順勢對沖壓抑波動，以下追價放大波動。OI 為前一交易日。
        </div>
      </>) },
  ];
  return (
    <div style={GRID_BODY}>
      <PanelGrid tab="levels" panels={panels} defaults={GRID_DEFAULTS.levels} grid={grid} />
    </div>
  );
}

// ───────────────────────────────────────────────── CHART WORKSPACE
// Top-level Chart tab (from the design): full-width candles + MA + RSI.
// Desktop only — mobile keeps the K線 sub-tab inside Calc.
function ChartWorkspace({ P, bars, barsLive, live, theme, light, barPeriodId, setBarPeriodId, barSession, setBarSession, cone = null, D, grid }) {
  const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
  const panels = [{
    i: 'kline',
    title: <>K線 · {P.code} · {per.label}K<span style={{ color: 'var(--text2)', fontWeight: 500, marginLeft: 4 }}>· {barsLive ? `近月 · ${liveLabel(live, P)}` : '模擬'}</span></>,
    right: <div style={{ display: 'flex', gap: 8 }}><KSessionToggle value={barSession} onChange={setBarSession} /><KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} /></div>,
    body: <PriceChart cone={cone}
          bars={bars} theme={theme} code={P.code}
          periodLabel={`${per.label}K` + (barSession === 'full' ? ' · 全日盤' : ' · 日盤')}
          sourceLabel={barsLive
            ? `● ${liveLabel(live, P)} — 近月期貨日K`
            : '○ 模擬 K 線 — 隨機漫步；接上本機代理（server/）才有真實行情'}
        />,
  }];
  return (
    <div style={GRID_BODY}>
      <PanelGrid tab="chart" panels={panels} defaults={GRID_DEFAULTS.chart} grid={grid} />
    </div>
  );
}

// ───────────────────────────────────────────────── IV SURFACE WORKSPACE
// Strike x expiry IV analytics, shared by the desktop IV workspace and the phone
// IV tab. The current expiry uses the live rows when a feed is connected; the
// other expiries come from the mock generator at the same spot — a feed loads
// one expiry's chain at a time. IV per cell = mid of the call and put IV.
function ivAnalytics({ rows, expiry, expiries, spot, P }) {
  const base = (rows && rows.length) ? rows
    : (window.genChain ? window.genChain({ spot, contract: expiry.type, dte: expiry.dte, product: P }) : []);
  if (!base.length) return { grid: null, term: [], skew: null };
  const strikes = base.map((r) => r.strike);
  const cellIv = (r) => {
    if (!r) return null;
    const c = r.call.iv, p = r.put.iv;
    if (c > 0 && p > 0) return (c + p) / 2;
    return c || p || null;
  };
  const exps = expiries.map((e) => {
    const rws = (e.id === expiry.id) ? base
      : (window.genChain ? window.genChain({ spot, contract: e.type, dte: e.dte, product: P }) : []);
    const ivRow = strikes.map((k) => {
      let best = null, bd = Infinity;
      for (const r of rws) { const d = Math.abs(r.strike - k); if (d < bd) { bd = d; best = r; } }
      return cellIv(best);
    });
    return { label: e.label, dte: e.dte, iv: ivRow };
  });

  // ATM IV per expiry (term structure) — the strike nearest spot.
  let atmIdx = 0, atmD = Infinity;
  strikes.forEach((k, i) => { const d = Math.abs(k - spot); if (d < atmD) { atmD = d; atmIdx = i; } });
  const term = exps.map((e) => ({ label: e.label, dte: e.dte, iv: e.iv[atmIdx] }));

  // 25-delta skew on the current expiry: IV(put d~-.25) - IV(call d~+.25).
  // Positive -> put skew (index-style downside hedging); negative -> call skew
  // (grain-style upside risk premium).
  let callIv = null, callD = Infinity, putIv = null, putD = Infinity;
  for (const r of base) {
    if (r.call.iv > 0 && Number.isFinite(r.call.delta)) {
      const d = Math.abs(r.call.delta - 0.25);
      if (d < callD) { callD = d; callIv = r.call.iv; }
    }
    if (r.put.iv > 0 && Number.isFinite(r.put.delta)) {
      const d = Math.abs(r.put.delta + 0.25);
      if (d < putD) { putD = d; putIv = r.put.iv; }
    }
  }
  const skew = (callIv == null || putIv == null) ? null : putIv - callIv;
  return { grid: { strikes, exps, base }, term, skew };
}

function IVWorkspace({ D, P, spot, iv, expiry, expiries = TXO_EXPIRIES, rows, hv20, hvLive, dayBars = null, live = null, light = false, theme = 'dark', grid: gridCtl }) {
  const ref = uR(null);
  const instRef = uR(null);
  const [ivView, setIvView] = uS('3d'); // '3d' | 'heat'

  const { grid, term, skew } = uM(
    () => ivAnalytics({ rows, expiry, expiries, spot, P }),
    [rows, expiry, expiries, spot, P]);

  // 3D: mount once per view switch, then push data updates in place — the
  // What-if spot slider regenerates the grid and a WebGL remount per tick
  // would be far too heavy.
  const surfaceData = uM(() => {
    if (!grid) return null;
    return { strikes: grid.strikes, expiries: grid.exps.map((e) => ({ label: e.label, dte: e.dte })), iv: grid.exps.map((e) => e.iv) };
  }, [grid]);
  uE(() => {
    if (ivView !== '3d' || !ref.current || !window.IVSurface3D) return;
    instRef.current = window.IVSurface3D.make({ container: ref.current, data: surfaceData });
    return () => { if (instRef.current) { instRef.current.destroy(); instRef.current = null; } };
  }, [ivView]);
  uE(() => {
    if (instRef.current && instRef.current.setData && surfaceData) instRef.current.setData(surfaceData);
  }, [surfaceData]);

  // Heatmap shares the grid: every 2nd strike, up to 10 columns.
  const heat = uM(() => {
    if (!grid) return { header: [], rows: [] };
    const colIdx = grid.strikes.map((_, i) => i).filter((i) => i % 2 === 0).slice(0, 10);
    const vals = grid.exps.flatMap((e) => colIdx.map((i) => e.iv[i])).filter((v) => v != null);
    const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    const span = Math.max(hi - lo, 0.5);
    const header = colIdx.map((i) => window.fmtStrike(grid.strikes[i], (P && P.strikeStep) || 50));
    const rowsOut = grid.exps.map((e) => ({
      exp: e.label,
      cells: colIdx.map((i) => {
        const v = e.iv[i];
        if (v == null) return { v: '—', bg: 'transparent' };
        const a = Math.max(0.05, Math.min(0.6, 0.05 + ((v - lo) / span) * 0.55));
        return { v: v.toFixed(1), bg: `rgba(240,192,104,${a.toFixed(2)})` };
      }),
    }));
    return { header, rows: rowsOut };
  }, [grid, P]);

  const viewChip = (id, label) => {
    const active = ivView === id;
    return (
      <button onClick={() => setIvView(id)} style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '3px 10px', borderRadius: 0,
        border: '1px solid ' + (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.14)'),
        background: active ? 'linear-gradient(150deg,oklch(0.66 0.16 250),oklch(0.55 0.18 240))' : 'transparent',
        color: active ? '#fff' : (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)'),
        cursor: 'pointer', fontFamily: 'inherit',
      }}>{label}</button>
    );
  };
  const cellBorder = light ? 'rgba(25,40,70,0.08)' : 'rgba(255,255,255,0.06)';

  const surfaceBody = ivView === '3d' ? (
    <div ref={ref} style={{ height: '100%', minHeight: 320, overflow: 'hidden', background: 'radial-gradient(ellipse at 30% 30%, rgba(167,139,250,0.10), transparent 60%)' }} />
  ) : (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
        <div style={{ display: 'flex' }}>
          <div style={{ width: 64, flexShrink: 0, fontSize: 9, opacity: 0.5, fontWeight: 600, padding: '8px 10px' }}>到期</div>
          {heat.header.map((h, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, opacity: 0.5, fontWeight: 600, padding: '8px 0' }}>{h}</div>
          ))}
        </div>
        {heat.rows.map((row) => (
          <div key={row.exp} style={{ display: 'flex' }}>
            <div style={{ width: 64, flexShrink: 0, padding: '9px 10px', borderTop: `1px solid ${cellBorder}`, fontWeight: 600 }}>{row.exp}</div>
            {row.cells.map((c, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderTop: `1px solid ${cellBorder}`, background: c.bg }}>{c.v}</div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 10, opacity: 0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>低</span>
        <span style={{ display: 'inline-block', width: 120, height: 8, background: 'linear-gradient(90deg,rgba(240,192,104,0.06),rgba(240,192,104,0.6))' }} />
        <span>高 · 列＝到期日 · 欄＝履約價 · 值＝IV %</span>
      </div>
    </div>
  );
  const panels = [
    { i: 'surface', title: `隱含波動率曲面 · ${P.code}`, right: <span style={{ display: 'inline-flex', gap: 4 }}>{viewChip('3d', '3D')}{viewChip('heat', '熱圖')}</span>, body: surfaceBody },
    { i: 'hv', title: '隱含 vs 歷史波動 · 20 日', hk: 'hv', tone: 'raised', right: gridCap(hvLive ? `${liveLabel(live, P)} 日K` : '模擬'),
      body: hv20 == null ? <div style={{ fontSize: 11, opacity: 0.5 }}>日K不足，無法計算歷史波動。</div> : (<>
        <div className="tnum" style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span>{iv.toFixed(1)}%</span>
          <span style={{ opacity: 0.4, fontSize: 13 }}>vs</span>
          <span style={{ opacity: 0.75 }}>{hv20.toFixed(1)}%</span>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: iv / hv20 > 1.15 ? '#f0c068' : iv / hv20 < 0.85 ? '#5fa3d4' : 'var(--text2)' }}>
            ×{(iv / hv20).toFixed(2)}
          </span>
        </div>
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
          {iv / hv20 > 1.15 ? 'IV 高於實際波動 — 權利金偏貴，利於賣方'
            : iv / hv20 < 0.85 ? 'IV 低於實際波動 — 權利金偏便宜，利於買方'
            : 'IV ≈ 實際波動 — 權利金合理'}
        </div>
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{window.HelpTip ? <window.HelpTip k="volcone">波動率錐 · HV 5/10/20/60 日</window.HelpTip> : '波動率錐 · HV 5/10/20/60 日'}</div>
          <window.VolCone bars={dayBars} ivPct={iv} theme={theme} />
        </div>
      </>) },
    { i: 'term', title: '期限結構', right: gridCap('價平 IV'),
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {term.map((e) => (
            <div key={e.label + e.dte} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ opacity: 0.7 }}>{e.label} · {e.dte} 天</span>
              <span className="mono tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: e.dte === expiry.dte ? '#f0c068' : 'var(--text)' }}>
                {e.iv != null ? e.iv.toFixed(1) + '%' : '—'}
              </span>
            </div>
          ))}
        </div>
      ) },
    { i: 'skew', title: '偏斜 · 25Δ', right: gridCap(expCap(expiry)),
      body: skew != null ? (<>
        <div className="tnum" style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: skew >= 0 ? '#5fa3d4' : '#f0c068' }}>{skew >= 0 ? '+' : ''}{skew.toFixed(1)}</span>
          <span style={{ opacity: 0.4, fontSize: 14 }}> vol 點</span>
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
          {skew >= 0 ? 'Put 偏斜 · 下檔避險有價' : 'Call 偏斜 · 上檔風險溢價'}
        </div>
      </>) : <div style={{ fontSize: 11, opacity: 0.5 }}>此到期日沒有可用的 25Δ 報價</div> },
    { i: 'help', title: '怎麼讀', tone: 'chip',
      body: (
        <div style={{ fontSize: 11, opacity: 0.75, lineHeight: 1.55 }}>
          {ivView === '3d'
            ? <><strong>拖曳</strong>旋轉 · <strong>滾輪</strong>縮放。高度＝各履約價（X）× 各到期日（縱深，前緣最近）的 IV。取自報價表的每檔 IV；沒載入報價的到期日用模型微笑曲線。</>
            : <>每格＝該履約價、該到期日的 IV（%）。越亮越高。橫向讀微笑／偏斜，縱向讀期限結構。</>}
        </div>
      ) },
  ];
  return (
    <div style={GRID_BODY}>
      <PanelGrid tab="lab-iv" panels={panels} defaults={GRID_DEFAULTS['lab-iv']} grid={gridCtl} />
    </div>
  );
}

// ───────────────────────────────────────────────── COMPARE WORKSPACE
// Strategy templates. Premium is computed by the product's pricing model
// (TXO=Black-Scholes、穀物=Black-76) at the current spot/iv/dte so the numbers
// actually reflect the underlying regime. Strike offsets are in "檔" (multiples
// of the product's strikeStep — TXO 50pt、ZC/ZW 10¢、ZS 20¢)，跟原本 TXO 的
// 200/300/500 點對應 4/6/10 檔一致。
function _bs(type, S, K, iv, dte, r, model) {
  return Math.round(window.bsPrice(type, S, K, iv, dte, r, model) * 100) / 100;
}
function _mkLeg(side, type, S, K, iv, dte, P, qty = 1) {
  const model = (P && P.model) || 'bs';
  const r = ((P && P.r != null) ? P.r : 1.5) / 100;
  // Store dte on the leg so calendars / diagonals value each leg at its own
  // expiry. Single-expiry portfolios all carry the same dte → unchanged output.
  return { side, type, strike: K, premium: _bs(type, S, K, iv, dte, r, model), qty, dte };
}
const STRATEGY_LIBRARY = [
  { id: 'bull-call', nameZh: '買權多頭價差',  name: 'Bull Call Spread',  bias: 'bullish', tag: '看小漲',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','call',s,s,iv,dte,P), _mkLeg('short','call',s,s+4*st,iv,dte,P)] },
  { id: 'bear-put', nameZh: '賣權空頭價差',   name: 'Bear Put Spread',   bias: 'bearish', tag: '看小跌',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','put',s,s,iv,dte,P), _mkLeg('short','put',s,s-4*st,iv,dte,P)] },
  { id: 'iron-condor', nameZh: '鐵兀鷹',name: 'Iron Condor',       bias: 'neutral', tag: '盤整收租',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','put',s,s-6*st,iv,dte,P), _mkLeg('long','put',s,s-10*st,iv,dte,P), _mkLeg('short','call',s,s+6*st,iv,dte,P), _mkLeg('long','call',s,s+10*st,iv,dte,P)] },
  { id: 'straddle', nameZh: '買進跨式',   name: 'Long Straddle',     bias: 'volatile',tag: '大波動',
    build: (s, iv, dte, P) => [_mkLeg('long','call',s,s,iv,dte,P), _mkLeg('long','put',s,s,iv,dte,P)] },
  { id: 'strangle', nameZh: '買進勒式',   name: 'Long Strangle',     bias: 'volatile',tag: '大波動(便宜)',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','call',s,s+3*st,iv,dte,P), _mkLeg('long','put',s,s-3*st,iv,dte,P)] },
  { id: 'short-strangle', nameZh: '賣出勒式', name: 'Short Strangle',bias: 'neutral', tag: '盤整裸賣',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','call',s,s+4*st,iv,dte,P), _mkLeg('short','put',s,s-4*st,iv,dte,P)] },
  { id: 'put-credit', nameZh: '賣權多頭價差', name: 'Put Credit Spread', bias: 'bullish', tag: '看不跌',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','put',s,s-2*st,iv,dte,P), _mkLeg('long','put',s,s-6*st,iv,dte,P)] },
  { id: 'call-credit', nameZh: '買權空頭價差',name: 'Call Credit Spread',bias: 'bearish', tag: '看不漲',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','call',s,s+2*st,iv,dte,P), _mkLeg('long','call',s,s+6*st,iv,dte,P)] },
  { id: 'butterfly', nameZh: '買進蝶式',  name: 'Long Butterfly',    bias: 'neutral', tag: '精準錨點',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','call',s,s-3*st,iv,dte,P), _mkLeg('short','call',s,s,iv,dte,P,2), _mkLeg('long','call',s,s+3*st,iv,dte,P)] },
  { id: 'long-call', nameZh: '買進買權',  name: 'Long Call',         bias: 'bullish', tag: '純多單',
    build: (s, iv, dte, P) => [_mkLeg('long','call',s,s,iv,dte,P)] },
  { id: 'long-put', nameZh: '買進賣權',   name: 'Long Put',          bias: 'bearish', tag: '純空單',
    build: (s, iv, dte, P) => [_mkLeg('long','put',s,s,iv,dte,P)] },
];

// Shelved: the Compare tab was removed per owner decision (2026-07-10).
// Kept intact — re-enable by adding a 'compare' entry back to WorkspaceTabs and
// its route. STRATEGY_LIBRARY above is still used by the mobile strategy chips.
function CompareWorkspace({ D, P, spot, iv, dte, theme = 'dark' }) {
  const [picked, setPicked] = uS(['bull-call', 'iron-condor', 'straddle']);
  const [showPicker, setShowPicker] = uS(false);

  function toggle(id) {
    if (picked.includes(id)) {
      if (picked.length > 1) setPicked(picked.filter((p) => p !== id));
    } else if (picked.length < 4) {
      setPicked([...picked, id]);
    }
  }

  const cardW = picked.length === 1 ? '1fr' : picked.length === 2 ? 'repeat(2,1fr)' : picked.length === 3 ? 'repeat(3,1fr)' : 'repeat(4,1fr)';
  const biasColor = { bullish: '#ef5350', bearish: '#26a69a', neutral: '#a78bfa', volatile: '#f0c068' };

  return (
    <div style={{ position: 'absolute', top: 90, left: 12, right: 12, bottom: 12, zIndex: 5, display: 'flex', flexDirection: 'column', gap: D.gap }}>
      {/* Strategy picker bar */}
      <Glass2 tone="panel" padding="12px 16px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {STRATEGY_LIBRARY.map((s) => {
              const active = picked.includes(s.id);
              const c = biasColor[s.bias];
              return (
                <button key={s.id} onClick={() => toggle(s.id)} style={{
                  padding: '6px 10px', borderRadius: 0, border: '1px solid',
                  borderColor: active ? c : 'rgba(255,255,255,0.10)',
                  background: active ? `${c}22` : 'rgba(255,255,255,0.02)',
                  color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  transition: 'all .15s',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: c, opacity: active ? 1 : 0.5 }} />
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      </Glass2>

      {/* Cards */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: cardW, gap: D.gap, minHeight: 0, alignItems: 'start', overflowY: 'auto', overflowX: 'hidden', paddingBottom: 4 }}>
        {picked.map((id) => (
          <CompareCard
            key={`${P.id}:${id}`}
            strategy={STRATEGY_LIBRARY.find((x) => x.id === id)}
            P={P}
            spot={spot}
            iv={iv}
            dte={dte}
            D={D}
            theme={theme}
            biasColor={biasColor}
            onRemove={() => toggle(id)}
          />
        ))}
      </div>
    </div>
  );
}

function CompareCard({ strategy: s, P, spot, iv, dte, D, theme = 'dark', biasColor, onRemove }) {
  // Local editable legs — initialize from strategy's build() at current iv/dte.
  const [legs, setLegs] = uS(() => s.build(Math.round(spot / P.strikeStep) * P.strikeStep, iv, dte, P));
  const c = biasColor[s.bias];

  const credit = legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0);
  const scanStep = Math.max(P.strikeStep / 2, spot * 0.001);
  // 掃描範圍必須涵蓋所有腿的履約價：穀物的檔距佔 spot 比例大（condor 翼可到 ±20%），
  // 只掃 ±8% 會漏掉翼部，max loss / break-even 就算錯。
  const _ks = legs.map((l) => l.strike);
  const scanLo = Math.min(spot * 0.92, Math.min.apply(null, _ks) - 2 * P.strikeStep);
  const scanHi = Math.max(spot * 1.08, Math.max.apply(null, _ks) + 2 * P.strikeStep);
  let mp = -Infinity, ml = Infinity;
  for (let st = scanLo; st <= scanHi; st += scanStep) {
    const v = legs.reduce((a, l) => a + legPayoff(l, st), 0);
    mp = Math.max(mp, v); ml = Math.min(ml, v);
  }
  const bes = [];
  let prev = null;
  for (let st = scanLo; st <= scanHi; st += scanStep / 2.5) {
    const v = legs.reduce((a, l) => a + legPayoff(l, st), 0);
    if (prev !== null && (prev.v >= 0) !== (v >= 0)) {
      const t = Math.abs(prev.v) / (Math.abs(prev.v) + Math.abs(v));
      bes.push(prev.s + t * (st - prev.s));
    }
    prev = { s: st, v };
  }

  function setStrike(i, v) {
    const next = legs.slice();
    next[i] = { ...next[i], strike: v };
    setLegs(next);
  }

  return (
    <Glass2 tone="panel" padding={D.panelPad} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: c }} />
            {s.name}
          </div>
          <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>{legs.length} legs</div>
        </div>
        <button onClick={onRemove} style={{
          width: 22, height: 22, borderRadius: 0, border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
          fontSize: 12, lineHeight: 1, padding: 0, fontFamily: 'inherit',
        }}>×</button>
      </div>

      <PayoffChart legs={legs} spot={spot} theme={theme} height={170} width={300} iv={iv} dte={dte} showCone={true} sliceFrac={1} rangePct={0.06} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />

      {/* Editable strikes */}
      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 0, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.55, fontWeight: 600, marginBottom: 6 }}>Strikes · adjust K</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {legs.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                background: l.side === 'long' ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
                color: l.side === 'long' ? '#fff' : 'rgba(255,255,255,0.6)',
                border: '1px solid rgba(255,255,255,0.10)',
                minWidth: 36, textAlign: 'center', letterSpacing: 0.3,
              }}>{l.side === 'long' ? '+' : '−'}{l.qty}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                background: l.type === 'call' ? 'rgba(239,83,80,0.16)' : 'rgba(38,166,154,0.16)',
                color: l.type === 'call' ? '#ef5350' : '#26a69a',
                minWidth: 30, textAlign: 'center', letterSpacing: 0.3,
              }}>{l.type === 'call' ? 'C' : 'P'}</span>
              <input
                type="number" step={P.strikeStep} value={l.strike}
                onChange={(e) => setStrike(i, parseInt(e.target.value) || 0)}
                style={{
                  flex: 1, padding: '3px 6px', borderRadius: 4,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(0,0,0,0.20)', color: '#e8eaef',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                  outline: 'none',
                }}
              />
              <span className="mono" style={{ fontSize: 10, opacity: 0.5, fontFamily: 'var(--font-mono)', minWidth: 38, textAlign: 'right' }}>@{l.premium}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Key numbers */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
        <div style={{ padding: '6px 8px', borderRadius: 0, background: 'rgba(239,83,80,0.10)', border: '1px solid rgba(239,83,80,0.18)' }}>
          <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>最大獲利</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ef5350', fontSize: 13 }}>
            +{P.cur}{Math.round(mp * P.mult).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 0, background: 'rgba(38,166,154,0.10)', border: '1px solid rgba(38,166,154,0.18)' }}>
          <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>最大虧損</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#26a69a', fontSize: 13 }}>
            {P.cur}{Math.round(ml * P.mult).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 0, background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.18)' }}>
          <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 600 }}>損益兩平</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#a78bfa', fontSize: 12 }}>
            {bes.length ? bes.map((b) => b.toFixed(0)).join(' / ') : '—'}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>{credit >= 0 ? 'NET CREDIT' : 'NET DEBIT'}</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: credit >= 0 ? '#ef5350' : '#cdd3df' }}>
            {credit >= 0 ? '+' : ''}{P.cur}{Math.round(credit * P.mult).toLocaleString()}
          </div>
        </div>
      </div>
    </Glass2>
  );
}

const miniBtn = {
  fontSize: 10.5, fontWeight: 600,
  padding: '3px 8px', borderRadius: 0, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
};

// Strategy template picker (desktop). One click replaces the working legs with
// a classic template from STRATEGY_LIBRARY, built at the current ATM / IV /
// selected expiry. Mobile keeps its own chip strip.
function StrategyMenu({ P, spot, iv, dte, onPick, light }) {
  const [open, setOpen] = uS(false);
  const biasColor = { bullish: '#ef5350', bearish: '#26a69a', neutral: '#a78bfa', volatile: '#f0c068' };
  return (
    <div style={{ position: 'relative' }}>
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />}
      <button style={miniBtn} onClick={() => setOpen(!open)} title="套用策略範本">策略範本</button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 31, width: 232, padding: 4,
          background: 'var(--panel2)', border: '1px solid var(--border)', boxShadow: '0 12px 28px rgba(0,0,0,0.45)', color: 'var(--text)',
          display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 320, overflowY: 'auto',
        }}>
          {STRATEGY_LIBRARY.map((s) => (
            <button key={s.id} onClick={() => {
              onPick(s.build(Math.round(spot / P.strikeStep) * P.strikeStep, iv, dte, P));
              setOpen(false);
            }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 0,
              border: 'none', textAlign: 'left', cursor: 'pointer', background: 'transparent',
              color: 'inherit', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = light ? 'rgba(20,40,80,0.08)' : 'rgba(255,255,255,0.10)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: biasColor[s.bias], flexShrink: 0 }} />
              {s.nameZh || s.name}
              <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.55 }}>{s.tag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MOBILE / FOLDABLE LAYOUT
// ═════════════════════════════════════════════════════════════════════════════
function MobileApp({
  vp, workspace, setWorkspace,
  theme = 'dark', setTheme,
  helpOpen, setHelpOpen,
  P, switchProduct, live, lastLiveAt, fees = 0,
  expiries, chainRows,
  bars, barsLive, barPeriodId, setBarPeriodId,
  spotMin, spotMax,
  expiryId, setExpiryId, expiry,
  legs, setLegs, addLegFromChain,
  spot, setSpot, iv, setIv, dte,
  view, setView, sliceFrac, setSliceFrac,
  pnlPts, pnlNTD, maxProfit, maxLoss,
  portfolioG, popValue, quality,
  accent, t, setTweak,
}) {
  const isFold = vp.layout === 'fold';
  const light = theme === 'light';
  const chartW = Math.max(280, Math.min(vp.width - 48, isFold ? 560 : 400));
  return (
    <div style={{
      width: '100%', minHeight: '100vh', position: 'relative',
      fontFamily: 'var(--font-display)', color: light ? '#1c2433' : '#e8eaef',
      background: light ? `
        radial-gradient(ellipse 90% 50% at 50% 0%, ${t.showAuroraBlobs ? `oklch(0.90 0.045 ${t.accentHue}) 0%` : 'transparent 0%'}, transparent 55%),
        linear-gradient(180deg, #eef1f6 0%, #e4e9f2 100%)
      ` : `
        radial-gradient(ellipse 90% 50% at 50% 0%, ${t.showAuroraBlobs ? `oklch(0.32 0.10 ${t.accentHue}) 0%` : 'transparent 0%'}, transparent 55%),
        linear-gradient(180deg, #0a0d14 0%, #11151f 100%)
      `,
      paddingBottom: 130, // room for sticky bottom rail
    }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        padding: '10px 12px 8px',
        background: light
          ? 'linear-gradient(180deg, rgba(238,241,246,0.94), rgba(238,241,246,0.6) 80%, transparent)'
          : 'linear-gradient(180deg, rgba(10,13,20,0.92), rgba(10,13,20,0.55) 80%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Glass2 tone="chip" radius={999} padding="6px 10px" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: `linear-gradient(135deg, oklch(0.78 0.14 75), ${accent})` }} />
            {isFold && <span style={{ fontSize: 11, fontWeight: 600 }}>Options Lab</span>}
          </Glass2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Glass2 tone="chip" radius={999} padding="6px 9px" style={{ cursor: 'pointer', flexShrink: 0, border: helpOpen ? '1px solid oklch(0.66 0.16 250 / 0.6)' : undefined }}
              onClick={() => setHelpOpen((v) => !v)} title="Help">
              <span style={{ fontSize: 12, fontWeight: 700 }}>?</span>
            </Glass2>
            <Glass2 tone="chip" radius={999} padding="6px 9px" style={{ cursor: 'pointer', flexShrink: 0 }}
              onClick={() => setTheme(light ? 'dark' : 'light')} title="Light / dark">
              <span style={{ fontSize: 12 }}>{light ? '☀' : '☾'}</span>
            </Glass2>
            <Glass2 tone="chip" radius={999} padding="6px 10px" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <select
                className="lt-prodsel"
                value={P.id}
                onChange={(e) => switchProduct(e.target.value)}
                title={P.name}
                style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 3px', borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)', color: '#e8eaef',
                  border: 'none', outline: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {window.PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
              </select>
              <span className="tnum" style={{ fontSize: 12, fontWeight: 600 }}>{spot.toLocaleString()}</span>
              <span style={{ fontSize: 9, color: light ? '#8a6410' : '#f0c068' }}>{dte}d</span>
              {P.live && <MobileLiveBadge live={live} P={P} lastLiveAt={lastLiveAt} light={light} />}
            </Glass2>
          </div>
        </div>

        {/* Workspace toggle (mobile = Calc / Chain / Pricer / IV) */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {[
            { id: 'calc', label: 'Calc' },
            { id: 'chain', label: 'Chain' },
            { id: 'pricer', label: 'Pricer' },
            { id: 'iv', label: 'IV' },
          ].map((it) => {
            const active = workspace === it.id;
            return (
              <button key={it.id} onClick={() => setWorkspace(it.id)} style={{
                flex: 1, padding: '8px 6px', borderRadius: 10, border: 'none',
                fontSize: 12, fontWeight: 700, letterSpacing: 0.2,
                background: active ? `linear-gradient(150deg, ${accent}, oklch(0.55 0.18 240))` : (light ? 'rgba(20,40,80,0.06)' : 'rgba(255,255,255,0.05)'),
                color: active ? '#fff' : (light ? 'rgba(20,30,50,0.6)' : 'rgba(255,255,255,0.65)'),
                boxShadow: active ? '0 4px 12px -4px rgba(0,0,0,0.6)' : 'none',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{it.label}</button>
            );
          })}
        </div>

        {/* Expiry strip — horizontal scroll on phone */}
        <div style={{
          display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
        }}>
          {expiries.map((e) => {
            const active = e.id === expiryId;
            const isMonthly = e.type === 'monthly';
            return (
              <button key={e.id} onClick={() => setExpiryId(e.id)} style={{
                flexShrink: 0,
                padding: '5px 10px', borderRadius: 8, border: '1px solid',
                borderColor: active ? (isMonthly ? '#f0c068' : (light ? 'rgba(20,40,80,0.3)' : 'rgba(255,255,255,0.18)')) : (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.08)'),
                background: active ? (isMonthly ? 'rgba(240,192,104,0.16)' : (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)')) : (light ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)'),
                color: active ? (isMonthly ? (light ? '#8a6410' : '#f7d394') : (light ? '#1c2433' : '#fff')) : (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)'),
                fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                position: 'relative',
              }}>
                <span>{e.label}</span>
                <span style={{ fontSize: 9, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>{e.date}</span>
                {isMonthly && <span style={{ width: 4, height: 4, borderRadius: 2, background: '#f0c068' }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {workspace === 'calc' && (
          <MobileCalc
            isFold={isFold} chartW={chartW} theme={theme}
            P={P} bars={bars} barsLive={barsLive} expiries={expiries} fees={fees}
            barPeriodId={barPeriodId} setBarPeriodId={setBarPeriodId}
            legs={legs} setLegs={setLegs}
            spot={spot} setSpot={setSpot}
            iv={iv} setIv={setIv} dte={dte}
            view={view} setView={setView}
            sliceFrac={sliceFrac} setSliceFrac={setSliceFrac}
            pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss}
            portfolioG={portfolioG} popValue={popValue} quality={quality}
            accent={accent} t={t}
          />
        )}
        {workspace === 'chain' && (
          <MobileChain
            isFold={isFold} chartW={chartW} theme={theme}
            P={P} rows={chainRows}
            spot={spot} expiry={expiry} expiries={expiries}
            legs={legs} setLegs={setLegs}
            addLegFromChain={addLegFromChain}
            quality={quality} fees={fees}
          />
        )}
        {workspace === 'pricer' && (
          <Glass2 tone="panel" padding={14}>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>single contract</span>}>Option Pricer</Eyebrow>
            <OptionPricer key={P.id} product={P} spot={spot} iv={iv} dte={dte} rows={chainRows} theme={theme} accent={accent} />
          </Glass2>
        )}
        {workspace === 'iv' && (
          <MobileIV expiry={expiry} expiries={expiries} P={P} spot={spot} rows={chainRows} theme={theme} />
        )}
      </div>

      {/* Sticky bottom slider rail.
          Calc page: Spot + IV (both affect P&L / Greeks / distribution).
          Chain page: only Spot — IV doesn't move the displayed quotes, so showing
          it would be a red herring. */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        padding: '10px 12px 14px',
        background: light
          ? 'linear-gradient(0deg, rgba(238,241,246,0.97) 0%, rgba(238,241,246,0.88) 70%, transparent 100%)'
          : 'linear-gradient(0deg, rgba(10,13,20,0.95) 0%, rgba(10,13,20,0.85) 70%, transparent 100%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: `1px solid ${light ? 'rgba(25,40,70,0.10)' : 'rgba(255,255,255,0.06)'}`,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: workspace !== 'chain' ? '1fr 1fr' : '1fr', gap: 16 }}>
          <Slider label="Spot" value={spot} min={spotMin} max={spotMax} step={P.spotStep} onChange={setSpot} format={(v) => v.toLocaleString()} theme={theme} />
          {workspace !== 'chain' && (
            <Slider label="IV" value={iv} min={P.ivMin} max={P.ivMax} step={0.5} suffix="%" onChange={setIv} theme={theme} />
          )}
        </div>
      </div>

      {window.HelpDrawer && <window.HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} workspace={workspace} />}
    </div>
  );
}

// Live badge for the phone top bar. The desktop shows broker + a separate
// freshness chip; there is no room for both here, so the badge itself turns
// amber STALE once the feed stops updating.
function MobileLiveBadge({ live, P, lastLiveAt, light }) {
  const [, tick] = uS(0);
  uE(() => {
    if (!live) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [live]);
  if (!live) {
    return <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: light ? 'rgba(20,30,50,0.45)' : 'rgba(255,255,255,0.45)' }}>○MOCK</span>;
  }
  const stale = lastLiveAt && (Date.now() - lastLiveAt) > 45000;
  return (
    <span className="mono" title={stale ? 'live data may be stale' : 'live'} style={{
      fontSize: 8, fontWeight: 700, letterSpacing: 0.4,
      color: stale ? '#f0c068' : '#4dd0c8',
    }}>{stale && !(live.health && live.health.source === 'eod') ? '●STALE' : `●${liveLabel(live, P)}`}</span>
  );
}

function MobileCalc({
  isFold, chartW, theme = 'dark',
  P, bars, barsLive, barPeriodId, setBarPeriodId, expiries,
  legs, setLegs, spot, setSpot, iv, setIv, dte,
  view, setView, sliceFrac, setSliceFrac,
  pnlPts, pnlNTD, maxProfit, maxLoss, fees = 0,
  portfolioG, popValue, quality,
  accent, t,
}) {
  const light = theme === 'light';
  // Net of estimated round-trip fees, matching the desktop card. Charts stay gross.
  const netPnl = pnlNTD - fees;
  return (
    <>
      {/* P&L now card */}
      <Glass2 tone="raised" padding={14}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow right={<DataQualityPill quality={quality} />}>P&L now</Eyebrow>
            <div className="tnum" style={{
              fontSize: 26, fontWeight: 700, letterSpacing: -0.4,
              color: netPnl >= 0
                ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)')
                : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)'),
              fontFamily: 'var(--font-mono)', lineHeight: 1.05,
            }}>
              {netPnl >= 0 ? '+' : ''}{P.cur}{Math.abs(Math.round(netPnl)).toLocaleString()}
            </div>
            <div className="tnum" style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
              Max <span style={{ color: light ? '#8a6410' : '#f0c068' }}>+{P.cur}{Math.round(maxProfit - fees).toLocaleString()}</span>
              <span style={{ opacity: 0.4 }}> · </span>
              Min <span style={{ color: light ? '#2b6a99' : '#5fa3d4' }}>{P.cur}{Math.round(maxLoss - fees).toLocaleString()}</span>
            </div>
            {fees > 0 && (
              <div className="tnum" style={{ fontSize: 9, opacity: 0.42, marginTop: 2 }}>
                incl. est. fees {P.cur}{Math.round(fees).toLocaleString()}
              </div>
            )}
          </div>
          <div style={{ width: 84, flexShrink: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600, textAlign: 'center', marginBottom: 2 }}>POP</div>
            <POPGauge theme={theme} size={84} value={popValue} />
          </div>
        </div>
      </Glass2>

      {/* 3D surface — small but present */}
      <Glass2 tone="panel" padding={6} style={{ position: 'relative', height: isFold ? 320 : 220 }}>
        <Surface3DMount theme={theme} height="100%" scheme={t.scheme} />
      </Glass2>

      {/* Chart tabs */}
      <Glass2 tone="chip" padding={3} style={{ display: 'flex', gap: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        {[
          { id: 'payoff', label: 'Payoff' },
          { id: 'kbar', label: 'K線' },
          { id: 'greeks', label: 'Greeks' },
          { id: 'dist', label: 'Dist' },
          { id: 'attr', label: 'Attr' },
          { id: 'theta', label: 'Theta' },
          { id: 'iv', label: 'IV' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setView(tab.id)} style={{
            flex: '1 0 auto', minWidth: 64,
            fontSize: 11, fontWeight: 600, padding: '7px 10px', borderRadius: 999,
            border: 'none', cursor: 'pointer',
            background: view === tab.id ? (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)') : 'transparent',
            color: view === tab.id ? (light ? '#1c2433' : '#fff') : (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)'),
            fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>{tab.label}</button>
        ))}
      </Glass2>

      <Glass2 tone="panel" padding={14}>
        {view === 'payoff' && (<>
          <Eyebrow right={
            <span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>
              {sliceFrac >= 0.99 ? 'expiry' : sliceFrac <= 0.01 ? 'now' : `${(sliceFrac * 100).toFixed(0)}%`}
            </span>
          }>Payoff</Eyebrow>
          <PayoffChart legs={legs} spot={spot} theme={theme} height={150} width={chartW} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={sliceFrac} rangePct={0.08} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />
          <div style={{ marginTop: 10 }}>
            <input type="range" min="0" max="1" step="0.01" value={sliceFrac} onChange={(e) => setSliceFrac(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: accent }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.5, fontFamily: 'var(--font-mono)' }}>
              <span>now</span><span>expiry</span>
            </div>
          </div>
        </>)}
        {view === 'kbar' && (<>
          <Eyebrow right={<KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} light={light} />}>K線 · {P.code} <span style={{ opacity: 0.5, fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· {barsLive ? (BROKER[P.live] || 'live') : 'mock'}</span></Eyebrow>
          <KBarChart bars={bars} theme={theme} height={160} width={chartW} />
        </>)}
        {view === 'greeks' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d</span>}>Greeks vs spot</Eyebrow>
          <GreeksProfile legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={150} width={chartW} model={P.model} r={P.r / 100} />
        </>)}
        {view === 'dist' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>at expiry</span>}>P&L distribution</Eyebrow>
          <PnLDistribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={150} width={chartW} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />
        </>)}
        {view === 'attr' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>vs baseline</span>}>P&L attribution</Eyebrow>
          <PnLAttribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={155} width={chartW} baseSpot={P.defaultSpot} baseIv={P.defaultIv} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />
        </>)}
        {view === 'theta' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>θ decay</span>}>Time decay</Eyebrow>
          <ThetaDecay theme={theme} dte={dte} height={150} width={chartW} />
        </>)}
        {view === 'iv' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{iv}% ATM</span>}>IV smile</Eyebrow>
          <IVSmile theme={theme} iv={iv} height={150} width={chartW} />
        </>)}
      </Glass2>

      {/* Greeks chips */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow>Greeks at current spot</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
          <GreekChip label="Δ" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Γ" value={portfolioG.gamma.toFixed(4)} theme={theme} />
          <GreekChip label="Θ" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
          <GreekChip label="V" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
        </div>
      </Glass2>

      {/* Legs editor */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow right={
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>+ leg</button>
            {legs.length > 0 && <button style={miniBtn} onClick={() => setLegs([])}>clear</button>}
          </div>
        }>Legs · {legs.length}</Eyebrow>

        {/* Strategy preset chips — tap to load strategy template */}
        <div style={{
          display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 8, marginBottom: 8,
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
          borderBottom: `1px solid ${light ? 'rgba(25,40,70,0.10)' : 'rgba(255,255,255,0.06)'}`,
        }}>
          {STRATEGY_LIBRARY.map((s) => {
            const c = { bullish: '#ef5350', bearish: '#26a69a', neutral: '#a78bfa', volatile: '#f0c068' }[s.bias];
            return (
              <button key={s.id}
                onClick={() => setLegs(s.build(Math.round(spot / P.strikeStep) * P.strikeStep, iv, dte, P))}
                style={{
                  flexShrink: 0,
                  padding: '5px 9px', borderRadius: 999,
                  border: `1px solid ${c}55`,
                  background: `${c}14`,
                  color: 'inherit', fontFamily: 'inherit',
                  fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: c }} />
                {s.name}
              </button>
            );
          })}
        </div>

        {legs.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 11, opacity: 0.5 }}>
            No legs yet · pick a strategy above or go to Chain
          </div>
        ) : (
          <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
        )}
      </Glass2>

      {/* Stress test */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow>Stress test</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { label: '−5% & IV+15%', spot: -5, iv: 15 },
            { label: '+3% & IV−5%',  spot: 3,  iv: -5 },
            { label: '−10% crash',   spot: -10, iv: 21 },
            { label: 'Reset',        spot: 0, iv: 0, reset: true },
          ].map((s, i) => (
            <button key={i} onClick={() => {
              if (s.reset) { setSpot(P.defaultSpot); setIv(P.defaultIv); return; }
              setSpot(Math.round(P.defaultSpot * (1 + s.spot / 100)));
              setIv(Math.max(P.ivMin, Math.min(P.ivMax, P.defaultIv + s.iv)));
            }} style={{
              padding: '10px 6px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              border: `1px solid ${light ? 'rgba(25,40,70,0.12)' : 'rgba(255,255,255,0.10)'}`, cursor: 'pointer',
              background: light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.03)', color: 'inherit', fontFamily: 'inherit',
            }}>{s.label}</button>
          ))}
        </div>
      </Glass2>
    </>
  );
}

function MobileIV({ expiry, expiries = TXO_EXPIRIES, P, spot, rows, theme = 'dark' }) {
  const ref = uR(null);
  const instRef = uR(null);
  const light = theme === 'light';
  // Same analytics as the desktop IV workspace. This tab used to print a
  // formula-generated term structure and a hardcoded +4.2 skew, which looked
  // like data but was not — even with a live feed connected.
  const { grid, term, skew } = uM(
    () => ivAnalytics({ rows, expiry, expiries, spot, P }),
    [rows, expiry, expiries, spot, P]);
  const surfaceData = uM(() => {
    if (!grid) return null;
    return { strikes: grid.strikes, expiries: grid.exps.map((e) => ({ label: e.label, dte: e.dte })), iv: grid.exps.map((e) => e.iv) };
  }, [grid]);
  uE(() => {
    if (!ref.current || !window.IVSurface3D) return;
    instRef.current = window.IVSurface3D.make({ container: ref.current, data: surfaceData });
    return () => { if (instRef.current) { instRef.current.destroy(); instRef.current = null; } };
  }, []);
  uE(() => {
    if (instRef.current && instRef.current.setData && surfaceData) instRef.current.setData(surfaceData);
  }, [surfaceData]);
  const rule = light ? 'rgba(25,40,70,0.08)' : 'rgba(255,255,255,0.04)';
  return (
    <>
      <Glass2 tone="panel" padding={14}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>strike × DTE × IV</span>}>IV Surface</Eyebrow>
        <div ref={ref} style={{ height: 320, borderRadius: 14, overflow: 'hidden', background: 'radial-gradient(ellipse at 30% 30%, rgba(167,139,250,0.10), transparent 60%)' }} />
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 8, lineHeight: 1.5 }}>
          One finger drags to orbit · pinch to zoom. Height = IV at each strike (X) × expiry (depth).
        </div>
      </Glass2>
      <Glass2 tone="panel" padding={14}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>ATM IV</span>}>Term structure</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {term.map((e) => (
            <div key={e.label + e.dte} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${rule}` }}>
              <span style={{ opacity: 0.7 }}>{e.label} · {e.dte}d</span>
              <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: e.dte === expiry.dte ? (light ? '#8a6410' : '#f0c068') : (light ? '#3a4658' : '#cdd3df') }}>
                {e.iv != null ? e.iv.toFixed(1) + '%' : '—'}
              </span>
            </div>
          ))}
        </div>
      </Glass2>
      <Glass2 tone="panel" padding={14}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>Skew · 25Δ</Eyebrow>
        {skew != null ? (<>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: skew >= 0 ? (light ? '#2b6a99' : '#5fa3d4') : (light ? '#8a6410' : '#f0c068') }}>{skew >= 0 ? '+' : ''}{skew.toFixed(1)}</span>
            <span style={{ opacity: 0.4, fontSize: 14 }}> vol pts</span>
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
            {skew >= 0 ? 'Put skew · downside hedging priced in' : 'Call skew · upside risk premium'}
          </div>
        </>) : (
          <div style={{ fontSize: 11, opacity: 0.5 }}>No usable 25Δ quotes on this expiry</div>
        )}
      </Glass2>
    </>
  );
}

function MobileChain({ isFold, chartW, P, rows, spot, expiry, expiries, legs, setLegs, addLegFromChain, quality, fees = 0, theme = 'dark' }) {
  const light = theme === 'light';
  // Tapping a quote used to always BUY. The desktop chain got a buy/sell
  // popover; on touch a persistent segmented control is steadier than a
  // popover, and it shows which way the next tap goes before you tap.
  const [side, setSide] = uS('long');
  return (
    <>
      {/* Net premium card */}
      <Glass2 tone="raised" padding={12}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Eyebrow right={<DataQualityPill quality={quality} />}>Net premium</Eyebrow>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: -0.3 }}>
              {P.cur}{Math.round(legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) * P.mult).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3 }}>
              {legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) >= 0 ? 'credit received' : 'debit paid'}
              <span style={{ opacity: 0.4 }}> · </span>
              {legs.length} leg{legs.length === 1 ? '' : 's'}
              {fees > 0 && <><span style={{ opacity: 0.4 }}> · </span>est. fees {P.cur}{Math.round(fees).toLocaleString()}</>}
            </div>
          </div>
          {legs.length > 0 && (
            <button style={miniBtn} onClick={() => setLegs([])}>clear</button>
          )}
        </div>
      </Glass2>

      {/* Option chain (compact: hides OI/Vol on phone, only IV + BID/ASK + Strike) */}
      <Glass2 tone="panel" padding={10} style={{ overflow: 'auto' }}>
        <Eyebrow right={
          <div style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
            {[{ id: 'long', label: 'BUY' }, { id: 'short', label: 'SELL' }].map((o) => {
              const on = side === o.id;
              const c = o.id === 'long' ? '#ef5350' : '#26a69a';
              return (
                <button key={o.id} onClick={() => setSide(o.id)} style={{
                  padding: '3px 8px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                  border: `1px solid ${on ? c : (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.10)')}`,
                  background: on ? `${c}22` : 'transparent',
                  color: on ? c : (light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.5)'),
                }}>{o.label}</button>
              );
            })}
            <span className="mono" style={{ fontSize: 9, opacity: 0.5, marginLeft: 3 }}>{expiry.label} · {expiry.dte}d</span>
          </div>
        }>
          Option chain
        </Eyebrow>
        <MobileChainTable spot={spot} contract={expiry.type} rows={rows} onAddLeg={addLegFromChain} side={side} dte={expiry.dte} light={light} />
      </Glass2>

      {/* OI Profile */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label}</span>}>OI profile</Eyebrow>
        <OIProfile spot={spot} contract={expiry.type} rows={rows} theme={theme} maxRows={9} />
      </Glass2>

      {/* Max Pain */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>settlement</span>}>Max pain</Eyebrow>
        <MaxPain spot={spot} contract={expiry.type} rows={rows} ntdMult={P.mult} cur={P.cur} theme={theme} height={150} width={chartW} />
      </Glass2>

      {/* Current legs */}
      {legs.length > 0 && (
        <Glass2 tone="panel" padding={12}>
          <Eyebrow>Current legs</Eyebrow>
          <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={expiry.dte} />
        </Glass2>
      )}
    </>
  );
}

// Compact chain table for phone — drops OI/Vol columns, keeps IV / BID-ASK / Strike.
function MobileChainTable({ spot, contract, rows: rowsProp, onAddLeg, side = 'long', dte, light = false }) {
  const hc = hCell(light), cc = cCell(light);
  const genRows = uM(() => {
    if (rowsProp && rowsProp.length) return [];
    return window.genChain ? window.genChain({ spot, contract }) : [];
  }, [spot, contract, rowsProp]);
  const rows = (rowsProp && rowsProp.length) ? rowsProp : genRows;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 70px 1fr 1fr',
      fontFamily: 'var(--font-mono)',
      fontSize: 11, fontVariantNumeric: 'tabular-nums',
      borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${light ? 'rgba(25,40,70,0.10)' : 'rgba(255,255,255,0.06)'}`,
    }}>
      {/* header */}
      <div style={hc}>IV</div>
      <div style={hc}>BID/ASK</div>
      <div style={{ ...hc, textAlign: 'center' }}>STRIKE</div>
      <div style={{ ...hc, textAlign: 'left' }}>BID/ASK</div>
      <div style={{ ...hc, textAlign: 'left' }}>IV</div>
      {rows.map((r) => {
        const callBg = r.itmCall ? 'rgba(239,83,80,0.08)' : 'transparent';
        const putBg  = r.itmPut  ? 'rgba(38,166,154,0.08)' : 'transparent';
        return (
          <React.Fragment key={r.strike}>
            <div onClick={() => onAddLeg({ side, type: 'call', strike: r.strike, premium: parseFloat(r.call.last.toFixed(2)), qty: 1, dte })}
              style={{ ...cc, background: callBg, opacity: 0.6 }}>{r.call.iv.toFixed(0)}%</div>
            <div onClick={() => onAddLeg({ side, type: 'call', strike: r.strike, premium: parseFloat(r.call.last.toFixed(2)), qty: 1, dte })}
              style={{ ...cc, background: callBg, color: '#ef5350', fontWeight: 600 }}>{r.call.bid.toFixed(0)}/{r.call.ask.toFixed(0)}</div>
            <div style={{
              ...cc, textAlign: 'center', fontWeight: r.atm ? 700 : 500,
              background: r.atm ? 'rgba(240,192,104,0.08)' : (light ? 'rgba(20,40,80,0.03)' : 'rgba(255,255,255,0.02)'),
              color: r.atm ? (light ? '#8a6410' : '#f7d394') : (light ? '#3a4658' : '#cdd3df'),
              borderLeft: `1px solid ${light ? 'rgba(25,40,70,0.07)' : 'rgba(255,255,255,0.04)'}`,
              borderRight: `1px solid ${light ? 'rgba(25,40,70,0.07)' : 'rgba(255,255,255,0.04)'}`,
              fontSize: r.atm ? 12 : 11,
            }}>{r.strike}</div>
            <div onClick={() => onAddLeg({ side, type: 'put', strike: r.strike, premium: parseFloat(r.put.last.toFixed(2)), qty: 1, dte })}
              style={{ ...cc, background: putBg, color: '#26a69a', fontWeight: 600, textAlign: 'left' }}>{r.put.bid.toFixed(0)}/{r.put.ask.toFixed(0)}</div>
            <div onClick={() => onAddLeg({ side, type: 'put', strike: r.strike, premium: parseFloat(r.put.last.toFixed(2)), qty: 1, dte })}
              style={{ ...cc, background: putBg, opacity: 0.6, textAlign: 'left' }}>{r.put.iv.toFixed(0)}%</div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
const hCell = (light) => ({
  padding: '6px 8px', fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
  color: light ? 'rgba(20,30,50,0.45)' : 'rgba(255,255,255,0.45)', fontWeight: 600, textAlign: 'right',
  background: light ? 'rgba(20,40,80,0.05)' : 'rgba(255,255,255,0.04)',
  borderBottom: `1px solid ${light ? 'rgba(25,40,70,0.12)' : 'rgba(255,255,255,0.08)'}`,
});
const cCell = (light) => ({
  padding: '8px', textAlign: 'right', cursor: 'pointer',
  borderTop: `1px solid ${light ? 'rgba(25,40,70,0.07)' : 'rgba(255,255,255,0.04)'}`,
  transition: 'background .12s',
});

window.Obsidian3 = Obsidian3;
