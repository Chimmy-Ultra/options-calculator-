"""SinoPac (永豐金證券) Shioaji data source — TXO 台指選擇權.

Read-only, like the IB path: quotes, expiries, option chain and history only.
No order endpoints, ever.

Research-only setup is deliberately light: market data needs just an API key and
secret key. The electronic certificate (憑證) is only required for ordering and
account queries, so it is NOT needed here — which also means account positions
are unavailable from this source (see positions()).

shioaji is an optional dependency: if it is not installed or not configured,
available() is False and the app simply stays on mock data for TXO.
"""

import asyncio
import math
import os
import time
from datetime import date, datetime

import pricing

API_KEY = os.environ.get("SINOPAC_API_KEY", "")
SECRET_KEY = os.environ.get("SINOPAC_SECRET_KEY", "")
# Simulation is the default: it needs no certificate and touches no real money.
SIMULATION = os.environ.get("SINOPAC_SIMULATION", "1") not in ("0", "false", "False")
RISK_FREE = float(os.environ.get("RISK_FREE_TW", "0.015"))
STRIKES_EACH_SIDE = 8
SNAPSHOT_CHUNK = 200          # snapshots() takes a batch; keep requests modest
CONTRACTS_TTL_S = 3600.0
CHAIN_TTL_S = 20.0

_api = None
_lock = asyncio.Lock()
_cache: dict = {}


def _cache_get(key):
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    return None


def _cache_put(key, value, ttl):
    _cache[key] = (time.monotonic() + ttl, value)


def _f(x):
    """Shioaji uses 0 / None for "no data" → normalise to None."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) else x


def configured() -> bool:
    return bool(API_KEY and SECRET_KEY)


def _connect_blocking():
    """Log in on a worker thread — Shioaji's client is synchronous."""
    global _api
    if _api is not None:
        return _api
    import shioaji as sj  # imported lazily so the IB-only path needs no shioaji
    api = sj.Shioaji(simulation=SIMULATION)
    api.login(api_key=API_KEY, secret_key=SECRET_KEY, subscribe_trade=False)
    _api = api
    return _api


async def ensure_connected():
    if not configured():
        return False
    if _api is not None:
        return True
    try:
        await asyncio.to_thread(_connect_blocking)
        return True
    except Exception:
        return False


def installed() -> bool:
    """Whether the shioaji package is importable — reported separately from
    configured() so a diagnosis can tell "not installed" from "no API key"."""
    try:
        import shioaji  # noqa: F401
        return True
    except ImportError:
        return False


def available() -> bool:
    """Usable as a data source: package present and credentials set."""
    return configured() and installed()


def _categories(spec: dict):
    """Option categories to gather. TXO is the monthly; TX1/TX2/TX4/TX5 are the
    weeklies. Missing categories are skipped, so this is safe to over-list."""
    raw = spec.get("categories") or os.environ.get("SINOPAC_TXO_CATEGORIES", "TXO,TX1,TX2,TX4,TX5")
    return [c.strip() for c in (raw.split(",") if isinstance(raw, str) else raw) if c.strip()]


def _option_contracts(spec: dict):
    """All listed option contracts for the product, grouped by delivery date."""
    key = ("opts", spec["symbol"])
    hit = _cache_get(key)
    if hit:
        return hit
    opts = _api.Contracts.Options
    by_date: dict = {}
    for cat in _categories(spec):
        group = getattr(opts, cat, None)
        if group is None:
            continue
        for c in group:
            d = (c.delivery_date or "").replace("/", "")
            if not d:
                continue
            by_date.setdefault(d, []).append(c)
    if not by_date:
        raise RuntimeError("Shioaji returned no option contracts for " + spec["symbol"])
    _cache_put(key, by_date, CONTRACTS_TTL_S)
    return by_date


def _underlying_contract(spec: dict):
    """The front TX future — what TXO is actually priced against (Black-76).
    Put-call parity on the exchange's own settlement prices recovers the
    futures price to within a point, while the index sits ~80 points above it
    on the dividend basis. Falls back to the index only if the futures chain
    is unavailable."""
    fut = spec.get("underlyingFuture", "TXF")
    try:
        group = getattr(_api.Contracts.Futures, fut, None)
        if group:
            return group[0]
    except Exception:
        pass
    idx = spec.get("index", ("TSE", "001"))
    try:
        return _api.Contracts.Indexs[idx[0]][idx[1]]
    except Exception:
        return None


