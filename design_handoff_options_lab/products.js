// products.js — 商品註冊表（plain JS，在 Babel 腳本之前載入）。
// TXO = 台指選擇權（Black-Scholes on spot），CBOT 穀物 = 期貨選擇權（Black-76 on futures）。
// 穀物報價單位：美分/英斗（cents/bushel），一口 5,000 bu → 1¢ = US$50，跟 TXO 的 ×50 對稱。
// mockExpiries 的日期跟 TXO_EXPIRIES 一樣是寫死的 mock；live 模式會被 IB 的真實到期日覆蓋。
(function () {
  const PRODUCTS = [
    {
      id: 'txo', code: 'TXO', nameZh: '台指選', name: 'TAIEX Options',
      cur: 'NT$', mult: 50, unitLabel: '×50 NTD/pt',
      strikeStep: 50,
      model: 'bs', r: 1.5, skew: 'put',
      defaultSpot: 21850, defaultIv: 24,
      spotMin: 20000, spotMax: 23500, spotStep: 10,
      ivMin: 10, ivMax: 50,
      // Transaction cost per contract per side: NT$20 brokerage + 0.1% futures
      // transaction tax on the premium notional (premium × mult). Broker-dependent
      // — tune to your own account.
      fees: { perSide: 20, taxRate: 0.001 },
      settleNote: '13:30',
      ivBase: { weekly: 22, monthly: 24 },
      // 即時資料源：'sinopac' = 永豐金 Shioaji（見 server/sinopac.py）。
      // null = 只有 mock。ib 欄位僅 IB 商品使用。
      live: 'sinopac',
      // Open interest comes from TAIFEX's daily report via the proxy (server/taifex.py):
      // the Levels tab's 壓力 / 支撐 walls and the chain's OI column while connected.
      oiSource: 'taifex',
      // 永豐的帳務/部位需要電子憑證，唯讀研究設定刻意不裝 → 不提供部位匯入。
      livePositions: false,
      ib: null,           // TXO 不走 IB
      mockExpiries: null, // null → 用 obsidian3.jsx 的 TXO_EXPIRIES
    },
    {
      id: 'zc', code: 'ZC', nameZh: '玉米', name: 'Corn',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 10, eighth: true,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 450, defaultIv: 26,
      spotMin: 350, spotMax: 560, spotStep: 0.25,
      ivMin: 10, ivMax: 60,
      settleNote: '13:20 CT',
      ivBase: { std: 26 },
      // ~US$2.5 per contract per side (IB commission + exchange fees, rough
      // all-in); no separate premium tax. Broker-dependent — tune per account.
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'ZC', exchange: 'CBOT' },
      mockExpiries: [
        { id: 'sep', label: 'SEP', dte: 43,  type: 'std', date: '8/21'  },
        { id: 'dec', label: 'DEC', dte: 134, type: 'std', date: '11/20' },
        { id: 'mar', label: 'MAR', dte: 225, type: 'std', date: '2/19'  },
      ],
    },
    {
      id: 'zs', code: 'ZS', nameZh: '黃豆', name: 'Soybeans',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 20, eighth: true,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 1050, defaultIv: 20,
      spotMin: 850, spotMax: 1250, spotStep: 0.25,
      ivMin: 8, ivMax: 50,
      settleNote: '13:20 CT',
      ivBase: { std: 20 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'ZS', exchange: 'CBOT' },
      mockExpiries: [
        { id: 'aug', label: 'AUG', dte: 15,  type: 'std', date: '7/24'  },
        { id: 'sep', label: 'SEP', dte: 43,  type: 'std', date: '8/21'  },
        { id: 'nov', label: 'NOV', dte: 106, type: 'std', date: '10/23' },
        { id: 'jan', label: 'JAN', dte: 168, type: 'std', date: '12/24' },
      ],
    },
    {
      id: 'zw', code: 'ZW', nameZh: '小麥', name: 'Wheat',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 10, eighth: true,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 550, defaultIv: 30,
      spotMin: 420, spotMax: 680, spotStep: 0.25,
      ivMin: 12, ivMax: 70,
      settleNote: '13:20 CT',
      ivBase: { std: 30 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'ZW', exchange: 'CBOT' },
      mockExpiries: [
        { id: 'sep', label: 'SEP', dte: 43,  type: 'std', date: '8/21'  },
        { id: 'dec', label: 'DEC', dte: 134, type: 'std', date: '11/20' },
        { id: 'mar', label: 'MAR', dte: 225, type: 'std', date: '2/19'  },
      ],
    },
    {
      // CME spec: 100 short tons, quoted US$/ton → US$100 per $1 (IB's option
      // descriptions carry no multiplier for ZM, so this is the exchange's number).
      id: 'zm', code: 'ZM', nameZh: '黃豆粉', name: 'Soybean Meal',
      cur: 'US$', mult: 100, unitLabel: '×US$100 / $·ton',
      strikeStep: 5, pxDecimals: 2,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 347, defaultIv: 22,
      spotMin: 250, spotMax: 450, spotStep: 0.1,
      ivMin: 10, ivMax: 60,
      settleNote: '13:20 CT',
      ivBase: { std: 22 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'ZM', exchange: 'CBOT', tradingClass: 'OZM' },
      mockExpiries: [
        { id: 'm1', label: 'OCT', dte: 11, type: 'std', date: '9/25'  },
        { id: 'm2', label: 'NOV', dte: 39, type: 'std', date: '10/23' },
        { id: 'm3', label: 'DEC', dte: 67, type: 'std', date: '11/20' },
      ],
    },
    {
      id: 'le', code: 'LE', nameZh: '活牛', name: 'Live Cattle',
      cur: 'US$', mult: 400, unitLabel: '×US$400/¢ · 40,000 lb',
      strikeStep: 2, pxDecimals: 3,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 219.7, defaultIv: 17,
      spotMin: 180, spotMax: 260, spotStep: 0.025,
      ivMin: 8, ivMax: 60,
      settleNote: '13:05 CT',
      ivBase: { std: 17 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'LE', exchange: 'CME', tradingClass: 'LE' },
      mockExpiries: [
        { id: 'm1', label: 'OCT', dte: 18, type: 'std', date: '10/02' },
        { id: 'm2', label: 'NOV', dte: 53, type: 'std', date: '11/06' },
        { id: 'm3', label: 'DEC', dte: 81, type: 'std', date: '12/04' },
      ],
    },
    // ── Financial / metal / energy futures options (specs from the design mockup).
    // Same Black-76 + FOP path as grains; just registry entries.
    {
      id: 'es', code: 'ES', nameZh: '小S&P', name: 'S&P 500 E-mini',
      cur: 'US$', mult: 50, unitLabel: '×US$50 / pt',
      strikeStep: 25,
      model: 'b76', r: 4.0, skew: 'put',
      defaultSpot: 6120, defaultIv: 15,
      spotMin: 5400, spotMax: 6850, spotStep: 0.25,
      ivMin: 8, ivMax: 60,
      settleNote: '15:00 CT',
      ivBase: { std: 15 },
      fees: { perSide: 2.5, taxRate: 0 },
      // Standard end-of-month options trading class is 'ES' on CME.
      live: 'ib', livePositions: true,
      ib: { symbol: 'ES', exchange: 'CME', tradingClass: 'ES' },
      mockExpiries: [
        { id: 'm1', label: 'JUL', dte: 35,  type: 'std', date: '7/18' },
        { id: 'm2', label: 'AUG', dte: 65,  type: 'std', date: '8/15' },
        { id: 'm3', label: 'SEP', dte: 95,  type: 'std', date: '9/19' },
      ],
    },
    {
      id: 'nq', code: 'NQ', nameZh: '小那斯達克', name: 'Nasdaq-100 E-mini',
      cur: 'US$', mult: 20, unitLabel: '×US$20 / pt',
      strikeStep: 100, pxDecimals: 2,
      model: 'b76', r: 4.0, skew: 'put',
      defaultSpot: 29060, defaultIv: 20,
      spotMin: 25000, spotMax: 33000, spotStep: 0.25,
      ivMin: 8, ivMax: 80,
      settleNote: '15:00 CT',
      ivBase: { std: 20 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'NQ', exchange: 'CME', tradingClass: 'NQ' },
      mockExpiries: [
        { id: 'm1', label: 'SEP', dte: 5,  type: 'std', date: '9/18'  },
        { id: 'm2', label: 'OCT', dte: 47, type: 'std', date: '10/30' },
        { id: 'm3', label: 'DEC', dte: 96, type: 'std', date: '12/18' },
      ],
    },
    {
      // VIX options are CBOE index options (OPT), not futures options: the
      // proxy has no path for them, so real data is the IB snapshot only.
      // Each expiry prices off the VX future that settles with it — Black-76
      // on that future, never on the spot index.
      id: 'vix', code: 'VIX', nameZh: 'VIX', name: 'CBOE Volatility Index',
      cur: 'US$', mult: 100, unitLabel: '×US$100 / pt',
      strikeStep: 1, pxDecimals: 2,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 15.84, defaultIv: 90,
      spotMin: 10, spotMax: 40, spotStep: 0.05,
      ivMin: 40, ivMax: 200,
      settleNote: '週三 SOQ',
      ivBase: { std: 90 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: false,
      ib: null,
      mockExpiries: [
        { id: 'm1', label: 'SEP', dte: 2,  type: 'std', date: '9/15'  },
        { id: 'm2', label: 'OCT', dte: 37, type: 'std', date: '10/20' },
        { id: 'm3', label: 'NOV', dte: 65, type: 'std', date: '11/17' },
      ],
    },
    {
      id: 'gc', code: 'GC', nameZh: '黃金', name: 'Gold',
      cur: 'US$', mult: 100, unitLabel: '×US$100 / oz',
      strikeStep: 25,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 3352, defaultIv: 18,
      spotMin: 2950, spotMax: 3760, spotStep: 0.5,
      ivMin: 8, ivMax: 60,
      settleNote: '12:30 CT',
      ivBase: { std: 18 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'GC', exchange: 'COMEX', tradingClass: 'OG' },
      mockExpiries: [
        { id: 'm1', label: 'AUG', dte: 28,  type: 'std', date: '7/25' },
        { id: 'm2', label: 'OCT', dte: 63,  type: 'std', date: '8/26' },
        { id: 'm3', label: 'DEC', dte: 95,  type: 'std', date: '9/25' },
      ],
    },
    {
      id: 'cl', code: 'CL', nameZh: '原油', name: 'WTI Crude',
      cur: 'US$', mult: 1000, unitLabel: '×US$1,000 / bbl',
      strikeStep: 1,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 72.30, defaultIv: 33,
      spotMin: 55, spotMax: 92, spotStep: 0.05,
      ivMin: 15, ivMax: 80,
      settleNote: '14:30 CT',
      ivBase: { std: 33 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'CL', exchange: 'NYMEX', tradingClass: 'LO' },
      mockExpiries: [
        { id: 'm1', label: 'AUG', dte: 21,  type: 'std', date: '7/17' },
        { id: 'm2', label: 'SEP', dte: 51,  type: 'std', date: '8/16' },
        { id: 'm3', label: 'OCT', dte: 82,  type: 'std', date: '9/16' },
      ],
    },
    {
      id: 'ng', code: 'NG', nameZh: '天然氣', name: 'Natural Gas',
      cur: 'US$', mult: 10000, unitLabel: '×US$10,000 / pt',
      strikeStep: 0.1,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 3.42, defaultIv: 45,
      spotMin: 2.0, spotMax: 5.0, spotStep: 0.005,
      ivMin: 20, ivMax: 100,
      settleNote: '14:30 CT',
      ivBase: { std: 45 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      ib: { symbol: 'NG', exchange: 'NYMEX', tradingClass: 'ON' },
      mockExpiries: [
        { id: 'm1', label: 'AUG', dte: 26,  type: 'std', date: '7/28' },
        { id: 'm2', label: 'SEP', dte: 57,  type: 'std', date: '8/27' },
        { id: 'm3', label: 'OCT', dte: 88,  type: 'std', date: '9/26' },
      ],
    },
    {
      id: 'bz', code: 'BZ', nameZh: '布蘭特原油', name: 'Brent Crude (last day)',
      cur: 'US$', mult: 1000, unitLabel: '×US$1,000 / bbl',
      strikeStep: 1, pxDecimals: 2,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 107.3, defaultIv: 35,
      spotMin: 80, spotMax: 140, spotStep: 0.01,
      ivMin: 15, ivMax: 100,
      settleNote: '13:30 CT',
      ivBase: { std: 35 },
      fees: { perSide: 2.5, taxRate: 0 },
      live: 'ib', livePositions: true,
      // IB lists the standard monthly class as BE (seen in the option descriptions).
      ib: { symbol: 'BZ', exchange: 'NYMEX', tradingClass: 'BE' },
      mockExpiries: [
        { id: 'm1', label: 'NOV', dte: 11, type: 'std', date: '9/25'  },
        { id: 'm2', label: 'DEC', dte: 43, type: 'std', date: '10/27' },
        { id: 'm3', label: 'JAN', dte: 74, type: 'std', date: '11/25' },
      ],
    },
  ];

  window.PRODUCTS = PRODUCTS;
  window.getProduct = function (id) {
    return PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
  };
})();
