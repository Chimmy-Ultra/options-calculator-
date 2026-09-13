"""Options Lab 行情代理 — 唯讀，把兩個券商的期權行情餵給前端。

資料源（每個商品在 PRODUCTS 裡用 "source" 指定）：
  ib      → 本機 TWS / IB Gateway，期貨選擇權（ZC/ZS/ZW/ES/GC/CL/NG）
  sinopac → 永豐金 Shioaji，TXO 台指選擇權（見 sinopac.py）

前端（design_handoff_options_lab/data-live.js）打這裡的端點：
  GET /api/health            → 連線狀態
  GET /api/quote/{pid}       → 近月期貨報價（pid = zc / zs / zw）
  GET /api/expiries/{pid}    → 選擇權到期日（IB 真實資料，id = YYYYMMDD）
  GET /api/chain/{pid}       → ?expiry=YYYYMMDD 的期權鏈，rows 形狀跟前端 genChain 一致
  GET /api/bars/{pid}        → 近月期貨歷史 K 棒
  GET /api/positions/{pid}   → 目前帳戶的選擇權部位（唯讀，載入前端 legs 用）
  GET /api/oi/{pid}          → ?expiry=YYYYMMDD 的每檔未平倉（TAIFEX 每日行情，見 taifex.py）
  GET /api/market/{pid}      → 籌碼：P/C 比、外資淨未平倉、十大交易人（TAIFEX 每日，見 taifex.py）

唯讀行情 + 部位代理：只讀行情與持倉，不下單、不改單（沒有任何下單端點）。
沒訂閱 CME 即時行情時自動退到 15 分鐘延遲數據（IB_MARKET_DATA_TYPE=3）。
資料源沒連上時 /api/health 回 connected=false，前端就留在 mock。

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

import pricing
import sinopac
import taifex

# Standard (monthly) options trading class; weeklies not wired yet.
# tradingClass for the newer products is a best-guess for the standard monthly
# class — _sec_def() falls back to the class with the most expirations if it
# doesn't match, so a wrong guess degrades gracefully.
# "source" selects the data backend: "ib" = Interactive Brokers (futures
# options), "sinopac" = 永豐金 Shioaji (TXO 台指選擇權). Both are read-only.
# "oi" names a separate open-interest source for products whose quote feed has
# none: "taifex" = the exchange's daily report (taifex.py), merged into the
# chain rows and served whole by /api/oi.
PRODUCTS = {
    "txo": {"source": "sinopac", "symbol": "TXO", "exchange": "TAIFEX", "strikeStep": 50.0,
            "index": ("TSE", "001"), "underlyingFuture": "TXF", "monthlyCategory": "TXO",
            "oi": "taifex"},
    "zc": {"source": "ib", "symbol": "ZC", "exchange": "CBOT", "tradingClass": "OZC", "strikeStep": 10.0},
    "zs": {"source": "ib", "symbol": "ZS", "exchange": "CBOT", "tradingClass": "OZS", "strikeStep": 20.0},
    "zw": {"source": "ib", "symbol": "ZW", "exchange": "CBOT", "tradingClass": "OZW", "strikeStep": 10.0},
    "es": {"source": "ib", "symbol": "ES", "exchange": "CME", "tradingClass": "ES", "strikeStep": 25.0},
    "gc": {"source": "ib", "symbol": "GC", "exchange": "COMEX", "tradingClass": "OG", "strikeStep": 25.0},
    "cl": {"source": "ib", "symbol": "CL", "exchange": "NYMEX", "tradingClass": "LO", "strikeStep": 1.0},
    "ng": {"source": "ib", "symbol": "NG", "exchange": "NYMEX", "tradingClass": "ON", "strikeStep": 0.1},
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
POSITIONS_CACHE_TTL_S = 10.0

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


async def _from_sinopac(coro, what: str):
    """Await a SinoPac call and turn a null result into the same 503 the IB path
    raises, so the frontend's null-on-failure → mock fallback is unchanged."""
    data = await coro
    if data is None:
        raise HTTPException(503, f"SinoPac (Shioaji) {what} unavailable — check SINOPAC_API_KEY / SINOPAC_SECRET_KEY")
    return data


@app.get("/api/health")
async def health(pid: str | None = None):
    """Connection status. With ?pid= the answer is for that product's own data
    source, so the frontend only shows a live badge when the backend that
    actually serves that product is up; without it, connected means "any source"."""
    src = PRODUCTS.get((pid or "").lower(), {}).get("source") if pid else None

    sino_ok = await sinopac.ensure_connected() if (src in (None, "sinopac")) else False
    ib_ok = False
    if src in (None, "ib"):
        async with _ib_lock:
            ib_ok = await _ensure_connected()

    connected = sino_ok if src == "sinopac" else ib_ok if src == "ib" else (ib_ok or sino_ok)
    return {
        "connected": connected,
        "source": src,
        "ib": {"connected": ib_ok, "host": IB_HOST, "port": _port_in_use, "marketDataType": MARKET_DATA_TYPE},
        "sinopac": {"connected": sino_ok, "configured": sinopac.configured(),
                    "installed": sinopac.installed(), "simulation": sinopac.SIMULATION},
        "serverTime": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/api/quote/{pid}")
async def quote(pid: str):
    spec = _product(pid)
    if spec.get("source") == "sinopac":
        return await _from_sinopac(sinopac.quote(spec), "quote")
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
        # Today's running session range (the 關卡價 base).
        "open": _f(t.open) if t else None,
        "high": _f(t.high) if t else None,
        "low": _f(t.low) if t else None,
    }


