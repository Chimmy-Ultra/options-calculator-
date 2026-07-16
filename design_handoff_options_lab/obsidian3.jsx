// OBSIDIAN v3 — TXO options lab. Multi-workspace: Chain / Calculator / IV Surface / Compare.

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

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

function Eyebrow({ children, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600 }}>{children}</span>
      {right}
    </div>
  );
}

// Workspace tabs
function WorkspaceTabs({ value, onChange, accent, light }) {
  // Desktop tabs (design): Compare is shelved and Pricer is folded into
  // Calculator, so the top bar shows four workspaces.
  const items = [
    { id: 'chain',  label: 'Chain',      icon: '☷' },
    { id: 'chart',  label: 'Chart',      icon: '☵' },
    { id: 'calc',   label: 'Calculator', icon: '◈' },
    { id: 'iv',     label: 'IV Surface', icon: '◬' },
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
        {P.ib ? (
          <span className={`mono ${live ? '' : 'lt-mock'}`} title={live ? 'IB connected (delayed/realtime per subscription)' : 'no local IB proxy — mock data'} style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: live ? '#4dd0c8' : 'rgba(255,255,255,0.45)' }}>{live ? '● IB' : '○ MOCK'}</span>
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
              <span className="tnum" style={{ fontSize: 11, fontWeight: 600, fontFamily: 'ui-monospace, Menlo, monospace', opacity: 0.8 }}>{fmtSpot(p.defaultSpot)}</span>
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
            <span style={{ fontSize: 9, opacity: 0.75, fontFamily: 'ui-monospace, SF Mono, monospace' }}>{e.date}</span>
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

// Collapsible global What-if rail (design ⑦, owner-revised to be tucked away).
// Collapsed = a small pill with a spot/IV readout; expanded = Spot + IV sliders.
function WhatIfRail({ P, spot, setSpot, spotMin, spotMax, iv, setIv, open, setOpen, theme, light }) {
  if (!open) {
    return (
      <Glass2 tone="chip" radius={999} padding="8px 14px" onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 20, right: 24, zIndex: 15, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3 }}>⇅ What-if</span>
        <span className="tnum" style={{ fontSize: 11, opacity: 0.7, fontFamily: 'ui-monospace, Menlo, monospace' }}>{P.code} {spot.toLocaleString()} · IV {iv}%</span>
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
      <span className="mono" style={{ fontSize: 12, fontWeight: 600, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
        {dte}d · {note}
      </span>
    </Glass2>
  );
}

function Obsidian3() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [workspace, setWorkspace] = uS('chain'); // design opens on Chain
  const [productId, setProductId] = uS('txo');
  const P = window.getProduct(productId);
  const [live, setLive] = uS(null);         // { quote, expiries, health } — IB proxy 抓到的
  const [liveRows, setLiveRows] = uS(null); // 當前到期日的 IB 期權鏈 rows
  const [liveBars, setLiveBars] = uS(null); // 近月期貨的 IB 歷史 K
  const [barPeriodId, setBarPeriodId] = uS('D'); // K 線週期：D / 4H / 1H
  const [theme, setTheme] = uS('dark'); // 'dark' | 'light'（設計稿的 Light/Dark 切換）
  const [prodMenuOpen, setProdMenuOpen] = uS(false);
  const [whatIfOpen, setWhatIfOpen] = uS(false); // collapsible What-if rail (owner: rarely used)
  const light = theme === 'light';
  // 亮色靠 body.light 的 CSS 覆蓋（tokens.css），圖表等元件則吃 theme prop 的 light 分支。
  uE(() => { document.body.classList.toggle('light', theme === 'light'); }, [theme]);
  uE(() => { setProdMenuOpen(false); }, [workspace]); // close product menu on tab change
  const [expiryId, setExpiryId] = uS('m');
  const expiries = productExpiries(P, live && live.expiries);
  const expiry = expiries.find((e) => e.id === expiryId) || expiries[0];

  const [legs, setLegs] = uS(() => defaultLegsFor(window.getProduct('txo'), defaultExpiryFor(window.getProduct('txo')).dte));
  const [spot, setSpot] = uS(TXO_SPOT);
  const [iv, setIv] = uS(24);
  const [view, setView] = uS('payoff');
  const [hover, setHover] = uS(null);
  const [sliceFrac, setSliceFrac] = uS(1); // 0 = now, 1 = expiry

  const dte = expiry.dte;

  // 切商品：重設市場狀態 + 預設策略；live 數據下面的 effect 會重新抓。
  function switchProduct(id) {
    if (id === productId) return;
    const p = window.getProduct(id);
    const e0 = defaultExpiryFor(p);
    setProductId(id);
    setLive(null);
    setLiveRows(null);
    setLiveBars(null);
    setExpiryId(e0.id);
    setSpot(p.defaultSpot);
    setIv(p.defaultIv);
    setLegs(defaultLegsFor(p, e0.dte));
  }

  // IB live：商品有 ib 設定且本機 proxy（server/）活著 → 抓期貨報價 + 真實到期日。
  // proxy 不在 / IB 沒連線 → 安靜留在 mock。
  uE(() => {
    let dead = false;
    if (!P.ib || !window.LiveData) return undefined;
    (async () => {
      const health = await window.LiveData.probe();
      if (dead || !health || !health.connected) return;
      const [quote, exps] = await Promise.all([
        window.LiveData.quote(P.id),
        window.LiveData.expiries(P.id),
      ]);
      if (dead) return;
      if (quote && quote.last > 0) setSpot(quote.last);
      if (exps && exps.length) setExpiryId(exps[0].id);
      // K 棒交給下面的專屬 effect 抓（換週期會重抓，避免重複邏輯）。
      setLive({ quote, expiries: exps && exps.length ? exps : null, health });
    })();
    return () => { dead = true; };
  }, [productId]);

  // IB live：換到期日時抓該到期日的期權鏈；spot 跟著換成該鏈的標的期貨月份價。
  uE(() => {
    let dead = false;
    setLiveRows(null);
    if (!live || !P.ib || !window.LiveData) return undefined;
    (async () => {
      const chain = await window.LiveData.chain(P.id, expiryId);
      if (dead || !chain || !chain.rows || !chain.rows.length) return;
      setLiveRows(chain.rows);
      if (chain.underlying && chain.underlying.price > 0) setSpot(chain.underlying.price);
    })();
    return () => { dead = true; };
  }, [live, expiryId]);

  // IB live：K 線依所選週期抓歷史 K 棒。剛連上 + 每次換週期都會重抓；
  // 換週期時不清舊 bars（留著顯示直到新資料到，避免閃回 mock）。
  uE(() => {
    let dead = false;
    if (!live || !P.ib || !window.LiveData) return undefined;
    const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
    (async () => {
      const hist = await window.LiveData.bars(P.id, { bar: per.bar, duration: per.duration });
      if (dead || !hist || !hist.bars || !hist.bars.length) return;
      setLiveBars(hist.bars);
    })();
    return () => { dead = true; };
  }, [live, barPeriodId]);

  // live 報價可能落在預設 slider 範圍外 → 動態放寬邊界。
  const spotMin = Math.min(P.spotMin, Math.floor(spot * 0.9));
  const spotMax = Math.max(P.spotMax, Math.ceil(spot * 1.1));
  const D = DENSITY[t.density] || DENSITY.comfortable;
  const accent = `oklch(0.66 0.16 ${t.accentHue})`;
  const vp = useViewport();
  // On phone/fold, Compare is the only desktop-exclusive workspace (it needs the
  // multi-card grid to be useful). IV Surface is now mobile-friendly so it stays.
  uE(() => {
    if (vp.layout !== 'desk' && (workspace === 'compare' || workspace === 'chart')) setWorkspace('calc');
  }, [vp.layout]);
  // Desktop: Pricer/Compare tabs removed — redirect stale state to Chain.
  uE(() => {
    if (vp.layout === 'desk' && (workspace === 'pricer' || workspace === 'compare')) setWorkspace('chain');
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
  // 期權鏈 rows：live（IB）優先，否則 mock。所有吃 chain 的元件都從這裡拿。
  const chainRows = uM(() => {
    if (liveRows && liveRows.length) return liveRows;
    return window.genChain ? window.genChain({ spot, contract: expiry.type, dte, product: P }) : [];
  }, [liveRows, spot, expiry.type, dte, productId]);
  const quality = uM(() => dataQuality(legs, chainRows), [legs, chainRows]);
  // K 線：live（IB 日K）優先，否則 mock 隨機漫步。
  // 刻意不依賴 spot — 拉 slider 屬於情境模擬，不該重繪歷史走勢。
  const bars = uM(() => {
    if (liveBars && liveBars.length) return liveBars;
    const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
    return window.genBars ? window.genBars({ spot, n: per.n, volScale: per.volScale, product: P }) : [];
  }, [liveBars, productId, barPeriodId]);

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
        P={P} switchProduct={switchProduct} live={live}
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

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 18, left: 24, right: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 12 }}>
        <Glass2 tone="chip" radius={999} padding="8px 14px" style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, oklch(0.78 0.14 75), ${accent})`, boxShadow: `0 0 12px -2px ${accent}` }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>Options Lab</span>
        </Glass2>

        <WorkspaceTabs value={workspace} onChange={setWorkspace} accent={accent} light={light} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <DataQualityPill quality={quality} />
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
        </div>
      </div>

      {/* Expiry strip — second row */}
      <div style={{ position: 'absolute', top: 64, left: 24, right: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 12 }}>
        <ExpiryStrip value={expiryId} onChange={setExpiryId} expiries={expiries} light={light} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Glass2 tone="chip" radius={8} padding="5px 10px" style={{ fontSize: 10, opacity: 0.7, fontFamily: 'ui-monospace, SF Mono, monospace', whiteSpace: 'nowrap' }}>
            {P.unitLabel}
          </Glass2>
        </div>
      </div>

      {/* WORKSPACE BODY */}
      {workspace === 'calc' && (
        <CalcWorkspace
          P={P} theme={theme} light={light} rows={chainRows} expiries={expiries}
          legs={legs} setLegs={setLegs}
          spot={spot} setSpot={setSpot}
          spotMin={spotMin} spotMax={spotMax}
          iv={iv} setIv={setIv}
          dte={dte}
          sliceFrac={sliceFrac} setSliceFrac={setSliceFrac}
          view={view} setView={setView}
          pnlPts={pnlPts} pnlNTD={pnlNTD}
          maxProfit={maxProfit} maxLoss={maxLoss}
          hover={hover} setHover={setHover}
          accent={accent} D={D} t={t}
          portfolioG={portfolioG} popValue={popValue} quality={quality}
        />
      )}
      {workspace === 'chain' && (
        <ChainWorkspace
          P={P} rows={chainRows} theme={theme}
          spot={spot} setSpot={setSpot} expiry={expiry} expiries={expiries}
          onAddLeg={addLegFromChain}
          legs={legs} setLegs={setLegs}
          iv={iv} setIv={setIv} dte={dte}
          pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss}
          popValue={popValue} portfolioG={portfolioG}
          accent={accent} t={t} D={D}
          quality={quality}
        />
      )}
      {workspace === 'chart' && (
        <ChartWorkspace
          P={P} bars={bars} barsLive={!!liveBars} theme={theme} light={light}
          barPeriodId={barPeriodId} setBarPeriodId={setBarPeriodId}
          D={D}
        />
      )}
      {workspace === 'iv' && (
        <IVWorkspace D={D} P={P} spot={spot} iv={iv} expiry={expiry} expiries={expiries} light={light} theme={theme} />
      )}

      {/* Global collapsible What-if rail — on every tab */}
      <WhatIfRail
        P={P} spot={spot} setSpot={setSpot} spotMin={spotMin} spotMax={spotMax}
        iv={iv} setIv={setIv} open={whatIfOpen} setOpen={setWhatIfOpen} theme={theme} light={light}
      />

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
function CalcWorkspace({ P, theme = 'dark', rows, expiries, legs, setLegs, spot, setSpot, spotMin, spotMax, iv, setIv, dte, sliceFrac, setSliceFrac, view, setView, pnlPts, pnlNTD, maxProfit, maxLoss, hover, setHover, accent, D, t, portfolioG, popValue, quality }) {
  const light = theme === 'light';
  const hoverInfo = uM(() => {
    if (!hover) return null;
    const spotAt = (spot * (1 + hover.xn * 0.18)).toFixed(0);
    const dteAt = (dte * (1 - hover.yn)).toFixed(0);
    const pnlAt = (hover.v * 1000 * P.mult).toFixed(0); // approx points × mult
    return { spotAt, dteAt, pnlAt };
  }, [hover, spot, dte, P]);

  return (
    <>
      {/* 3D background fills middle */}
      <div style={{ position: 'absolute', inset: '110px 0 0 0' }}>
        <Surface3DMount theme={theme} height="100%" scheme={t.scheme} onHover={setHover} />
      </div>

      {/* hover tooltip */}
      {hoverInfo && (
        <div style={{
          position: 'absolute', top: 130, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
          padding: '8px 14px', borderRadius: 999,
          background: 'rgba(20,24,34,0.85)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.12)',
          fontSize: 12, fontFamily: 'ui-monospace, SF Mono, monospace',
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

      {/* Left column */}
      <div className="calc-col" style={{
        position: 'absolute', top: 110, left: 24, width: 320, zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: D.gap,
        maxHeight: 'calc(100vh - 200px)', overflow: 'auto', paddingBottom: 4,
      }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={
            <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>+ leg</button>
          }>Legs</Eyebrow>
          <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
        </Glass2>

        {/* Single-contract pricer — folded in from the removed Pricer tab.
            Auto: pick a strike, IV is pulled from the chain smile, price is live. */}
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{P.model === 'b76' ? 'Black-76' : 'Black-Scholes'}</span>}>Option Pricer</Eyebrow>
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
              <Eyebrow>P&L now</Eyebrow>
              <div className="tnum" style={{
                fontSize: 32, fontWeight: 600, letterSpacing: -0.6,
                color: pnlNTD >= 0 ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)') : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)'),
                fontFamily: 'ui-monospace, SF Mono, monospace', lineHeight: 1,
              }}>
                {pnlNTD >= 0 ? '+' : ''}{P.cur}{Math.abs(Math.round(pnlNTD)).toLocaleString()}
              </div>
              <div className="tnum" style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                {pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} pts {P.unitLabel}
              </div>
              <div className="tnum" style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
                Max profit <span style={{ color: '#f0c068' }}>+{P.cur}{Math.round(maxProfit).toLocaleString()}</span>
                <span style={{ opacity: 0.4 }}> · </span>
                Max loss <span style={{ color: '#5fa3d4' }}>{P.cur}{Math.round(maxLoss).toLocaleString()}</span>
              </div>
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
            { id: 'payoff', label: 'Payoff' },
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
              background: view === tab.id ? (light ? 'rgba(20,40,80,0.10)' : 'rgba(255,255,255,0.10)') : 'transparent',
              color: view === tab.id ? 'inherit' : (light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.55)'),
              fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>{tab.label}</button>
          ))}
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          {view === 'payoff' && (<>
            <Eyebrow right={
              <span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>
                {sliceFrac >= 0.99 ? 'at expiry' : sliceFrac <= 0.01 ? 'now' : `t = ${(sliceFrac * 100).toFixed(0)}%`}
              </span>
            }>Payoff {t.showProbCone && <span style={{ color: '#a78bfa', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· 1σ/2σ cone</span>}</Eyebrow>
            <PayoffChart legs={legs} spot={spot} theme={theme} height={140} width={304} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={sliceFrac} rangePct={0.08} showKeyNumbers={true} model={P.model} r={P.r / 100} strikeStep={P.strikeStep} />
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, opacity: 0.55, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
                <span>Time slice</span>
                <span className="mono">now → expiry</span>
              </div>
              <input type="range" min="0" max="1" step="0.01" value={sliceFrac} onChange={(e) => setSliceFrac(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: accent }} />
            </div>
          </>)}
          {view === 'cross' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d</span>}>P&L vs spot</Eyebrow>
            <CrossSection theme={theme} dte={dte} height={140} width={304} />
          </>)}
          {view === 'greeks' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d · IV {iv}%</span>}>
              Greeks <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· Δ Γ Θ V vs spot</span>
            </Eyebrow>
            <GreeksProfile legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={140} width={304} model={P.model} r={P.r / 100} />
          </>)}
          {view === 'dist' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>at expiry</span>}>
              P&L distribution <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· lognormal</span>
            </Eyebrow>
            <PnLDistribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={140} width={304} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />
          </>)}
          {view === 'attr' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>vs baseline</span>}>
              P&L attribution <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· why up / down</span>
            </Eyebrow>
            <PnLAttribution legs={legs} spot={spot} iv={iv} dte={dte} theme={theme} height={150} width={304} baseSpot={P.defaultSpot} baseIv={P.defaultIv} ntdMult={P.mult} cur={P.cur} model={P.model} r={P.r / 100} />
          </>)}
          {view === 'theta' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>θ decay</span>}>Time decay</Eyebrow>
            <ThetaDecay theme={theme} dte={dte} height={140} width={304} />
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>−{P.cur}{(0.12 * P.mult * 100).toFixed(0)} / day at current DTE</div>
          </>)}
          {view === 'iv' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{iv}% ATM</span>}>IV smile</Eyebrow>
            <IVSmile theme={theme} iv={iv} height={140} width={304} />
          </>)}
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<DataQualityPill quality={quality} />}>Greeks</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <GreekChip label="Delta · Δ" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
            <GreekChip label="Gamma · Γ" value={portfolioG.gamma.toFixed(4)} theme={theme} />
            <GreekChip label="Theta · Θ" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
            <GreekChip label="Vega · V" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
          </div>
        </Glass2>
      </div>

      {/* Spot / IV live in the global What-if rail (shell) now. */}

      {/* Surface legend */}
      <div style={{
        position: 'absolute', bottom: 24, right: 24, zIndex: 4, pointerEvents: 'none',
        padding: '10px 14px', borderRadius: 12,
        background: 'rgba(20,24,34,0.55)', backdropFilter: 'blur(20px) saturate(140%)',
        border: '1px solid rgba(255,255,255,0.10)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.55, fontWeight: 600 }}>P&L</span>
        <span className="tnum" style={{ fontSize: 11, fontFamily: 'ui-monospace, SF Mono, monospace', color: '#5fa3d4' }}>−15K</span>
        <div style={{ width: 88, height: 8, borderRadius: 4,
          background: t.scheme === 'aurora' ? 'linear-gradient(90deg, oklch(0.65 0.18 220), oklch(0.70 0.16 290), oklch(0.70 0.18 350))'
                   : t.scheme === 'viridis' ? 'linear-gradient(90deg, #440154, #21918c, #fde725)'
                   : t.scheme === 'classic' ? 'linear-gradient(90deg, #d94d4d, #4d4d59, #4dc870)'
                   :                          'linear-gradient(90deg, #5fa3d4, #4d4d59, #f0c068)',
        }} />
        <span className="tnum" style={{ fontSize: 11, fontFamily: 'ui-monospace, SF Mono, monospace', color: '#f0c068' }}>+45K</span>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────── CHAIN WORKSPACE
// P&L what-if card (design ⑤) — compact hero + POP gauge + max profit/loss tiles.
function WhatIfCard({ P, pnlPts, pnlNTD, maxProfit, maxLoss, popValue, theme, light, D }) {
  const profit = pnlNTD >= 0;
  const heroColor = profit
    ? (light ? 'oklch(0.60 0.13 75)' : 'oklch(0.84 0.14 75)')
    : (light ? 'oklch(0.50 0.10 220)' : 'oklch(0.74 0.12 220)');
  const tile = { padding: '7px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' };
  return (
    <Glass2 tone="raised" padding="14px 14px 12px" radius={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow>P&L what-if · {P.code}</Eyebrow>
          <div className="tnum" style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.05, marginTop: 3, fontFamily: 'ui-monospace, SF Mono, monospace', color: heroColor }}>
            {profit ? '+' : ''}{P.cur}{Math.abs(Math.round(pnlNTD)).toLocaleString()}
          </div>
          <div className="tnum" style={{ fontSize: 9, opacity: 0.5, marginTop: 3 }}>{pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} pts {P.unitLabel}</div>
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
          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace', color: '#f0c068' }}>+{P.cur}{Math.round(maxProfit).toLocaleString()}</div>
        </div>
        <div className="lt-tile" style={tile}>
          <div style={{ fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.6 }}>Max loss</div>
          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace', color: '#5fa3d4' }}>{P.cur}{Math.round(maxLoss).toLocaleString()}</div>
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
  iv, setIv, dte, pnlPts, pnlNTD, maxProfit, maxLoss, popValue, portfolioG, accent, t, D, quality }) {
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
          <WhatIfCard P={P} pnlPts={pnlPts} pnlNTD={pnlNTD} maxProfit={maxProfit} maxLoss={maxLoss} popValue={popValue} theme={theme} light={light} D={D} />
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
          <GreekChip label="Delta · Δ" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme={theme} emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Gamma · Γ" value={portfolioG.gamma.toFixed(4)} theme={theme} />
          <GreekChip label="Theta · Θ" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme={theme} emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Vega · V" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme={theme} emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
        </div>

        {/* legs */}
        {glassArea('legs', (<>
          <Eyebrow right={
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 2 * P.strikeStep) / P.strikeStep) * P.strikeStep, iv, dte, P)])}>+ leg</button>
              {legs.length > 0 && <button style={miniBtn} onClick={() => setLegs([])}>clear</button>}
            </div>
          }>Legs · {legs.length}</Eyebrow>
          {legs.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, opacity: 0.5 }}>Click any chain row to add a leg</div>
          ) : (
            <LegEditor legs={legs} onChange={setLegs} theme={theme} expiries={expiries} defaultDte={dte} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.6, marginTop: 8, fontFamily: 'ui-monospace, Menlo, monospace' }}>
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

// ───────────────────────────────────────────────── CHART WORKSPACE
// Top-level Chart tab (from the design): full-width candles + MA + RSI.
// Desktop only — mobile keeps the K線 sub-tab inside Calc.
function ChartWorkspace({ P, bars, barsLive, theme, light, barPeriodId, setBarPeriodId, D }) {
  const per = K_PERIODS.find((p) => p.id === barPeriodId) || K_PERIODS[0];
  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, overflowY: 'auto' }}>
      <Glass2 tone="panel" padding={D.panelPad}>
        <Eyebrow right={<KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} light={light} />}>
          Chart · {P.code}
          <span style={{ color: light ? 'rgba(20,30,50,0.5)' : 'rgba(255,255,255,0.5)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>
            · {barsLive ? 'front-month · IB' : 'mock'}
          </span>
        </Eyebrow>
        <PriceChart
          bars={bars} theme={theme} code={P.code}
          periodLabel={per.label === '日' ? 'Daily' : per.label}
          sourceLabel={barsLive
            ? '● IB feed — front-month futures via server/ proxy (TWS / Gateway)'
            : '○ MOCK OHLC — random walk; connect the IB proxy (server/) for real bars'}
        />
      </Glass2>
    </div>
  );
}

// ───────────────────────────────────────────────── IV SURFACE WORKSPACE
function IVWorkspace({ D, P, spot, iv, expiry, expiries = TXO_EXPIRIES, light = false, theme = 'dark' }) {
  const ref = uR(null);
  const [ivView, setIvView] = uS('3d'); // '3d' | 'heat'
  uE(() => {
    if (ivView !== '3d' || !ref.current || !window.IVSurface3D) return;
    const inst = window.IVSurface3D.make({ container: ref.current });
    return () => inst && inst.destroy && inst.destroy();
  }, [ivView]);

  // Heatmap: IV across expiry (rows) × strike (cols). Every 2nd strike, 10 cols.
  const heat = uM(() => {
    const atmIv = iv || (P ? P.defaultIv : 24);
    const cols = (e) => (window.genChain
      ? window.genChain({ spot, contract: e.type, dte: e.dte, product: P }).filter((_, i) => i % 2 === 0).slice(0, 10)
      : []);
    const header = cols(expiry).map((r) => window.fmtStrike(r.strike, (P && P.strikeStep) || 50));
    const rows = expiries.map((e) => ({
      exp: e.label,
      cells: cols(e).map((r) => {
        const a = Math.max(0.05, Math.min(0.6, ((r.call.iv - (atmIv - 1.8)) / 4.5) * 0.55));
        return { v: r.call.iv.toFixed(1), bg: `rgba(240,192,104,${a.toFixed(2)})` };
      }),
    }));
    return { header, rows };
  }, [spot, iv, expiries, expiry, P]);

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
            <div style={{ minWidth: 640, fontFamily: 'ui-monospace, SF Mono, monospace', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
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
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow>Term structure</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {expiries.map((e) => {
              const ivAtm = ((P ? P.defaultIv : 24) - 2) + (1 - e.dte / 60) * 6;
              return (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ opacity: 0.7 }}>{e.label} · {e.dte}d</span>
                  <span className="mono" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 600, color: e.id === expiry.id ? '#f0c068' : '#cdd3df' }}>{ivAtm.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </Glass2>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow>Skew · 25Δ</Eyebrow>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
            <span style={{ color: '#5fa3d4' }}>+4.2</span><span style={{ opacity: 0.4, fontSize: 14 }}> vol pts</span>
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>Put skew elevated · downside hedging</div>
        </Glass2>
        <Glass2 tone="chip" padding={D.panelPad}>
          <div style={{ fontSize: 11, opacity: 0.65, lineHeight: 1.55 }}>
            {ivView === '3d'
              ? <><strong>Drag</strong> to orbit · <strong>scroll</strong> to zoom. Surface shows IV across all listed strikes & expiries — lower-left = short-dated puts (highest IV); upper-right = long-dated calls.</>
              : <>Heatmap: each cell is the call IV at that strike (columns) and expiry (rows). Warmer = higher IV. Mock IV for expiries other than the loaded live chain.</>}
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
                  fontFamily: 'ui-monospace, SF Mono, monospace', fontSize: 11, fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                  outline: 'none',
                }}
              />
              <span className="mono" style={{ fontSize: 10, opacity: 0.5, fontFamily: 'ui-monospace, SF Mono, monospace', minWidth: 38, textAlign: 'right' }}>@{l.premium}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Key numbers */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(239,83,80,0.10)', border: '1px solid rgba(239,83,80,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>MAX PROFIT</div>
          <div className="tnum" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 700, color: '#ef5350', fontSize: 13 }}>
            +{P.cur}{Math.round(mp * P.mult).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(38,166,154,0.10)', border: '1px solid rgba(38,166,154,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>MAX LOSS</div>
          <div className="tnum" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 700, color: '#26a69a', fontSize: 13 }}>
            {P.cur}{Math.round(ml * P.mult).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>BREAK-EVEN</div>
          <div className="tnum" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 700, color: '#a78bfa', fontSize: 12 }}>
            {bes.length ? bes.map((b) => b.toFixed(0)).join(' / ') : '—'}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>{credit >= 0 ? 'NET CREDIT' : 'NET DEBIT'}</div>
          <div className="tnum" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 700, fontSize: 12, color: credit >= 0 ? '#ef5350' : '#cdd3df' }}>
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

// ═════════════════════════════════════════════════════════════════════════════
// MOBILE / FOLDABLE LAYOUT
// ═════════════════════════════════════════════════════════════════════════════
function MobileApp({
  vp, workspace, setWorkspace,
  theme = 'dark',
  P, switchProduct, live,
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
  const chartW = Math.max(280, Math.min(vp.width - 48, isFold ? 560 : 400));
  return (
    <div style={{
      width: '100%', minHeight: '100vh', position: 'relative',
      fontFamily: 'var(--font-display)', color: '#e8eaef',
      background: `
        radial-gradient(ellipse 90% 50% at 50% 0%, ${t.showAuroraBlobs ? `oklch(0.32 0.10 ${t.accentHue}) 0%` : 'transparent 0%'}, transparent 55%),
        linear-gradient(180deg, #0a0d14 0%, #11151f 100%)
      `,
      paddingBottom: 130, // room for sticky bottom rail
    }}>
      {/* Top bar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        padding: '10px 12px 8px',
        background: 'linear-gradient(180deg, rgba(10,13,20,0.92), rgba(10,13,20,0.55) 80%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Glass2 tone="chip" radius={999} padding="6px 10px" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: `linear-gradient(135deg, oklch(0.78 0.14 75), ${accent})` }} />
            <span style={{ fontSize: 11, fontWeight: 600 }}>Options Lab</span>
          </Glass2>
          <Glass2 tone="chip" radius={999} padding="6px 10px" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <select
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
            <span style={{ fontSize: 9, color: '#f0c068' }}>{dte}d</span>
            {P.ib && (
              <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: live ? '#4dd0c8' : 'rgba(255,255,255,0.45)' }}>
                {live ? '●IB' : '○MOCK'}
              </span>
            )}
          </Glass2>
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
                background: active ? `linear-gradient(150deg, ${accent}, oklch(0.55 0.18 240))` : 'rgba(255,255,255,0.05)',
                color: active ? '#fff' : 'rgba(255,255,255,0.65)',
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
                borderColor: active ? (isMonthly ? '#f0c068' : 'rgba(255,255,255,0.18)') : 'rgba(255,255,255,0.08)',
                background: active ? (isMonthly ? 'rgba(240,192,104,0.16)' : 'rgba(255,255,255,0.10)') : 'rgba(255,255,255,0.02)',
                color: active ? (isMonthly ? '#f7d394' : '#fff') : 'rgba(255,255,255,0.55)',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                position: 'relative',
              }}>
                <span>{e.label}</span>
                <span style={{ fontSize: 9, opacity: 0.7, fontFamily: 'ui-monospace, SF Mono, monospace' }}>{e.date}</span>
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
            isFold={isFold} chartW={chartW}
            P={P} bars={bars} barsLive={barsLive}
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
            isFold={isFold} chartW={chartW}
            P={P} rows={chainRows}
            spot={spot} expiry={expiry}
            legs={legs} setLegs={setLegs}
            addLegFromChain={addLegFromChain}
            quality={quality}
          />
        )}
        {workspace === 'pricer' && (
          <Glass2 tone="panel" padding={14}>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>single contract</span>}>Option Pricer</Eyebrow>
            <OptionPricer key={P.id} product={P} spot={spot} iv={iv} dte={dte} rows={chainRows} theme={theme} accent={accent} />
          </Glass2>
        )}
        {workspace === 'iv' && (
          <MobileIV expiry={expiry} expiries={expiries} P={P} />
        )}
      </div>

      {/* Sticky bottom slider rail.
          Calc page: Spot + IV (both affect P&L / Greeks / distribution).
          Chain page: only Spot — IV doesn't move the displayed quotes, so showing
          it would be a red herring. */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        padding: '10px 12px 14px',
        background: 'linear-gradient(0deg, rgba(10,13,20,0.95) 0%, rgba(10,13,20,0.85) 70%, transparent 100%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: workspace !== 'chain' ? '1fr 1fr' : '1fr', gap: 16 }}>
          <Slider label="Spot" value={spot} min={spotMin} max={spotMax} step={P.spotStep} onChange={setSpot} format={(v) => v.toLocaleString()} theme={theme} />
          {workspace !== 'chain' && (
            <Slider label="IV" value={iv} min={P.ivMin} max={P.ivMax} step={0.5} suffix="%" onChange={setIv} theme={theme} />
          )}
        </div>
      </div>
    </div>
  );
}

function MobileCalc({
  isFold, chartW, theme = 'dark',
  P, bars, barsLive, barPeriodId, setBarPeriodId,
  legs, setLegs, spot, setSpot, iv, setIv, dte,
  view, setView, sliceFrac, setSliceFrac,
  pnlPts, pnlNTD, maxProfit, maxLoss,
  portfolioG, popValue, quality,
  accent, t,
}) {
  return (
    <>
      {/* P&L now card */}
      <Glass2 tone="raised" padding={14}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Eyebrow right={<DataQualityPill quality={quality} />}>P&L now</Eyebrow>
            <div className="tnum" style={{
              fontSize: 26, fontWeight: 700, letterSpacing: -0.4,
              color: pnlNTD >= 0 ? 'oklch(0.84 0.14 75)' : 'oklch(0.74 0.12 220)',
              fontFamily: 'ui-monospace, SF Mono, monospace', lineHeight: 1.05,
            }}>
              {pnlNTD >= 0 ? '+' : ''}{P.cur}{Math.abs(Math.round(pnlNTD)).toLocaleString()}
            </div>
            <div className="tnum" style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
              Max <span style={{ color: '#f0c068' }}>+{P.cur}{Math.round(maxProfit).toLocaleString()}</span>
              <span style={{ opacity: 0.4 }}> · </span>
              Min <span style={{ color: '#5fa3d4' }}>{P.cur}{Math.round(maxLoss).toLocaleString()}</span>
            </div>
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
            background: view === tab.id ? 'rgba(255,255,255,0.10)' : 'transparent',
            color: view === tab.id ? '#fff' : 'rgba(255,255,255,0.55)',
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.5, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
              <span>now</span><span>expiry</span>
            </div>
          </div>
        </>)}
        {view === 'kbar' && (<>
          <Eyebrow right={<KPeriodToggle value={barPeriodId} onChange={setBarPeriodId} />}>K線 · {P.code} <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· {barsLive ? 'IB' : 'mock'}</span></Eyebrow>
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
          borderBottom: '1px solid rgba(255,255,255,0.06)',
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
                  color: '#e8eaef', fontFamily: 'inherit',
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
          <LegEditor legs={legs} onChange={setLegs} theme={theme} />
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
              border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer',
              background: 'rgba(255,255,255,0.03)', color: '#e8eaef', fontFamily: 'inherit',
            }}>{s.label}</button>
          ))}
        </div>
      </Glass2>
    </>
  );
}

function MobileIV({ expiry, expiries = TXO_EXPIRIES, P, theme = 'dark' }) {
  const ref = uR(null);
  uE(() => {
    if (!ref.current || !window.IVSurface3D) return;
    const inst = window.IVSurface3D.make({ container: ref.current });
    return () => inst && inst.destroy && inst.destroy();
  }, []);
  return (
    <>
      <Glass2 tone="panel" padding={14}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>strike × DTE × IV</span>}>IV Surface</Eyebrow>
        <div ref={ref} style={{ height: 320, borderRadius: 14, overflow: 'hidden', background: 'radial-gradient(ellipse at 30% 30%, rgba(167,139,250,0.10), transparent 60%)' }} />
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 8, lineHeight: 1.5 }}>
          單指拖曳旋轉 · 雙指縮放
        </div>
      </Glass2>
      <Glass2 tone="panel" padding={14}>
        <Eyebrow>Term structure</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {expiries.map((e) => {
            const ivAtm = ((P ? P.defaultIv : 24) - 2) + (1 - e.dte / 60) * 6;
            return (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ opacity: 0.7 }}>{e.label} · {e.dte}d</span>
                <span className="mono" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 600, color: e.id === expiry.id ? '#f0c068' : '#cdd3df' }}>{ivAtm.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </Glass2>
      <Glass2 tone="panel" padding={14}>
        <Eyebrow>Skew · 25Δ</Eyebrow>
        <div className="tnum" style={{ fontSize: 22, fontWeight: 600, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
          <span style={{ color: '#5fa3d4' }}>+4.2</span><span style={{ opacity: 0.4, fontSize: 14 }}> vol pts</span>
        </div>
        <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>Put skew elevated · downside hedging</div>
      </Glass2>
    </>
  );
}

function MobileChain({ isFold, chartW, P, rows, spot, expiry, legs, setLegs, addLegFromChain, quality, theme = 'dark' }) {
  return (
    <>
      {/* Net premium card */}
      <Glass2 tone="raised" padding={12}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Eyebrow right={<DataQualityPill quality={quality} />}>Net premium</Eyebrow>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'ui-monospace, SF Mono, monospace', letterSpacing: -0.3 }}>
              {P.cur}{Math.round(legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) * P.mult).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3 }}>
              {legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) >= 0 ? 'credit received' : 'debit paid'}
              <span style={{ opacity: 0.4 }}> · </span>
              {legs.length} leg{legs.length === 1 ? '' : 's'}
            </div>
          </div>
          {legs.length > 0 && (
            <button style={miniBtn} onClick={() => setLegs([])}>clear</button>
          )}
        </div>
      </Glass2>

      {/* Option chain (compact: hides OI/Vol on phone, only IV + BID/ASK + Strike) */}
      <Glass2 tone="panel" padding={10} style={{ overflow: 'auto' }}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>
          Option chain
        </Eyebrow>
        <MobileChainTable spot={spot} contract={expiry.type} rows={rows} onAddLeg={addLegFromChain} />
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
          <LegEditor legs={legs} onChange={setLegs} theme={theme} />
        </Glass2>
      )}
    </>
  );
}

// Compact chain table for phone — drops OI/Vol columns, keeps IV / BID-ASK / Strike.
function MobileChainTable({ spot, contract, rows: rowsProp, onAddLeg }) {
  const genRows = uM(() => {
    if (rowsProp && rowsProp.length) return [];
    return window.genChain ? window.genChain({ spot, contract }) : [];
  }, [spot, contract, rowsProp]);
  const rows = (rowsProp && rowsProp.length) ? rowsProp : genRows;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 70px 1fr 1fr',
      fontFamily: 'ui-monospace, SF Mono, monospace',
      fontSize: 11, fontVariantNumeric: 'tabular-nums',
      borderRadius: 8, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* header */}
      <div style={hCell}>IV</div>
      <div style={hCell}>BID/ASK</div>
      <div style={{ ...hCell, textAlign: 'center' }}>STRIKE</div>
      <div style={{ ...hCell, textAlign: 'left' }}>BID/ASK</div>
      <div style={{ ...hCell, textAlign: 'left' }}>IV</div>
      {rows.map((r) => {
        const callBg = r.itmCall ? 'rgba(239,83,80,0.08)' : 'transparent';
        const putBg  = r.itmPut  ? 'rgba(38,166,154,0.08)' : 'transparent';
        return (
          <React.Fragment key={r.strike}>
            <div onClick={() => onAddLeg({ side: 'long', type: 'call', strike: r.strike, premium: parseFloat(r.call.last.toFixed(2)), qty: 1 })}
              style={{ ...cCell, background: callBg, color: 'rgba(255,255,255,0.6)' }}>{r.call.iv.toFixed(0)}%</div>
            <div onClick={() => onAddLeg({ side: 'long', type: 'call', strike: r.strike, premium: parseFloat(r.call.last.toFixed(2)), qty: 1 })}
              style={{ ...cCell, background: callBg, color: '#ef5350', fontWeight: 600 }}>{r.call.bid.toFixed(0)}/{r.call.ask.toFixed(0)}</div>
            <div style={{
              ...cCell, textAlign: 'center', fontWeight: r.atm ? 700 : 500,
              background: r.atm ? 'rgba(240,192,104,0.08)' : 'rgba(255,255,255,0.02)',
              color: r.atm ? '#f7d394' : '#cdd3df',
              borderLeft: '1px solid rgba(255,255,255,0.04)',
              borderRight: '1px solid rgba(255,255,255,0.04)',
              fontSize: r.atm ? 12 : 11,
            }}>{r.strike}</div>
            <div onClick={() => onAddLeg({ side: 'long', type: 'put', strike: r.strike, premium: parseFloat(r.put.last.toFixed(2)), qty: 1 })}
              style={{ ...cCell, background: putBg, color: '#26a69a', fontWeight: 600, textAlign: 'left' }}>{r.put.bid.toFixed(0)}/{r.put.ask.toFixed(0)}</div>
            <div onClick={() => onAddLeg({ side: 'long', type: 'put', strike: r.strike, premium: parseFloat(r.put.last.toFixed(2)), qty: 1 })}
              style={{ ...cCell, background: putBg, color: 'rgba(255,255,255,0.6)', textAlign: 'left' }}>{r.put.iv.toFixed(0)}%</div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
const hCell = {
  padding: '6px 8px', fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)', fontWeight: 600, textAlign: 'right',
  background: 'rgba(255,255,255,0.04)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};
const cCell = {
  padding: '8px', textAlign: 'right', cursor: 'pointer',
  borderTop: '1px solid rgba(255,255,255,0.04)',
  transition: 'background .12s',
};

window.Obsidian3 = Obsidian3;