def _snapshot_map(contracts):
    """code → Snapshot, batched."""
    out = {}
    for i in range(0, len(contracts), SNAPSHOT_CHUNK):
        chunk = contracts[i:i + SNAPSHOT_CHUNK]
        try:
            for s in (_api.snapshots(chunk) or []):
                out[s.code] = s
        except Exception:
            continue
    return out


def _last_of(snap):
    if not snap:
        return None
    bid, ask = _f(snap.buy_price), _f(snap.sell_price)
    mid = (bid + ask) / 2 if bid and ask else None
    return _f(snap.close) or mid or None


# ── public API, shaped exactly like the IB source ────────────────────────────

async def health():
    ok = await ensure_connected()
    return {"connected": ok, "source": "sinopac", "simulation": SIMULATION}


async def quote(spec: dict):
    async with _lock:
        if not await ensure_connected():
            return None
        def work():
            und = _underlying_contract(spec)
            if und is None:
                return None
            s = (_api.snapshots([und]) or [None])[0]
            if s is None:
                return None
            last = _f(s.close)
            ref = _f(s.change_price)
            return {
                "symbol": spec["symbol"],
                "month": datetime.now().strftime("%Y%m"),
                "last": last,
                "bid": _f(s.buy_price),
                "ask": _f(s.sell_price),
                "close": (last - ref) if (last is not None and ref is not None) else None,
                "chgPct": _f(s.change_rate),
                # Today's running session range (the 關卡價 base). Snapshot
                # fields per the Shioaji docs; guarded in case a build lacks them.
                "open": _f(getattr(s, "open", None)),
                "high": _f(getattr(s, "high", None)),
                "low": _f(getattr(s, "low", None)),
            }
        return await asyncio.to_thread(work)


async def expiries(spec: dict):
    async with _lock:
        if not await ensure_connected():
            return None
        def work():
            by_date = _option_contracts(spec)
            today = date.today()
            out = []
            for d in sorted(by_date):
                try:
                    dd = datetime.strptime(d, "%Y%m%d").date()
                except ValueError:
                    continue
                dte = (dd - today).days
                if dte < 1:
                    continue
                # Monthly = the TXO category; the TX* categories are weeklies.
                cats = {getattr(c, "category", "") for c in by_date[d]}
                monthly = spec.get("monthlyCategory", "TXO") in cats
                out.append({
                    "id": d,
                    "label": (dd.strftime("%b").upper() if monthly else f"W{((dd.day - 1) // 7) + 1}"),
                    "dte": dte,
                    "type": "monthly" if monthly else "weekly",
                    "date": f"{dd.month}/{dd.day:02d}",
                })
                if len(out) >= 8:
                    break
            return out or None
        return await asyncio.to_thread(work)


