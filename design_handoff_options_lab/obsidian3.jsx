// OBSIDIAN v3 — TXO options lab. Multi-workspace: Chain / Calculator / IV Surface / Compare.

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

// Live data providers, keyed by the product's `live` field (products.js).
const BROKER = { ib: 'IB', sinopac: 'SinoPac' };
// What the live badge says: the source's own label when the probe supplied one
// (the TAIFEX end-of-day snapshot: "TAIFEX 09/11 EOD"), else the broker name.
function liveLabel(live, P) {
  return (live && live.health && live.health.label) || BROKER[P.live] || 'live';
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
const K_PERIODS = [
  { id: 'D',  label: '日',  bar: '1 day',   duration: '3 M', n: 60, volScale: 1 },
  { id: '4H', label: '4H',  bar: '4 hours', duration: '1 M', n: 60, volScale: 0.5 },
  { id: '1H', label: '1H',  bar: '1 hour',  duration: '1 M', n: 90, volScale: 0.38 },
];

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

function Glass2({ tone = 'panel', radius = 18, padding = 18, style, children, ...rest }) {
  const styles = {
    panel: {
      background: 'linear-gradient(155deg, rgba(60,68,88,0.42) 0%, rgba(28,34,48,0.32) 60%, rgba(18,22,32,0.28) 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.10) inset, 0 -1px 0 rgba(0,0,0,0.30) inset, 0 20px 40px -20px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.30)',
    },
    chip: {
      background: 'linear-gradient(150deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)',
      border: '1px solid rgba(255,255,255,0.10)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.10) inset, 0 4px 12px -6px rgba(0,0,0,0.40)',
    },
    raised: {
      background: 'linear-gradient(155deg, rgba(80,90,115,0.50) 0%, rgba(36,42,58,0.42) 100%)',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset, 0 -1px 0 rgba(0,0,0,0.30) inset, 0 28px 56px -24px rgba(0,0,0,0.7)',
    },
  };
  return (
    <div className={`g2 g2-${tone}`} style={{
      borderRadius: radius, padding, position: 'relative', overflow: 'hidden',
      backdropFilter: 'blur(36px) saturate(160%)', WebkitBackdropFilter: 'blur(36px) saturate(160%)',
      color: '#e8eaef', ...styles[tone], ...style,
    }} {...rest}>
      <div aria-hidden style={{
        position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',
        background: 'linear-gradient(155deg, rgba(255,255,255,0.06) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.03) 100%)',
      }} />
      {children}
    </div>
  );
}

function Eyebrow({ children, right, hk }) {
  const HT = window.HelpTip; // desktop-only hover help (⑧a); pass hk to enable
  const label = (hk && HT) ? <HT k={hk}>{children}</HT> : children;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600 }}>{label}</span>
      {right}
    </div>
  );
}

// Workspace tabs
function WorkspaceTabs({ value, onChange, accent, light }) {
  // Desktop tabs (design): Compare is shelved and Pricer is folded into
  // Calculator, so the top bar shows four workspaces.
  const items = [
    { id: 'levels', label: 'Levels',     icon: '☰' },
    { id: 'chain',  label: 'Chain',      icon: '☷' },
    { id: 'chart',  label: 'Chart',      icon: '☵' },
    { id: 'calc',   label: 'Calculator', icon: '◈' },
    { id: 'lab',    label: 'Lab',        icon: '◬' },
  ];
  return (
    <Glass2 tone="chip" radius={999} padding={4} style={{ display: 'flex', gap: 2 }}>
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button key={it.id} onClick={() => onChange(it.id)} style={{
            display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 999,
            border: 'none', cursor: 'pointer', transition: 'all .18s',
            background: active ? `linear-gradient(150deg, ${accent} 0%, oklch(0.55 0.18 240) 100%)` : 'transparent',
            color: active ? '#fff' : (light ? 'rgba(20,30,50,0.6)' : 'rgba(255,255,255,0.65)'),
            boxShadow: active ? '0 1px 0 rgba(255,255,255,0.18) inset, 0 4px 10px -4px rgba(0,0,0,0.5)' : 'none',
            fontFamily: 'inherit',
          }}>
            <span style={{ opacity: 0.85, fontSize: 11 }}>{it.icon}</span>
            {it.label}
          </button>
        );
      })}
    </Glass2>
  );
}

