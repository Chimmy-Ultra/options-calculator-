// Option Chain table (TXO-styled).
// Calls on left, Puts on right, strike in middle. Click any cell adds a leg.

const { useMemo: cnM, useState: cnS, useEffect: cnE } = React;

// Mock chain rows。product 給合約規格（strikeStep / 定價模型 / smile 方向），
// 理論價直接走 bsPrice（'bs' 或 'b76'），跟 payoff / P&L / Pricer 同一條定價路徑。
// live 模式下不會呼叫這裡 — rows 由 IB proxy 回傳、經 props 傳進各元件。
function genChain({ spot, contract, dte = 17, product }) {
  const P = product || (window.getProduct && window.getProduct('txo')) || {};
  const strikeStep = P.strikeStep || 50;
  const model = P.model || 'bs';
  const r = (P.r != null ? P.r : 1.5) / 100;
  const skewUp = P.skew === 'call' ? 1 : -1; // TXO put-skew；穀物 call-skew（旱災風險在上檔）
  const center = Math.round(spot / strikeStep) * strikeStep;
  const rows = [];
  for (let i = -8; i <= 8; i++) {
    const strike = center + i * strikeStep;
    const m = Math.abs(strike - spot) / spot;
    // Mock IV smile
    const ivBase = (P.ivBase && (P.ivBase[contract] != null ? P.ivBase[contract] : P.ivBase.std))
      || (contract === 'weekly' ? 22 : 24);
    // Smooth mock term structure: ATM IV rises gently with dte (calm-market
    // upward slope, ±0.9 pts over ~3 months) so the IV-surface term axis and
    // the term-structure card carry real gradients instead of flat steps.
    const termAdj = 1.8 * (1 - Math.exp(-dte / 60)) - 0.9;
    const iv = ivBase + termAdj + Math.pow(m * 6, 1.6) * 8 + (i * skewUp > 0 ? 1.2 : -0.4);
    const callPx = window.bsPrice('call', spot, strike, iv, dte, r, model);
    const putPx = window.bsPrice('put', spot, strike, iv, dte, r, model);
    const half = Math.max(strikeStep * 0.02, callPx * 0.02, putPx * 0.02); // bid-ask 半寬
    // Mock OI peaks a few strikes OTM on each side (call wall above spot, put
    // wall below), so the Levels walls sit away from spot like real books do.
    const callOI = Math.round(8000 - Math.abs(i - 3) * 600 + Math.random() * 400);
    const putOI = Math.round(7500 - Math.abs(i + 3) * 550 + Math.random() * 400);
    const callVol = Math.round(callOI * 0.18);
    const putVol = Math.round(putOI * 0.18);
    rows.push({
      strike,
      atm: Math.abs(strike - spot) <= strikeStep / 2,
      itmCall: strike < spot, itmPut: strike > spot,
      call: { bid: Math.max(0, callPx - half), ask: callPx + half, last: callPx, iv, oi: callOI, vol: callVol, delta: window.bsGreeks('call', spot, strike, iv, dte, r, model).delta },
      put:  { bid: Math.max(0, putPx - half),  ask: putPx + half,  last: putPx,  iv, oi: putOI,  vol: putVol,  delta: window.bsGreeks('put', spot, strike, iv, dte, r, model).delta },
    });
  }
  return rows;
}

// Quote formatting. CBOT grains trade in eighths of a cent (P.eighth) and show
// three decimals (e.g. 462.875); everything else shows one decimal, or two for
// sub-1 strike steps (NG).
function fmtPx(v, P) {
  if (P && P.eighth) return (Math.round(v * 8) / 8).toFixed(3);
  if (P && P.pxDecimals != null) return v.toFixed(P.pxDecimals); // products whose tick is finer than the strike step implies (VIX 0.05, NQ 0.25)
  if (P && P.strikeStep && P.strikeStep < 1) return v.toFixed(2);
  return v.toFixed(1);
}
// Delta, T-quote style: leading zero stripped, sign always shown ('+.69' / '-.31').
function fmtDelta(d) {
  return (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2).replace(/^0/, '');
}
// Strike label — two decimals when the strike step is fractional (NG).
function fmtStrike(k, step) {
  return step < 1 ? k.toFixed(2) : String(Math.round(k));
}

