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

// TXO market state
const TXO_SPOT = 21850;
const STRIKE_STEP = 50;
// Default legs: a TXO bull-call spread, premiums priced by Black-Scholes
// at the default spot/iv/dte (21850 / 24% / 17d ≈ monthly settlement).
const _bsRound = (type, S, K, iv, dte) => Math.round(window.bsPrice(type, S, K, iv, dte) * 100) / 100;
const TXO_DEFAULT_LEGS = [
  { side: 'long',  type: 'call', strike: 21900, premium: _bsRound('call', 21850, 21900, 24, 17), qty: 1 },
  { side: 'short', type: 'call', strike: 22100, premium: _bsRound('call', 21850, 22100, 24, 17), qty: 1 },
];

// TXO weekly expiries. Anchored to 2026-05 calendar.
// 第三個禮拜三 (5/20) 是 May monthly settlement，標金點代表「月選」。
// 不放 M+1（6/17，39d）因為 day-trade 用戶通常不做那麼長。
const TXO_EXPIRIES = [
  { id: 'w1', label: 'W1', dte: 4,  type: 'weekly',  date: '5/13' },
  { id: 'm',  label: 'M',  dte: 11, type: 'monthly', date: '5/20' },
  { id: 'w3', label: 'W3', dte: 18, type: 'weekly',  date: '5/27' },
  { id: 'w4', label: 'W4', dte: 25, type: 'weekly',  date: '6/03' },
];

