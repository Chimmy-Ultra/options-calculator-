// products.js — 商品註冊表（plain JS，在 Babel 腳本之前載入）。
// TXO = 台指選擇權（Black-Scholes on spot），CBOT 穀物 = 期貨選擇權（Black-76 on futures）。
// 穀物報價單位：美分/英斗（cents/bushel），一口 5,000 bu → 1¢ = US$50，跟 TXO 的 ×50 對稱。
// mockExpiries 的日期跟 TXO_EXPIRIES 一樣是寫死的 mock；live 模式會被 IB 的真實到期日覆蓋。
(function () {
  const PRODUCTS = [
    {
      id: 'txo', code: 'TXO', name: 'TAIEX Options',
      cur: 'NT$', mult: 50, unitLabel: '×50 NTD/pt',
      strikeStep: 50,
      model: 'bs', r: 1.5, skew: 'put',
      defaultSpot: 21850, defaultIv: 24,
      spotMin: 20000, spotMax: 23500, spotStep: 10,
      ivMin: 10, ivMax: 50,
      settleNote: '13:30',
      ivBase: { weekly: 22, monthly: 24 },
      ib: null,           // TXO 不走 IB
      mockExpiries: null, // null → 用 obsidian3.jsx 的 TXO_EXPIRIES
    },
    {
      id: 'zc', code: 'ZC', name: 'Corn',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 10, eighth: true,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 450, defaultIv: 26,
      spotMin: 350, spotMax: 560, spotStep: 0.25,
      ivMin: 10, ivMax: 60,
      settleNote: '13:20 CT',
      ivBase: { std: 26 },
      ib: { symbol: 'ZC', exchange: 'CBOT' },
      mockExpiries: [
        { id: 'sep', label: 'SEP', dte: 43,  type: 'std', date: '8/21'  },
        { id: 'dec', label: 'DEC', dte: 134, type: 'std', date: '11/20' },
        { id: 'mar', label: 'MAR', dte: 225, type: 'std', date: '2/19'  },
      ],
    },
    {
      id: 'zs', code: 'ZS', name: 'Soybeans',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 20, eighth: true,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 1050, defaultIv: 20,
      spotMin: 850, spotMax: 1250, spotStep: 0.25,
      ivMin: 8, ivMax: 50,
      settleNote: '13:20 CT',
      ivBase: { std: 20 },
      ib: { symbol: 'ZS', exchange: 'CBOT' },
      mockExpiries: [
        { id: 'aug', label: 'AUG', dte: 15,  type: 'std', date: '7/24'  },
        { id: 'sep', label: 'SEP', dte: 43,  type: 'std', date: '8/21'  },
        { id: 'nov', label: 'NOV', dte: 106, type: 'std', date: '10/23' },
        { id: 'jan', label: 'JAN', dte: 168, type: 'std', date: '12/24' },
      ],
    },
    {
      id: 'zw', code: 'ZW', name: 'Wheat',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 10, eighth: true,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 550, defaultIv: 30,
      spotMin: 420, spotMax: 680, spotStep: 0.25,
      ivMin: 12, ivMax: 70,
      settleNote: '13:20 CT',
      ivBase: { std: 30 },
      ib: { symbol: 'ZW', exchange: 'CBOT' },
      mockExpiries: [
        { id: 'sep', label: 'SEP', dte: 43,  type: 'std', date: '8/21'  },
        { id: 'dec', label: 'DEC', dte: 134, type: 'std', date: '11/20' },
        { id: 'mar', label: 'MAR', dte: 225, type: 'std', date: '2/19'  },
      ],
    },
    // ── Financial / metal / energy futures options (specs from the design mockup).
    // Same Black-76 + FOP path as grains; just registry entries.
    {
      id: 'es', code: 'ES', name: 'S&P 500 E-mini',
      cur: 'US$', mult: 50, unitLabel: '×US$50 / pt',
      strikeStep: 25,
      model: 'b76', r: 4.0, skew: 'put',
      defaultSpot: 6120, defaultIv: 15,
      spotMin: 5400, spotMax: 6850, spotStep: 0.25,
      ivMin: 8, ivMax: 60,
      settleNote: '15:00 CT',
      ivBase: { std: 15 },
      // Standard end-of-month options trading class is 'ES' on CME.
      ib: { symbol: 'ES', exchange: 'CME', tradingClass: 'ES' },
      mockExpiries: [
        { id: 'm1', label: 'JUL', dte: 35,  type: 'std', date: '7/18' },
        { id: 'm2', label: 'AUG', dte: 65,  type: 'std', date: '8/15' },
        { id: 'm3', label: 'SEP', dte: 95,  type: 'std', date: '9/19' },
      ],
    },
    {
      id: 'gc', code: 'GC', name: 'Gold',
      cur: 'US$', mult: 100, unitLabel: '×US$100 / oz',
      strikeStep: 25,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 3352, defaultIv: 18,
      spotMin: 2950, spotMax: 3760, spotStep: 0.5,
      ivMin: 8, ivMax: 60,
      settleNote: '12:30 CT',
      ivBase: { std: 18 },
      ib: { symbol: 'GC', exchange: 'COMEX', tradingClass: 'OG' },
      mockExpiries: [
        { id: 'm1', label: 'AUG', dte: 28,  type: 'std', date: '7/25' },
        { id: 'm2', label: 'OCT', dte: 63,  type: 'std', date: '8/26' },
        { id: 'm3', label: 'DEC', dte: 95,  type: 'std', date: '9/25' },
      ],
    },
    {
      id: 'cl', code: 'CL', name: 'WTI Crude',
      cur: 'US$', mult: 1000, unitLabel: '×US$1,000 / bbl',
      strikeStep: 1,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 72.30, defaultIv: 33,
      spotMin: 55, spotMax: 92, spotStep: 0.05,
      ivMin: 15, ivMax: 80,
      settleNote: '14:30 CT',
      ivBase: { std: 33 },
      ib: { symbol: 'CL', exchange: 'NYMEX', tradingClass: 'LO' },
      mockExpiries: [
        { id: 'm1', label: 'AUG', dte: 21,  type: 'std', date: '7/17' },
        { id: 'm2', label: 'SEP', dte: 51,  type: 'std', date: '8/16' },
        { id: 'm3', label: 'OCT', dte: 82,  type: 'std', date: '9/16' },
      ],
    },
    {
      id: 'ng', code: 'NG', name: 'Natural Gas',
      cur: 'US$', mult: 10000, unitLabel: '×US$10,000 / pt',
      strikeStep: 0.1,
      model: 'b76', r: 4.0, skew: 'call',
      defaultSpot: 3.42, defaultIv: 45,
      spotMin: 2.0, spotMax: 5.0, spotStep: 0.005,
      ivMin: 20, ivMax: 100,
      settleNote: '14:30 CT',
      ivBase: { std: 45 },
      ib: { symbol: 'NG', exchange: 'NYMEX', tradingClass: 'ON' },
      mockExpiries: [
        { id: 'm1', label: 'AUG', dte: 26,  type: 'std', date: '7/28' },
        { id: 'm2', label: 'SEP', dte: 57,  type: 'std', date: '8/27' },
        { id: 'm3', label: 'OCT', dte: 88,  type: 'std', date: '9/26' },
      ],
    },
  ];

  window.PRODUCTS = PRODUCTS;
  window.getProduct = function (id) {
    return PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
  };
})();
