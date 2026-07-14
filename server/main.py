"""Options Lab IB proxy — 連本機 TWS / IB Gateway，把 CBOT 農產品期貨選擇權餵給前端。

前端（design_handoff_options_lab/data-live.js）打這裡的四個端點：
  GET /api/health            → 連線狀態
  GET /api/quote/{pid}       → 近月期貨報價（pid = zc / zs / zw）
  GET /api/expiries/{pid}    → 選擇權到期日（IB 真實資料，id = YYYYMMDD）
  GET /api/chain/{pid}       → ?expiry=YYYYMMDD 的期權鏈，rows 形狀跟前端 genChain 一致

沒訂閱 CME 即時行情時自動退到 15 分鐘延遲數據（IB_MARKET_DATA_TYPE=3）。
IB 完全沒連上時 /api/health 回 connected=false，前端就留在 mock。

啟動：uvicorn main:app --host 127.0.0.1 --port 8720
"""

import asyncio
import math
import os
import time
from datetime import date, datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ib_async import IB, Future, FuturesOption

# Standard (monthly) options trading class; weeklies not wired yet.
# tradingClass for the newer products is a best-guess for the standard monthly
# class — _sec_def() falls back to the class with the most expirations if it
# doesn't match, so a wrong guess degrades gracefully.
PRODUCTS = {
    "zc": {"symbol": "ZC", "exchange": "CBOT", "tradingClass": "OZC", "strikeStep": 10.0},
    "zs": {"symbol": "ZS", "exchange": "CBOT", "tradingClass": "OZS", "strikeStep": 20.0},
    "zw": {"symbol": "ZW", "exchange": "CBOT", "tradingClass": "OZW", "strikeStep": 10.0},
    "es": {"symbol": "ES", "exchange": "CME", "tradingClass": "ES", "strikeStep": 25.0},
    "gc": {"symbol": "GC", "exchange": "COMEX", "tradingClass": "OG", "strikeStep": 25.0},
    "cl": {"symbol": "CL", "exchange": "NYMEX", "tradingClass": "LO", "strikeStep": 1.0},
    "ng": {"symbol": "NG", "exchange": "NYMEX", "tradingClass": "ON", "strikeStep": 0.1},
}

IB_HOST = os.environ.get("IB_HOST", "127.0.0.1")
# TWS paper / TWS live / Gateway paper / Gateway live — 依序試
IB_PORTS = [int(p) for p in os.environ.get("IB_PORTS", "7497,7496,4002,4001").split(",")]
IB_CLIENT_ID = int(os.environ.get("IB_CLIENT_ID", "27"))
# 1=即時 2=frozen 3=延遲(沒訂閱自動退) 4=延遲frozen
MARKET_DATA_TYPE = int(os.environ.get("IB_MARKET_DATA_TYPE", "3"))
RISK_FREE = float(os.environ.get("RISK_FREE", "0.04"))
STRIKES_EACH_SIDE = 8      # 跟前端 mock 的 ±8 檔一致
SNAPSHOT_WAIT_S = 6.0      # 等行情快照的秒數（延遲數據要久一點）
CHAIN_CACHE_TTL_S = 30.0

app = FastAPI(title="Options Lab IB proxy")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

ib = IB()
_ib_lock = asyncio.Lock()
_port_in_use = None
_cache: dict = {}  # key -> (expires_at, value)


def _cache_get(key):
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    return None


def _cache_put(key, value, ttl):
    _cache[key] = (time.monotonic() + ttl, value)


def _f(x):
    """IB 用 NaN 表示沒資料 → 轉 None。"""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) else x


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _b76_price(right: str, f: float, k: float, sigma: float, t: float, r: float) -> float:
    """Black-76：期貨選擇權理論價（跟前端 atoms.jsx 的 model='b76' 同式）。"""
    t = max(t, 1e-6)
    sigma = max(sigma, 1e-6)
    srt = sigma * math.sqrt(t)
    df = math.exp(-r * t)
    d1 = (math.log(f / k) + sigma * sigma * t / 2.0) / srt
    d2 = d1 - srt
    if right == "C":
        return df * (f * _norm_cdf(d1) - k * _norm_cdf(d2))
    return df * (k * _norm_cdf(-d2) - f * _norm_cdf(-d1))