// Product dropdown (design ⑥) — replaces the native select with a custom menu
// listing each product's name + reference spot. Shows live IB / mock badge.
function ProductDropdown({ productId, P, spot, live, open, setOpen, onPick, light }) {
  const fmtSpot = (v) => v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 2 : v < 1000 ? 2 : 0 });
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 25 }} />}
      <Glass2 tone="chip" radius={999} padding="8px 12px"
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', cursor: 'pointer', border: '1px solid oklch(0.66 0.16 250 / 0.55)' }}>
        <span className="lt-prodsel" style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>{P.code} ▾</span>
        <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{spot.toLocaleString()}</span>
        {P.live ? (
          <span className={`mono ${live ? '' : 'lt-mock'}`} title={live ? (live.health && live.health.source === 'eod' ? `previous session from TAIFEX (${live.health.asOf}) — no live feed` : `${BROKER[P.live]} connected (delayed/realtime per subscription)`) : `no local data proxy — mock data`} style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: live ? '#4dd0c8' : 'rgba(255,255,255,0.45)' }}>{live ? `● ${liveLabel(live, P)}` : '○ MOCK'}</span>
        ) : (
          <span className="tnum" style={{ fontSize: 11, color: 'oklch(0.78 0.14 145)' }}>+0.84%</span>
        )}
      </Glass2>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 30, width: 250, padding: 6, borderRadius: 14,
          backdropFilter: 'blur(36px) saturate(160%)', WebkitBackdropFilter: 'blur(36px) saturate(160%)',
          background: light ? 'rgba(255,255,255,0.97)' : 'linear-gradient(155deg, rgba(80,90,115,0.92), rgba(36,42,58,0.95))',
          border: `1px solid ${light ? 'rgba(25,40,70,0.16)' : 'rgba(255,255,255,0.14)'}`,
          boxShadow: '0 28px 56px -24px rgba(0,0,0,0.7)', color: light ? '#1c2433' : '#e8eaef',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {window.PRODUCTS.map((p) => (
            <button key={p.id} onClick={() => onPick(p.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 9, border: 'none', textAlign: 'left', cursor: 'pointer',
              background: p.id === productId ? (light ? 'rgba(20,40,80,0.08)' : 'rgba(255,255,255,0.10)') : 'transparent', color: 'inherit',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: light ? 'rgba(20,40,80,0.08)' : 'rgba(255,255,255,0.08)', minWidth: 26, textAlign: 'center' }}>{p.code}</span>
              <span style={{ fontSize: 11, opacity: 0.85, flex: 1 }}>{p.name}</span>
              <span className="tnum" style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', opacity: 0.8 }}>{fmtSpot(p.defaultSpot)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Expiry strip — overflow scroll on narrow desktop windows, plain flex when
// there's room. expiries 由商品決定（TXO 週/月選、穀物月份、或 IB 真實到期日）。
function ExpiryStrip({ value, onChange, expiries = TXO_EXPIRIES, light }) {
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      {expiries.map((e) => {
        const active = e.id === value;
        const isMonthly = e.type === 'monthly';
        return (
          <button key={e.id} onClick={() => onChange(e.id)} style={{
            padding: '6px 11px', borderRadius: 8, border: '1px solid',
            borderColor: active ? (isMonthly ? '#f0c068' : (light ? 'rgba(20,40,80,0.3)' : 'rgba(255,255,255,0.18)')) : (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.08)'),
            background: active ? (isMonthly ? 'rgba(240,192,104,0.16)' : (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)')) : (light ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.02)'),
            color: active ? (isMonthly ? (light ? '#8a6410' : '#f7d394') : (light ? '#1c2433' : '#fff')) : (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)'),
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.1,
            position: 'relative', minWidth: 52, flexShrink: 0,
          }}>
            <span style={{ fontSize: 11 }}>{e.label}</span>
            <span style={{ fontSize: 9, opacity: 0.75, fontFamily: 'var(--font-mono)' }}>{e.date}</span>
            {isMonthly && <span style={{ position: 'absolute', top: -3, right: -3, width: 6, height: 6, borderRadius: 3, background: '#f0c068', boxShadow: '0 0 6px rgba(240,192,104,0.8)' }} />}
          </button>
        );
      })}
    </div>
  );
}

// K-line period toggle (Daily / 4H / 1H) — small segmented control.
function KPeriodToggle({ value, onChange, light = false }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {K_PERIODS.map((p) => {
        const active = p.id === value;
        return (
          <button key={p.id} onClick={() => onChange(p.id)} style={{
            fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, minWidth: 26,
            border: '1px solid ' + (active ? (light ? 'rgba(20,40,80,0.3)' : 'rgba(255,255,255,0.22)') : (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.08)')),
            background: active ? (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)') : 'transparent',
            color: active ? 'inherit' : (light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.5)'),
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{p.label}</button>
        );
      })}
    </div>
  );
}

// 日盤 / 全日盤 toggle for the K-line. 全日盤 folds the night session into the
// trading day it belongs to (TAIFEX books the after-hours session under the
// next business day), so one bar = 15:00 → 13:45.
function KSessionToggle({ value, onChange, light = false }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[{ id: 'day', label: '日盤' }, { id: 'full', label: '全日盤' }].map((p) => {
        const active = p.id === value;
        return (
          <button key={p.id} onClick={() => onChange(p.id)} style={{
            fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, minWidth: 26,
            border: '1px solid ' + (active ? (light ? 'rgba(20,40,80,0.3)' : 'rgba(255,255,255,0.22)') : (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.08)')),
            background: active ? (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)') : 'transparent',
            color: active ? 'inherit' : (light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.5)'),
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{p.label}</button>
        );
      })}
    </div>
  );
}

// Collapsible global What-if rail (design ⑦, owner-revised to be tucked away).
// Collapsed = a small pill with a spot/IV readout; expanded = Spot + IV sliders.
function WhatIfRail({ P, spot, setSpot, spotMin, spotMax, iv, setIv, open, setOpen, theme, light }) {
  if (!open) {
    return (
      <Glass2 tone="chip" radius={999} padding="8px 14px" onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 20, right: 24, zIndex: 15, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>⇅ What-if</span>
        <span className="tnum" style={{ fontSize: 11, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>{P.code} {spot.toLocaleString()} · IV {iv}%</span>
      </Glass2>
    );
  }
  return (
    <Glass2 tone="raised" radius={14} padding="10px 16px"
      style={{ position: 'fixed', bottom: 20, right: 24, zIndex: 15, width: 520, maxWidth: 'calc(100vw - 48px)', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 18, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 9, letterSpacing: 0.7, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600 }}>What-if</span>
        <button onClick={() => setOpen(false)} title="collapse" style={{ fontSize: 13, lineHeight: 1, padding: '2px 7px', borderRadius: 6, border: '1px solid rgba(128,140,170,0.3)', background: 'rgba(128,140,170,0.12)', color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
      </div>
      <Slider label={`Spot · ${P.code}`} value={spot} min={spotMin} max={spotMax} step={P.spotStep} onChange={setSpot} format={(v) => v.toLocaleString()} theme={theme} />
      <Slider label="IV" value={iv} min={P.ivMin} max={P.ivMax} step={0.5} suffix="%" onChange={setIv} theme={theme} />
    </Glass2>
  );
}

// Settlement countdown
function SettlementCountdown({ dte, note = '13:30' }) {
  const isSettleDay = dte <= 0;
  return (
    <Glass2 tone="chip" radius={10} padding="6px 12px" style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', flexShrink: 0,
      border: isSettleDay ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.10)',
      background: isSettleDay ? 'linear-gradient(150deg, rgba(239,68,68,0.20), rgba(239,68,68,0.10))' : undefined,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: isSettleDay ? '#ef4444' : '#f0c068', boxShadow: `0 0 8px ${isSettleDay ? '#ef4444' : '#f0c068'}` }} />
      <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.6, fontWeight: 600 }}>Settle</span>
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
        {dte}d · {note}
      </span>
    </Glass2>
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
      {stale && <span style={{ fontWeight: 800 }}>STALE</span>}{hhmmss}
    </span>
  );
}

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
    const qId = setInterval(pullQuote, 10000);
    const cId = setInterval(pullChain, 30000);
    const onVis = () => { if (!document.hidden) { pullQuote(); pullChain(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; clearInterval(qId); clearInterval(cId); document.removeEventListener('visibilitychange', onVis); };
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
  const rangeLevels = uM(() => {
    const q = quoteNow || (live && live.quote);
    const today = (q && q.high > 0 && q.low > 0) ? { date: taipeiDate(), high: q.high, low: q.low } : { date: taipeiDate() };
    return computeRangeLevels({ bars: dayBars, today });
  }, [dayBars, quoteNow, live]);
  // K 線：live（IB 日K）優先，否則 mock 隨機漫步。
  // 刻意不依賴 spot — 拉 slider 屬於情境模擬，不該重繪歷史走勢。
  const bars = uM(() => {
    if (liveBars && liveBars.length) return liveBars;
    const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
    return window.genBars ? window.genBars({ spot, n: per.n, volScale: per.volScale, product: P }) : [];
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
  function addLegFromChain(leg) {
    setLegs((prev) => [...prev, leg]);
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

  return (
    <div style={{
      width: '100%', minHeight: '100vh', position: 'relative', overflow: 'hidden',
      fontFamily: 'var(--font-display)', color: light ? '#1c2433' : '#e8eaef',
      background: light ? `
        radial-gradient(ellipse 60% 70% at 18% 30%, ${t.showAuroraBlobs ? `oklch(0.90 0.045 ${t.accentHue}) 0%` : 'transparent 0%'}, transparent 60%),
        radial-gradient(ellipse 50% 50% at 82% 70%, ${t.showAuroraBlobs ? 'oklch(0.93 0.035 60) 0%' : 'transparent 0%'}, transparent 60%),
        linear-gradient(180deg, #eef1f6 0%, #e4e9f2 100%)
      ` : `
        radial-gradient(ellipse 60% 70% at 18% 30%, ${t.showAuroraBlobs ? `oklch(0.34 0.10 ${t.accentHue}) 0%` : 'transparent 0%'}, transparent 60%),
        radial-gradient(ellipse 50% 50% at 82% 70%, ${t.showAuroraBlobs ? 'oklch(0.30 0.08 30) 0%' : 'transparent 0%'}, transparent 60%),
        radial-gradient(ellipse 80% 60% at 50% 100%, ${t.showAuroraBlobs ? `oklch(0.26 0.06 ${(t.accentHue + 60) % 360}) 0%` : 'transparent 0%'}, transparent 65%),
        linear-gradient(180deg, #0a0d14 0%, #11151f 100%)
      `,
    }}>
      {/* texture grid */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none',
        backgroundImage: `radial-gradient(circle, ${light ? 'rgba(20,40,80,0.05)' : 'rgba(255,255,255,0.04)'} 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
      }} />

      {/* Top bar. Sits above the expiry strip: both rows are positioned siblings and
          the bar creates a stacking context, so the bar's own z-index — not the
          dropdown's — decides whether the product menu nested inside it is clickable.
          At equal z-index the later strip won and covered the menu's first rows. */}
      <div style={{ position: 'absolute', top: 18, left: 24, right: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 20, gap: 12 }}>
        <Glass2 tone="chip" radius={999} padding="8px 14px" style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, oklch(0.78 0.14 75), ${accent})`, boxShadow: `0 0 12px -2px ${accent}` }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>Options Lab</span>
        </Glass2>

        <WorkspaceTabs value={workspace} onChange={setWorkspace} accent={accent} light={light} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <DataQualityPill quality={quality} />
          {live && P.live && !(live.health && live.health.source === 'eod') && <FreshnessChip lastLiveAt={lastLiveAt} />}
          <ProductDropdown
            productId={productId} P={P} spot={spot} live={live}
            open={prodMenuOpen} setOpen={setProdMenuOpen}
            onPick={(id) => { switchProduct(id); setProdMenuOpen(false); }}
            light={light}
          />
          <SettlementCountdown dte={dte} note={P.settleNote} />
          <Glass2 tone="chip" radius={999} padding="8px 13px" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setTheme(light ? 'dark' : 'light')} title="切換 亮色 / 深色">
            <span style={{ fontSize: 13 }}>{light ? '☀' : '☾'}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{light ? 'Light' : 'Dark'}</span>
          </Glass2>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <Glass2 tone="chip" radius={999} padding="8px 12px" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', border: helpOpen ? '1px solid oklch(0.66 0.16 250 / 0.6)' : undefined }}
              onClick={() => { setHelpOpen((v) => !v); dismissHelpHint(); }} title="Help — how to read this">
              <span style={{ fontSize: 13, fontWeight: 700 }}>?</span>
            </Glass2>
            {!helpHintSeen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 20, whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999,
                background: 'rgba(240,192,104,0.16)', border: '1px solid rgba(240,192,104,0.4)',
                fontSize: 10, fontWeight: 600, color: light ? '#8a6410' : '#f7d394',
              }}>
                New here? Click <b>?</b> for a guide
                <button onClick={(e) => { e.stopPropagation(); dismissHelpHint(); }} title="dismiss" style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0, fontFamily: 'inherit' }}>×</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expiry strip — second row */}
      <div style={{ position: 'absolute', top: 64, left: 24, right: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 12 }}>
        <ExpiryStrip value={expiryId} onChange={setExpiryId} expiries={expiries} light={light} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {workspace === 'lab' && <LabToggle value={labView} onChange={setLabView} light={light} />}
          <Glass2 tone="chip" radius={8} padding="5px 10px" style={{ fontSize: 10, opacity: 0.7, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
            {P.unitLabel}
          </Glass2>
        </div>
      </div>

      {/* WORKSPACE BODY */}
      {workspace === 'levels' && (
        <LevelsWorkspace
          P={P} theme={theme} light={light} spot={spot} expiry={expiry} levels={levels} live={live} market={marketData}
          rangeLevels={rangeLevels} dayBarsLive={!!liveDayBars} gex={gex}
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
          portfolioG={portfolioG} popValue={popValue} quality={quality}
        />
      )}
      {workspace === 'lab' && labView === '3d' && (
        <LabSurface P={P} theme={theme} light={light} t={t} spot={spot} dte={dte} legs={legs} hover={hover} setHover={setHover} D={D} />
      )}
      {workspace === 'lab' && labView === 'iv' && (
        <IVWorkspace D={D} P={P} spot={spot} iv={iv} expiry={expiry} expiries={expiries} rows={chainRows} hv20={hv20} hvLive={hvLive} dayBars={dayBars} live={live} light={light} theme={theme} />
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
          quality={quality}
        />
      )}
      {workspace === 'chart' && (
        <ChartWorkspace
          P={P} bars={bars} barsLive={!!liveBars} live={live} theme={theme} light={light}
          barPeriodId={barPeriodId} setBarPeriodId={setBarPeriodId}
          barSession={barSession} setBarSession={setBarSession}
          cone={levels.atmIv ? { ivPct: levels.atmIv, days: expiry.dte, label: expiry.label } : null}
          D={D}
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
function CalcWorkspace({ P, theme = 'dark', rows, expiries, live, legs, setLegs, spot, setSpot, spotMin, spotMax, iv, setIv, dte, sliceFrac, setSliceFrac, view, setView, pnlPts, pnlNTD, maxProfit, maxLoss, fees = 0, accent, D, t, portfolioG, popValue, quality }) {
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
      setImportNote(`${res.positions.length} position${res.positions.length === 1 ? '' : 's'} loaded`);
    } else {
      setImportNote(`no ${BROKER[P.live]} positions`);
    }
    setTimeout(() => setImportNote(null), 3500);
  }
  // The right column's analysis tabs no longer include Payoff (it is the centre
  // panel now); a saved 'payoff' view shows the P&L cross-section instead.
  const rv = view === 'payoff' ? 'cross' : view;

  return (
    <>
      {/* Centre: the payoff chart at full size, with the time slice (the 3D
          surface that used to sit here lives in the Lab tab). */}
      <div style={{ position: 'absolute', top: 110, left: 24 + 320 + D.gap, right: 24 + 340 + D.gap, zIndex: 5, maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow hk="payoff" right={
            <span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>
              {sliceFrac >= 0.99 ? 'at expiry' : sliceFrac <= 0.01 ? 'now' : `t = ${(sliceFrac * 100).toFixed(0)}%`} · {legs.length} leg{legs.length === 1 ? '' : 's'}
            </span>
          }>Payoff {t.showProbCone && <span style={{ color: '#a78bfa', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· 1σ/2σ cone</span>}</Eyebrow>
          <PayoffChart legs={legs} spot={spot} theme={theme} height={320} width={720} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={sliceFrac} rangePct={0.08} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, opacity: 0.55, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
              <span>Time slice</span>
              <span className="mono">now → expiry</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" value={sliceFrac} onChange={(e) => setSliceFrac(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: accent }} />
          </div>
        </Glass2>

        {/* P&L by price × date (the OptionStrat table), gross of fees */}
        {legs.length > 0 && (
          <Glass2 tone="panel" padding={D.panelPad} style={{ marginTop: D.gap }}>
            <Eyebrow hk="pnlheat" right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>IV {iv.toFixed(1)}% 固定 · {P.cur} · 毛損益</span>}>損益表 · 價格 × 日期</Eyebrow>
            <window.PnLHeatmap legs={legs} spot={spot} iv={iv} dte={dte} P={P} theme={theme} />
          </Glass2>
        )}
      </div>

      {/* Left column */}
      <div className="calc-col" style={{
        position: 'absolute', top: 110, left: 24, width: 320, zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: D.gap,
        maxHeight: 'calc(100vh - 200px)', overflow: 'auto', paddingBottom: 4,
      }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={
            <div style={{ display: 'flex', gap: 4 }}>
              {canImport && <button style={miniBtn} disabled={importing} onClick={importPositions} title={`Load your real ${BROKER[P.live]} option positions`}>{importing ? '…' : `⟳ ${BROKER[P.live]}`}</button>}
              <StrategyMenu P={P} spot={spot} iv={iv} dte={dte} onPick={setLegs} light={light} />
              <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>+ leg</button>
            </div>
          }>Legs</Eyebrow>
          <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
          {importNote && <div style={{ fontSize: 10, opacity: 0.6, marginTop: 6, fontFamily: 'var(--font-mono)' }}>{importNote}</div>}
        </Glass2>

        {/* Single-contract pricer — folded in from the removed Pricer tab.
            Auto: pick a strike, IV is pulled from the chain smile, price is live. */}
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow hk="pricer" right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{P.model === 'b76' ? 'Black-76' : 'Black-Scholes'}</span>}>Option Pricer</Eyebrow>
          <OptionPricer key={P.id} product={P} spot={spot} iv={iv} dte={dte} rows={rows} theme={theme} accent={accent} />
        </Glass2>
      </div>

      {/* Right column */}
      <div className="calc-col" style={{
        position: 'absolute', top: 110, right: 24, width: 340, zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: D.gap,
        maxHeight: 'calc(100vh - 200px)', overflow: 'auto', paddingBottom: 4,
      }}>
        <Glass2 tone="raised" padding={D.panelPad}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <Eyebrow hk="pnlnow">P&L now</Eyebrow>
              <div className="tnum" style={{
                fontSize: 32, fontWeight: 600, letterSpacing: -0.6,
                color: netPnl >= 0 ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)') : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)'),
                fontFamily: 'var(--font-mono)', lineHeight: 1,
              }}>
                {netPnl >= 0 ? '+' : ''}{P.cur}{Math.abs(Math.round(netPnl)).toLocaleString()}
              </div>
              <div className="tnum" style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                {pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} pts {P.unitLabel}
              </div>
              <div className="tnum" style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
                Max profit <span style={{ color: '#f0c068' }}>+{P.cur}{Math.round(netMaxProfit).toLocaleString()}</span>
                <span style={{ opacity: 0.4 }}> · </span>
                Max loss <span style={{ color: '#5fa3d4' }}>{P.cur}{Math.round(netMaxLoss).toLocaleString()}</span>
              </div>
              {fees > 0 && (
                <div className="tnum" style={{ fontSize: 9, opacity: 0.45, marginTop: 4 }}>
                  incl. est. fees {P.cur}{Math.round(fees).toLocaleString()}
                </div>
              )}
            </div>
            <div style={{ width: 110 }}>
              <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600, textAlign: 'center' }}>POP</div>
              <POPGauge theme={theme} size={110} value={popValue} />
            </div>
          </div>
        </Glass2>

        {/* analysis tabs */}
        <Glass2 tone="chip" padding={4} style={{ display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { id: 'cross', label: 'P&L' },
            { id: 'greeks', label: 'Greeks' },
            { id: 'dist', label: 'Dist' },
            { id: 'attr', label: 'Attr' },
            { id: 'theta', label: 'Theta' },
            { id: 'iv', label: 'IV' },
          ].map((tab) => (
            <button key={tab.id} onClick={() => setView(tab.id)} style={{
              flex: '1 0 auto', minWidth: 56, fontSize: 11, fontWeight: 600, padding: '7px 10px', borderRadius: 999,
              border: 'none', cursor: 'pointer', transition: 'all .18s',
              background: rv === tab.id ? (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)') : 'transparent',
              color: rv === tab.id ? 'inherit' : (light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.55)'),
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>{tab.label}</button>
          ))}
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          {rv === 'cross' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d</span>}>P&L vs spot</Eyebrow>
            <CrossSection theme={theme} dte={dte} height={140} width={304} />
          </>)}
          {rv === 'greeks' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d · IV {iv}%</span>}>
              Greeks <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· Δ Γ Θ V vs spot</span>
            </Eyebrow>
            <GreeksProfile legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={140} width={304} model={P.model} r={P.r / 100} />
          </>)}
          {rv === 'dist' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>at expiry</span>}>
              P&L distribution <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· lognormal</span>
            </Eyebrow>
            <PnLDistribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={140} width={304} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />
          </>)}
          {rv === 'attr' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>vs baseline</span>}>
              P&L attribution <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· why up / down</span>
            </Eyebrow>
            <PnLAttribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={150} width={304} baseSpot={P.defaultSpot} baseIv={P.defaultIv} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />
          </>)}
          {rv === 'theta' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>θ decay</span>}>Time decay</Eyebrow>
            <ThetaDecay theme={theme} dte={dte} height={140} width={304} />
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>−{P.cur}{(0.12 * P.mult * 100).toFixed(0)} / day at current DTE</div>
          </>)}
          {rv === 'iv' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{iv}% ATM</span>}>IV smile</Eyebrow>
            <IVSmile theme={theme} iv={iv} height={140} width={304} />
          </>)}
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<DataQualityPill quality={quality} />}>Greeks</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <GreekChip label="Delta · Δ" helpKey="delta" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
            <GreekChip label="Gamma · Γ" helpKey="gamma" value={portfolioG.gamma.toFixed(4)} theme={theme} />
            <GreekChip label="Theta · Θ" helpKey="theta" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
            <GreekChip label="Vega · V" helpKey="vega" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
          </div>
        </Glass2>
      </div>

      {/* Spot / IV live in the global What-if rail (shell) now. */}
    </>
  );
}