@app.get("/api/expiries/{pid}")
async def expiries(pid: str):
    spec = _product(pid)
    if spec.get("source") == "sinopac":
        return await _from_sinopac(sinopac.expiries(spec), "expiries")
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
    if spec.get("source") == "sinopac":
        return await _from_sinopac(sinopac.bars(spec, duration, bar), "history")
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
    if spec.get("source") == "sinopac":
        data = await _from_sinopac(sinopac.chain(spec, expiry), "option chain")
        if spec.get("oi") == "taifex":
            # Shioaji snapshots have no OI; fill it from TAIFEX's daily report
            # (previous session's numbers). Unreachable → rows keep oi: 0.
            data = taifex.merge_into_chain(data, await taifex.open_interest(expiry))
        return data
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
            iv = pricing.implied_vol(c.right, und_px, c.strike, mid or last, t_years, RISK_FREE, "b76")
        iv = iv or 0.0
        delta = _f(mg.delta) if mg else None
        if delta is None:
            delta = pricing.delta(c.right, und_px, c.strike, max(iv, 1e-4), t_years, RISK_FREE, "b76")
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


@app.get("/api/oi/{pid}")
async def open_interest(pid: str, expiry: str | None = None):
    """Per-strike open interest for one expiry from TAIFEX's daily report — the
    whole strike range, not just the chain's ±8 — with the change vs the
    previous session and the max-OI strikes (壓力 / 支撐). Public data, no
    broker login needed. `expiry` = YYYYMMDD; omitted → the nearest unexpired.
    """
    spec = _product(pid)
    if spec.get("oi") != "taifex":
        raise HTTPException(404, f"no open-interest source for {pid!r}")
    data = await taifex.open_interest(expiry)
    if data is None:
        raise HTTPException(503, "TAIFEX daily report unavailable")
    if not data:
        tbl = await taifex.table()
        raise HTTPException(404, f"expiry {expiry} not in TAIFEX report (have {[e['id'] for e in taifex.expiries(tbl or {})]})")
    return data


@app.get("/api/market/{pid}")
async def market(pid: str):
    """Daily positioning from TAIFEX: market-wide put/call ratio (with ~23
    sessions of history), 外資 net futures position in TX-equivalent contracts
    (TX + MTX/4 + TMF/20, the exchange's own conversion) and the top-10 large
    traders' net position in the front month. Previous session's numbers."""
    spec = _product(pid)
    if spec.get("oi") != "taifex":
        raise HTTPException(404, f"no positioning source for {pid!r}")
    data = await taifex.market()
    if data is None:
        raise HTTPException(503, "TAIFEX daily reports unavailable")
    return data


@app.get("/api/positions/{pid}")
async def positions(pid: str):
    """該商品目前在 IB 帳戶的選擇權（FOP）部位 — 唯讀，給前端一鍵載入 legs。
    只回 secType == FOP 且 symbol / tradingClass 對得上該商品的部位；空陣列也是合法回傳。
    premium 換算成「點數」(averageCost / multiplier)，跟前端 legs 的 premium 慣例一致。
    """
    spec = _product(pid)
    if spec.get("source") == "sinopac":
        # Account data needs the electronic certificate, which research-only
        # setup deliberately skips — an empty list, not an error.
        return await sinopac.positions(spec)
    cache_key = ("positions", spec["symbol"])
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit
    async with _ib_lock:
        if not await _ensure_connected():
            raise HTTPException(503, "IB not connected")
        items = ib.portfolio()
    today = date.today()
    out = []
    for it in items:
        c = it.contract
        if getattr(c, "secType", None) != "FOP":
            continue
        # tradingClass 對得上（新商品）或 underlying symbol 對得上（fallback）
        tc = getattr(c, "tradingClass", None)
        if c.symbol != spec["symbol"] and tc != spec.get("tradingClass"):
            continue
        pos = _f(it.position) or 0.0
        if pos == 0:
            continue
        mult = float(c.multiplier) if getattr(c, "multiplier", None) else 1.0
        avg = _f(it.averageCost) or 0.0
        exp = c.lastTradeDateOrContractMonth or ""
        try:
            dte = (datetime.strptime(exp[:8], "%Y%m%d").date() - today).days
        except (ValueError, TypeError):
            dte = None
        right = (c.right or "").upper()
        out.append({
            "type": "call" if right.startswith("C") else "put",
            "side": "long" if pos > 0 else "short",
            "qty": int(abs(pos)),
            "strike": _f(c.strike) or 0.0,
            "premium": round(avg / mult, 4) if mult else round(avg, 4),
            "expiry": exp,
            "dte": dte,
        })
    result = {"positions": out}
    _cache_put(cache_key, result, POSITIONS_CACHE_TTL_S)
    return result