def _b76_delta(right: str, f: float, k: float, sigma: float, t: float, r: float) -> float:
    t = max(t, 1e-6)
    sigma = max(sigma, 1e-6)
    srt = sigma * math.sqrt(t)
    df = math.exp(-r * t)
    d1 = (math.log(f / k) + sigma * sigma * t / 2.0) / srt
    return df * _norm_cdf(d1) if right == "C" else -df * _norm_cdf(-d1)


def _implied_vol(right: str, f: float, k: float, price: float, t: float, r: float):
    """從權利金反推 IV（bisection）。無解回 None。"""
    if not price or price <= 0 or f <= 0 or k <= 0:
        return None
    lo, hi = 0.01, 3.0
    if not (_b76_price(right, f, k, lo, t, r) <= price <= _b76_price(right, f, k, hi, t, r)):
        return None
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if _b76_price(right, f, k, mid, t, r) < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


async def _ensure_connected() -> bool:
    global _port_in_use
    if ib.isConnected():
        return True
    for port in IB_PORTS:
        try:
            await ib.connectAsync(IB_HOST, port, clientId=IB_CLIENT_ID, timeout=3)
            ib.reqMarketDataType(MARKET_DATA_TYPE)
            _port_in_use = port
            return True
        except Exception:
            continue
    return False


def _product(pid: str) -> dict:
    spec = PRODUCTS.get(pid.lower())
    if not spec:
        raise HTTPException(404, f"unknown product {pid!r} (supported: {', '.join(PRODUCTS)})")
    return spec


async def _futures(spec: dict) -> list:
    """該商品所有未到期期貨，依到期日排序。回 [(yyyymmdd, Contract)]。"""
    key = ("futs", spec["symbol"])
    hit = _cache_get(key)
    if hit:
        return hit
    cds = await ib.reqContractDetailsAsync(
        Future(spec["symbol"], exchange=spec["exchange"], currency="USD")
    )
    today = date.today().strftime("%Y%m%d")
    futs = sorted(
        ((cd.contract.lastTradeDateOrContractMonth, cd.contract) for cd in cds),
        key=lambda x: x[0],
    )
    futs = [x for x in futs if x[0] >= today]
    if not futs:
        raise HTTPException(503, "no active futures contract found")
    _cache_put(key, futs, 3600)
    return futs


async def _fut_price(contract) -> float | None:
    tickers = await ib.reqTickersAsync(contract)
    if not tickers:
        return None
    t = tickers[0]
    for v in (t.last, t.close, (t.bid + t.ask) / 2 if _f(t.bid) and _f(t.ask) else None):
        v = _f(v)
        if v and v > 0:
            return v
    return None


async def _sec_def(spec: dict, fut_conid: int) -> dict:
    """expiry(YYYYMMDD) → set(strikes)，只取標準月選 trading class。"""
    key = ("secdef", spec["symbol"])
    hit = _cache_get(key)
    if hit:
        return hit
    chains = await ib.reqSecDefOptParamsAsync(spec["symbol"], spec["exchange"], "FUT", fut_conid)
    wanted = [c for c in chains if c.tradingClass == spec["tradingClass"]] or list(chains)
    by_expiry: dict = {}
    for ch in wanted:
        for exp in ch.expirations:
            by_expiry.setdefault(exp, set()).update(ch.strikes)
    if not by_expiry:
        raise HTTPException(503, "IB returned no option chain definition")
    _cache_put(key, by_expiry, 3600)
    return by_expiry


def _month_label(yyyymm: str) -> str:
    return datetime.strptime(yyyymm[:6], "%Y%m").strftime("%b").upper()