// ───────────────────────────────────────────────── LAB WORKSPACE
// Research views demoted from the working tabs (owner request, 2026-09): the
// 3D P&L surface that used to be the Calculator's backdrop, and the IV
// surface that used to be its own tab. The sub-view toggle sits in the
// expiry row so neither view has to make room for it.
function LabToggle({ value, onChange, light = false }) {
  return (
    <Glass2 tone="chip" radius={999} padding={3} style={{ display: 'flex', gap: 2 }}>
      {[{ id: '3d', label: '3D P&L' }, { id: 'iv', label: 'IV Surface' }].map((v) => {
        const active = v.id === value;
        return (
          <button key={v.id} onClick={() => onChange(v.id)} style={{
            fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            background: active ? (light ? 'rgba(20,40,80,0.12)' : 'rgba(255,255,255,0.14)') : 'transparent',
            color: active ? 'inherit' : (light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.55)'),
          }}>{v.label}</button>
        );
      })}
    </Glass2>
  );
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
          padding: '8px 14px', borderRadius: 999,
          background: 'rgba(20,24,34,0.85)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.12)',
          fontSize: 12, fontFamily: 'var(--font-mono)',
          display: 'flex', gap: 14, alignItems: 'center', pointerEvents: 'none',
        }}>
          <span><span style={{ opacity: 0.55 }}>spot </span>{parseInt(hoverInfo.spotAt).toLocaleString()}</span>
          <span style={{ opacity: 0.3 }}>·</span>
          <span><span style={{ opacity: 0.55 }}>DTE </span>{hoverInfo.dteAt}d</span>
          <span style={{ opacity: 0.3 }}>·</span>
          <span style={{ color: parseFloat(hoverInfo.pnlAt) >= 0 ? '#f0c068' : '#5fa3d4', fontWeight: 600 }}>
            {P.cur}{parseFloat(hoverInfo.pnlAt) >= 0 ? '+' : ''}{Math.round(parseFloat(hoverInfo.pnlAt)).toLocaleString()}
          </span>
        </div>
      )}
      <Glass2 tone="panel" padding={D.panelPad} style={{ position: 'absolute', bottom: 24, left: 24, zIndex: 5, width: 300 }}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{P.code} · {dte}d</span>}>3D P&L surface</Eyebrow>
        <div style={{ fontSize: 11, lineHeight: 1.6, opacity: 0.8 }}>
          Horizontal = underlying price, depth = days passing (front edge today, back edge expiry), height and color = P&L. Drag to orbit, scroll to zoom.
        </div>
        <div style={{ fontSize: 10, marginTop: 8, opacity: 0.55, lineHeight: 1.5 }}>
          Stylised surface — not yet driven by the {legs.length} working leg{legs.length === 1 ? '' : 's'}. The payoff chart on Calculator is the position's real P&L.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.55, fontWeight: 600 }}>P&L</span>
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
function WhatIfCard({ P, pnlPts, pnlNTD, maxProfit, maxLoss, popValue, fees = 0, theme, light, D }) {
  // Net of estimated round-trip fees (⑤).
  const netPnl = pnlNTD - fees;
  const netMaxProfit = maxProfit - fees;
  const netMaxLoss = maxLoss - fees;
  const profit = netPnl >= 0;
  const heroColor = profit
    ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)')
    : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)');
  const tile = { padding: '7px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' };
  return (
    <Glass2 tone="raised" padding="14px 14px 12px" radius={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow hk="pnlwhatif">P&L what-if · {P.code}</Eyebrow>
          <div className="tnum" style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.05, marginTop: 3, fontFamily: 'var(--font-mono)', color: heroColor }}>
            {profit ? '+' : ''}{P.cur}{Math.abs(Math.round(netPnl)).toLocaleString()}
          </div>
          <div className="tnum" style={{ fontSize: 9, opacity: 0.5, marginTop: 3 }}>{pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} pts {P.unitLabel}{fees > 0 ? ` · incl. est. fees ${P.cur}${Math.round(fees).toLocaleString()}` : ''}</div>
        </div>
        <div style={{ width: 74, flexShrink: 0 }}>
          <POPGauge theme={theme} size={74} value={popValue} />
          <div style={{ textAlign: 'center', fontSize: 7, opacity: 0.5, marginTop: 3, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>prob. of profit</div>
        </div>
      </div>
      <div style={{ height: 1, background: light ? 'rgba(20,30,50,0.10)' : 'rgba(255,255,255,0.10)', margin: '10px 0 9px' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="lt-tile" style={tile}>
          <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.6 }}>Max profit</div>
          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: 'var(--font-mono)', color: '#f0c068' }}>+{P.cur}{Math.round(netMaxProfit).toLocaleString()}</div>
        </div>
        <div className="lt-tile" style={tile}>
          <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.6 }}>Max loss</div>
          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: 'var(--font-mono)', color: '#5fa3d4' }}>{P.cur}{Math.round(netMaxLoss).toLocaleString()}</div>
        </div>
      </div>
    </Glass2>
  );
}