const SAVED_SCENARIOS = [
  { t: '2w ago', name: 'Bull call 21500/700', pnl: 12250 },
  { t: '1w ago', name: 'Iron condor', pnl: -4000 },
  { t: '3d ago', name: 'Put credit spread', pnl: 9000 },
  { t: 'today',  name: 'Bull call 21900/22100', pnl: 19000 },
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
    <div style={{
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
function WorkspaceTabs({ value, onChange, accent }) {
  const items = [
    { id: 'chain',  label: 'Chain',      icon: '☷' },
    { id: 'calc',   label: 'Calculator', icon: '◈' },
    { id: 'pricer', label: 'Pricer',     icon: '$' },
    { id: 'iv',     label: 'IV Surface', icon: '◬' },
    { id: 'compare',label: 'Compare',    icon: '◫' },
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
            color: active ? '#fff' : 'rgba(255,255,255,0.65)',
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

// Expiry strip (TXO weekly/monthly)
function ExpiryStrip({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {TXO_EXPIRIES.map((e) => {
        const active = e.id === value;
        const isMonthly = e.type === 'monthly';
        return (
          <button key={e.id} onClick={() => onChange(e.id)} style={{
            padding: '6px 11px', borderRadius: 8, border: '1px solid',
            borderColor: active ? (isMonthly ? '#f0c068' : 'rgba(255,255,255,0.18)') : 'rgba(255,255,255,0.08)',
            background: active ? (isMonthly ? 'rgba(240,192,104,0.16)' : 'rgba(255,255,255,0.10)') : 'rgba(255,255,255,0.02)',
            color: active ? (isMonthly ? '#f7d394' : '#fff') : 'rgba(255,255,255,0.55)',
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.1,
            position: 'relative', minWidth: 52,
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

// Settlement countdown
function SettlementCountdown({ dte }) {
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
        {dte}d · 13:30
      </span>
    </Glass2>
  );
}

function Obsidian3() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [workspace, setWorkspace] = uS('calc');
  const [expiryId, setExpiryId] = uS('m');
  const expiry = TXO_EXPIRIES.find((e) => e.id === expiryId) || TXO_EXPIRIES[2];

  const [legs, setLegs] = uS(TXO_DEFAULT_LEGS);
  const [spot, setSpot] = uS(TXO_SPOT);
  const [iv, setIv] = uS(24);
  const [view, setView] = uS('payoff');
  const [hover, setHover] = uS(null);
  const [sliceFrac, setSliceFrac] = uS(1); // 0 = now, 1 = expiry

  const dte = expiry.dte;
  const D = DENSITY[t.density] || DENSITY.comfortable;
  const accent = `oklch(0.66 0.16 ${t.accentHue})`;
  const vp = useViewport();
  // On phone/fold, only Calculator / Chain / Pricer workspaces are shown.
  // If the user previously chose iv/compare on a desktop, snap back to calc.
  uE(() => {
    if (vp.layout !== 'desk' && (workspace === 'iv' || workspace === 'compare')) setWorkspace('calc');
  }, [vp.layout]);

  // P&L numbers (×50 NTD per point). BS-valued at the same daysRem as PayoffChart
  // so the displayed number always matches the curve.
  const pnlPts = uM(() => {
    const daysRem = Math.max(0, dte * (1 - sliceFrac));
    return legs.reduce((acc, l) => {
      const sign = l.side === 'long' ? 1 : -1;
      const v = bsPrice(l.type, spot, l.strike, iv, daysRem);
      return acc + sign * l.qty * (v - l.premium);
    }, 0);
  }, [legs, spot, iv, dte, sliceFrac]);
  const pnlNTD = pnlPts * 50;
  const maxProfit = uM(() => {
    let m = -Infinity;
    for (let s = spot * 0.7; s <= spot * 1.3; s += 25) m = Math.max(m, legs.reduce((a, l) => a + legPayoff(l, s), 0));
    return m * 50;
  }, [legs, spot]);
  const maxLoss = uM(() => {
    let m = Infinity;
    for (let s = spot * 0.7; s <= spot * 1.3; s += 25) m = Math.min(m, legs.reduce((a, l) => a + legPayoff(l, s), 0));
    return m * 50;
  }, [legs, spot]);

  // Live Greeks for the current portfolio (replaces hardcoded chips).
  const portfolioG = uM(() => portfolioGreeks(legs, spot, iv, dte), [legs, spot, iv, dte]);
  // Real POP from lognormal P&L distribution (replaces hardcoded 0.68).
  const popValue = uM(() => pnlDistribution(legs, spot, iv, dte).pop, [legs, spot, iv, dte]);
  // Data quality of legs against current chain.
  const chainRows = uM(() => (window.genChain ? window.genChain({ spot, contract: expiry.type }) : []), [spot, expiry.type]);
  const quality = uM(() => dataQuality(legs, chainRows), [legs, chainRows]);

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
      fontFamily: 'var(--font-display)', color: '#e8eaef',
      background: `
        radial-gradient(ellipse 60% 70% at 18% 30%, ${t.showAuroraBlobs ? `oklch(0.34 0.10 ${t.accentHue}) 0%` : 'transparent 0%'}, transparent 60%),
        radial-gradient(ellipse 50% 50% at 82% 70%, ${t.showAuroraBlobs ? 'oklch(0.30 0.08 30) 0%' : 'transparent 0%'}, transparent 60%),
        radial-gradient(ellipse 80% 60% at 50% 100%, ${t.showAuroraBlobs ? `oklch(0.26 0.06 ${(t.accentHue + 60) % 360}) 0%` : 'transparent 0%'}, transparent 65%),
        linear-gradient(180deg, #0a0d14 0%, #11151f 100%)
      `,
    }}>
      {/* texture grid */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} />

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 18, left: 24, right: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 12 }}>
        <Glass2 tone="chip" radius={999} padding="8px 14px" style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, oklch(0.78 0.14 75), ${accent})`, boxShadow: `0 0 12px -2px ${accent}` }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.2 }}>Options Lab</span>
        </Glass2>

        <WorkspaceTabs value={workspace} onChange={setWorkspace} accent={accent} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <Glass2 tone="chip" radius={999} padding="8px 12px" style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <span className="mono" style={{ fontSize: 10, opacity: 0.6, padding: '2px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>TXO</span>
            <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{spot.toLocaleString()}</span>
            <span className="tnum" style={{ fontSize: 11, color: 'oklch(0.78 0.14 145)' }}>+0.84%</span>
          </Glass2>
          <SettlementCountdown dte={dte} />
        </div>
      </div>

      {/* Expiry strip — second row */}
      <div style={{ position: 'absolute', top: 64, left: 24, right: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 12 }}>
        <ExpiryStrip value={expiryId} onChange={setExpiryId} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Glass2 tone="chip" radius={8} padding="5px 10px" style={{ fontSize: 10, opacity: 0.7, fontFamily: 'ui-monospace, SF Mono, monospace', whiteSpace: 'nowrap' }}>
            ×50 NTD/pt
          </Glass2>
        </div>
      </div>

      {/* WORKSPACE BODY */}
      {workspace === 'calc' && (
        <CalcWorkspace
          legs={legs} setLegs={setLegs}
          spot={spot} setSpot={setSpot}
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
          spot={spot} expiry={expiry}
          onAddLeg={addLegFromChain}
          legs={legs} setLegs={setLegs}
          D={D}
          quality={quality}
        />
      )}
      {workspace === 'pricer' && (
        <PricerWorkspace D={D} spot={spot} iv={iv} dte={dte} accent={accent} />
      )}
      {workspace === 'iv' && (
        <IVWorkspace D={D} expiry={expiry} />
      )}
      {workspace === 'compare' && (
        <CompareWorkspace D={D} spot={spot} iv={iv} dte={dte} />
      )}

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
function CalcWorkspace({ legs, setLegs, spot, setSpot, iv, setIv, dte, sliceFrac, setSliceFrac, view, setView, pnlPts, pnlNTD, maxProfit, maxLoss, hover, setHover, accent, D, t, portfolioG, popValue, quality }) {
  const hoverInfo = uM(() => {
    if (!hover) return null;
    const spotAt = (spot * (1 + hover.xn * 0.18)).toFixed(0);
    const dteAt = (dte * (1 - hover.yn)).toFixed(0);
    const pnlAt = (hover.v * 1000 * 50).toFixed(0); // approx points × 50
    return { spotAt, dteAt, pnlAt };
  }, [hover, spot, dte]);

  return (
    <>
      {/* 3D background fills middle */}
      <div style={{ position: 'absolute', inset: '110px 0 0 0' }}>
        <Surface3DMount theme="dark" height="100%" scheme={t.scheme} onHover={setHover} />
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
            NT${parseFloat(hoverInfo.pnlAt) >= 0 ? '+' : ''}{Math.round(parseFloat(hoverInfo.pnlAt)).toLocaleString()}
          </span>
        </div>
      )}

      {/* Left column */}
      <div style={{
        position: 'absolute', top: 110, left: 24, width: 320, zIndex: 5,
        display: 'flex', flexDirection: 'column', gap: D.gap,
        maxHeight: 'calc(100vh - 200px)', overflow: 'auto', paddingBottom: 4,
      }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={
            <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 100) / 50) * 50, iv, dte)])}>+ leg</button>
          }>Legs</Eyebrow>
          <LegEditor legs={legs} onChange={setLegs} theme="dark" />
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={
            <span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>1-click</span>
          }>Stress test</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { label: '−5% & IV+15%', spot: -5, iv: 15 },
              { label: '+3% & IV−5%',  spot: 3,  iv: -5 },
              { label: '−10% crash',   spot: -10, iv: 21 },
              { label: 'Reset',        spot: 0,  iv: 0,  reset: true },
            ].map((s, i) => (
              <button key={i} onClick={() => {
                if (s.reset) { setSpot(TXO_SPOT); setIv(24); return; }
                setSpot(Math.round(TXO_SPOT * (1 + s.spot/100)));
                setIv(Math.max(10, Math.min(50, 24 + s.iv)));
              }} style={{
                padding: '8px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                border: '1px solid rgba(255,255,255,0.10)', cursor: 'pointer',
                background: 'rgba(255,255,255,0.03)', color: '#e8eaef', fontFamily: 'inherit',
              }}>{s.label}</button>
            ))}
          </div>
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow>Saved scenarios</Eyebrow>
          <ScenarioTimeline theme="dark" items={SAVED_SCENARIOS} current={SAVED_SCENARIOS.length - 1} />
        </Glass2>
      </div>

      {/* Right column */}
      <div style={{
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
                color: pnlNTD >= 0 ? 'oklch(0.84 0.14 75)' : 'oklch(0.74 0.12 220)',
                fontFamily: 'ui-monospace, SF Mono, monospace', lineHeight: 1,
              }}>
                {pnlNTD >= 0 ? '+' : ''}NT${Math.abs(Math.round(pnlNTD)).toLocaleString()}
              </div>
              <div className="tnum" style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                {pnlPts >= 0 ? '+' : ''}{pnlPts.toFixed(1)} pts × 50 NTD
              </div>
              <div className="tnum" style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
                Max profit <span style={{ color: '#f0c068' }}>+NT${Math.round(maxProfit).toLocaleString()}</span>
                <span style={{ opacity: 0.4 }}> · </span>
                Max loss <span style={{ color: '#5fa3d4' }}>NT${Math.round(maxLoss).toLocaleString()}</span>
              </div>
            </div>
            <div style={{ width: 110 }}>
              <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600, textAlign: 'center' }}>POP</div>
              <POPGauge theme="dark" size={110} value={popValue} />
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
              background: view === tab.id ? 'rgba(255,255,255,0.10)' : 'transparent',
              color: view === tab.id ? '#fff' : 'rgba(255,255,255,0.55)',
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
            <PayoffChart legs={legs} spot={spot} theme="dark" height={140} width={304} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={sliceFrac} rangePct={0.08} showKeyNumbers={true} />
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
            <CrossSection theme="dark" dte={dte} height={140} width={304} />
          </>)}
          {view === 'greeks' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d · IV {iv}%</span>}>
              Greeks <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· Δ Γ Θ V vs spot</span>
            </Eyebrow>
            <GreeksProfile legs={legs} spot={spot} iv={iv} dte={dte} theme="dark" height={140} width={304} />
          </>)}
          {view === 'dist' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>at expiry</span>}>
              P&L distribution <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· lognormal</span>
            </Eyebrow>
            <PnLDistribution legs={legs} spot={spot} iv={iv} dte={dte} theme="dark" height={140} width={304} />
          </>)}
          {view === 'attr' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>vs baseline</span>}>
              P&L attribution <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· why up / down</span>
            </Eyebrow>
            <PnLAttribution legs={legs} spot={spot} iv={iv} dte={dte} theme="dark" height={150} width={304} />
          </>)}
          {view === 'theta' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>θ decay</span>}>Time decay</Eyebrow>
            <ThetaDecay theme="dark" dte={dte} height={140} width={304} />
            <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>−NT${(0.12 * 50 * 100).toFixed(0)} / day at current DTE</div>
          </>)}
          {view === 'iv' && (<>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{iv}% ATM</span>}>IV smile</Eyebrow>
            <IVSmile theme="dark" iv={iv} height={140} width={304} />
          </>)}
        </Glass2>

        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<DataQualityPill quality={quality} />}>Greeks</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <GreekChip label="Delta · Δ" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme="dark" emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
            <GreekChip label="Gamma · Γ" value={portfolioG.gamma.toFixed(4)} theme="dark" />
            <GreekChip label="Theta · Θ" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme="dark" emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
            <GreekChip label="Vega · V" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme="dark" emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
          </div>
        </Glass2>
      </div>

      {/* Bottom command rail */}
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        width: 'min(720px, calc(100vw - 720px))', zIndex: 5,
      }}>
        <Glass2 tone="raised" padding="16px 22px">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
            <Slider label="Spot" value={spot} min={20000} max={23500} step={10} onChange={setSpot} format={(v) => v.toLocaleString()} theme="dark" />
            <Slider label="IV" value={iv} min={10} max={50} step={0.5} suffix="%" onChange={setIv} theme="dark" />
          </div>
        </Glass2>
      </div>

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
function ChainWorkspace({ spot, expiry, onAddLeg, legs, setLegs, D, quality }) {
  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, display: 'flex', gap: D.gap }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <Glass2 tone="panel" padding={D.panelPad} style={{ maxHeight: '100%', overflow: 'auto' }}>
          <Eyebrow right={
            <span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>
          }>Option Chain · TXO</Eyebrow>
          <OptionChain spot={spot} contract={expiry.type} onAddLeg={onAddLeg} theme="dark" />
        </Glass2>
      </div>
      <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: D.gap, maxHeight: '100%', overflow: 'auto', paddingBottom: 4 }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={
            <button style={miniBtn} onClick={() => setLegs([])}>clear</button>
          }>Current legs · {legs.length}</Eyebrow>
          {legs.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 11, opacity: 0.5 }}>Click any chain row to add a leg</div>
          ) : (
            <LegEditor legs={legs} onChange={setLegs} theme="dark" />
          )}
        </Glass2>
        <Glass2 tone="raised" padding={D.panelPad}>
          <Eyebrow right={<DataQualityPill quality={quality} />}>Net premium</Eyebrow>
          <div className="tnum" style={{ fontSize: 28, fontWeight: 600, fontFamily: 'ui-monospace, SF Mono, monospace', letterSpacing: -0.4 }}>
            NT${Math.round(legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) * 50).toLocaleString()}
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
            {legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) >= 0 ? 'credit received' : 'debit paid'}
          </div>
        </Glass2>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label} · {expiry.dte}d</span>}>OI profile</Eyebrow>
          <OIProfile spot={spot} contract={expiry.type} theme="dark" maxRows={11} />
        </Glass2>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>結算指標</span>}>Max pain</Eyebrow>
          <MaxPain spot={spot} contract={expiry.type} theme="dark" height={150} width={280} />
        </Glass2>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────── PRICER WORKSPACE
function PricerWorkspace({ D, spot, iv, dte, accent }) {
  return (
    <div style={{ position: 'absolute', top: 110, left: 0, right: 0, bottom: 0, zIndex: 5, padding: '0 24px 24px', overflowY: 'auto' }}>
      <div style={{ maxWidth: 540, margin: '0 auto' }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>Black-Scholes · 歐式</span>}>
            Option Pricer <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500, marginLeft: 4, textTransform: 'none' }}>· 單張合約理論定價</span>
          </Eyebrow>
          <OptionPricer spot={spot} iv={iv} dte={dte} theme="dark" accent={accent} />
        </Glass2>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────── IV SURFACE WORKSPACE
function IVWorkspace({ D, expiry }) {
  const ref = uR(null);
  uE(() => {
    if (!ref.current || !window.IVSurface3D) return;
    const inst = window.IVSurface3D.make({ container: ref.current });
    return () => inst && inst.destroy && inst.destroy();
  }, []);
  return (
    <div style={{ position: 'absolute', top: 110, left: 24, right: 24, bottom: 24, zIndex: 5, display: 'flex', gap: D.gap }}>
      <Glass2 tone="panel" padding={D.panelPad} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>strike × DTE × IV</span>}>IV Surface</Eyebrow>
        <div ref={ref} style={{ flex: 1, minHeight: 360, borderRadius: 14, overflow: 'hidden', background: 'radial-gradient(ellipse at 30% 30%, rgba(167,139,250,0.10), transparent 60%)' }} />
      </Glass2>
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: D.gap }}>
        <Glass2 tone="panel" padding={D.panelPad}>
          <Eyebrow>Term structure</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TXO_EXPIRIES.map((e) => {
              const ivAtm = 22 + (1 - e.dte / 60) * 6;
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
            <strong style={{ color: '#fff' }}>Drag</strong> to orbit · <strong style={{ color: '#fff' }}>scroll</strong> to zoom. Surface shows IV across all listed strikes & expiries — lower-left = short-dated puts (highest IV); upper-right = long-dated calls.
          </div>
        </Glass2>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────── COMPARE WORKSPACE
// Strategy templates. Premium is computed by Black-Scholes at the current
// spot/iv/dte so the numbers actually reflect the underlying TXO regime
// (previously these were hardcoded for spot≈480 and made the calc nonsense
// at TXO 21850). Strikes snap to the 50pt TXO grid.
function _bs(type, S, K, iv, dte) {
  return Math.round(window.bsPrice(type, S, K, iv, dte) * 100) / 100;
}
function _mkLeg(side, type, S, K, iv, dte, qty = 1) {
  return { side, type, strike: K, premium: _bs(type, S, K, iv, dte), qty };
}
const STRATEGY_LIBRARY = [
  { id: 'bull-call',  name: 'Bull Call Spread',  bias: 'bullish', tag: '看小漲',
    build: (s, iv, dte) => [_mkLeg('long','call',s,s,iv,dte), _mkLeg('short','call',s,s+200,iv,dte)] },
  { id: 'bear-put',   name: 'Bear Put Spread',   bias: 'bearish', tag: '看小跌',
    build: (s, iv, dte) => [_mkLeg('long','put',s,s,iv,dte), _mkLeg('short','put',s,s-200,iv,dte)] },
  { id: 'iron-condor',name: 'Iron Condor',       bias: 'neutral', tag: '盤整收租',
    build: (s, iv, dte) => [_mkLeg('short','put',s,s-300,iv,dte), _mkLeg('long','put',s,s-500,iv,dte), _mkLeg('short','call',s,s+300,iv,dte), _mkLeg('long','call',s,s+500,iv,dte)] },
  { id: 'straddle',   name: 'Long Straddle',     bias: 'volatile',tag: '大波動',
    build: (s, iv, dte) => [_mkLeg('long','call',s,s,iv,dte), _mkLeg('long','put',s,s,iv,dte)] },
  { id: 'strangle',   name: 'Long Strangle',     bias: 'volatile',tag: '大波動(便宜)',
    build: (s, iv, dte) => [_mkLeg('long','call',s,s+150,iv,dte), _mkLeg('long','put',s,s-150,iv,dte)] },
  { id: 'short-strangle', name: 'Short Strangle',bias: 'neutral', tag: '盤整裸賣',
    build: (s, iv, dte) => [_mkLeg('short','call',s,s+200,iv,dte), _mkLeg('short','put',s,s-200,iv,dte)] },
  { id: 'put-credit', name: 'Put Credit Spread', bias: 'bullish', tag: '看不跌',
    build: (s, iv, dte) => [_mkLeg('short','put',s,s-100,iv,dte), _mkLeg('long','put',s,s-300,iv,dte)] },
  { id: 'call-credit',name: 'Call Credit Spread',bias: 'bearish', tag: '看不漲',
    build: (s, iv, dte) => [_mkLeg('short','call',s,s+100,iv,dte), _mkLeg('long','call',s,s+300,iv,dte)] },
  { id: 'butterfly',  name: 'Long Butterfly',    bias: 'neutral', tag: '精準錨點',
    build: (s, iv, dte) => [_mkLeg('long','call',s,s-150,iv,dte), _mkLeg('short','call',s,s,iv,dte,2), _mkLeg('long','call',s,s+150,iv,dte)] },
  { id: 'long-call',  name: 'Long Call',         bias: 'bullish', tag: '純多單',
    build: (s, iv, dte) => [_mkLeg('long','call',s,s,iv,dte)] },
  { id: 'long-put',   name: 'Long Put',          bias: 'bearish', tag: '純空單',
    build: (s, iv, dte) => [_mkLeg('long','put',s,s,iv,dte)] },
];

function CompareWorkspace({ D, spot, iv, dte }) {
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
            key={id}
            strategy={STRATEGY_LIBRARY.find((x) => x.id === id)}
            spot={spot}
            iv={iv}
            dte={dte}
            D={D}
            biasColor={biasColor}
            onRemove={() => toggle(id)}
          />
        ))}
      </div>
    </div>
  );
}

function CompareCard({ strategy: s, spot, iv, dte, D, biasColor, onRemove }) {
  // Local editable legs — initialize from strategy's build() at current iv/dte.
  const [legs, setLegs] = uS(() => s.build(Math.round(spot / 50) * 50, iv, dte));
  const c = biasColor[s.bias];

  const credit = legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0);
  let mp = -Infinity, ml = Infinity;
  for (let st = spot * 0.92; st <= spot * 1.08; st += 25) {
    const v = legs.reduce((a, l) => a + legPayoff(l, st), 0);
    mp = Math.max(mp, v); ml = Math.min(ml, v);
  }
  const bes = [];
  let prev = null;
  for (let st = spot * 0.92; st <= spot * 1.08; st += 10) {
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

      <PayoffChart legs={legs} spot={spot} theme="dark" height={170} width={300} iv={24} dte={17} showCone={true} sliceFrac={1} rangePct={0.06} showKeyNumbers={true} />

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
                type="number" step="50" value={l.strike}
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
            +NT${Math.round(mp * 50).toLocaleString()}
          </div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(38,166,154,0.10)', border: '1px solid rgba(38,166,154,0.18)' }}>
          <div style={{ fontSize: 9, letterSpacing: 0.4, opacity: 0.7, fontWeight: 600 }}>MAX LOSS</div>
          <div className="tnum" style={{ fontFamily: 'ui-monospace, SF Mono, monospace', fontWeight: 700, color: '#26a69a', fontSize: 13 }}>
            NT${Math.round(ml * 50).toLocaleString()}
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
            {credit >= 0 ? '+' : ''}NT${Math.round(credit * 50).toLocaleString()}
          </div>
        </div>
      </div>
    </Glass2>
  );
}

const miniBtn = {
  fontSize: 10, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
  padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.04)', color: '#e8eaef', cursor: 'pointer', whiteSpace: 'nowrap',
};

// ═════════════════════════════════════════════════════════════════════════════
// MOBILE / FOLDABLE LAYOUT
// ═════════════════════════════════════════════════════════════════════════════
function MobileApp({
  vp, workspace, setWorkspace,
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
            <span className="mono" style={{ fontSize: 9, opacity: 0.6 }}>TXO</span>
            <span className="tnum" style={{ fontSize: 12, fontWeight: 600 }}>{spot.toLocaleString()}</span>
            <span style={{ fontSize: 9, color: '#f0c068' }}>{dte}d</span>
          </Glass2>
        </div>

        {/* Workspace toggle (mobile = Calc / Chain / Pricer) */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {[
            { id: 'calc', label: 'Calc' },
            { id: 'chain', label: 'Chain' },
            { id: 'pricer', label: 'Pricer' },
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
          {TXO_EXPIRIES.map((e) => {
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
            spot={spot} expiry={expiry}
            legs={legs} setLegs={setLegs}
            addLegFromChain={addLegFromChain}
            quality={quality}
          />
        )}
        {workspace === 'pricer' && (
          <Glass2 tone="panel" padding={14}>
            <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>單張定價</span>}>Option Pricer</Eyebrow>
            <OptionPricer spot={spot} iv={iv} dte={dte} theme="dark" accent={accent} />
          </Glass2>
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
          <Slider label="Spot" value={spot} min={20000} max={23500} step={10} onChange={setSpot} format={(v) => v.toLocaleString()} theme="dark" />
          {workspace !== 'chain' && (
            <Slider label="IV" value={iv} min={10} max={50} step={0.5} suffix="%" onChange={setIv} theme="dark" />
          )}
        </div>
      </div>
    </div>
  );
}

function MobileCalc({
  isFold, chartW,
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
              {pnlNTD >= 0 ? '+' : ''}NT${Math.abs(Math.round(pnlNTD)).toLocaleString()}
            </div>
            <div className="tnum" style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
              Max <span style={{ color: '#f0c068' }}>+NT${Math.round(maxProfit).toLocaleString()}</span>
              <span style={{ opacity: 0.4 }}> · </span>
              Min <span style={{ color: '#5fa3d4' }}>NT${Math.round(maxLoss).toLocaleString()}</span>
            </div>
          </div>
          <div style={{ width: 84, flexShrink: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', opacity: 0.5, fontWeight: 600, textAlign: 'center', marginBottom: 2 }}>POP</div>
            <POPGauge theme="dark" size={84} value={popValue} />
          </div>
        </div>
      </Glass2>

      {/* 3D surface — small but present */}
      <Glass2 tone="panel" padding={6} style={{ position: 'relative', height: isFold ? 320 : 220 }}>
        <Surface3DMount theme="dark" height="100%" scheme={t.scheme} />
      </Glass2>

      {/* Chart tabs */}
      <Glass2 tone="chip" padding={3} style={{ display: 'flex', gap: 2, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        {[
          { id: 'payoff', label: 'Payoff' },
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
          <PayoffChart legs={legs} spot={spot} theme="dark" height={150} width={chartW} iv={iv} dte={dte} showCone={t.showProbCone} sliceFrac={sliceFrac} rangePct={0.08} showKeyNumbers={true} />
          <div style={{ marginTop: 10 }}>
            <input type="range" min="0" max="1" step="0.01" value={sliceFrac} onChange={(e) => setSliceFrac(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: accent }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.5, fontFamily: 'ui-monospace, SF Mono, monospace' }}>
              <span>now</span><span>expiry</span>
            </div>
          </div>
        </>)}
        {view === 'greeks' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{dte}d</span>}>Greeks vs spot</Eyebrow>
          <GreeksProfile legs={legs} spot={spot} iv={iv} dte={dte} theme="dark" height={150} width={chartW} />
        </>)}
        {view === 'dist' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>at expiry</span>}>P&L distribution</Eyebrow>
          <PnLDistribution legs={legs} spot={spot} iv={iv} dte={dte} theme="dark" height={150} width={chartW} />
        </>)}
        {view === 'attr' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>vs baseline</span>}>P&L attribution</Eyebrow>
          <PnLAttribution legs={legs} spot={spot} iv={iv} dte={dte} theme="dark" height={155} width={chartW} />
        </>)}
        {view === 'theta' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>θ decay</span>}>Time decay</Eyebrow>
          <ThetaDecay theme="dark" dte={dte} height={150} width={chartW} />
        </>)}
        {view === 'iv' && (<>
          <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{iv}% ATM</span>}>IV smile</Eyebrow>
          <IVSmile theme="dark" iv={iv} height={150} width={chartW} />
        </>)}
      </Glass2>

      {/* Greeks chips */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow>Greeks at current spot</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
          <GreekChip label="Δ" value={(portfolioG.delta >= 0 ? '+' : '') + portfolioG.delta.toFixed(2)} theme="dark" emphasis={portfolioG.delta >= 0 ? 'up' : 'down'} />
          <GreekChip label="Γ" value={portfolioG.gamma.toFixed(4)} theme="dark" />
          <GreekChip label="Θ" value={(portfolioG.theta >= 0 ? '+' : '') + portfolioG.theta.toFixed(2)} theme="dark" emphasis={portfolioG.theta >= 0 ? 'up' : 'down'} />
          <GreekChip label="V" value={(portfolioG.vega >= 0 ? '+' : '') + portfolioG.vega.toFixed(2)} theme="dark" emphasis={portfolioG.vega >= 0 ? 'up' : 'down'} />
        </div>
      </Glass2>

      {/* Legs editor */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow right={
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={miniBtn} onClick={() => setLegs([...legs, _mkLeg('long', 'call', spot, Math.round((spot + 100) / 50) * 50, iv, dte)])}>+ leg</button>
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
                onClick={() => setLegs(s.build(Math.round(spot / 50) * 50, iv, dte))}
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
          <LegEditor legs={legs} onChange={setLegs} theme="dark" />
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
              if (s.reset) { setSpot(TXO_SPOT); setIv(24); return; }
              setSpot(Math.round(TXO_SPOT * (1 + s.spot / 100)));
              setIv(Math.max(10, Math.min(50, 24 + s.iv)));
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

function MobileChain({ isFold, chartW, spot, expiry, legs, setLegs, addLegFromChain, quality }) {
  return (
    <>
      {/* Net premium card */}
      <Glass2 tone="raised" padding={12}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Eyebrow right={<DataQualityPill quality={quality} />}>Net premium</Eyebrow>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'ui-monospace, SF Mono, monospace', letterSpacing: -0.3 }}>
              NT${Math.round(legs.reduce((a, l) => a + (l.side === 'long' ? -1 : 1) * l.premium * l.qty, 0) * 50).toLocaleString()}
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
        <MobileChainTable spot={spot} contract={expiry.type} onAddLeg={addLegFromChain} />
      </Glass2>

      {/* OI Profile */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>{expiry.label}</span>}>OI profile</Eyebrow>
        <OIProfile spot={spot} contract={expiry.type} theme="dark" maxRows={9} />
      </Glass2>

      {/* Max Pain */}
      <Glass2 tone="panel" padding={12}>
        <Eyebrow right={<span className="mono" style={{ fontSize: 9, opacity: 0.5 }}>結算指標</span>}>Max pain</Eyebrow>
        <MaxPain spot={spot} contract={expiry.type} theme="dark" height={150} width={chartW} />
      </Glass2>

      {/* Current legs */}
      {legs.length > 0 && (
        <Glass2 tone="panel" padding={12}>
          <Eyebrow>Current legs</Eyebrow>
          <LegEditor legs={legs} onChange={setLegs} theme="dark" />
        </Glass2>
      )}
    </>
  );
}

// Compact chain table for phone — drops OI/Vol columns, keeps IV / BID-ASK / Strike.
function MobileChainTable({ spot, contract, onAddLeg }) {
  const rows = uM(() => (window.genChain ? window.genChain({ spot, contract }) : []), [spot, contract]);
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