@app.get("/api/health")
async def health():
    async with _ib_lock:
        ok = await _ensure_connected()
    return {
        "connected": ok,
        "host": IB_HOST,
        "port": _port_in_use,
        "marketDataType": MARKET_DATA_TYPE,
        "serverTime": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/api/quote/{pid}")
async def quote(pid: str):
    spec = _product(pid)
    async with _ib_lock:
        if not await _ensure_connected():
            raise HTTPException(503, "IB not connected")
        futs = await _futures(spec)
        exp, front = futs[0]
        tickers = await ib.reqTickersAsync(front)
    t = tickers[0] if tickers else None
    last = _f(t.last) if t else None
    close = _f(t.close) if t else None
    px = last or close
    return {
        "symbol": spec["symbol"],
        "month": exp[:6],
        "localSymbol": front.localSymbol,
        "last": px,
        "bid": _f(t.bid) if t else None,
        "ask": _f(t.ask) if t else None,
        "close": close,
        "chgPct": round((last - close) / close * 100, 2) if last and close else None,
    }


@app.get("/api/expiries/{pid}")
async def expiries(pid: str):
    spec = _product(pid)
    async with _ib_lock:
        if not await _ensure_connected():
            raise HTTPException(503, "IB not connected")
        futs = await _futures(spec)
        by_expiry = await _sec_def(spec, futs[0][1].conId)
    today = date.today()
    out = []
    for exp in sorted(by_expiry):
        d = datetime.strptime(exp, "%Y%m%d").date()
        dte = (d - today).days
        if dte < 1:
            continue
        # 該到期日行使成哪個月份的期貨：最近一個到期日 >= 選擇權到期日的期貨
        und = next((f for f in futs if f[0] >= exp), futs[-1])
        out.append({
            "id": exp,
            "label": _month_label(und[0]),
            "dte": dte,
            "type": "std",
            "date": f"{d.month}/{d.day:02d}",
        })
        if len(out) >= 8:
            break
    return out


@app.get("/api/bars/{pid}")
async def bars(pid: str, duration: str = "3 M", bar: str = "1 day"):
    """近月期貨的歷史 K 棒（給前端 K 線圖）。"""
    if duration not in {"1 M", "3 M", "6 M", "1 Y"} or bar not in {"1 day", "1 hour", "4 hours"}:
        raise HTTPException(400, "duration ∈ {1 M,3 M,6 M,1 Y}, bar ∈ {1 day,1 hour,4 hours}")
    spec = _product(pid)
    cache_key = ("bars", spec["symbol"], duration, bar)
    hit = _cache_get(cache_key)
    if hit:
        return hit
    async with _ib_lock:
        if not await _ensure_connected():
            raise HTTPException(503, "IB not connected")
        futs = await _futures(spec)
        exp, front = futs[0]
        try:
            raw = await ib.reqHistoricalDataAsync(
                front, endDateTime="", durationStr=duration,
                barSizeSetting=bar, whatToShow="TRADES", useRTH=True,
            )
        except Exception as e:
            raise HTTPException(503, f"historical data unavailable: {e}")
    if not raw:
        raise HTTPException(503, "IB returned no historical bars")
    out = {
        "symbol": spec["symbol"],
        "month": exp[:6],
        "bar": bar,
        "bars": [
            {
                "t": b.date.strftime("%Y%m%d") if hasattr(b.date, "strftime") else str(b.date),
                "o": _f(b.open), "h": _f(b.high), "l": _f(b.low), "c": _f(b.close),
                "v": int(_f(b.volume) or 0),
            }
            for b in raw
        ],
    }
    _cache_put(cache_key, out, 300)
    return out


@app.get("/api/chain/{pid}")
async def chain(pid: str, expiry: str):
    spec = _product(pid)
    cache_key = ("chain", spec["symbol"], expiry)
    hit = _cache_get(cache_key)
    if hit:
        return hit

    async with _ib_lock:
        if not await _ensure_connected():
            raise HTTPException(503, "IB not connected")
        futs = await _futures(spec)
        by_expiry = await _sec_def(spec, futs[0][1].conId)
        if expiry not in by_expiry:
            raise HTTPException(404, f"expiry {expiry} not listed (have {sorted(by_expiry)[:8]}...)")

        und_exp, und_fut = next((f for f in futs if f[0] >= expiry), futs[-1])
        und_px = await _fut_price(und_fut)
        if not und_px:
            raise HTTPException(503, "no underlying futures price (market data unavailable)")

        step = spec["strikeStep"]
        near = sorted(
            (k for k in by_expiry[expiry] if abs(k - und_px) <= STRIKES_EACH_SIDE * step),
            key=lambda k: abs(k - und_px),
        )
        strikes = sorted(near[: STRIKES_EACH_SIDE * 2 + 1])
        if not strikes:
            raise HTTPException(503, "no strikes near the underlying price")

        contracts = [
            FuturesOption(
                symbol=spec["symbol"], lastTradeDateOrContractMonth=expiry,
                strike=k, right=right, exchange=spec["exchange"],
                currency="USD", tradingClass=spec["tradingClass"],
            )
            for k in strikes for right in ("C", "P")
        ]
        qualified = [c for c in await ib.qualifyContractsAsync(*contracts) if c and c.conId]

        # streaming 訂閱 + generic tick 101（OI），等一輪快照再收
        tickers = {c.conId: ib.reqMktData(c, genericTickList="101", snapshot=False) for c in qualified}
        await asyncio.sleep(SNAPSHOT_WAIT_S)
        for c in qualified:
            ib.cancelMktData(c)

    dte = (datetime.strptime(expiry, "%Y%m%d").date() - date.today()).days
    t_years = max(dte, 0.5) / 365.0
    atm_strike = min(strikes, key=lambda k: abs(k - und_px))

    def side(c) -> dict:
        tk = tickers.get(c.conId)
        bid, ask = (_f(tk.bid), _f(tk.ask)) if tk else (None, None)
        mid = (bid + ask) / 2 if bid and ask else None
        last = (_f(tk.last) if tk else None) or mid or (_f(tk.close) if tk else None) or 0.0
        mg = tk.modelGreeks if tk else None
        iv = _f(mg.impliedVol) if mg else None
        if not iv:
            iv = _implied_vol(c.right, und_px, c.strike, mid or last, t_years, RISK_FREE)
        iv = iv or 0.0
        delta = _f(mg.delta) if mg else None
        if delta is None:
            delta = _b76_delta(c.right, und_px, c.strike, max(iv, 1e-4), t_years, RISK_FREE)
        oi = _f(tk.callOpenInterest if c.right == "C" else tk.putOpenInterest) if tk else None
        vol = _f(tk.volume) if tk else None
        return {
            "bid": bid or 0.0, "ask": ask or 0.0, "last": last,
            "iv": round(iv * 100, 2), "oi": int(oi or 0), "vol": int(vol or 0),
            "delta": round(delta, 4),
        }

    by_strike: dict = {}
    for c in qualified:
        row = by_strike.setdefault(c.strike, {})
        row["call" if c.right == "C" else "put"] = side(c)

    empty = {"bid": 0.0, "ask": 0.0, "last": 0.0, "iv": 0.0, "oi": 0, "vol": 0, "delta": 0.0}
    rows = [
        {
            "strike": k,
            "atm": k == atm_strike,
            "itmCall": k < und_px,
            "itmPut": k > und_px,
            "call": by_strike[k].get("call", empty),
            "put": by_strike[k].get("put", empty),
        }
        for k in sorted(by_strike)
    ]
    result = {
        "expiry": expiry,
        "dte": dte,
        "underlying": {"month": und_exp[:6], "price": und_px},
        "rows": rows,
    }
    _cache_put(cache_key, result, CHAIN_CACHE_TTL_S)
    return result