// Chain-tab layout switcher (design ③): SIDE / WIDE / SPLIT.
const CHAIN_LAYOUTS = {
  a: { label: 'SIDE',  cols: 'minmax(460px,1fr) minmax(340px,392px)', areas: "'chain pnl' 'chain payoff' 'chain greeks' 'chain legs'" },
  b: { label: 'WIDE',  cols: '1fr 1fr',            areas: "'chain chain' 'pnl payoff' 'greeks legs'" },
  c: { label: 'SPLIT', cols: '1.1fr 1fr 1fr',      areas: "'chain chain chain' 'payoff pnl legs' 'greeks greeks greeks'" },
};
function LayoutToggle({ value, onChange, light }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.45, fontWeight: 600 }}>Layout</span>
      {Object.keys(CHAIN_LAYOUTS).map((k) => {
        const active = k === value;
        return (
          <button key={k} onClick={() => onChange(k)} style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '3px 10px', borderRadius: 999,
            border: '1px solid ' + (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.14)'),
            background: active ? 'linear-gradient(150deg,oklch(0.66 0.16 250),oklch(0.55 0.18 240))' : 'transparent',
            color: active ? '#fff' : (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)'),
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{CHAIN_LAYOUTS[k].label}</button>
        );
      })}
    </div>
  );
}

