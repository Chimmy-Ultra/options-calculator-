// products.js — 商品註冊表（plain JS，在 Babel 腳本之前載入）。
// TXO = 台指選擇權（Black-Scholes on spot），CBOT 穀物 = 期貨選擇權（Black-76 on futures）。
// 穀物報價單位：美分/英斗（cents/bushel），一口 5,000 bu → 1¢ = US$50，跟 TXO 的 ×50 對稱。
// mockExpiries 的日期跟 TXO_EXPIRIES 一樣是寫死的 mock；live 模式會被 IB 的真實到期日覆蓋。
(function () {
  const PRODUCTS = [
    {
      id: 'txo', code: 'TXO', name: '台指選擇權',
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
      id: 'zc', code: 'ZC', name: '玉米 Corn',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 10,
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
      id: 'zs', code: 'ZS', name: '黃豆 Soybeans',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 20,
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
      id: 'zw', code: 'ZW', name: '小麥 Wheat',
      cur: 'US$', mult: 50, unitLabel: '×$50/¢ · 5,000 bu',
      strikeStep: 10,
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
  ];

  window.PRODUCTS = PRODUCTS;
  window.getProduct = function (id) {
    return PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];
  };
})();