const CHAIN_COLS =
  'minmax(0,.8fr) minmax(0,.75fr) minmax(0,.6fr) minmax(0,.65fr) minmax(0,1.3fr) minmax(0,1.5fr) 84px minmax(0,1.5fr) minmax(0,1.3fr) minmax(0,.65fr) minmax(0,.6fr) minmax(0,.75fr) minmax(0,.8fr)';

// Rich / cheap colours for the 理論價 difference, the same pair the IV
// workspace uses for IV above / below realized volatility.
const THEO_RICH = '#f0c068', THEO_CHEAP = '#5fa3d4';

function OptionChain({ spot, contract = 'monthly', dte, product, rows: rowsProp, legs, onAddLeg, theme = 'dark', hv20 = null }) {
  const genRows = cnM(() => genChain({ spot, contract, dte, product }), [spot, contract, dte, product]);
  const rows = (rowsProp && rowsProp.length) ? rowsProp : genRows;
  const [hov, setHov] = cnS(null); // { row, side }
  // 理論價: the product's own model (Black-Scholes on spot / Black-76 on the
  // future) at ONE reference vol for the whole chain, so the difference to the
  // market reads as a premium: at the ATM IV the difference is the strike's
  // skew premium; at the 20-day realized vol it is what the market charges
  // over what the underlying has actually moved. Market = bid/ask mid, else last.
  const [theoMode, setTheoMode] = cnS('atm'); // 'atm' | 'hv'
  const Pm = product || {};
  let atmRow = null;
  for (const r of rows) if (!atmRow || Math.abs(r.strike - spot) < Math.abs(atmRow.strike - spot)) atmRow = r;
  const atmIv = atmRow ? ((atmRow.call.iv > 0 && atmRow.put.iv > 0) ? (atmRow.call.iv + atmRow.put.iv) / 2 : (atmRow.call.iv || atmRow.put.iv || null)) : null;
  const theoVol = theoMode === 'hv' ? hv20 : atmIv;
  const theoOf = (type, strike) => ((theoVol > 0 && dte != null && window.bsPrice)
    ? window.bsPrice(type, spot, strike, theoVol, dte, (Pm.r != null ? Pm.r : 1.5) / 100, Pm.model || 'bs') : null);
  const midOf = (opt) => ((opt.bid > 0 && opt.ask > 0) ? (opt.bid + opt.ask) / 2 : (opt.last > 0 ? opt.last : null));
  // Clicking a quote opens a BUY / SELL chooser anchored at the cell instead of
  // silently adding a long leg. { strike, type: 'call'|'put', opt, x, y }.
  const [popover, setPopover] = cnS(null);
  cnE(() => {
    if (!popover) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPopover(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);
  const dark = theme === 'dark';
  const P = product || {};
  const step = rows.length > 1 ? (rows[1].strike - rows[0].strike) : (P.strikeStep || 50);
  const colHead = dark ? 'rgba(255,255,255,0.45)' : 'rgba(20,30,50,0.45)';
  const border = dark ? 'rgba(255,255,255,0.06)' : 'rgba(25,40,70,0.08)';
  const rowAlt = dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.5)';

  // Position badges: match legs to strike + type.
  const legAt = (strike, type) => (legs || []).find((l) => l.strike === strike && l.type === type) || null;

  // Spot line vertical position within the grid (data area starts below the 28px header).
  const spotFrac = rows.length
    ? Math.max(0.02, Math.min(1, ((spot - rows[0].strike) / step + 0.5) / rows.length))
    : 0.5;
  const spotTxt = step < 5 ? spot.toFixed(2) : Math.round(spot).toLocaleString();

  // `type` here is the chain side (call / put). The BUY/SELL choice in the
  // popover becomes the leg's long / short side.
  function cellClick(strike, type, opt, e) {
    if (!onAddLeg) return;
    setPopover({ strike, type, opt, x: e.clientX, y: e.clientY });
  }
  function commitLeg(legSide) {
    if (!popover) return;
    onAddLeg({ side: legSide, type: popover.type, strike: popover.strike, premium: parseFloat(popover.opt.last.toFixed(2)), qty: 1, dte });
    setPopover(null);
  }

  const HCol = ({ children, align = 'right' }) => (
    <div style={{ fontSize: 10, color: colHead, fontWeight: 600, padding: '8px 10px', textAlign: align }}>
      {children}
    </div>
  );

  return (
    <div style={{ width: '100%' }}>
      {/* legend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '4px 4px 10px' }}>
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          <span style={{ color: '#ef5350', fontWeight: 600 }}>買權</span>
          <span style={{ opacity: 0.4, margin: '0 8px' }}>|</span>
          <span style={{ color: '#26a69a', fontWeight: 600 }}>賣權</span>
          <span style={{ opacity: 0.5, marginLeft: 12 }}>· 點一列加入部位</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 10, opacity: 0.6 }} title="理論價 = 本商品定價模型（Black-Scholes／Black-76）用同一個參考波動率算的價格；差 = 市價中值 − 理論價，＋為市場高估、－為低估">
            理論價 {theoVol > 0 ? `${theoVol.toFixed(1)}%` : '—'} · 差＝市價中值 − 理論價
          </span>
          <div className="seg">
            <button className={theoMode === 'atm' ? 'on' : ''} onClick={() => setTheoMode('atm')} title="用這個到期日價平的隱含波動率">價平 IV</button>
            <button className={theoMode === 'hv' ? 'on' : ''} onClick={() => hv20 != null && setTheoMode('hv')} disabled={hv20 == null} title={hv20 == null ? '日K不足，沒有 20 日歷史波動率' : `20 日歷史波動率 ${hv20.toFixed(1)}%`} style={hv20 == null ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>20日 HV</button>
          </div>
          <span className="mono" style={{ fontSize: 10, opacity: 0.5 }}>
            {(product && product.unitLabel) || '×50 NTD/pt'} · 價平 {fmtStrike(rows.find((r) => r.atm)?.strike ?? spot, step)}
          </span>
        </div>
      </div>

      <div className="lt-chainbg" style={{ overflowX: 'auto', borderRadius: 0, border: `1px solid ${border}`, background: dark ? 'rgba(20,24,34,0.4)' : 'rgba(255,255,255,0.55)' }}>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: CHAIN_COLS, minWidth: 1040, borderRadius: 0, overflow: 'hidden', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
          {/* Header */}
          <HCol>未平倉</HCol><HCol>量</HCol><HCol>Δ</HCol><HCol>IV</HCol><HCol>理論價 · 差</HCol><HCol>買價/賣價</HCol>
          <div style={{ fontSize: 10, color: colHead, fontWeight: 600, padding: '8px 0', textAlign: 'center' }}>履約價</div>
          <HCol align="left">買價/賣價</HCol><HCol align="left">理論價 · 差</HCol><HCol align="left">IV</HCol><HCol align="left">Δ</HCol><HCol align="left">量</HCol><HCol align="left">未平倉</HCol>

          {rows.map((r, i) => {
            const isHov = hov && hov.row === i;
            const callItmBg = dark ? 'rgba(239,83,80,0.08)' : 'rgba(239,83,80,0.12)';
            const putItmBg  = dark ? 'rgba(38,166,154,0.08)' : 'rgba(38,166,154,0.12)';
            const callBg = (isHov && hov.side === 'call') ? (dark ? 'rgba(239,83,80,0.22)' : 'rgba(239,83,80,0.26)') : (r.itmCall ? callItmBg : (i % 2 ? rowAlt : 'transparent'));
            const putBg  = (isHov && hov.side === 'put')  ? (dark ? 'rgba(38,166,154,0.22)' : 'rgba(38,166,154,0.26)') : (r.itmPut  ? putItmBg : (i % 2 ? rowAlt : 'transparent'));
            const callLeg = legAt(r.strike, 'call');
            const putLeg = legAt(r.strike, 'put');
            const Cell = ({ children, side, align = 'right' }) => (
              <div onClick={(e) => cellClick(r.strike, side, side === 'call' ? r.call : r.put, e)}
                   onMouseEnter={() => setHov({ row: i, side })}
                   onMouseLeave={() => setHov(null)}
                   style={{
                padding: '7px 10px', borderTop: `1px solid ${border}`,
                color: dark ? '#e8eaef' : '#1c2433',
                background: side === 'call' ? callBg : putBg,
                textAlign: align, cursor: 'pointer', transition: 'background .12s',
              }}>
                {children}
              </div>
            );
            // BID/ASK cell with optional position badge + ring.
            const BaCell = ({ side }) => {
              const leg = side === 'call' ? callLeg : putLeg;
              const opt = side === 'call' ? r.call : r.put;
              const ringCol = leg ? (leg.side === 'long' ? 'rgba(240,192,104,0.85)' : 'rgba(95,163,212,0.85)') : null;
              return (
                <div onClick={(e) => cellClick(r.strike, side, opt, e)}
                     onMouseEnter={() => setHov({ row: i, side })}
                     onMouseLeave={() => setHov(null)}
                     style={{
                  padding: '7px 10px', borderTop: `1px solid ${border}`,
                  background: side === 'call' ? callBg : putBg,
                  boxShadow: ringCol ? `inset 0 0 0 1px ${ringCol}` : 'none', borderRadius: ringCol ? 6 : 0,
                  textAlign: side === 'call' ? 'right' : 'left', cursor: 'pointer', position: 'relative', whiteSpace: 'nowrap',
                }}>
                  {leg && (
                    <span style={{
                      position: 'absolute', left: 5, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 7.5, fontWeight: 800, letterSpacing: 0.4, padding: '2px 5px', borderRadius: 4, lineHeight: 1,
                      background: leg.side === 'long' ? '#f0c068' : '#5fa3d4', color: '#0a0d14',
                    }}>{leg.side === 'long' ? '買 +' : '賣 −'}{leg.qty}</span>
                  )}
                  <span style={{ color: side === 'call' ? '#ef5350' : '#26a69a', fontWeight: 600 }}>
                    {fmtPx(opt.bid, P)}/{fmtPx(opt.ask, P)}
                  </span>
                </div>
              );
            };

            // 理論價 + the difference to the market mid (＋ rich in gold, － cheap in blue).
            const TheoCell = ({ side }) => {
              const opt = side === 'call' ? r.call : r.put;
              const th = theoOf(side, r.strike);
              const mid = midOf(opt);
              const diff = (th != null && mid != null) ? mid - th : null;
              const col = diff == null || diff === 0 ? undefined : diff > 0 ? THEO_RICH : THEO_CHEAP;
              return (
                <Cell side={side} align={side === 'call' ? 'right' : 'left'}>
                  {th == null ? <span style={{ opacity: 0.4 }}>—</span> : (<>
                    <span style={{ opacity: 0.85 }}>{fmtPx(th, P)}</span>
                    {diff != null && <span style={{ color: col, fontSize: 10.5, fontWeight: 700, marginLeft: 5 }}>{diff > 0 ? '+' : diff < 0 ? '−' : '±'}{fmtPx(Math.abs(diff), P)}</span>}
                  </>)}
                </Cell>
              );
            };

            return (
              <React.Fragment key={r.strike}>
                <Cell side="call">{r.call.oi.toLocaleString()}</Cell>
                <Cell side="call">{r.call.vol.toLocaleString()}</Cell>
                <Cell side="call"><span style={{ opacity: 0.85 }}>{fmtDelta(r.call.delta)}</span></Cell>
                <Cell side="call">{r.call.iv.toFixed(1)}%</Cell>
                <TheoCell side="call" />
                <BaCell side="call" />
                <div style={{
                  padding: '7px 0', borderTop: `1px solid ${border}`,
                  textAlign: 'center', fontWeight: r.atm ? 700 : 500,
                  fontSize: r.atm ? 13 : 12,
                  background: r.atm ? (dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)') : 'transparent',
                  color: r.atm ? (dark ? '#fff' : '#1c2433') : (dark ? 'rgba(255,255,255,0.85)' : '#1c2433'),
                  position: 'relative',
                }}>
                  {r.atm && <span style={{ position: 'absolute', left: 6, fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'oklch(0.66 0.16 250)', color: '#fff', fontWeight: 700 }}>價平</span>}
                  {fmtStrike(r.strike, step)}
                </div>
                <BaCell side="put" />
                <TheoCell side="put" />
                <Cell side="put" align="left">{r.put.iv.toFixed(1)}%</Cell>
                <Cell side="put" align="left"><span style={{ opacity: 0.85 }}>{fmtDelta(r.put.delta)}</span></Cell>
                <Cell side="put" align="left">{r.put.vol.toLocaleString()}</Cell>
                <Cell side="put" align="left">{r.put.oi.toLocaleString()}</Cell>
              </React.Fragment>
            );
          })}

          {/* Spot line + pill overlay. The pill floats to the LEFT edge (over the
              call OI column) and just above the line, so it never covers the
              centered strike / ATM badge. */}
          <div className="spotline" style={{ position: 'absolute', left: 0, right: 0, height: 2, background: dark ? 'rgba(95,163,212,0.55)' : 'rgba(51,113,159,0.6)', top: `calc(28px + (100% - 28px) * ${spotFrac})`, pointerEvents: 'none' }} />
          <div className="spotpill" style={{
            position: 'absolute', left: 8, transform: 'translateY(-50%)', top: `calc(28px + (100% - 28px) * ${spotFrac})`,
            background: dark ? '#10141d' : '#1c2433', border: `1px solid ${dark ? 'rgba(95,163,212,0.6)' : 'rgba(51,113,159,0.7)'}`,
            color: '#fff', fontVariantNumeric: 'tabular-nums', fontSize: 9.5, fontWeight: 700, padding: '2px 8px', borderRadius: 0,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)', pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>spot {spotTxt}</div>
        </div>
      </div>

      {/* BUY / SELL chooser popover (desktop). Click-outside overlay + Esc close. */}
      {popover && (
        <>
          <div onClick={() => setPopover(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{
            position: 'fixed',
            left: Math.min(popover.x, window.innerWidth - 184),
            top: Math.min(popover.y + 6, window.innerHeight - 96),
            zIndex: 41, width: 168, padding: 10, borderRadius: 0,
            background: 'var(--panel2)', border: '1px solid var(--border)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.45)', color: 'var(--text)',
          }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.75, marginBottom: 8, textAlign: 'center' }}>
              {fmtStrike(popover.strike, step)} <span style={{ color: popover.type === 'call' ? '#ef5350' : '#26a69a', fontWeight: 700 }}>{popover.type === 'call' ? '買權' : '賣權'}</span> @ {fmtPx(popover.opt.last, P)}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => commitLeg('long')} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 0, cursor: 'pointer', background: '#f0c068', color: '#0a0d14', fontWeight: 800, fontSize: 11, fontFamily: 'inherit' }}>買進</button>
              <button onClick={() => commitLeg('short')} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 0, cursor: 'pointer', background: '#5fa3d4', color: '#0a0d14', fontWeight: 800, fontSize: 11, fontFamily: 'inherit' }}>賣出</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

window.OptionChain = OptionChain;
window.genChain = genChain;
window.fmtPx = fmtPx;
window.fmtStrike = fmtStrike;