async def chain(spec: dict, expiry: str):
    cache_key = ("chain", spec["symbol"], expiry)
    hit = _cache_get(cache_key)
    if hit:
        return hit
    async with _lock:
        if not await ensure_connected():
            return None
        def work():
            by_date = _option_contracts(spec)
            contracts = by_date.get(expiry)
            if not contracts:
                return None
            und = _underlying_contract(spec)
            und_snap = (_api.snapshots([und]) or [None])[0] if und else None
            und_px = _last_of(und_snap)
            if not und_px:
                return None

            step = float(spec.get("strikeStep", 50))
            strikes = sorted({float(c.strike_price) for c in contracts})
            near = sorted(strikes, key=lambda k: abs(k - und_px))[: STRIKES_EACH_SIDE * 2 + 1]
            strikes = sorted(near)
            if not strikes:
                return None
            wanted = set(strikes)
            picked = [c for c in contracts if float(c.strike_price) in wanted]
            snaps = _snapshot_map(picked)

            dte = (datetime.strptime(expiry, "%Y%m%d").date() - date.today()).days
            t_years = max(dte, 0.5) / 365.0
            atm = min(strikes, key=lambda k: abs(k - und_px))

            def side(c):
                s = snaps.get(c.code)
                bid, ask = (_f(s.buy_price), _f(s.sell_price)) if s else (None, None)
                mid = (bid + ask) / 2 if bid and ask else None
                last = _last_of(s) or 0.0
                right = "C" if str(getattr(c.option_right, "value", c.option_right)) in ("C", "Call") else "P"
                # Shioaji snapshots carry no greeks -> invert IV from the
                # premium. `und_px` is the front TX future, so the model is
                # Black-76, matching products.js and the EOD snapshot; pricing
                # a futures quote with Black-Scholes would add the carry twice.
                # One forward for the whole board: unlike the snapshot this
                # path cannot take a per-expiry parity forward from settlement
                # prices, so a far expiry is off by its dividend basis.
                iv = pricing.implied_vol(right, und_px, float(c.strike_price), mid or last, t_years, RISK_FREE, "b76") or 0.0
                d = pricing.delta(right, und_px, float(c.strike_price), max(iv, 1e-4), t_years, RISK_FREE, "b76")
                return {
                    "bid": bid or 0.0, "ask": ask or 0.0, "last": last,
                    "iv": round(iv * 100, 2),
                    # Snapshots expose volume but not open interest (TAIFEX
                    # publishes OI separately) — 0 means "unknown", and the
                    # frontend's liquidity scoring skips OI when the whole
                    # chain reports none.
                    "oi": 0,
                    "vol": int(_f(s.total_volume) or 0) if s else 0,
                    "delta": round(d, 4),
                }

            by_strike: dict = {}
            for c in picked:
                right = str(getattr(c.option_right, "value", c.option_right))
                key = "call" if right in ("C", "Call") else "put"
                by_strike.setdefault(float(c.strike_price), {})[key] = side(c)

            empty = {"bid": 0.0, "ask": 0.0, "last": 0.0, "iv": 0.0, "oi": 0, "vol": 0, "delta": 0.0}
            rows = [{
                "strike": k,
                "atm": k == atm,
                "itmCall": k < und_px,
                "itmPut": k > und_px,
                "call": by_strike[k].get("call", empty),
                "put": by_strike[k].get("put", empty),
            } for k in sorted(by_strike)]
            return {
                "expiry": expiry, "dte": dte,
                "underlying": {"month": expiry[:6], "price": und_px},
                "rows": rows,
            }
        result = await asyncio.to_thread(work)
    if result:
        _cache_put(cache_key, result, CHAIN_TTL_S)
    return result


