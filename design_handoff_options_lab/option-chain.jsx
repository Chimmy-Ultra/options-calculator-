// Option Chain table (TXO-styled).
// Calls on left, Puts on right, strike in middle. Click any cell adds a leg.

const { useMemo: cnM, useState: cnS } = React;

function genChain({ spot, contract }) {
  const strikeStep = 50; // TXO 點
  const center = Math.round(spot / strikeStep) * strikeStep;
  const rows = [];
  for (let i = -8; i <= 8; i++) {
    const strike = center + i * strikeStep;
    const m = Math.abs(strike - spot) / spot;
    // Mock IV smile + premiums
    const ivBase = contract === 'weekly' ? 22 : 24;
    const iv = ivBase + Math.pow(m * 6, 1.6) * 8 + (i < 0 ? 1.2 : -0.4);
    const callIntrinsic = Math.max(spot - strike, 0);
    const putIntrinsic = Math.max(strike - spot, 0);
    const timeVal = Math.max(0, 70 - Math.abs(strike - spot) * 0.7) * (contract === 'weekly' ? 0.5 : 1);
    const callPx = callIntrinsic + timeVal * (i <= 0 ? 1 : 0.7);
    const putPx = putIntrinsic + timeVal * (i >= 0 ? 1 : 0.7);
    const callOI = Math.round(8000 - Math.abs(i) * 600 + Math.random() * 400);
    const putOI = Math.round(7500 - Math.abs(i) * 550 + Math.random() * 400);
    const callVol = Math.round(callOI * 0.18);
    const putVol = Math.round(putOI * 0.18);
    rows.push({
      strike,
      atm: Math.abs(strike - spot) <= strikeStep / 2,
      itmCall: strike < spot, itmPut: strike > spot,
      call: { bid: Math.max(0, callPx - 1.0), ask: callPx + 1.0, last: callPx, iv, oi: callOI, vol: callVol, delta: 0.5 + (spot - strike) / (spot * 0.06) },
      put:  { bid: Math.max(0, putPx - 1.0),  ask: putPx + 1.0,  last: putPx,  iv, oi: putOI,  vol: putVol,  delta: -0.5 + (spot - strike) / (spot * 0.06) },
    });
  }
  return rows;
}

