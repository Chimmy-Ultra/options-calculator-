"""TAIFEX open data — per-strike open interest for TXO 台指選擇權.

Shioaji snapshots carry no open interest; TAIFEX publishes it once a day after
the close (day session ~15:00). This module reads the exchange's options daily
report download (the same CSV the 每日行情 page offers), which gives every
strike's 未沖銷契約數 for the last few sessions plus each contract's expiry
date — so it also answers "OI change vs the previous session" and maps a
contract month/week to the YYYYMMDD expiry id the frontend uses.

Read-only, no credentials, cached for 15 minutes. Every public function returns
None on any failure so callers fall back exactly like the other data sources.

Verified against the live endpoint (2026-09-12): 22 columns, rows for both
一般 and 盤後 sessions; OI is only reported on the 一般 rows.
"""

import asyncio
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

CSV_URL = "https://www.taifex.com.tw/cht/3/dlOptDataDown"
COMMODITY = "TXO"
# The same download for futures (real TX daily bars) and the exchange's own
# quote list (index close) — both only used by the end-of-day snapshot below.
FUT_CSV_URL = "https://www.taifex.com.tw/cht/3/dlFutDataDown"
FUT_COMMODITY = "TX"
MIS_URL = "https://mis.taifex.com.tw/futures/api/getQuoteList"
# 權值股 TOP20: TAIFEX's monthly TAIEX constituent-weight table + TWSE's daily closing table.
WEIGHTS_URL = "https://www.taifex.com.tw/cht/9/futuresQADetail"
TWSE_MI_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
# Every trade of one day, all products (TAIFEX keeps roughly the last two weeks).
TICK_ZIP_URL = "https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_{y}_{m}_{d}.zip"
RISK_FREE_TW = float(os.environ.get("RISK_FREE_TW", "0.015"))
WINDOW_DAYS = 7          # calendar days back — enough for 2 trading days across holidays
CACHE_TTL_S = 15 * 60.0
TIMEOUT_S = 25

_cache: dict = {}        # "table" -> (expires_at, table)
_lock = asyncio.Lock()


def _num(x, default=None):
    """'-' and '' mean no data in TAIFEX files."""
    try:
        return float(str(x).replace(",", ""))
    except (TypeError, ValueError):
        return default


