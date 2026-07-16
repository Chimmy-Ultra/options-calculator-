// data-live.js — IB proxy 客戶端（plain JS，走 window.* 全域模式）。
// 對應 repo 的 server/（FastAPI + ib_async，連本機 TWS / IB Gateway）。
// 所有函式失敗一律回 null：proxy 沒開、IB 沒連線、跨網域被擋 → 前端安靜 fallback 回 mock。
// proxy 位址可用 localStorage.setItem('ibProxyBase', 'http://...') 覆蓋。
(function () {
  const DEFAULT_BASE = 'http://127.0.0.1:8720';

  function base() {
    try {
      return localStorage.getItem('ibProxyBase') || DEFAULT_BASE;
    } catch (e) {
      return DEFAULT_BASE;
    }
  }

  async function get(path, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 6000);
    try {
      const res = await fetch(base() + path, { signal: ctl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  window.LiveData = {
    // { connected, host, port, marketDataType } | null
    probe: () => get('/api/health', 2000),
    // { symbol, last, bid, ask, close, chgPct, month } | null
    quote: (pid) => get('/api/quote/' + encodeURIComponent(pid)),
    // [{ id, label, dte, type, date }] | null — id = YYYYMMDD
    expiries: (pid) => get('/api/expiries/' + encodeURIComponent(pid)),
    // { expiry, dte, underlying: { month, price }, rows: [...] } | null
    // rows 形狀跟 genChain 一致，元件可以直接吃。鏈要對 30+ 合約做行情快照，給長一點的 timeout。
    chain: (pid, expiry) => get('/api/chain/' + encodeURIComponent(pid) + '?expiry=' + encodeURIComponent(expiry), 30000),
    // { symbol, month, bar, bars: [{t,o,h,l,c,v}] } | null — 近月期貨歷史 K
    // opts: { bar: '1 day'|'1 hour'|'4 hours', duration: '1 M'|'3 M'|... }
    bars: (pid, opts) => {
      opts = opts || {};
      const q = [];
      if (opts.bar) q.push('bar=' + encodeURIComponent(opts.bar));
      if (opts.duration) q.push('duration=' + encodeURIComponent(opts.duration));
      return get('/api/bars/' + encodeURIComponent(pid) + (q.length ? '?' + q.join('&') : ''), 15000);
    },
    // { positions: [{ side, type, strike, premium(點數), qty, expiry, dte }] } | null
    // 唯讀持倉，用來把真實部位載入前端 legs。失敗一律 null（房間規則）。
    positions: (pid) => get('/api/positions/' + encodeURIComponent(pid), 8000),
  };
})();