async def bars(spec: dict, duration: str = "3 M", bar: str = "1 day"):
    """Daily history for the underlying index. Shioaji returns minute kbars, so
    they are folded into the requested bucket."""
    cache_key = ("bars", spec["symbol"], duration, bar)
    hit = _cache_get(cache_key)
    if hit:
        return hit
    months = {"1 M": 1, "3 M": 3, "6 M": 6, "1 Y": 12}.get(duration, 3)
    async with _lock:
        if not await ensure_connected():
            return None
        def work():
            und = _underlying_contract(spec)
            if und is None:
                return None
            today = date.today()
            start = date(today.year - (months // 12), today.month, 1)
            if months % 12:
                m = today.month - (months % 12)
                y = today.year - (1 if m <= 0 else 0)
                start = date(y, m + 12 if m <= 0 else m, 1)
            kb = _api.kbars(und, start=start.strftime("%Y-%m-%d"), end=today.strftime("%Y-%m-%d"))
            ts, op, hi, lo, cl, vo = kb.ts, kb.Open, kb.High, kb.Low, kb.Close, kb.Volume
            if not ts:
                return None
            bucket = {"1 day": "%Y%m%d", "1 hour": "%Y%m%d%H", "4 hours": "%Y%m%d%H"}.get(bar, "%Y%m%d")
            div = 4 if bar == "4 hours" else 1
            agg: dict = {}
            order = []
            for i, t in enumerate(ts):
                dt = datetime.fromtimestamp(t / 1e9)
                if div > 1:
                    dt = dt.replace(hour=(dt.hour // div) * div)
                key = dt.strftime(bucket)
                if key not in agg:
                    agg[key] = {"t": dt.strftime("%Y%m%d"), "o": op[i], "h": hi[i], "l": lo[i], "c": cl[i], "v": 0}
                    order.append(key)
                a = agg[key]
                a["h"] = max(a["h"], hi[i]); a["l"] = min(a["l"], lo[i])
                a["c"] = cl[i]; a["v"] += int(vo[i] or 0)
            return {"symbol": spec["symbol"], "month": today.strftime("%Y%m"), "bar": bar,
                    "bars": [agg[k] for k in order]}
        result = await asyncio.to_thread(work)
    if result:
        _cache_put(cache_key, result, 300)
    return result


async def positions(spec: dict):
    """Not available from this source: account data requires the electronic
    certificate, which read-only research deliberately does not set up.
    Returns an empty list so the frontend just shows "no positions"."""
    return {"positions": []}


# ── Intraday: 成本線 + 多空差額 from Shioaji ticks ─────────────────────────────
# The exact version of taifex.intraday(): the exchange's own tick_type says
# whether each trade hit the ask (外盤, 1) or the bid (內盤, 2), so 多空差額 is
# the real Σ(外盤 − 內盤) per minute rather than the tick-rule approximation.
# Front-month TXF contract; `day` = YYYYMMDD, default today. Written against
# shioaji 1.7.5's api.ticks(contract, date) signature (Ticks: ts / close /
# volume / tick_type lists); a build without tick_type falls back to the
# tick rule and says so in `flow`. Not exercised in this container — it has
# no credentials and cannot reach api.sinotrade.com.tw.

def _front_future(spec: dict):
    fut = spec.get("underlyingFuture", "TXF")
    group = getattr(_api.Contracts.Futures, fut, None)
    if not group:
        return None
    # the R1 / R2 continuous codes come first in Shioaji's list; pick the nearest dated month
    dated = [c for c in group if getattr(c, "delivery_month", "") and c.code and not c.code.endswith(("R1", "R2"))]
    dated.sort(key=lambda c: c.delivery_month)
    return dated[0] if dated else group[0]


def _series_from_ticks(times: list, prices: list, lots: list, types: list | None) -> dict:
    """Same shape as taifex._minute_series: bars [hhmm, o, h, l, c, lots, cost, net, cum]."""
    bars: list = []
    hi = lo = None
    prev_px = None
    sign = 0
    cur = None
    buy = sell = 0
    for i, (t, px, q) in enumerate(zip(times, prices, lots)):
        hi = px if hi is None else max(hi, px)
        lo = px if lo is None else min(lo, px)
        if types is not None:
            tt = types[i]
            side = 1 if tt == 1 else -1 if tt == 2 else 0
        else:
            if prev_px is not None and px != prev_px:
                sign = 1 if px > prev_px else -1
            side = sign
        prev_px = px
        if side > 0:
            buy += q
        elif side < 0:
            sell += q
        m = t[:4]
        if cur is None or cur[0] != m:
            cur = [m, px, px, px, px, 0, 0.0, 0, 0]
            bars.append(cur)
        cur[2] = max(cur[2], px)
        cur[3] = min(cur[3], px)
        cur[4] = px
        cur[5] += q
        cur[6] = (hi + lo) / 2
        cur[7] += side * q
    cum = 0
    for b in bars:
        cum += b[7]
        b[8] = cum
    return {"bars": bars, "high": hi, "low": lo, "cost": (hi + lo) / 2 if hi is not None else None,
            "buy": buy, "sell": sell, "net": buy - sell}


async def intraday(spec: dict, day: str | None = None):
    async with _lock:
        if not await ensure_connected():
            return None

        def work():
            fut = _front_future(spec)
            if fut is None:
                return None
            d = day or datetime.now().strftime("%Y%m%d")
            iso = f"{d[:4]}-{d[4:6]}-{d[6:]}"
            t = _api.ticks(contract=fut, date=iso)
            ts = list(getattr(t, "ts", []) or [])
            if not ts:
                return None
            closes = [float(x) for x in t.close]
            vols = [int(x) for x in t.volume]
            types = list(t.tick_type) if getattr(t, "tick_type", None) else None
            # ts = epoch nanoseconds (Shioaji), exchange local time
            times = [datetime.fromtimestamp(int(x) / 1e9).strftime("%H%M%S") for x in ts]
            rows = list(zip(times, closes, vols, types if types else [None] * len(ts)))
            day_rows = [r for r in rows if "084500" <= r[0] <= "134500"]
            night_rows = [r for r in rows if r[0] >= "150000" or r[0] < "050000"]
            def build(rs):
                if not rs:
                    return None
                return _series_from_ticks([r[0] for r in rs], [r[1] for r in rs], [r[2] for r in rs],
                                          [r[3] for r in rs] if types else None)
            return {"source": "sinopac-ticks", "flow": "tick-type" if types else "tick-rule",
                    "symbol": spec.get("underlyingFuture", "TXF"), "date": d, "month": getattr(fut, "delivery_month", None),
                    "day": build(day_rows), "night": build(night_rows)}
        return await asyncio.to_thread(work)