def _fetch_csv(start: date, end: date, url: str = CSV_URL, commodity: str = COMMODITY) -> str:
    form = urllib.parse.urlencode({
        "down_type": "1", "commodity_id": commodity,
        "queryStartDate": start.strftime("%Y/%m/%d"),
        "queryEndDate": end.strftime("%Y/%m/%d"),
    }).encode()
    req = urllib.request.Request(url, data=form, headers={"User-Agent": "options-lab/1"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return _decode(r.read())


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "big5", "cp950"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _parse(text: str) -> dict:
    """CSV → {expiry(YYYYMMDD): {"month": str, "dates": {date: {strike: {"call": {...}, "put": {...}}}}}}.

    Only 一般 (day session) rows carry OI; 盤後 rows are skipped.
    """
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        raise ValueError("TAIFEX answered without a table")
    header = [h.strip() for h in rows[0]]
    col = {name: i for i, name in enumerate(header)}
    need = ("交易日期", "契約", "到期月份(週別)", "履約價", "買賣權", "收盤價", "成交量", "結算價", "未沖銷契約數", "交易時段", "契約到期日", "最後最佳買價", "最後最佳賣價")
    missing = [n for n in need if n not in col]
    if missing:
        raise ValueError(f"TAIFEX CSV columns changed, missing {missing}")
    out: dict = {}
    for r in rows[1:]:
        if len(r) < len(header) - 1:
            continue
        if r[col["契約"]].strip() != COMMODITY or r[col["交易時段"]].strip() != "一般":
            continue
        expiry = r[col["契約到期日"]].strip()
        strike = _num(r[col["履約價"]])
        if not expiry or strike is None:
            continue
        side = "call" if r[col["買賣權"]].strip() == "買權" else "put"
        day = r[col["交易日期"]].strip()
        e = out.setdefault(expiry, {"month": r[col["到期月份(週別)"]].strip(), "dates": {}})
        e["dates"].setdefault(day, {}).setdefault(strike, {})[side] = {
            "oi": int(_num(r[col["未沖銷契約數"]], 0) or 0),
            "vol": int(_num(r[col["成交量"]], 0) or 0),
            "settle": _num(r[col["結算價"]]),
            "close": _num(r[col["收盤價"]]),
            "bid": _num(r[col["最後最佳買價"]]),
            "ask": _num(r[col["最後最佳賣價"]]),
        }
    if not out:
        raise ValueError("TAIFEX CSV had no TXO day-session rows")
    return out


async def table():
    """The parsed download, cached. None if TAIFEX is unreachable."""
    hit = _cache.get("table")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    async with _lock:
        hit = _cache.get("table")
        if hit and hit[0] > time.monotonic():
            return hit[1]
        try:
            today = date.today()
            text = await asyncio.to_thread(_fetch_csv, today - timedelta(days=WINDOW_DAYS), today)
            parsed = await asyncio.to_thread(_parse, text)
        except Exception:
            return None
        _cache["table"] = (time.monotonic() + CACHE_TTL_S, parsed)
        return parsed


def expiries(tbl: dict, today: str | None = None) -> list:
    """Unexpired expiry ids (YYYYMMDD) with their contract month, soonest first."""
    today = today or date.today().strftime("%Y%m%d")
    return [{"id": e, "month": v["month"]} for e, v in sorted(tbl.items()) if e >= today]


def summarize(tbl: dict, expiry: str) -> dict | None:
    """Per-strike OI for one expiry on the latest session, with the change vs
    the previous session, the max-OI strikes (壓力 = max call OI, 支撐 = max
    put OI) and totals. None if the expiry is not in the table."""
    e = tbl.get(expiry)
    if not e or not e["dates"]:
        return None
    days = sorted(e["dates"])
    latest, prev = days[-1], (days[-2] if len(days) > 1 else None)
    cur, old = e["dates"][latest], (e["dates"][prev] if prev else {})
    empty = {"oi": 0, "vol": 0, "settle": None, "close": None, "bid": None, "ask": None}
    rows = []
    for k in sorted(cur):
        row = {"strike": k}
        for side in ("call", "put"):
            s = cur[k].get(side, empty)
            p = old.get(k, {}).get(side, empty)
            row[side] = {"oi": s["oi"], "vol": s["vol"], "settle": s["settle"], "close": s["close"], "oiChg": s["oi"] - p["oi"]}
        rows.append(row)

    def top(side):
        best = max(rows, key=lambda r: r[side]["oi"])
        return {"strike": best["strike"], "oi": best[side]["oi"], "oiChg": best[side]["oiChg"]} if best[side]["oi"] > 0 else None

    return {
        "source": "taifex",
        "date": latest, "prevDate": prev,
        "expiry": expiry, "contractMonth": e["month"],
        "rows": rows,
        "maxCallOi": top("call"),
        "maxPutOi": top("put"),
        "totals": {
            "callOi": sum(r["call"]["oi"] for r in rows),
            "putOi": sum(r["put"]["oi"] for r in rows),
            "callOiChg": sum(r["call"]["oiChg"] for r in rows),
            "putOiChg": sum(r["put"]["oiChg"] for r in rows),
        },
    }


async def open_interest(expiry: str | None):
    """OI summary for `expiry`, or for the nearest unexpired one when omitted.
    None when TAIFEX is unavailable; {} when the expiry is unknown."""
    tbl = await table()
    if tbl is None:
        return None
    if not expiry:
        avail = expiries(tbl)
        if not avail:
            return {}
        expiry = avail[0]["id"]
    return summarize(tbl, expiry) or {}


def merge_into_chain(chain: dict, oi: dict | None) -> dict:
    """Copy TAIFEX OI (and its change) onto chain rows by strike, keeping the
    row shape the frontend already consumes. No OI → rows untouched."""
    if not oi or not oi.get("rows"):
        return chain
    by_strike = {r["strike"]: r for r in oi["rows"]}
    rows = []
    for row in chain.get("rows", []):
        src = by_strike.get(float(row["strike"]))
        if not src:
            rows.append(row)
            continue
        row = dict(row)
        for side in ("call", "put"):
            row[side] = {**row[side], "oi": src[side]["oi"], "oiChg": src[side]["oiChg"]}
        rows.append(row)
    return {**chain, "rows": rows, "oi": {"source": oi["source"], "date": oi["date"], "prevDate": oi["prevDate"]}}


# ── Daily positioning (籌碼) ──────────────────────────────────────────────────
# Three more public TAIFEX sources, all published after the close:
#   PutCallRatio (OpenAPI)        — market-wide TXO put/call OI + volume ratio, ~23 sessions
#   futContractsDateDown (CSV)    — 三大法人 futures positions by contract, by date
#   largeTraderFutDown (CSV)      — 大額交易人 top-5 / top-10 positions, by date
# 外資 net position is reported in TX-equivalent contracts using the exchange's
# own conversion (its large-trader table is labelled "TX+MTX/4+TMF/20").

OPENAPI = "https://openapi.taifex.com.tw/v1/"
INST_CSV_URL = "https://www.taifex.com.tw/cht/3/futContractsDateDown"
LARGE_CSV_URL = "https://www.taifex.com.tw/cht/3/largeTraderFutDown"
TX_EQUIV = {"臺股期貨": 1.0, "小型臺指期貨": 0.25, "微型臺指期貨": 0.05}
INST_IDS = ("TXF", "MXF", "TMF")
FOREIGN = "外資"


def _post_csv(url: str, form: dict) -> list:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), headers={"User-Agent": "options-lab/1"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        text = _decode(r.read())
    if text.lstrip().startswith("<"):
        raise ValueError(f"{url.rsplit('/', 1)[-1]} answered with a page, not a table")
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        raise ValueError(f"{url.rsplit('/', 1)[-1]} answered without a table")
    header = [h.strip() for h in rows[0]]
    return [dict(zip(header, (c.strip() for c in r))) for r in rows[1:] if len(r) >= len(header) - 1]


def _fetch_pc_ratio() -> list:
    """Oldest first: [{date, putOi, callOi, ratio, volRatio}], ratio as a decimal."""
    with urllib.request.urlopen(urllib.request.Request(OPENAPI + "PutCallRatio", headers={"User-Agent": "options-lab/1"}), timeout=TIMEOUT_S) as r:
        rows = json.loads(_decode(r.read()))
    out = []
    for r in rows:
        d = r.get("Date", "")
        if len(d) != 8:
            continue
        out.append({"date": f"{d[:4]}/{d[4:6]}/{d[6:]}", "putOi": int(_num(r.get("PutOI"), 0)), "callOi": int(_num(r.get("CallOI"), 0)),
                    "ratio": round((_num(r.get("PutCallOIRatio%"), 0) or 0) / 100, 4), "volRatio": round((_num(r.get("PutCallVolumeRatio%"), 0) or 0) / 100, 4)})
    return sorted(out, key=lambda x: x["date"])


def _fetch_institutional(days: int = 12) -> dict:
    """{date: {contract name: {身份別: net OI}}} for TX / MTX / TMF.

    This download rejects an end date that is not a trading day (weekends,
    holidays answer with an error page), so the end date steps back until the
    exchange accepts it. All three contracts must load, or the TX-equivalent
    sum would be wrong."""
    out: dict = {}
    for cid in INST_IDS:
        rows, err = None, None
        for back in range(7):
            end = date.today() - timedelta(days=back)
            try:
                rows = _post_csv(INST_CSV_URL, {"queryType": "1", "queryStartDate": (end - timedelta(days=days)).strftime("%Y/%m/%d"),
                                                "queryEndDate": end.strftime("%Y/%m/%d"), "commodityId": cid})
                break
            except ValueError as e:
                err = e
        if rows is None:
            raise err or ValueError("institutional download failed")
        for r in rows:
            net = _num(r.get("多空未平倉口數淨額"))
            if net is None:
                continue
            out.setdefault(r["日期"], {}).setdefault(r["商品名稱"], {})[r["身份別"]] = int(net)
    return out


def _fetch_large_traders(days: int = 12) -> dict:
    """{date: {month: {traderType: {top5Buy, top5Sell, top10Buy, top10Sell, marketOi}}}} for TX."""
    today = date.today()
    rows = _post_csv(LARGE_CSV_URL, {"queryStartDate": (today - timedelta(days=days)).strftime("%Y/%m/%d"),
                                     "queryEndDate": today.strftime("%Y/%m/%d"), "contractId": "TX"})
    out: dict = {}
    for r in rows:
        if r.get("商品(契約)") != "TX":
            continue
        out.setdefault(r["日期"], {}).setdefault(r["到期月份(週別)"], {})[r["交易人類別"]] = {
            "top5Buy": int(_num(r["前五大交易人買方"], 0)), "top5Sell": int(_num(r["前五大交易人賣方"], 0)),
            "top10Buy": int(_num(r["前十大交易人買方"], 0)), "top10Sell": int(_num(r["前十大交易人賣方"], 0)),
            "marketOi": int(_num(r["全市場未沖銷部位數"], 0)),
        }
    return out


def _tx_equiv(by_contract: dict, who) -> float:
    """Net position summed across TX / MTX / TMF in TX-equivalent contracts.
    `who` picks the 身份別 (a prefix match: 外資 also matches 外資及陸資)."""
    total = 0.0
    for name, w in TX_EQUIV.items():
        for item, net in (by_contract.get(name) or {}).items():
            if item.startswith(who):
                total += net * w
    return total


def _market_blocks(pc: list | None, inst: dict | None, large: dict | None) -> dict:
    out: dict = {"source": "taifex"}
    if pc:
        cur, prev = pc[-1], (pc[-2] if len(pc) > 1 else None)
        out["pcRatio"] = {**cur, "prevRatio": prev["ratio"] if prev else None,
                          "chg": round(cur["ratio"] - prev["ratio"], 4) if prev else None,
                          "series": [{"date": x["date"], "ratio": x["ratio"]} for x in pc]}
    if inst:
        days = sorted(inst)
        cur, prev = days[-1], (days[-2] if len(days) > 1 else None)
        net = _tx_equiv(inst[cur], FOREIGN)
        pnet = _tx_equiv(inst[prev], FOREIGN) if prev else None
        out["foreign"] = {
            "date": cur, "prevDate": prev,
            "net": round(net), "prevNet": round(pnet) if pnet is not None else None,
            "chg": round(net - pnet) if pnet is not None else None,
            "byContract": {name: next((v for k, v in (inst[cur].get(name) or {}).items() if k.startswith(FOREIGN)), None) for name in TX_EQUIV},
            "dealerNet": round(_tx_equiv(inst[cur], "自營商")), "trustNet": round(_tx_equiv(inst[cur], "投信")),
            "unit": "TX-equivalent contracts (TX + MTX/4 + TMF/20)",
        }
    if large:
        days = sorted(large)

        def front(day):
            months = [m for m in large[day] if m.isdigit() and m not in ("999999", "666666")]
            return min(months) if months else None

        cur, prev = days[-1], (days[-2] if len(days) > 1 else None)
        m = front(cur)
        if m:
            a = large[cur][m].get("0") or {}
            sp = large[cur][m].get("1") or {}
            net = a.get("top10Buy", 0) - a.get("top10Sell", 0)
            pm = front(prev) if prev else None
            pa = (large[prev][pm].get("0") or {}) if pm else None
            pnet = (pa["top10Buy"] - pa["top10Sell"]) if pa else None
            out["top10"] = {
                "date": cur, "prevDate": prev, "month": m,
                "net": net, "prevNet": pnet, "chg": (net - pnet) if pnet is not None else None,
                "specificNet": (sp.get("top10Buy", 0) - sp.get("top10Sell", 0)) if sp else None,
                "top5Net": a.get("top5Buy", 0) - a.get("top5Sell", 0),
                "marketOi": a.get("marketOi"),
            }
    out["date"] = max(x for x in (out.get("pcRatio", {}).get("date"), out.get("foreign", {}).get("date"), out.get("top10", {}).get("date")) if x) if len(out) > 1 else None
    return out


async def market():
    """Positioning block for the Levels strip. Each part is independent: a
    failed source is simply absent. None only when nothing answered."""
    hit = _cache.get("market")
    if hit and hit[0] > time.monotonic():
        return hit[1]

    async def part(fn):
        try:
            return await asyncio.to_thread(fn)
        except Exception:
            return None

    pc, inst, large = await asyncio.gather(part(_fetch_pc_ratio), part(_fetch_institutional), part(_fetch_large_traders))
    if not (pc or inst or large):
        return None
    data = _market_blocks(pc, inst, large)
    _cache["market"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


# ── 權值股 TOP20 ────────────────────────────────────────────────────────────
# The 多空指南針 "權值股 TOP20" read. Weights: TAIFEX's 臺灣證券交易所發行量加權
# 股價指數成分股暨市值比重 page (updated once a month, 資料日期 on the page).
# Moves: TWSE's 每日收盤行情 table for the latest trading day (one request for
# every listed stock; a non-trading date answers stat != OK, so the date steps
# back). Both public, no login.

def _fetch_weights() -> dict:
    """{date: 'YYYY/M/D', rows: [{rank, code, name, weight}] by rank}. The page
    lays the list out in two column groups (headers rank_a/name_a/propertion_a
    and *_b); cells are read in document order and grouped per column."""
    import re
    req = urllib.request.Request(WEIGHTS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r"資料日期[：:]\s*(\d{4}/\d{1,2}/\d{1,2})", html)
    cells = re.findall(r"<td[^>]*headers=\"?(rank|name|propertion|proportion)_([ab])\"?[^>]*>\s*([^<]*?)\s*</td>", html, flags=re.I | re.S)
    cur: dict = {}
    rows: list = []
    for kind, col, text in cells:
        kind = kind.lower()
        if kind == "rank":
            rec = {"rank": int(_num(text, 0) or 0), "code": None, "name": None, "weight": None}
            cur[col] = rec
            rows.append(rec)
        elif col in cur and kind == "name":
            if cur[col]["code"] is None:
                cur[col]["code"] = text.strip()
            else:
                cur[col]["name"] = text.strip()
        elif col in cur:
            cur[col]["weight"] = _num(text.replace("%", ""))
    rows = [r for r in rows if r["rank"] and r["code"] and r["name"] and r["weight"] is not None]
    rows.sort(key=lambda r: r["rank"])
    if not rows:
        raise ValueError("weights table not found")
    return {"date": m.group(1) if m else None, "rows": rows}


def _fetch_twse_daily(days_back: int = 7) -> dict:
    """{date: 'YYYYMMDD', stocks: {code: {name, open, high, low, close, chg, vol}}} for the latest trading day."""
    last_err = None
    for back in range(days_back):
        d = date.today() - timedelta(days=back)
        url = TWSE_MI_URL + "?" + urllib.parse.urlencode({"response": "json", "date": d.strftime("%Y%m%d"), "type": "ALLBUT0999"})
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        j = None
        # TWSE rate-limits bursts with a 307 to a "too many requests" page —
        # wait and retry the same date before giving up on it.
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    j = json.loads(r.read().decode("utf-8", "replace"))
                break
            except Exception as e:  # network / JSON / 307
                last_err = e
                time.sleep(2.5 * (attempt + 1))
        if not j or j.get("stat") != "OK":
            time.sleep(1.0)
            continue
        for t in j.get("tables") or []:
            f = t.get("fields") or []
            if "證券代號" not in f or "收盤價" not in f:
                continue
            ix = {k: f.index(k) for k in f}
            stocks = {}
            for row in t.get("data") or []:
                try:
                    code = str(row[ix["證券代號"]]).strip()
                    close = _num(str(row[ix["收盤價"]]).replace(",", ""))
                    if close is None:
                        continue
                    sign_cell = str(row[ix["漲跌(+/-)"]])
                    sign = 1 if "+" in sign_cell else -1 if "-" in sign_cell else 0
                    diff = _num(str(row[ix["漲跌價差"]]).replace(",", ""), 0.0) or 0.0
                    stocks[code] = {
                        "name": str(row[ix["證券名稱"]]).strip(),
                        "open": _num(str(row[ix["開盤價"]]).replace(",", "")),
                        "high": _num(str(row[ix["最高價"]]).replace(",", "")),
                        "low": _num(str(row[ix["最低價"]]).replace(",", "")),
                        "close": close, "chg": sign * diff,
                        "vol": int(_num(str(row[ix["成交股數"]]).replace(",", ""), 0) or 0),
                    }
                except (IndexError, KeyError, ValueError):
                    continue
            if stocks:
                return {"date": d.strftime("%Y%m%d"), "stocks": stocks}
    raise last_err or ValueError("TWSE daily table unavailable")


async def top20(n: int = 20):
    """The twenty heaviest TAIEX constituents with the previous session's move.
    None when either source failed — the panel needs both."""
    hit = _cache.get("top20")
    if hit and hit[0] > time.monotonic():
        return hit[1]

    async def part(fn):
        try:
            return await asyncio.to_thread(fn)
        except Exception:
            return None

    w, q = await asyncio.gather(part(_fetch_weights), part(_fetch_twse_daily))
    if not w or not q:
        return None
    rows = []
    for rec in w["rows"][:n]:
        st = q["stocks"].get(rec["code"])
        chg = st["chg"] if st else None
        close = st["close"] if st else None
        prev = (close - chg) if (close is not None and chg is not None) else None
        rows.append({**rec,
                     "close": close, "chg": chg,
                     "chgPct": round(chg / prev * 100, 2) if (prev and chg is not None) else None,
                     "open": st["open"] if st else None, "high": st["high"] if st else None, "low": st["low"] if st else None,
                     "vol": st["vol"] if st else None})
    data = {"source": "taifex+twse", "weightsDate": w["date"], "date": q["date"], "rows": rows}
    _cache["top20"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


# ── Intraday: 成本線 + 多空差額 from the exchange's own tick file ────────────
# 自由人's 成本線 is (session high + session low) / 2 — his FB post "主力成本線
# 篇" states the formula, and it reproduces three dated screenshots to the
# point (docs/daytrade-redesign.md §8). 多空差額 is the running sum of each
# minute's 外盤量 − 內盤量 (the arithmetic of his per-minute table checks out).
# TAIFEX's tick file has no bid / ask, so here 外盤 / 內盤 is the tick rule
# (an uptick trades at the ask, a downtick at the bid, an unchanged price
# inherits) — an approximation, labelled `flow: "tick-rule"`; the Shioaji path
# in sinopac.py uses the exchange's real tick_type when a session is connected.

def _fetch_tick_zip(day: date) -> bytes | None:
    """The day's Daily_YYYY_MM_DD.zip, or None when TAIFEX has no file (it
    answers a redirect to an HTML page instead of the archive)."""
    url = TICK_ZIP_URL.format(y=day.year, m=f"{day.month:02d}", d=f"{day.day:02d}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    return raw if raw[:2] == b"PK" else None


def _parse_ticks(raw_zip: bytes, symbol: str = FUT_COMMODITY) -> dict:
    """Front-month ticks of `symbol` from the archive: {date, month,
    day: [(hhmmss, price, lots)], night: [...]} — the day session of the file's
    trading date and the night session booked before it (dated the previous
    calendar day). Lots = 成交數量(B+S) / 2. Front month = the outright month
    with the most day-session lots."""
    import zipfile
    zf = zipfile.ZipFile(io.BytesIO(raw_zip))
    name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
    text = zf.read(name).decode("big5", "replace")
    rows = []
    for line in text.splitlines()[1:]:
        p = [x.strip() for x in line.split(",")]
        if len(p) < 6 or p[1] != symbol or "/" in p[2]:
            continue
        rows.append((p[0], p[2], p[3], float(p[4]), int(p[5]) // 2))
    if not rows:
        raise ValueError(f"no {symbol} ticks in file")
    trade_date = max(r[0] for r in rows)
    day_rows = [r for r in rows if r[0] == trade_date and "084500" <= r[2] <= "134500"]
    by_month: dict = {}
    for r in day_rows:
        by_month[r[1]] = by_month.get(r[1], 0) + r[4]
    month = max(by_month, key=by_month.get)
    day = [(r[2], r[3], r[4]) for r in day_rows if r[1] == month]
    night = [(r[2], r[3], r[4]) for r in rows if r[1] == month and r[0] != trade_date]
    return {"date": trade_date, "month": month, "day": day, "night": night}


def _minute_series(ticks: list) -> dict:
    """1-minute bars with the running 成本線 and the tick-rule 多空差額.
    bars: [hhmm, o, h, l, c, lots, cost, net, cum]; cost = (running high +
    running low) / 2 at the end of the minute; net = the minute's 外盤 − 內盤
    lots; cum = the running sum."""
    bars: list = []
    hi = lo = None
    prev_px = None
    sign = 0
    cur = None
    buy = sell = 0
    for t, px, q in ticks:
        hi = px if hi is None else max(hi, px)
        lo = px if lo is None else min(lo, px)
        if prev_px is not None and px != prev_px:
            sign = 1 if px > prev_px else -1
        prev_px = px
        if sign > 0:
            buy += q
        elif sign < 0:
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
        cur[7] += sign * q
    cum = 0
    for b in bars:
        cum += b[7]
        b[8] = cum
    return {"bars": bars, "high": hi, "low": lo, "cost": (hi + lo) / 2 if hi is not None else None,
            "buy": buy, "sell": sell, "net": buy - sell}


async def intraday(day: str | None = None, days_back: int = 10):
    """成本線 / 多空差額 series for the latest day TAIFEX has a tick file for
    (or the given YYYYMMDD). None when no file could be found."""
    key = f"intraday:{day or 'latest'}"
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]

    def work():
        start = datetime.strptime(day, "%Y%m%d").date() if day else date.today()
        for back in range(days_back if not day else 1):
            d = start - timedelta(days=back)
            if d.weekday() >= 5:
                continue
            try:
                raw = _fetch_tick_zip(d)
            except Exception:
                raw = None
            if raw is None:
                continue
            parsed = _parse_ticks(raw)
            out = {"source": "taifex-ticks", "flow": "tick-rule", "symbol": FUT_COMMODITY,
                   "date": parsed["date"], "month": parsed["month"],
                   "day": _minute_series(parsed["day"]),
                   "night": _minute_series(parsed["night"]) if parsed["night"] else None}
            return out
        return None

    data = await asyncio.to_thread(work)
    if data is not None:
        _cache[key] = (time.monotonic() + CACHE_TTL_S, data)
    return data


# ── End-of-day snapshot ─────────────────────────────────────────────────────
# Everything the frontend needs for the previous session, from TAIFEX alone:
# index close (MIS quote list), per-strike close / best bid-ask / settlement /
# OI (options CSV) and real TX daily bars (futures CSV). Written to a JS file
# the deployed app loads as `window.TAIFEX_EOD`, so the site shows real
# previous-session numbers without any local proxy (docs/daytrade-redesign.md
# §3, "deployment note"). Rebuild once per trading day:
#
#     python3 taifex.py --write ../design_handoff_options_lab/taifex-eod.js

def _fetch_index() -> dict:
    """TAIEX close and the front-month TX quote from the exchange's quote list."""
    body = json.dumps({"MarketType": "0", "SymbolType": "F", "KindID": "1", "CID": "TXF",
                       "ExpireMonth": "", "RowSize": "全部", "PageNo": "", "SortColumn": "", "AscDesc": "A"}).encode()
    req = urllib.request.Request(MIS_URL, data=body, headers={"User-Agent": "options-lab/1", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        rows = (json.loads(_decode(r.read())).get("RtData") or {}).get("QuoteList") or []
    idx = next(r for r in rows if r.get("SymbolID") == "TXF-S")
    fut = next((r for r in rows if str(r.get("SymbolID", "")).endswith("-F")), None)
    return {
        "price": float(idx["CLastPrice"]), "ref": _num(idx.get("CRefPrice")),
        "date": idx.get("CDate", ""), "time": idx.get("CTime", ""),
        "futures": {"name": fut.get("DispCName"), "price": _num(fut.get("CLastPrice")),
                    "settle": _num(fut.get("SettlementPrice"))} if fut else None,
    }


def _parse_bars(text: str) -> dict:
    """Futures CSV → {YYYYMMDD: {"day": bar, "night": bar}} for the front month
    (the row with the most volume on each date and session). The 盤後 row
    dated D is the night session TAIFEX books under business day D — it runs
    from 15:00 the previous day to 05:00 on D (its open sits on D−1's close)."""
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return {}
    col = {h.strip(): i for i, h in enumerate(rows[0])}
    out: dict = {}
    for r in rows[1:]:
        if len(r) < len(col) - 1 or r[col["契約"]].strip() != FUT_COMMODITY:
            continue
        sess = {"一般": "day", "盤後": "night"}.get(r[col["交易時段"]].strip())
        o, h, l, c = (_num(r[col[k]]) for k in ("開盤價", "最高價", "最低價", "收盤價"))
        v = int(_num(r[col["成交量"]], 0) or 0)
        if sess is None or None in (o, h, l, c):
            continue
        t = r[col["交易日期"]].strip().replace("/", "")
        slot = out.setdefault(t, {})
        if sess not in slot or v > slot[sess]["v"]:
            slot[sess] = {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}
    return out


def _fetch_bars(days: int = 150) -> dict:
    """Real TX daily bars for the last `days` calendar days (30-day windows —
    the download's limit per request), oldest first, as two series:
    "day" = the day session only (日盤), "full" = night + day session of the
    same trading day (全日盤: 15:00 → 13:45)."""
    today = date.today()
    sessions: dict = {}
    end = today
    while (today - end).days < days:
        start = end - timedelta(days=29)
        sessions.update(_parse_bars(_fetch_csv(start, end, url=FUT_CSV_URL, commodity=FUT_COMMODITY)))
        end = start - timedelta(days=1)
    day, full = [], []
    for t in sorted(sessions):
        d, n = sessions[t].get("day"), sessions[t].get("night")
        if not d:
            continue
        day.append(d)
        full.append({"t": t, "o": n["o"], "h": max(n["h"], d["h"]), "l": min(n["l"], d["l"]), "c": d["c"], "v": n["v"] + d["v"]} if n else dict(d))
    return {"day": day, "full": full}


def _expiry_label(month: str, expiry: str) -> tuple:
    """TAIFEX contract code → (label, type): '202609' → ('SEP', 'monthly'),
    '202609F3' → ('F3', 'weekly'); same vocabulary as the mock expiry strip."""
    if len(month) == 6:
        return datetime.strptime(month, "%Y%m").strftime("%b").upper(), "monthly"
    return month[6:], "weekly"


async def build_snapshot(product_id: str = "txo", n_expiries: int = 5, strike_pct: float = 0.08):
    """The previous session as the frontend consumes it. None if TAIFEX is down."""
    import pricing  # shared with the live sources so IV is inverted identically

    tbl = await table()
    if tbl is None:
        return None
    idx = await asyncio.to_thread(_fetch_index)
    bars = await asyncio.to_thread(_fetch_bars)
    mkt = await market()
    t20 = await top20()
    intra = None
    try:
        intra = await intraday()
    except Exception:
        intra = None
    spot = idx["price"]
    data_date = max(d for e in tbl.values() for d in e["dates"])          # yyyy/mm/dd
    asof = data_date.replace("/", "")
    asof_d = datetime.strptime(asof, "%Y%m%d").date()

    expiries, chains, oi = [], {}, {}
    for e in [x for x in sorted(tbl) if x > asof][:n_expiries]:
        summ = summarize(tbl, e)
        if not summ:
            continue
        d = datetime.strptime(e, "%Y%m%d").date()
        label, kind = _expiry_label(tbl[e]["month"], e)
        expiries.append({"id": e, "label": label, "type": kind, "date": f"{d.month}/{d.day:02d}", "month": tbl[e]["month"]})
        t_years = max((d - asof_d).days, 0.5) / 365.0
        cur = tbl[e]["dates"][data_date]
        rows = []
        for r in summ["rows"]:
            k = r["strike"]
            if abs(k - spot) / spot > strike_pct:
                continue
            row = {"strike": k, "atm": False, "itmCall": k < spot, "itmPut": k > spot}
            for side, right in (("call", "C"), ("put", "P")):
                raw = cur.get(k, {}).get(side, {})
                last = raw.get("close") if raw.get("close") is not None else (raw.get("settle") or 0.0)
                bid, ask = raw.get("bid"), raw.get("ask")
                mid = (bid + ask) / 2 if bid and ask else None
                iv = pricing.implied_vol(right, spot, k, mid or last, t_years, RISK_FREE_TW, "bs") or 0.0
                delta = pricing.delta(right, spot, k, max(iv, 1e-4), t_years, RISK_FREE_TW, "bs")
                row[side] = {"bid": bid or 0.0, "ask": ask or 0.0, "last": last,
                             "iv": round(iv * 100, 2), "oi": r[side]["oi"], "oiChg": r[side]["oiChg"],
                             "vol": r[side]["vol"], "delta": round(delta, 4)}
            rows.append(row)
        if rows:
            min(rows, key=lambda x: abs(x["strike"] - spot))["atm"] = True
        chains[e] = {"rows": rows}
        oi[e] = {k: v for k, v in summ.items() if k != "rows"}
        # compact: [strike, callOi, callOiChg, callSettle, callPrevSettle, putOi, putOiChg, putSettle, putPrevSettle]
        # prevSettle = the session before the snapshot's own premiums, so the
        # straddle's "vs prev settle" reading stays a one-session change.
        prev = tbl[e]["dates"].get(summ["prevDate"], {}) if summ["prevDate"] else {}
        oi[e]["rows"] = [[r["strike"],
                          r["call"]["oi"], r["call"]["oiChg"], r["call"]["settle"], prev.get(r["strike"], {}).get("call", {}).get("settle"),
                          r["put"]["oi"], r["put"]["oiChg"], r["put"]["settle"], prev.get(r["strike"], {}).get("put", {}).get("settle")]
                         for r in summ["rows"]]

    return {
        "product": product_id, "source": "taifex-eod",
        "date": data_date, "prevDate": next(iter(oi.values()))["prevDate"] if oi else None,
        "asOf": asof, "builtAt": datetime.now().isoformat(timespec="seconds"),
        "spot": {"price": spot, "ref": idx["ref"], "date": idx["date"], "time": idx["time"]},
        "futures": idx["futures"],
        "expiries": expiries, "chains": chains, "oi": oi,
        "bars": bars["day"], "barsFull": bars["full"],
        "market": mkt,
        "top20": t20,
        "intraday": intra,
    }


def main(argv):
    out = None
    if "--write" in argv:
        out = argv[argv.index("--write") + 1]
    snap = asyncio.run(build_snapshot())
    if snap is None:
        print("TAIFEX unreachable — nothing written", file=sys.stderr)
        return 1
    text = ("// Generated by server/taifex.py --write: TAIFEX previous-session snapshot for the\n"
            "// deployed app (no local proxy needed). Do not edit; rebuild once per trading day.\n"
            "window.TAIFEX_EOD = " + json.dumps(snap, separators=(",", ":")) + ";\n")  # ASCII-safe: no charset dependence
    print(f"snapshot {snap['date']} (prev {snap['prevDate']}) spot {snap['spot']['price']} "
          f"expiries {[e['id'] for e in snap['expiries']]} chain rows {[len(c['rows']) for c in snap['chains'].values()]} "
          f"bars {len(snap['bars'])} day / {len(snap['barsFull'])} full; market {sorted((snap['market'] or {}).keys())}; "
          f"top20 {len((snap.get('top20') or {}).get('rows') or [])} rows; "
          f"intraday {((snap.get('intraday') or {}).get('date'))} {len(((snap.get('intraday') or {}).get('day') or {}).get('bars') or [])} min -> {len(text) // 1024} KB")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