function ChainWorkspace({ P, rows, theme = 'dark', spot, setSpot, expiry, expiries, onAddLeg, legs, setLegs,
  iv, setIv, dte, pnlPts, pnlNTD, maxProfit, maxLoss, fees = 0, popValue, portfolioG, accent, t, D, quality }) {
  const light = theme === 'light';
  const [layout, setLayout] = uS('a');
  const lay = CHAIN_LAYOUTS[layout];
  const credit = legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0);
  const glassArea = (area, children, pad = D.panelPad) => (
    <Glass2 tone="panel" padding={pad} style={{ gridArea: area, minWidth: 0 }}>{children}</Glass2>
  );
  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, overflowY: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <LayoutToggle value={layout} onChange={setLayout} light={light} />
      </div>

      <div style={{ display: 'grid', gap: D.gap, alignItems: 'start', gridTemplateColumns: lay.cols, gridTemplateAreas: lay.areas }}>
        {/* chain */}
        <Glass2 tone="panel" padding={D.panelPad} style={{ gridArea: 'chain', minWidth: 0 }}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>Option Chain · {P.code}</Eyebrow>
          <OptionChain spot={spot} contract={expiry.type} dte={expiry.dte} product={P} rows={rows} legs={legs} onAddLeg={onAddLeg} theme={theme} />
        </Glass2>

        {/* pnl what-if */}
        <div style={{ gridArea: 'pnl', minWidth: 0 }}>
          <WhatIfCard P={P} pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss} fees={fees} popValue={popValue} theme={theme} light={light} D={D} />
        </div>

        {/* payoff */}
        {glassArea('payoff', (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>at expiry</span>}>
            Payoff {t.showProbCone && <span style={{ color: '#a78bfa', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· 1σ/2σ cone</span>}
          </Eyebrow>
          <PayoffChart legs={legs} spot={spot} theme={theme} height={150} width={304} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={1} rangePct={0.08} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />
        </>))}

        {/* greeks */}
        <div style={{ gridArea: 'greeks', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
          <GreekChip label="Delta · Δ" helpKey="delta" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Gamma · Γ" helpKey="gamma" value={portfolioG.gamma.toFixed(4)} theme={theme} />
          <GreekChip label="Theta · Θ" helpKey="theta" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Vega · V" helpKey="vega" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
        </div>

        {/* legs */}
        {glassArea('legs', (<>
          <Eyebrow right={
            <div style={{ display: 'flex', gap: 4 }}>
              <StrategyMenu P={P} spot={spot} iv={iv} dte={dte} onPick={setLegs} light={light} />
              <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>+ leg</button>
              {legs.length > 0 && <button style={miniBtn} onClick={() => setLegs([])}>clear</button>}
            </div>
          }>Legs · {legs.length}</Eyebrow>
          {legs.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, opacity: 0.5 }}>Click any chain row to add a leg</div>
          ) : (
            <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6, marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            <span>{credit >= 0 ? 'Net credit' : 'Net debit'}</span>
            <span>{credit >= 0 ? '+' : ''}{P.cur}{Math.round(credit * P.mult).toLocaleString()}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
            {[
              { label: '−5% & IV+15%', spot: -5, iv: 15 },
              { label: '−10% crash', spot: -10, iv: 21 },
            ].map((s, i) => (
              <button key={i} onClick={() => {
                setSpot(Math.round(P.defaultSpot * (1 + s.spot / 100) / P.spotStep) * P.spotStep);
                setIv(Math.max(P.ivMin, Math.min(P.ivMax, P.defaultIv + s.iv)));
              }} style={{
                padding: '8px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                border: '1px solid rgba(128,140,170,0.28)', cursor: 'pointer',
                background: 'rgba(128,140,170,0.12)', color: 'inherit', fontFamily: 'inherit',
              }}>{s.label}</button>
            ))}
          </div>
        </>))}
      </div>

      {/* OI Profile + Max Pain — kept, below the grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: D.gap, marginTop: D.gap }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>OI profile</Eyebrow>
          <OIProfile spot={spot} contract={expiry.type} rows={rows} theme={theme} maxRows={11} />
        </Glass2>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>settlement</span>}>Max pain</Eyebrow>
          <MaxPain spot={spot} contract={expiry.type} rows={rows} ntdMult={P.mult} cur={P.cur} theme={theme} height={150} width={520} />
        </Glass2>
      </div>
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
      <div title={`振幅 ${fmtP(l.dist)} 點`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 6, alignItems: 'baseline', padding: '4px 8px', borderRadius: 8, opacity: reached ? 0.45 : 1, whiteSpace: 'nowrap',
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
    <Glass2 tone="chip" radius={12} padding="10px 12px" style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
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
function LevelsLadder({ P, spot, L, G, light }) {
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
            padding: r.isSpot ? '10px 12px' : '9px 12px', marginBottom: 6, borderRadius: 10,
            background: r.isSpot ? 'rgba(240,192,104,0.10)' : (light ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.03)'),
            border: `1px solid ${r.isSpot ? 'rgba(240,192,104,0.45)' : line}`,
          }}>
            <span aria-hidden style={{ position: 'absolute', left: -18, top: '50%', width: 10, height: 10, marginTop: -5, borderRadius: 5, background: r.color, boxShadow: `0 0 8px ${r.color}` }} />
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

function LevelsWorkspace({ P, theme = 'dark', light = false, spot, expiry, levels: L, live, market: M, rangeLevels: R, dayBarsLive, gex: G, bars, barsLive, barPeriodId, setBarPeriodId, barSession, setBarSession, D }) {
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
  const chartLevels = [];
  if (L.resistance) chartLevels.push({ price: L.resistance.strike, label: '壓力 Call OI最大', color: LEVEL_COLORS.up });
  if (L.straddle != null) {
    chartLevels.push({ price: L.atm.strike + L.straddle, label: '價平＋和', color: LEVEL_COLORS.band });
    chartLevels.push({ price: L.atm.strike - L.straddle, label: '價平－和', color: LEVEL_COLORS.band });
  }
  if (L.support) chartLevels.push({ price: L.support.strike, label: '支撐 Put OI最大', color: LEVEL_COLORS.down });
  if (G && G.flip != null) chartLevels.push({ price: G.flip, label: '零Gamma', color: LEVEL_COLORS.gex });
  // 關卡價: only the two 一壘 lines go on the chart — ten would bury the candles.
  if (R) {
    chartLevels.push({ price: R.up[0].price, label: '一壘↑', color: LEVEL_COLORS.range });
    chartLevels.push({ price: R.down[0].price, label: '一壘↓', color: LEVEL_COLORS.range });
  }
  // The nearer unreached 一壘 for the strip tile — his header's 「距一壘 … 差 N 點」.
  const near1B = (() => {
    if (!R) return null;
    const cands = [{ side: '上', price: R.up[0].price }, { side: '下', price: R.down[0].price }]
      .filter((c) => (c.side === '上' ? c.price > spot : c.price < spot));
    if (!cands.length) return null;
    return cands.reduce((a, b) => (Math.abs(a.price - spot) <= Math.abs(b.price - spot) ? a : b));
  })();
  const rangeSource = dayBarsLive ? `● ${liveLabel(live, P)} 日K` : '○ 模擬日K';
  // OI table centered on the strike nearest spot, walls highlighted.
  let atmK = null;
  for (const r of L.oiRows) if (atmK == null || Math.abs(r.strike - spot) < Math.abs(atmK - spot)) atmK = r.strike;
  const oiRows = L.oiRows.map((r) => ({ ...r, atm: r.strike === atmK }));
  const walls = { call: L.resistance ? L.resistance.strike : null, put: L.support ? L.support.strike : null };
  const dim = light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)';
  const pc = M && M.pcRatio, fx = M && M.foreign, t10 = M && M.top10;
  const noMkt = isLive ? '期交所資料未載入' : '模擬模式沒有籌碼資料';
  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, overflowY: 'auto', paddingBottom: 4 }}>
      {/* the strip: 關卡 on the left, 籌碼 on the right — one row of big numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(172px, 1fr))', gap: D.gap, marginBottom: D.gap }}>
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
          sub={L.sigma1 != null ? <>{fmtP(Math.round(spot - L.sigma1))}–{fmtP(Math.round(spot + L.sigma1))} · IV {L.atmIv.toFixed(1)}% · {expiry.dte}d{L.straddle != null ? ` · 價平和×0.85 ${window.fmtPx(L.straddle * 0.85, P)}` : ''}</> : '沒有 IV'} light={light} />
        <LevelTile label="距一壘" hk="rangelevels" color={LEVEL_COLORS.range}
          value={near1B ? fmtP(near1B.price) : '—'}
          sub={near1B ? <>{near1B.side}方一壘 · 差 <b>{fmtP(Math.abs(near1B.price - spot))}</b> 點</> : (R ? '兩側一壘皆已到達' : '日K不足')} light={light} />
        <LevelTile label="P/C 比（全市場）" hk="pcratio"
          value={pc ? pc.ratio.toFixed(2) : '—'}
          color={pc ? (pc.ratio >= 1 ? LEVEL_COLORS.down : LEVEL_COLORS.up) : undefined}
          sub={pc ? <>較前日 <Chg v={pc.chg} fmt={(x) => x.toFixed(2)} /></> : noMkt}
          right={pc ? <Spark series={pc.series} w={64} light={light} /> : null} light={light} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(380px, 440px) 1fr', gap: D.gap, alignItems: 'start' }}>
        {/* ladder */}
        <Glass2 tone="panel" padding={D.panelPad} style={{ minWidth: 0 }}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>關卡 · {P.code}</Eyebrow>
          <LevelsLadder P={P} spot={spot} L={L} G={G} light={light} />
          <div className="mono" style={{ marginTop: 10, fontSize: 9.5, color: dim, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>{oiLabel}</span>
            <span>權利金：{isLive ? `● ${liveLabel(live, P)}` : '○ 模擬'}</span>
          </div>
          <div style={{ marginTop: D.gap, paddingTop: D.gap, borderTop: `1px solid ${light ? 'rgba(25,40,70,0.18)' : 'rgba(255,255,255,0.12)'}` }}>
            <Eyebrow hk="rangelevels" right={<span className="mono tnum" style={{ fontSize: 9, opacity: 0.5 }}>近{RANGE_LEVEL_N}日振幅</span>}>關卡價 · 振幅</Eyebrow>
            <RangeLevelsPanel P={P} spot={spot} R={R} light={light} sourceLabel={rangeSource} />
          </div>
        </Glass2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: D.gap, minWidth: 0 }}>
          {/* K-line with the levels drawn on it */}
          <Glass2 tone="panel" padding={D.panelPad}>
            <Eyebrow right={<div style={{ display: 'flex', gap: 8 }}><KSessionToggle value={barSession} onChange={setBarSession} light={light} /><KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} light={light} /></div>}>
              台指期 {barSession === 'full' ? '全日盤' : '日盤'} 日K · 關卡疊圖
              <span style={{ color: dim, fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· {barsLive ? liveLabel(live, P) : '模擬'}</span>
            </Eyebrow>
            <PriceChart bars={bars} theme={theme} code={P.code} periodLabel={per.label === '日' ? 'Daily' : per.label} levels={chartLevels}
              cone={L.atmIv ? { ivPct: L.atmIv, days: expiry.dte, label: expiry.label } : null} />
          </Glass2>

          {/* OI by strike with change column */}
          <Glass2 tone="panel" padding={D.panelPad}>
            <Eyebrow hk="oichg" right={<span className="mono tnum" style={{ fontSize: 9.5, opacity: 0.6 }}>{pcExpiry != null ? `本到期日 P/C ${pcExpiry.toFixed(2)} · ` : ''}{oiLabel}</span>}>各履約價未平倉 · 對前日增減</Eyebrow>
            <OIProfile spot={spot} contract={expiry.type} rows={oiRows} theme={theme} maxRows={15} showChange walls={walls} />
          </Glass2>

          {/* Dealer gamma exposure by strike (SpotGamma-style), same expiry */}
          <Glass2 tone="panel" padding={D.panelPad}>
            <Eyebrow hk="gex" right={<span className="mono tnum" style={{ fontSize: 9.5, opacity: 0.6 }}>{G ? <>總 GEX <b style={{ color: G.total >= 0 ? LEVEL_COLORS.up : LEVEL_COLORS.down }}>{fmtBig(G.total, P)}</b>/1%{G.flip != null ? ` · 零 Gamma ${fmtP(Math.round(G.flip))}` : ''} · </> : ''}{oiLabel}</span>}>Gamma 曝險 · 各履約價（本到期日）</Eyebrow>
            {G ? <GexProfile P={P} spot={spot} G={G} theme={theme} light={light} maxRows={15} /> : <div className="mono" style={{ fontSize: 11, color: dim }}>沒有 OI 或 IV，無法計算。</div>}
            <div className="mono" style={{ marginTop: 8, fontSize: 9.5, color: dim }}>
              GEX = γ × OI × {P.mult} × S² × 1%，Call 為正、Put 為負（SqueezeMetrics 的造市者存貨慣例：Call 多 Gamma／Put 空 Gamma）。零 Gamma 以上造市者順勢對沖壓抑波動，以下追價放大波動。OI 為前一交易日。
            </div>
          </Glass2>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────── CHART WORKSPACE
// Top-level Chart tab (from the design): full-width candles + MA + RSI.
// Desktop only — mobile keeps the K線 sub-tab inside Calc.
function ChartWorkspace({ P, bars, barsLive, live, theme, light, barPeriodId, setBarPeriodId, barSession, setBarSession, cone = null, D }) {
  const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, overflowY: 'auto' }}>
      <Glass2 tone="panel" padding={D.panelPad}>
        <Eyebrow right={<div style={{ display: 'flex', gap: 8 }}><KSessionToggle value={barSession} onChange={setBarSession} light={light} /><KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} light={light} /></div>}>
          Chart · {P.code}
          <span style={{ color: light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.5)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>
            · {barsLive ? `front-month · ${liveLabel(live, P)}` : 'mock'}
          </span>
        </Eyebrow>
        <PriceChart cone={cone}
          bars={bars} theme={theme} code={P.code}
          periodLabel={(per.label === '日' ? 'Daily' : per.label) + (barSession === 'full' ? ' · 全日盤' : ' · 日盤')}
          sourceLabel={barsLive
            ? `● ${liveLabel(live, P)} — front-month futures daily bars`
            : '○ MOCK OHLC — random walk; connect the proxy (server/) for real bars'}
        />
      </Glass2>
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

function IVWorkspace({ D, P, spot, iv, expiry, expiries = TXO_EXPIRIES, rows, hv20, hvLive, dayBars = null, live = null, light = false, theme = 'dark' }) {
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
        fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: '3px 10px', borderRadius: 999,
        border: '1px solid ' + (light ? 'rgba(25,40,70,0.14)' : 'rgba(255,255,255,0.14)'),
        background: active ? 'linear-gradient(150deg,oklch(0.66 0.16 250),oklch(0.55 0.18 240))' : 'transparent',
        color: active ? '#fff' : (light ? 'rgba(20,30,50,0.55)' : 'rgba(255,255,255,0.55)'),
        cursor: 'pointer', fontFamily: 'inherit',
      }}>{label}</button>
    );
  };
  const cellBorder = light ? 'rgba(25,40,70,0.08)' : 'rgba(255,255,255,0.06)';

  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, display: 'flex', gap: D.gap }}>
      <Glass2 tone="panel" padding={D.panelPad} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Eyebrow right={<span style={{ display: 'inline-flex', gap: 4 }}>{viewChip('3d', '3D')}{viewChip('heat', 'HEATMAP')}</span>}>IV Surface · {P.code}</Eyebrow>
        {ivView === '3d' ? (
          <div ref={ref} style={{ flex: 1, minHeight: 360, borderRadius: 14, overflow: 'hidden', background: 'radial-gradient(ellipse at 30% 30%, rgba(167,139,250,0.10), transparent 60%)' }} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 640, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
              <div style={{ display: 'flex' }}>
                <div style={{ width: 64, flexShrink: 0, fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600, padding: '8px 10px' }}>EXP</div>
                {heat.header.map((h, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, letterSpacing: 0.4, opacity: 0.5, fontWeight: 600, padding: '8px 0' }}>{h}</div>
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
              <span>low</span>
              <span style={{ display: 'inline-block', width: 120, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,rgba(240,192,104,0.06),rgba(240,192,104,0.6))' }} />
              <span>high · rows = expiry · cols = strike · value = IV %</span>
            </div>
          </div>
        )}
      </Glass2>
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: D.gap }}>
        {/* IV vs realized — is premium rich or cheap? */}
        {hv20 != null && (
          <Glass2 tone="raised" padding={D.panelPad}>
            <Eyebrow hk="hv" right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{hvLive ? `${liveLabel(live, P)} daily bars` : 'mock'}</span>}>IV vs HV · 20d</Eyebrow>
            <div className="tnum" style={{ fontSize: 20, fontWeight: 600, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span>{iv.toFixed(1)}%</span>
              <span style={{ opacity: 0.4, fontSize: 13 }}>vs</span>
              <span style={{ opacity: 0.75 }}>{hv20.toFixed(1)}%</span>
              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: iv / hv20 > 1.15 ? '#f0c068' : iv / hv20 < 0.85 ? '#5fa3d4' : (light ? 'rgba(20,30,50,0.6)' : 'rgba(255,255,255,0.6)') }}>
                ×{(iv / hv20).toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              {iv / hv20 > 1.15 ? 'IV above realized — premium rich, favors sellers'
                : iv / hv20 < 0.85 ? 'IV below realized — premium cheap, favors buyers'
                : 'IV ≈ realized — options fairly priced'}
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + (light ? 'rgba(25,40,70,0.12)' : 'rgba(255,255,255,0.08)') }}>
              <Eyebrow hk="volcone">波動率錐 · HV 5/10/20/60 日</Eyebrow>
              <window.VolCone bars={dayBars} ivPct={iv} theme={theme} />
            </div>
          </Glass2>
        )}
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>ATM IV</span>}>Term structure</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {term.map((e) => (
              <div key={e.label + e.dte} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ opacity: 0.7 }}>{e.label} · {e.dte}d</span>
                <span className="mono" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: e.dte === expiry.dte ? '#f0c068' : (light ? '#3a4658' : '#cdd3df') }}>
                  {e.iv != null ? e.iv.toFixed(1) + '%' : '—'}
                </span>
              </div>
            ))}
          </div>
        </Glass2>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>Skew · 25Δ</Eyebrow>
          {skew != null ? (<>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: skew >= 0 ? '#5fa3d4' : '#f0c068' }}>{skew >= 0 ? '+' : ''}{skew.toFixed(1)}</span>
              <span style={{ opacity: 0.4, fontSize: 14 }}> vol pts</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
              {skew >= 0 ? 'Put skew · downside hedging priced in' : 'Call skew · upside risk premium'}
            </div>
          </>) : (
            <div style={{ fontSize: 11, opacity: 0.5 }}>No usable 25Δ quotes on this expiry</div>
          )}
        </Glass2>
        <Glass2 tone="chip" padding={D.panelPad}>
          <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.55 }}>
            {ivView === '3d'
              ? <><strong>Drag</strong> to orbit · <strong>scroll</strong> to zoom. Height = IV at each strike (X) × expiry (depth, front = nearest). Built from the chain's per-strike IVs — expiries beyond the loaded chain use the model smile.</>
              : <>Heatmap: each cell is the IV (call/put mid) at that strike (columns) and expiry (rows). Warmer = higher IV. Expiries beyond the loaded live chain use the model smile.</>}
          </div>
        </Glass2>
      </div>
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
  { id: 'bull-call',  name: 'Bull Call Spread',  bias: 'bullish', tag: '看小漲',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','call',s,s,iv,dte,P), _mkLeg('short','call',s,s+4*st,iv,dte,P)] },
  { id: 'bear-put',   name: 'Bear Put Spread',   bias: 'bearish', tag: '看小跌',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','put',s,s,iv,dte,P), _mkLeg('short','put',s,s-4*st,iv,dte,P)] },
  { id: 'iron-condor',name: 'Iron Condor',       bias: 'neutral', tag: '盤整收租',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','put',s,s-6*st,iv,dte,P), _mkLeg('long','put',s,s-10*st,iv,dte,P), _mkLeg('short','call',s,s+6*st,iv,dte,P), _mkLeg('long','call',s,s+10*st,iv,dte,P)] },
  { id: 'straddle',   name: 'Long Straddle',     bias: 'volatile',tag: '大波動',
    build: (s, iv, dte, P) => [_mkLeg('long','call',s,s,iv,dte,P), _mkLeg('long','put',s,s,iv,dte,P)] },
  { id: 'strangle',   name: 'Long Strangle',     bias: 'volatile',tag: '大波動(便宜)',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','call',s,s+3*st,iv,dte,P), _mkLeg('long','put',s,s-3*st,iv,dte,P)] },
  { id: 'short-strangle', name: 'Short Strangle',bias: 'neutral', tag: '盤整裸賣',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','call',s,s+4*st,iv,dte,P), _mkLeg('short','put',s,s-4*st,iv,dte,P)] },
  { id: 'put-credit', name: 'Put Credit Spread', bias: 'bullish', tag: '看不跌',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','put',s,s-2*st,iv,dte,P), _mkLeg('long','put',s,s-6*st,iv,dte,P)] },
  { id: 'call-credit',name: 'Call Credit Spread',bias: 'bearish', tag: '看不漲',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('short','call',s,s+2*st,iv,dte,P), _mkLeg('long','call',s,s+6*st,iv,dte,P)] },
  { id: 'butterfly',  name: 'Long Butterfly',    bias: 'neutral', tag: '精準錨點',
    build: (s, iv, dte, P, st = P.strikeStep) => [_mkLeg('long','call',s,s-3*st,iv,dte,P), _mkLeg('short','call',s,s,iv,dte,P,2), _mkLeg('long','call',s,s+3*st,iv,dte,P)] },
  { id: 'long-call',  name: 'Long Call',         bias: 'bullish', tag: '純多單',
    build: (s, iv, dte, P) => [_mkLeg('long','call',s,s,iv,dte,P)] },
  { id: 'long-put',   name: 'Long Put',          bias: 'bearish', tag: '純空單',
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
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, display: 'flex', flexDirection: 'column', gap: D.gap }}>
      {/* Strategy picker bar */}
      <Glass2 tone="panel" padding="12px 16px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {STRATEGY_LIBRARY.map((s) => {
              const active = picked.includes(s.id);
              const c = biasColor[s.bias];
              return (
                <button key={s.id} onClick={() => toggle(s.id)} style={{
                  padding: '6px 10px', borderRadius: 999, border: '1px solid',
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
          width: 22, height: 22, borderRadius: 11, border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
          fontSize: 12, lineHeight: 1, padding: 0, fontFamily: 'inherit',
        }}>×</button>
      </div>

      <PayoffChart legs={legs} spot={spot} theme={theme} height={170} width={300} iv={iv} dte={dte} showCone={true} sliceFrac={1} rangePct={0.06} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />

      {/* Editable strikes */}
      <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
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
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(239,83,80,0.10)', border: '1px solid rgba(239,83,80,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>MAX PROFIT</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#ef5350', fontSize: 13 }}>
            +{P.cur}{Math.round(mp * P.mult).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(38,166,154,0.10)', border: '1px solid rgba(38,166,154,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>MAX LOSS</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#26a69a', fontSize: 13 }}>
            {P.cur}{Math.round(ml * P.mult).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>BREAK-EVEN</div>
          <div className="tnum" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#a78bfa', fontSize: 12 }}>
            {bes.length ? bes.map((b) => b.toFixed(0)).join(' / ') : '—'}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
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
  fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
  padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,140,170,0.28)',
  background: 'rgba(128,140,170,0.12)', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
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
      <button style={miniBtn} onClick={() => setOpen(!open)} title="Load a strategy template">≡ strategy</button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 31, width: 212, padding: 6, borderRadius: 12,
          backdropFilter: 'blur(36px) saturate(160%)', WebkitBackdropFilter: 'blur(36px) saturate(160%)',
          background: light ? 'rgba(255,255,255,0.97)' : 'linear-gradient(155deg, rgba(80,90,115,0.92), rgba(36,42,58,0.95))',
          border: `1px solid ${light ? 'rgba(25,40,70,0.16)' : 'rgba(255,255,255,0.14)'}`,
          boxShadow: '0 24px 48px -20px rgba(0,0,0,0.7)', color: light ? '#1c2433' : '#e8eaef',
          display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 320, overflowY: 'auto',
        }}>
          {STRATEGY_LIBRARY.map((s) => (
            <button key={s.id} onClick={() => {
              onPick(s.build(Math.round(spot / P.strikeStep) * P.strikeStep, iv, dte, P));
              setOpen(false);
            }} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8,
              border: 'none', textAlign: 'left', cursor: 'pointer', background: 'transparent',
              color: 'inherit', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = light ? 'rgba(20,40,80,0.08)' : 'rgba(255,255,255,0.10)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: biasColor[s.bias], flexShrink: 0 }} />
              {s.name}
              <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.45, textTransform: 'uppercase' }}>{s.bias}</span>
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