function OptionChain({ spot, contract = 'monthly', onAddLeg, theme = 'dark' }) {
  const rows = cnM(() => genChain({ spot, contract }), [spot, contract]);
  const [hov, setHov] = cnS(null); // { row, side }
  const dark = theme === 'dark';
  const colHead = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const border = dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.06)';
  const rowAlt = dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.55)';
  const itmBg = dark ? 'rgba(240,192,104,0.05)' : 'rgba(240,192,104,0.10)';

  function cellClick(strike, side, opt) {
    if (!onAddLeg) return;
    onAddLeg({ side: 'long', type: side, strike, premium: parseFloat(opt.last.toFixed(2)), qty: 1 });
  }

  const HCol = ({ children, align = 'right' }) => (
    <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: colHead, fontWeight: 600, padding: '8px 10px', textAlign: align }}>
      {children}
    </div>
  );

  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      {/* legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 12px 10px' }}>
        <div style={{ fontSize: 11, opacity: 0.55 }}>
          <span style={{ color: '#ef5350', fontWeight: 600 }}>CALL 買權</span>
          <span style={{ opacity: 0.4, margin: '0 8px' }}>|</span>
          <span style={{ color: '#26a69a', fontWeight: 600 }}>PUT 賣權</span>
          <span style={{ opacity: 0.4, marginLeft: 12 }}>· click any row to add leg</span>
        </div>
        <div className="mono" style={{ fontSize: 10, opacity: 0.5 }}>
          contract size = ×50 NTD · ATM = ${rows.find((r) => r.atm)?.strike}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 80px repeat(4, 1fr)', borderRadius: 12, overflow: 'hidden', border: `1px solid ${border}`, background: dark ? 'rgba(20,24,34,0.4)' : 'rgba(255,255,255,0.6)' }}>
        {/* Header */}
        <HCol>OI</HCol><HCol>Vol</HCol><HCol>IV</HCol><HCol>BID/ASK</HCol>
        <div style={{ fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase', color: colHead, fontWeight: 600, padding: '8px', textAlign: 'center' }}>STRIKE</div>
        <HCol align="left">BID/ASK</HCol><HCol align="left">IV</HCol><HCol align="left">Vol</HCol><HCol align="left">OI</HCol>

        {rows.map((r, i) => {
          const isHov = hov && hov.row === i;
          const callItmBg = dark ? 'rgba(239,83,80,0.08)' : 'rgba(239,83,80,0.12)';
          const putItmBg  = dark ? 'rgba(38,166,154,0.08)' : 'rgba(38,166,154,0.12)';
          const callBg = (isHov && hov.side === 'call') ? (dark ? 'rgba(239,83,80,0.22)' : 'rgba(239,83,80,0.26)') : (r.itmCall ? callItmBg : (i % 2 ? rowAlt : 'transparent'));
          const putBg  = (isHov && hov.side === 'put')  ? (dark ? 'rgba(38,166,154,0.22)' : 'rgba(38,166,154,0.26)') : (r.itmPut  ? putItmBg : (i % 2 ? rowAlt : 'transparent'));
          const Cell = ({ children, area, side, align = 'right' }) => (
            <div onClick={() => cellClick(r.strike, side, side === 'call' ? r.call : r.put)}
                 onMouseEnter={() => setHov({ row: i, side })}
                 onMouseLeave={() => setHov(null)}
                 style={{
              padding: '7px 10px', borderTop: `1px solid ${border}`, fontSize: 12,
              fontFamily: 'ui-monospace, SF Mono, monospace', fontVariantNumeric: 'tabular-nums',
              color: dark ? '#e8eaef' : '#1d1d22',
              background: side === 'call' ? callBg : putBg,
              textAlign: align, cursor: 'pointer', transition: 'background .12s',
            }}>
              {children}
            </div>
          );

          return (
            <React.Fragment key={r.strike}>
              <Cell side="call">{r.call.oi.toLocaleString()}</Cell>
              <Cell side="call">{r.call.vol.toLocaleString()}</Cell>
              <Cell side="call">{r.call.iv.toFixed(1)}%</Cell>
              <Cell side="call"><span style={{ color: '#ef5350', fontWeight: 600 }}>{r.call.bid.toFixed(1)}/{r.call.ask.toFixed(1)}</span></Cell>
              <div style={{
                padding: '7px 0', borderTop: `1px solid ${border}`,
                textAlign: 'center', fontWeight: r.atm ? 700 : 500,
                fontSize: r.atm ? 13 : 12, fontFamily: 'ui-monospace, SF Mono, monospace',
                background: r.atm ? (dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)') : 'transparent',
                color: r.atm ? (dark ? '#fff' : '#1d1d22') : (dark ? 'rgba(255,255,255,0.85)' : '#1d1d22'),
                position: 'relative',
              }}>
                {r.atm && <span style={{ position: 'absolute', left: 6, fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'oklch(0.66 0.16 250)', color: '#fff', fontWeight: 700, letterSpacing: 0.4 }}>ATM</span>}
                {r.strike}
              </div>
              <Cell side="put" align="left"><span style={{ color: '#26a69a', fontWeight: 600 }}>{r.put.bid.toFixed(1)}/{r.put.ask.toFixed(1)}</span></Cell>
              <Cell side="put" align="left">{r.put.iv.toFixed(1)}%</Cell>
              <Cell side="put" align="left">{r.put.vol.toLocaleString()}</Cell>
              <Cell side="put" align="left">{r.put.oi.toLocaleString()}</Cell>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

window.OptionChain = OptionChain;
window.genChain = genChain;
