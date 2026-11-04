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
import math
import os
import statistics
import sys
import time
import socket
import urllib.error
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
# 台股籌碼日報: TWSE's 三大法人買賣金額統計 and 信用交易統計 (margin balances).
TWSE_INST_URL = "https://www.twse.com.tw/rwd/zh/fund/BFI82U"
TWSE_MARGIN_URL = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN"
# Every trade of one day, all products (TAIFEX keeps roughly the last two weeks).
TICK_ZIP_URL = "https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_{y}_{m}_{d}.zip"
RISK_FREE_TW = float(os.environ.get("RISK_FREE_TW", "0.015"))
WINDOW_DAYS = 7          # calendar days back — enough for 2 trading days across holidays
CACHE_TTL_S = 15 * 60.0
TIMEOUT_S = 25


def _urlopen(req, timeout=TIMEOUT_S, attempts=3):
    """urllib.request.urlopen with retries. TAIFEX answers GitHub's runners
    slowly or not at all for a minute at a time (the daily job failed 7 times
    in October on one read timeout), so a timeout, reset or 5xx is retried
    after 5 s and then 20 s. A 4xx is the answer, not a hiccup: raised at once."""
    for i in range(attempts):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code < 500 or i == attempts - 1:
                raise
        except (TimeoutError, socket.timeout, ConnectionError, urllib.error.URLError):
            if i == attempts - 1:
                raise
        time.sleep(5 if i == 0 else 20)

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
    with _urlopen(req, timeout=TIMEOUT_S) as r:
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
#   pcRatioDown (CSV)             — the same ratio, posted on the day (OpenAPI lags a session)
#   futContractsDateDown (CSV)    — 三大法人 futures positions by contract, by date
#   largeTraderFutDown (CSV)      — 大額交易人 top-5 / top-10 positions, by date
# 外資 net position is reported in TX-equivalent contracts using the exchange's
# own conversion (its large-trader table is labelled "TX+MTX/4+TMF/20").

OPENAPI = "https://openapi.taifex.com.tw/v1/"
INST_CSV_URL = "https://www.taifex.com.tw/cht/3/futContractsDateDown"
LARGE_CSV_URL = "https://www.taifex.com.tw/cht/3/largeTraderFutDown"
PC_CSV_URL = "https://www.taifex.com.tw/cht/3/pcRatioDown"
TX_EQUIV = {"臺股期貨": 1.0, "小型臺指期貨": 0.25, "微型臺指期貨": 0.05}
INST_IDS = ("TXF", "MXF", "TMF")
FOREIGN = "外資"


def _post_csv(url: str, form: dict) -> list:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode(), headers={"User-Agent": "options-lab/1"})
    with _urlopen(req, timeout=TIMEOUT_S) as r:
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
    with _urlopen(urllib.request.Request(OPENAPI + "PutCallRatio", headers={"User-Agent": "options-lab/1"}), timeout=TIMEOUT_S) as r:
        rows = json.loads(_decode(r.read()))
    out = []
    for r in rows:
        d = r.get("Date", "")
        if len(d) != 8:
            continue
        out.append({"date": f"{d[:4]}/{d[4:6]}/{d[6:]}", "putOi": int(_num(r.get("PutOI"), 0)), "callOi": int(_num(r.get("CallOI"), 0)),
                    "ratio": round((_num(r.get("PutCallOIRatio%"), 0) or 0) / 100, 4), "volRatio": round((_num(r.get("PutCallVolumeRatio%"), 0) or 0) / 100, 4)})
    return sorted(out, key=lambda x: x["date"])


def _fetch_pc_ratio_csv(days: int = 100) -> list:
    """The same rows from the website's Put/Call 比 download, which TAIFEX posts
    on the day; the OpenAPI copy above lags one session (30 snapshots from
    2026/09/15 to 11/02 showed it a session behind every time they were built
    on the day itself). Columns are matched by name, since only this download
    spells them in Chinese. The end date steps back like the institutional
    download in case a non-trading day is rejected. The download refuses a
    window much past a month (an 8/01-11/02 request answered an error page),
    so `days` is walked in 30-day windows; an older window that fails ends the
    walk and keeps what is newer."""
    rows, err = None, None
    for back in range(7):
        end = date.today() - timedelta(days=back)
        try:
            rows = _post_csv(PC_CSV_URL, {"queryStartDate": (end - timedelta(days=29)).strftime("%Y/%m/%d"),
                                          "queryEndDate": end.strftime("%Y/%m/%d")})
            break
        except ValueError as e:
            err = e
    if rows is None:
        raise err or ValueError("pcRatioDown failed")
    while (date.today() - end).days + 30 < days:
        end = end - timedelta(days=30)
        try:
            rows += _post_csv(PC_CSV_URL, {"queryStartDate": (end - timedelta(days=29)).strftime("%Y/%m/%d"),
                                           "queryEndDate": end.strftime("%Y/%m/%d")})
        except ValueError:
            break

    def col(r, test):
        return next((v for k, v in r.items() if k and test(k)), None)

    out = []
    for r in rows:
        parts = (col(r, lambda k: k.startswith("日期")) or "").split("/")
        if len(parts) != 3 or not all(x.isdigit() for x in parts):
            continue
        ratio = _num(col(r, lambda k: "未平倉" in k and "比" in k))
        put_oi = _num(col(r, lambda k: k.startswith("賣權未平倉")))
        call_oi = _num(col(r, lambda k: k.startswith("買權未平倉")))
        # The ratio must be put OI / call OI; a row that disagrees means a column was misread.
        if ratio is None or not put_oi or not call_oi or abs(put_oi / call_oi * 100 - ratio) > 0.5:
            continue
        vol = _num(col(r, lambda k: "成交量" in k and "比" in k), 0) or 0
        out.append({"date": f"{int(parts[0]):04d}/{int(parts[1]):02d}/{int(parts[2]):02d}", "putOi": int(put_oi), "callOi": int(call_oi),
                    "ratio": round(ratio / 100, 4), "volRatio": round(vol / 100, 4)})
    if not out:
        raise ValueError(f"pcRatioDown table has no usable rows (columns: {list(rows[0])})")
    return sorted(out, key=lambda x: x["date"])


def _pc_ratio() -> list:
    """OpenAPI history with the website download laid over it by date, so the
    newest session comes from the download and either source alone still
    fills the tile."""
    by_date, err = {}, None
    for fn in (_fetch_pc_ratio, _fetch_pc_ratio_csv):
        try:
            for r in fn():
                by_date[r["date"]] = r
        except Exception as e:
            err = e
    if not by_date:
        raise err or ValueError("no put/call ratio source answered")
    return [by_date[d] for d in sorted(by_date)]


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


def _post_csv_back(url: str, form: dict, days: int, tries: int = 7) -> list:
    """_post_csv over [end - days, end], stepping the end date back while the
    download rejects it (non-trading days answer with an error page)."""
    err = None
    for back in range(tries):
        end = date.today() - timedelta(days=back)
        try:
            return _post_csv(url, {**form, "queryStartDate": (end - timedelta(days=days)).strftime("%Y/%m/%d"),
                                   "queryEndDate": end.strftime("%Y/%m/%d")})
        except ValueError as e:
            err = e
    raise err or ValueError(f"{url.rsplit('/', 1)[-1]} failed")


# ── TXO positions by trader type and by large trader ───────────────────────
# 選擇權買賣權分計 (callsAndPutsDateDown): 自營商 / 投信 / 外資及陸資 long, short
# and net OI per call / put, in contracts and in 契約金額 (千元).
# 選擇權大額交易人 (largeTraderOptDown): top-5 / top-10 long (買方) and short
# (賣方) per call / put with the whole market's OI, for all contracts
# (999999), the weeklies together (666666) and the front month (YYYYMM).
# Trader type 0 = all top traders, 1 = the 特定法人 among them. This download
# ignores its contract filter and answers every option product, so rows are
# filtered on TXO here. Both formats verified against the live endpoints
# on 2026/11/02.
OPT_INST_CSV_URL = "https://www.taifex.com.tw/cht/3/callsAndPutsDateDown"
LARGE_OPT_CSV_URL = "https://www.taifex.com.tw/cht/3/largeTraderOptDown"
INST_NAMES = {"外資及陸資": "foreign", "投信": "trust", "自營商": "dealer"}


def _fetch_inst_options(days: int = 20) -> dict:
    """{date: {who: {call|put: {longOi, shortOi, netOi, longAmt, shortAmt, netAmt}}}}, amounts in 千元."""
    rows = _post_csv_back(OPT_INST_CSV_URL, {"commodityId": "TXO"}, days)
    out: dict = {}
    for r in rows:
        who = INST_NAMES.get(r.get("身份別", ""))
        side = {"CALL": "call", "PUT": "put"}.get(r.get("買賣權別", "").upper())
        if not who or not side or "選擇權" not in r.get("商品名稱", ""):
            continue
        v = {k: int(_num(r.get(c), 0) or 0) for k, c in (
            ("longOi", "買方未平倉口數"), ("shortOi", "賣方未平倉口數"), ("netOi", "未平倉口數買賣淨額"),
            ("longAmt", "買方未平倉契約金額(千元)"), ("shortAmt", "賣方未平倉契約金額(千元)"), ("netAmt", "未平倉契約金額買賣淨額(千元)"))}
        out.setdefault(r["日期"], {}).setdefault(who, {})[side] = v
    if not out:
        raise ValueError("callsAndPutsDateDown had no TXO rows")
    return out


def _inst_options_block(raw: dict) -> dict:
    days = sorted(raw)
    cur, prev = days[-1], (days[-2] if len(days) > 1 else None)
    rows = {}
    for who in INST_NAMES.values():
        c = raw[cur].get(who)
        if not c:
            continue
        p = raw[prev].get(who) if prev else None
        rows[who] = {side: {**c[side], "chgOi": (c[side]["netOi"] - p[side]["netOi"]) if p else None,
                            "chgAmt": (c[side]["netAmt"] - p[side]["netAmt"]) if p else None}
                     for side in ("call", "put") if side in c}
    series = [{"date": d, **{who: [x.get("call", {}).get("netOi"), x.get("put", {}).get("netOi"),
                                   x.get("call", {}).get("netAmt"), x.get("put", {}).get("netAmt")]
                             for who, x in raw[d].items()}} for d in days[-10:]]
    return {"source": "taifex", "date": cur, "prevDate": prev, "unitAmt": "NT$ thousand", "rows": rows,
            # series rows: who -> [callNetOi, putNetOi, callNetAmt, putNetAmt]
            "series": series}


def _fetch_large_options(days: int = 10) -> dict:
    """{date: {month: {call|put: {traderType: {top5Buy, top5Sell, top10Buy, top10Sell, marketOi}}}}} for TXO."""
    rows = _post_csv_back(LARGE_OPT_CSV_URL, {"contractId": "TXO"}, days)
    out: dict = {}
    for r in rows:
        if r.get("商品(契約)") != "TXO":
            continue
        side = {"買權": "call", "賣權": "put"}.get(r.get("買賣權"))
        if not side or r.get("前五大交易人買方") in (None, "-"):
            continue
        out.setdefault(r["日期"], {}).setdefault(r["到期月份(週別)"], {}).setdefault(side, {})[r["交易人類別"]] = {
            "top5Buy": int(_num(r["前五大交易人買方"], 0)), "top5Sell": int(_num(r["前五大交易人賣方"], 0)),
            "top10Buy": int(_num(r["前十大交易人買方"], 0)), "top10Sell": int(_num(r["前十大交易人賣方"], 0)),
            "marketOi": int(_num(r["全市場未沖銷部位數"], 0)),
        }
    if not out:
        raise ValueError("largeTraderOptDown had no TXO rows")
    return out


def _large_options_block(raw: dict) -> dict:
    """Per filter (all / weekly / front) and side: top5 / top10 / 特定法人 (top10's
    type-1 rows) long, short, net and each as % of the market's OI."""
    days = sorted(raw)
    cur, prev = days[-1], (days[-2] if len(days) > 1 else None)

    def front(day):
        ms = [m for m in raw[day] if m.isdigit() and m not in ("999999", "666666")]
        return min(ms) if ms else None

    def view(day, month):
        sides = (raw.get(day) or {}).get(month) if month else None
        if not sides:
            return None
        out = {}
        for side, by in sides.items():
            a, sp = by.get("0") or {}, by.get("1") or {}
            mkt = a.get("marketOi") or 0
            pct = (lambda x: round(x / mkt * 100, 2) if mkt else None)
            grp = {}
            for name, src, key in (("top5", a, "top5"), ("top10", a, "top10"), ("specific", sp, "top10")):
                b, s = src.get(key + "Buy"), src.get(key + "Sell")
                if b is None:
                    continue
                grp[name] = {"buy": b, "sell": s, "net": b - s, "buyPct": pct(b), "sellPct": pct(s), "netPct": pct(b - s)}
            out[side] = {**grp, "marketOi": mkt}
        return out

    filters = {}
    for key, cm, pm in (("all", "999999", "999999"), ("weekly", "666666", "666666"),
                        ("front", front(cur), front(prev) if prev else None)):
        v = view(cur, cm)
        if not v:
            continue
        pv = view(prev, pm) if prev and pm else None
        for side in v:
            for name in ("top5", "top10", "specific"):
                if name in v[side]:
                    pn = ((pv or {}).get(side) or {}).get(name)
                    v[side][name]["chg"] = (v[side][name]["net"] - pn["net"]) if pn else None
        filters[key] = {"month": cm, **v}
    return {"source": "taifex", "date": cur, "prevDate": prev, "filters": filters}


async def options_positioning():
    """三大法人 TXO positions + options large traders. Each part independent; None when neither answered."""
    hit = _cache.get("optpos")
    if hit and hit[0] > time.monotonic():
        return hit[1]

    async def part(fn, shape):
        try:
            return shape(await asyncio.to_thread(fn))
        except Exception as e:
            print(f"{fn.__name__} unavailable: {e}", file=sys.stderr)
            return None

    inst, large = await asyncio.gather(part(_fetch_inst_options, _inst_options_block), part(_fetch_large_options, _large_options_block))
    if not (inst or large):
        return None
    data = {"source": "taifex", "inst": inst, "large": large,
            "date": max(x["date"] for x in (inst, large) if x)}
    _cache["optpos"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


def _tx_equiv(by_contract: dict, who) -> float:
    """Net position summed across TX / MTX / TMF in TX-equivalent contracts.
    `who` picks the 身份別 (a prefix match: 外資 also matches 外資及陸資)."""
    total = 0.0
    for name, w in TX_EQUIV.items():
        for item, net in (by_contract.get(name) or {}).items():
            if item.startswith(who):
                total += net * w
    return total


def _fetch_fut_rows(commodity: str, days: int = 8) -> list:
    """Futures daily rows for one commodity over the last `days` calendar days:
    [{date, month, session: day|night, o, h, l, c, v, settle, oi}] (outrights only)."""
    today = date.today()
    text = _fetch_csv(today - timedelta(days=days), today, url=FUT_CSV_URL, commodity=commodity)
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2 or len(rows[0]) < 2 or rows[0][1].strip() != "契約":
        raise ValueError(f"futures download for {commodity} answered without a table")
    col = {h.strip(): i for i, h in enumerate(rows[0])}
    out = []
    for r in rows[1:]:
        if len(r) < len(col) - 1 or r[col["契約"]].strip() != commodity or "/" in r[col["到期月份(週別)"]]:
            continue
        sess = {"一般": "day", "盤後": "night"}.get(r[col["交易時段"]].strip())
        if not sess:
            continue
        out.append({"date": r[col["交易日期"]].strip(), "month": r[col["到期月份(週別)"]].strip(), "session": sess,
                    **{k: _num(r[col[c]]) for k, c in (("o", "開盤價"), ("h", "最高價"), ("l", "最低價"), ("c", "收盤價"), ("settle", "結算價"))},
                    "v": int(_num(r[col["成交量"]], 0) or 0), "oi": _num(r[col["未沖銷契約數"]])})
    return out


RETAIL_CONTRACTS = (("MTX", "小型臺指期貨", "小台"), ("TMF", "微型臺指期貨", "微台"))


def _retail_block(inst: dict, fut: dict) -> dict | None:
    """散戶多空比 = (retail long − retail short) ÷ market OI, retail = the whole
    market less the three institutional categories. Since retail long = OI −
    institutional long and retail short = OI − institutional short, the
    numerator is −(institutional net), so the ratio is −Σ三大法人淨未平倉 ÷ OI.
    OI = the exchange's 未沖銷契約數 summed over every listed month (weeklies
    included) on the day-session rows."""
    out = {}
    for code, name, label in RETAIL_CONTRACTS:
        rows = fut.get(code) or []
        oi_by_day: dict = {}
        for r in rows:
            if r["session"] == "day" and r["oi"] is not None:
                oi_by_day[r["date"]] = oi_by_day.get(r["date"], 0) + int(r["oi"])
        days = [d for d in sorted(oi_by_day) if name in (inst.get(d) or {})]
        if not days:
            continue
        series = []
        for d in days:
            inst_net = sum((inst[d].get(name) or {}).values())
            series.append({"date": d, "oi": oi_by_day[d], "instNet": inst_net, "retailNet": -inst_net,
                           "ratio": round(-inst_net / oi_by_day[d] * 100, 2) if oi_by_day[d] else None})
        cur = series[-1]
        prev = series[-2] if len(series) > 1 else None
        out[code] = {**cur, "label": label, "name": name, "prevDate": prev["date"] if prev else None,
                     "prevRatio": prev["ratio"] if prev else None,
                     "chg": round(cur["ratio"] - prev["ratio"], 2) if prev and cur["ratio"] is not None and prev["ratio"] is not None else None,
                     "series": series}
    return out or None


def _sessions_block(rows: list) -> dict | None:
    """TX 日夜盤拆解 for the latest trading day D, front month (most day-session
    volume on D): the night session TAIFEX books under D (15:00 on the
    previous business day to 05:00) against the previous day session's
    settlement, then D's day session against that night close."""
    days = sorted({r["date"] for r in rows if r["session"] == "day"})
    if len(days) < 2:
        return None
    d, p = days[-1], days[-2]
    day_rows = [r for r in rows if r["date"] == d and r["session"] == "day"]
    front = max(day_rows, key=lambda r: r["v"])
    m = front["month"]
    night = next((r for r in rows if r["date"] == d and r["session"] == "night" and r["month"] == m), None)
    prev = next((r for r in rows if r["date"] == p and r["session"] == "day" and r["month"] == m), None)
    if not prev or not night or None in (night["o"], night["c"], front["o"], front["c"]):
        return None
    pick = lambda r: {k: r[k] for k in ("o", "h", "l", "c", "v")}
    ref = prev["settle"]
    return {"source": "taifex", "symbol": FUT_COMMODITY, "date": d, "prevDate": p, "month": m,
            "prevSettle": ref, "settle": front["settle"],
            "night": {**pick(night), "chg": night["c"] - ref if ref is not None else None,
                      "gap": night["o"] - ref if ref is not None else None},
            "day": {**pick(front), "chg": front["c"] - night["c"], "gap": front["o"] - night["c"],
                    "chgVsSettle": front["c"] - ref if ref is not None else None}}


def _market_blocks(pc: list | None, inst: dict | None, large: dict | None) -> dict:
    out: dict = {"source": "taifex"}
    if pc:
        cur, prev = pc[-1], (pc[-2] if len(pc) > 1 else None)
        out["pcRatio"] = {**cur, "prevRatio": prev["ratio"] if prev else None,
                          "chg": round(cur["ratio"] - prev["ratio"], 4) if prev else None,
                          "series": [{"date": x["date"], "ratio": x["ratio"], "volRatio": x["volRatio"],
                                      "putOi": x["putOi"], "callOi": x["callOi"]} for x in pc]}
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

    pc, inst, large, mtx, tmf = await asyncio.gather(part(_pc_ratio), part(_fetch_institutional), part(_fetch_large_traders),
                                                     part(lambda: _fetch_fut_rows("MTX")), part(lambda: _fetch_fut_rows("TMF")))
    if not (pc or inst or large):
        return None
    data = _market_blocks(pc, inst, large)
    if inst and (mtx or tmf):
        retail = _retail_block(inst, {"MTX": mtx, "TMF": tmf})
        if retail:
            data["retail"] = retail
    _cache["market"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


async def sessions():
    """TX 日夜盤拆解 (see _sessions_block). None when TAIFEX did not answer."""
    hit = _cache.get("sessions")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    try:
        data = _sessions_block(await asyncio.to_thread(_fetch_fut_rows, FUT_COMMODITY))
    except Exception as e:
        print(f"sessions unavailable: {e}", file=sys.stderr)
        return None
    if data:
        _cache["sessions"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


# ── Option seller margin (TAIFEX's own table and rule) ──────────────────────
# indexMarging lists 結算 / 維持 / 原始 保證金 per product, including the TXO
# 風險保證金 A / B / C values, with 更新日期 under the table. The rule that turns
# them into a short leg's margin is on margingReqIndexOpt (verified
# 2026/11/02): short call / put = 權利金市值 + MAX(A − 價外值, B), 價外值 =
# MAX((K − 標的指數) × 50, 0) for a call and MAX((標的指數 − K) × 50, 0) for a
# put; a same-expiry credit vertical = 履約價差 × 50, a debit vertical none; a
# short straddle / strangle = MAX(call margin, put margin) + the lower side's
# 權利金市值 + C. The frontend applies those rules; this only reads the values.
MARGIN_URL = "https://www.taifex.com.tw/cht/5/indexMarging"
MARGIN_ROWS = {"臺指選擇權風險保證金(A)值": "A", "臺指選擇權風險保證金(B)值": "B", "臺指選擇權風險保證金(C)值": "C", "臺股期貨": "TX"}


def _fetch_margin() -> dict:
    import re
    req = urllib.request.Request(MARGIN_URL, headers={"User-Agent": "Mozilla/5.0"})
    with _urlopen(req, timeout=40) as r:
        html = r.read().decode("utf-8", "replace")
    if "結算保證金" not in html or "原始保證金" not in html:
        raise ValueError("margin table not found")
    vals = {}
    for tr in re.findall(r"<tr>(.*?)</tr>", html, flags=re.S):
        cells = [re.sub(r"<[^>]+>|\s+", "", c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S)]
        if len(cells) == 4 and cells[0] in MARGIN_ROWS:
            nums = [_num(c) for c in cells[1:]]
            if None not in nums:
                vals[MARGIN_ROWS[cells[0]]] = {"clearing": int(nums[0]), "maintenance": int(nums[1]), "initial": int(nums[2])}
    if not all(k in vals for k in ("A", "B")):
        raise ValueError(f"TXO A / B values not found (have {sorted(vals)})")
    m = re.search(r"更新日期[：:]\s*(\d{4}/\d{1,2}/\d{1,2})", html)
    return {"source": "taifex", "url": MARGIN_URL, "date": m.group(1) if m else None, "unit": "NT$", "values": vals, "mult": 50}


async def margin():
    hit = _cache.get("margin")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    try:
        data = await asyncio.to_thread(_fetch_margin)
    except Exception as e:
        print(f"margin unavailable: {e}", file=sys.stderr)
        return None
    _cache["margin"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


# ── Final settlement prices of expired TXO contracts ───────────────────────
# optIndxFSP lists every expired contract's 最後結算日 / 契約月份 / 最後結算價
# (about the last year). The share of OI that expired worthless is measured on
# the contract's own last reported OI: the expiry day's 一般 rows in the
# options download still carry the positions held into settlement (202610F5:
# 98,551 call / 59,945 put OI on 2026/10/30, up from the session before).
FSP_URL = "https://www.taifex.com.tw/cht/5/optIndxFSP"


def _fetch_fsp() -> list:
    """[{date: 'YYYY/MM/DD', month: '202610F5', fsp}] newest first, TXO only."""
    import re
    req = urllib.request.Request(FSP_URL, headers={"User-Agent": "Mozilla/5.0"})
    with _urlopen(req, timeout=40) as r:
        html = r.read().decode("utf-8", "replace")
    out = []
    # the page writes its rows in upper case (<TR> / <TD>)
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I):
        cells = [re.sub(r"<[^>]+>|\s+", "", c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, flags=re.S | re.I)]
        if len(cells) >= 3 and re.fullmatch(r"\d{4}/\d{2}/\d{2}", cells[0]) and re.fullmatch(r"\d{6}(W\d|F\d)?", cells[1]):
            fsp = _num(cells[2])
            if fsp is not None:
                out.append({"date": cells[0], "month": cells[1], "fsp": fsp})
    if not out:
        raise ValueError("final settlement table not found")
    return out


def settlement_record(rec: dict) -> dict | None:
    """One expired contract: FSP plus the OI-weighted share of calls and puts
    that expired worthless (call K >= FSP, put K <= FSP), on the expiry day's
    reported OI. None when the options download has no rows for it."""
    d = datetime.strptime(rec["date"], "%Y/%m/%d").date()
    tbl = _parse(_fetch_csv(d, d))
    e = next((v for k, v in tbl.items() if v["month"] == rec["month"]), None)
    if not e or rec["date"] not in e["dates"]:
        return None
    strikes = e["dates"][rec["date"]]
    tot = {"call": 0, "put": 0}
    dead = {"call": 0, "put": 0}
    for k, sides in strikes.items():
        for side in ("call", "put"):
            oi = (sides.get(side) or {}).get("oi") or 0
            tot[side] += oi
            if (side == "call" and k >= rec["fsp"]) or (side == "put" and k <= rec["fsp"]):
                dead[side] += oi
    exp_id = next(k for k, v in tbl.items() if v is e)
    return {"id": exp_id, "month": rec["month"], "date": rec["date"], "fsp": rec["fsp"],
            "callOi": tot["call"], "putOi": tot["put"],
            "callWorthless": round(dead["call"] / tot["call"] * 100, 1) if tot["call"] else None,
            "putWorthless": round(dead["put"] / tot["put"] * 100, 1) if tot["put"] else None}


# ── 除息點數 per contract month (derived) ───────────────────────────────────
# TAIFEX publishes no dividend-point estimate as data (searched 2026/11/02), so
# this is derived from two exchange tables: TWSE's 除權除息預告表 (TWT48U: ex
# date and cash dividend per share) × TAIFEX's TAIEX constituent weights, with
# the previous close from TWSE's daily table:
#     points = Σ cash dividend ÷ previous close × weight × TAIEX
# summed over the constituents whose ex date falls on or before each
# contract's last trading day. Rows whose amount is still 待公告 are counted,
# not guessed; ETFs and other non-constituents drop out on the weight join.
TWSE_EXDIV_URL = "https://www.twse.com.tw/rwd/zh/exRight/TWT48U"


def _roc_date(s: str) -> str | None:
    import re
    m = re.match(r"(\d{2,3})年(\d{1,2})月(\d{1,2})日", s or "")
    return f"{int(m.group(1)) + 1911:04d}{int(m.group(2)):02d}{int(m.group(3)):02d}" if m else None


def _fetch_exdiv() -> list:
    j = _twse_json(TWSE_EXDIV_URL, {"response": "json"})
    if j.get("stat") != "OK":
        raise ValueError(f"TWT48U stat {j.get('stat')}")
    f = j.get("fields") or []
    ix = {k: i for i, k in enumerate(f)}
    out = []
    for r in j.get("data") or []:
        ex = _roc_date(str(r[ix["除權除息日期"]]))
        if not ex or "息" not in str(r[ix["除權息"]]):
            continue
        cash = _num(str(r[ix["現金股利"]]))
        out.append({"date": ex, "code": str(r[ix["股票代號"]]).strip(), "name": str(r[ix["名稱"]]).strip(), "cash": cash})
    return out


def dividend_points(weights: dict, daily: dict, exdiv: list, index_px: float, expiries: list, asof: str) -> dict:
    w = {r["code"]: r for r in weights["rows"]}
    items, pending = [], []
    for x in exdiv:
        if x["date"] <= asof or x["code"] not in w:
            continue
        if not x["cash"]:
            pending.append({"date": x["date"], "code": x["code"], "name": x["name"]})
            continue
        close = (daily["stocks"].get(x["code"]) or {}).get("close")
        if not close:
            pending.append({"date": x["date"], "code": x["code"], "name": x["name"]})
            continue
        pts = x["cash"] / close * w[x["code"]]["weight"] / 100 * index_px
        items.append({**x, "close": close, "weight": w[x["code"]]["weight"], "points": round(pts, 2)})
    items.sort(key=lambda x: x["date"])
    by_month = []
    for e in expiries:
        by_month.append({"id": e["id"], "label": e["label"], "month": e["month"],
                         "points": round(sum(i["points"] for i in items if i["date"] <= e["id"]), 2),
                         "pending": sum(1 for i in pending if i["date"] <= e["id"])})
    return {"source": "twse+taifex", "method": "cash / prevClose x weight x TAIEX", "asOf": asof,
            "weightsDate": weights.get("date"), "closeDate": daily.get("date"), "index": index_px,
            "items": items, "pending": pending, "byExpiry": by_month}


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
    with _urlopen(req, timeout=40) as r:
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
                with _urlopen(req, timeout=40) as r:
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
    if w and q:
        _cache["twse_raw"] = (time.monotonic() + CACHE_TTL_S, (w, q))  # reused by dividend points
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


# ── 台股籌碼日報 (TWSE) ─────────────────────────────────────────────────────
# Two after-close tables from the stock exchange, same idiom as the TAIFEX
# positioning block: 三大法人 net buy / sell by category (NT$) and the margin
# balances (融資 / 融券) with the change vs the previous session. TWSE answers
# bursts with a 307 to a "too many requests" page, so every request retries
# with a pause, and a non-trading date steps back.

def _twse_json(url: str, params: dict, tries: int = 3):
    q = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(q, headers={"User-Agent": "Mozilla/5.0"})
    last_err = None
    for attempt in range(tries):
        try:
            with _urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # 307 / network / JSON
            last_err = e
            time.sleep(3.0 * (attempt + 1))
    raise last_err or ValueError("TWSE unavailable")


def _fetch_twse_flows(days_back: int = 7) -> dict:
    """{date, institutional: [{name, buy, sell, net}] (NT$), margin: {...}} for the latest trading day."""
    for back in range(days_back):
        d = date.today() - timedelta(days=back)
        if d.weekday() >= 5:
            continue
        ds = d.strftime("%Y%m%d")
        inst = _twse_json(TWSE_INST_URL, {"response": "json", "dayDate": ds, "type": "day"})
        if inst.get("stat") != "OK":
            time.sleep(1.5)
            continue
        rows = []
        for r in inst.get("data") or []:
            try:
                rows.append({"name": str(r[0]).strip(), "buy": int(_num(str(r[1]).replace(",", ""), 0) or 0),
                             "sell": int(_num(str(r[2]).replace(",", ""), 0) or 0), "net": int(_num(str(r[3]).replace(",", ""), 0) or 0)})
            except (IndexError, ValueError):
                continue
        time.sleep(2.0)
        margin = None
        try:
            mj = _twse_json(TWSE_MARGIN_URL, {"response": "json", "date": ds, "selectType": "MS"})
            for t in mj.get("tables") or []:
                f = t.get("fields") or []
                if "項目" not in f or "今日餘額" not in f:
                    continue
                ix = {k: f.index(k) for k in f}
                margin = {}
                for r in t.get("data") or []:
                    key = str(r[ix["項目"]]).strip()
                    margin[key] = {"prev": int(_num(str(r[ix["前日餘額"]]).replace(",", ""), 0) or 0),
                                   "today": int(_num(str(r[ix["今日餘額"]]).replace(",", ""), 0) or 0)}
        except Exception:
            margin = None
        return {"source": "twse", "date": ds, "institutional": rows, "margin": margin}
    raise ValueError("TWSE daily tables unavailable")


async def twse_daily():
    hit = _cache.get("twse")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    try:
        data = await asyncio.to_thread(_fetch_twse_flows)
    except Exception:
        return None
    _cache["twse"] = (time.monotonic() + CACHE_TTL_S, data)
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
    with _urlopen(req, timeout=120) as r:
        raw = r.read()
    return raw if raw[:2] == b"PK" else None


def _parse_ticks(raw_zip: bytes, symbol: str = FUT_COMMODITY) -> dict:
    """Front-month ticks of `symbol` from the archive: {date, month,
    day: [(hhmmss, price, lots)], night: [...]} — the day session of the file's
    trading date and the night session booked before it, which runs 15:00 to
    05:00: its ticks before midnight carry the previous calendar day's date
    and those after midnight carry the trading date itself, so an hour before
    08:45 on the trading date is night, not day. Lots = 成交數量(B+S) / 2.
    Front month = the outright month with the most day-session lots."""
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
    night = sorted((r for r in rows if r[1] == month and (r[0] != trade_date or r[2] < "084500")),
                   key=lambda r: (r[0], r[2]))  # stable: same-second trades keep file order
    night = [(r[2], r[3], r[4]) for r in night]
    return {"date": trade_date, "month": month, "day": day, "night": night}


def _volume_profile(ticks: list) -> dict | None:
    """Market-Profile style levels of one session from its ticks: poc = the
    price with the most lots, vah / val = the bounds of the value area (the
    contiguous band around the POC holding 70% of the session's lots, grown
    one adjacent price at a time toward the larger neighbour), vwap = the
    lots-weighted average price."""
    if not ticks:
        return None
    by_px: dict = {}
    total = 0
    pv = 0.0
    for _, px, q in ticks:
        by_px[px] = by_px.get(px, 0) + q
        total += q
        pv += px * q
    if total <= 0:
        return None
    prices = sorted(by_px)
    poc = max(prices, key=lambda x: (by_px[x], -abs(x - pv / total)))
    lo = hi = prices.index(poc)
    cum = by_px[poc]
    while cum < 0.7 * total and (lo > 0 or hi < len(prices) - 1):
        up = by_px[prices[hi + 1]] if hi < len(prices) - 1 else -1
        dn = by_px[prices[lo - 1]] if lo > 0 else -1
        if up >= dn:
            hi += 1
            cum += up
        else:
            lo -= 1
            cum += dn
    return {"poc": poc, "vah": prices[hi], "val": prices[lo], "vwap": round(pv / total, 1), "lots": total}


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
            "buy": buy, "sell": sell, "net": buy - sell, "profile": _volume_profile(ticks)}


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
    with _urlopen(req, timeout=TIMEOUT_S) as r:
        rows = (json.loads(_decode(r.read())).get("RtData") or {}).get("QuoteList") or []
    idx = next(r for r in rows if r.get("SymbolID") == "TXF-S")
    fut = next((r for r in rows if str(r.get("SymbolID", "")).endswith("-F")), None)

    def _quote(row):
        """(price, ref). Outside session hours the list rolls to the next
        business day with every live field blank and CRefPrice holding the
        session that just closed, so a blank price falls back to that close
        and `ref` goes unknown rather than inventing a zero change."""
        last, ref = _num(row.get("CLastPrice")), _num(row.get("CRefPrice"))
        return (last, ref) if last is not None else (ref, None)

    price, ref = _quote(idx)
    if price is None:
        raise ValueError("TAIFEX quote list carried no index price")
    fut_px, fut_ref = _quote(fut) if fut else (None, None)
    return {
        "price": price, "ref": ref,
        "date": idx.get("CDate", ""), "time": idx.get("CTime", ""),
        "futures": {"name": fut.get("DispCName"), "price": fut_px, "ref": fut_ref,
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
        try:
            sessions.update(_parse_bars(_fetch_csv(start, end, url=FUT_CSV_URL, commodity=FUT_COMMODITY)))
        except (KeyError, ValueError):
            # a window the download refuses (the site answers an error page far
            # enough back) ends the walk; everything newer is kept
            break
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


def _fetch_proxy_json(base: str, path: str):
    """One GET against a running server/main.py — for the blocks only its IB session can fill."""
    req = urllib.request.Request(base.rstrip("/") + path, headers={"Accept": "application/json"})
    with _urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _parity_forward(cur: dict, spot: float, t_years: float, r: float) -> float | None:
    """The forward this expiry's options actually price against, recovered from
    put-call parity on the settlement premiums: F = K + (C - P) * e^(rT).

    One futures price cannot serve the whole board. TXO settles on the index,
    and each expiry's forward is the index less the dividends still to be paid
    before it -- Taiwan's ex-dividend season runs through the summer, so the
    near weeks sit below the index and the far month sits above the front
    future. On 2026/09/14 parity implied 45,780 for 9/16 (the front TX future
    to 0.3 of a point) but 45,922 for 10/21, and inverting the October chain
    against the front future split the same strike into a 28.1% call and a
    25.3% put. Per-expiry forwards closed that 2.76-point gap to 0.34.

    Corroborated by the exchange's own futures board, which lists a separate
    contract per month: on the same session TAIFEX quoted 臺指期096 at 45,777
    and 臺指期106 at 45,903, against parity forwards of 45,781 and 45,911.

    Median over the near-the-money strikes, so one stale settlement cannot move
    it. None when too few strikes price both sides, or when the answer is too
    far from the front future to be a forward -- the caller falls back to spot.
    """
    fs = []
    for k, sides in cur.items():
        c, p = (sides.get("call") or {}).get("settle"), (sides.get("put") or {}).get("settle")
        if c is None or p is None or abs(k - spot) / spot > 0.02:
            continue
        fs.append(k + (c - p) * math.exp(r * t_years))
    if len(fs) < 5:
        return None
    f = statistics.median(fs)
    return f if abs(f - spot) / spot <= 0.05 else None


async def build_snapshot(product_id: str = "txo", n_expiries: int = 5, strike_pct: float = 0.08, proxy: str | None = None):
    """The previous session as the frontend consumes it. None if TAIFEX is down.
    `proxy` = a running server/main.py whose IB session supplies the 盤前脈絡 block."""
    import pricing  # shared with the live sources so IV is inverted identically

    tbl = await table()
    if tbl is None:
        return None
    idx = await asyncio.to_thread(_fetch_index)
    bars = await asyncio.to_thread(_fetch_bars, 400)  # ~a year of sessions: the 關鍵價位 hit rates need the history
    mkt = await market()
    t20 = await top20()
    twse = await twse_daily()
    premarket = None
    if proxy:
        try:
            premarket = await asyncio.to_thread(_fetch_proxy_json, proxy, f"/api/premarket/{product_id}")
        except Exception as e:
            print(f"premarket from {proxy} unavailable: {e}", file=sys.stderr)
    intra = None
    try:
        intra = await intraday()
    except Exception:
        intra = None
    optpos = await options_positioning()
    mrg = await margin()
    sess = await sessions()
    # TXO is priced off the TX future, not the index. Put-call parity on the
    # 2026/09/14 chain implies a forward of 45,780.6 against a futures
    # settlement of 45,780.0 and an index of 45,862.5 — the options quote the
    # future to within a point. Inverting IV against the index made the same
    # strike read 22.14% on the call and 28.07% on the put; against the future
    # both read 25.1%, as put-call parity requires. The 82-point gap is the
    # dividend basis, which a flat 1.5% Black-Scholes carry cannot represent.
    data_date = max(d for e in tbl.values() for d in e["dates"])          # yyyy/mm/dd
    asof = data_date.replace("/", "")
    asof_d = datetime.strptime(asof, "%Y%m%d").date()
    fut = idx.get("futures") or {}
    day_bars = bars["day"] or []
    # The live quote counts only while it describes this session; once the
    # quote list rolls it carries the settlement price, which sits a few points
    # off the day session's close. The close is what the K-line draws and what
    # the 關卡價 and 成本線 are measured from, so the headline follows it.
    live = _num(fut.get("price")) if idx["date"] == asof else None
    bar_close = day_bars[-1]["c"] if day_bars and day_bars[-1]["t"] == asof else None
    spot = live or bar_close or _num(fut.get("price")) or _num(fut.get("settle")) or idx["price"]
    # Reference = the future's previous close, so the headline change is the
    # future's own move rather than the index's.
    spot_ref = day_bars[-2]["c"] if len(day_bars) >= 2 else None

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
        # Each expiry prices against its own forward, not the front future.
        fwd = _parity_forward(cur, spot, t_years, RISK_FREE_TW) or spot
        rows = []
        for r in summ["rows"]:
            k = r["strike"]
            if abs(k - spot) / spot > strike_pct:
                continue
            row = {"strike": k, "atm": False, "itmCall": k < fwd, "itmPut": k > fwd}
            for side, right in (("call", "C"), ("put", "P")):
                raw = cur.get(k, {}).get(side, {})
                last = raw.get("close") if raw.get("close") is not None else (raw.get("settle") or 0.0)
                bid, ask = raw.get("bid"), raw.get("ask")
                # IV comes off 結算價, not the bid-ask mid. TAIFEX's last best
                # bid / ask at 13:30 is frequently one-sided on a thin strike
                # (530 / 1000 on a 500-point option), and a mid taken from that
                # lifts the whole smile: on 2026/09/11 the mid gave 32% and 34%
                # at two strikes whose neighbours sat at 22%. 結算價 is the
                # exchange's own mark, published for every strike whether or not
                # it traded, and inverting it made the smile 15x smoother
                # (mean |2nd difference| 7.57 -> 0.52 over the ATM +/- 500 band).
                mark = raw.get("settle") if raw.get("settle") is not None else last
                iv = pricing.implied_vol(right, fwd, k, mark, t_years, RISK_FREE_TW, "b76") or 0.0
                delta = pricing.delta(right, fwd, k, max(iv, 1e-4), t_years, RISK_FREE_TW, "b76")
                row[side] = {"bid": bid or 0.0, "ask": ask or 0.0, "last": last,
                             "iv": round(iv * 100, 2), "oi": r[side]["oi"], "oiChg": r[side]["oiChg"],
                             "vol": r[side]["vol"], "delta": round(delta, 4)}
            rows.append(row)
        if rows:
            min(rows, key=lambda x: abs(x["strike"] - fwd))["atm"] = True
        # `forward` is context only: the frontend must not adopt it as spot, or
        # picking a far expiry would drag the headline off the front TX future
        # the K-line and the 關卡價 run on.
        chains[e] = {"rows": rows, "forward": round(fwd, 1)}
        oi[e] = {k: v for k, v in summ.items() if k != "rows"}
        # compact: [strike, callOi, callOiChg, callSettle, callPrevSettle, putOi, putOiChg, putSettle, putPrevSettle]
        # prevSettle = the session before the snapshot's own premiums, so the
        # straddle's "vs prev settle" reading stays a one-session change.
        prev = tbl[e]["dates"].get(summ["prevDate"], {}) if summ["prevDate"] else {}
        oi[e]["rows"] = [[r["strike"],
                          r["call"]["oi"], r["call"]["oiChg"], r["call"]["settle"], prev.get(r["strike"], {}).get("call", {}).get("settle"),
                          r["put"]["oi"], r["put"]["oiChg"], r["put"]["settle"], prev.get(r["strike"], {}).get("put", {}).get("settle")]
                         for r in summ["rows"]]

    term = term_structure(tbl, data_date, spot, asof_d)
    divs = await dividends(idx.get("price"))

    return {
        "product": product_id, "source": "taifex-eod",
        "date": data_date, "prevDate": next(iter(oi.values()))["prevDate"] if oi else None,
        "asOf": asof, "builtAt": datetime.now().isoformat(timespec="seconds"),
        # `spot` is what everything prices against — the front TX future.
        # The index it settles on is kept alongside as context.
        # The quote list rolls to the next business day once the session ends,
        # so its date/time only describe this price while they still match the
        # session the chain came from.
        "spot": {"price": spot, "ref": spot_ref, "base": "futures",
                 "date": idx["date"] if idx["date"] == asof else asof,
                 "time": idx["time"] if idx["date"] == asof else None},
        "index": {"price": idx["price"], "ref": idx["ref"]},
        "futures": idx["futures"],
        "expiries": expiries, "chains": chains, "oi": oi,
        "bars": bars["day"], "barsFull": bars["full"],
        "market": mkt,
        "top20": t20,
        "twse": twse,
        "premarket": premarket,
        "intraday": intra,
        "optPositions": optpos,
        "margin": mrg,
        "sessions": sess,
        "term": term,
        "dividends": divs,
    }


async def dividends(index_px: float | None = None):
    """除息點數 per listed contract (see dividend_points). None when TWSE's
    schedule, the weights, the daily closes or the index did not answer."""
    hit = _cache.get("dividends")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    tbl = await table()
    if tbl is None or await top20() is None or not _cache.get("twse_raw"):
        return None
    try:
        if index_px is None:
            index_px = (await asyncio.to_thread(_fetch_index))["price"]
        asof = max(d for e in tbl.values() for d in e["dates"]).replace("/", "")
        w, q = _cache["twse_raw"][1]
        data = dividend_points(w, q, await asyncio.to_thread(_fetch_exdiv), index_px, term_expiries(tbl, asof), asof)
    except Exception as e:
        print(f"dividend points unavailable: {e}", file=sys.stderr)
        return None
    _cache["dividends"] = (time.monotonic() + CACHE_TTL_S, data)
    return data


def term_expiries(tbl: dict, asof: str) -> list:
    """Every listed expiry after `asof` with the strip's label vocabulary."""
    out = []
    for e in sorted(x for x in tbl if x > asof):
        label, _ = _expiry_label(tbl[e]["month"], e)
        out.append({"id": e, "label": label, "month": tbl[e]["month"]})
    return out


# ── Daily history (taifex-history.js) ────────────────────────────────────────
# The snapshot holds one session; the history file keeps what a single
# session cannot show: P/C and 外資 net by date, per-expiry max pain / walls /
# ATM IV, the 30-day constant-maturity IV, per-strike OI for the last few
# sessions and every expired contract's final settlement. `--history PATH`
# merges the new snapshot into it on each run; server/history_backfill.py
# rebuilt the start of it from the git history of taifex-eod.js.

HISTORY_OI_SESSIONS = 8
HISTORY_OI_EXPIRIES = 3
HISTORY_OI_BAND = 0.06      # strikes within ±6% of spot
HISTORY_SETTLE_FROM = "2026/08/01"


def max_pain(rows: list) -> float | None:
    """rows [(strike, callOi, putOi)] ascending. Same definition as the
    frontend's computeLevels: the strike minimising Σ call OI·max(0, S−K) +
    Σ put OI·max(0, K−S); ties keep the lower strike."""
    best = None
    for k, _, _ in rows:
        pain = sum(c * (k - ki) for ki, c, _ in rows if k > ki) + sum(p * (ki - k) for ki, _, p in rows if k < ki)
        if best is None or pain < best[1]:
            best = (k, pain)
    return best[0] if best and best[1] > 0 else None


def term_structure(tbl: dict, data_date: str, spot: float, asof_d: date, r: float = RISK_FREE_TW) -> list:
    """ATM IV of every listed expiry, inverted from 結算價 against that expiry's
    parity forward — the same inputs as the chains, but for the whole board,
    so the 30-day point can usually be bracketed by the monthly contracts."""
    import pricing
    out = []
    for e in sorted(tbl):
        cur = tbl[e]["dates"].get(data_date)
        if not cur or e <= asof_d.strftime("%Y%m%d"):
            continue
        dte = (datetime.strptime(e, "%Y%m%d").date() - asof_d).days
        t = max(dte, 0.5) / 365.0
        fwd = _parity_forward(cur, spot, t, r)
        if fwd is None:
            continue
        k = min(cur, key=lambda x: abs(x - fwd))
        ivs = []
        for side, right in (("call", "C"), ("put", "P")):
            st = (cur[k].get(side) or {}).get("settle")
            if st:
                iv = pricing.implied_vol(right, fwd, k, st, t, r, "b76")
                if iv:
                    ivs.append(iv)
        if ivs:
            out.append({"id": e, "month": tbl[e]["month"], "dte": dte, "fwd": round(fwd, 1), "atmK": k,
                        "iv": round(sum(ivs) / len(ivs) * 100, 2)})
    return out


def cm30(term: list) -> dict | None:
    """30-calendar-day constant-maturity ATM IV: total variance σ²·t linear in t
    between the listed expiries that bracket 30 days. None (with no guess)
    when nothing listed reaches past 30 days or nothing is inside it."""
    lo = [x for x in term if x["dte"] <= 30]
    hi = [x for x in term if x["dte"] >= 30]
    if not lo or not hi:
        return None
    a, b = max(lo, key=lambda x: x["dte"]), min(hi, key=lambda x: x["dte"])
    if a["id"] == b["id"]:
        return {"iv": a["iv"], "pair": [a["id"], b["id"]]}
    wa, wb = (a["iv"] / 100) ** 2 * a["dte"], (b["iv"] / 100) ** 2 * b["dte"]
    w = wa + (wb - wa) * (30 - a["dte"]) / (b["dte"] - a["dte"])
    return {"iv": round(math.sqrt(w / 30) * 100, 2), "pair": [a["id"], b["id"]]}


def history_day(snap: dict) -> dict:
    """The per-session record the history keeps, from one snapshot."""
    spot = snap["spot"]["price"]
    exp = []
    for e in snap.get("expiries") or []:
        o = (snap.get("oi") or {}).get(e["id"])
        if not o:
            continue
        rows = sorted((r[0], r[1] or 0, r[5] or 0) for r in o["rows"])
        ch = (snap.get("chains") or {}).get(e["id"]) or {}
        atm = next((r for r in ch.get("rows") or [] if r.get("atm")), None)
        iv = None
        if atm and atm["call"].get("iv") and atm["put"].get("iv"):
            iv = round((atm["call"]["iv"] + atm["put"]["iv"]) / 2, 2)
        cw = max(rows, key=lambda r: r[1]) if rows else None
        pw = max(rows, key=lambda r: r[2]) if rows else None
        exp.append({"id": e["id"], "label": e["label"], "mp": max_pain(rows),
                    "cw": cw[0] if cw and cw[1] else None, "pw": pw[0] if pw and pw[2] else None,
                    "iv": iv, "fwd": ch.get("forward")})
    rec = {"date": snap["date"], "spot": spot, "exp": exp}
    term = snap.get("term")
    if term:
        rec["term"] = [[x["id"], x["dte"], x["iv"]] for x in term]
        c = cm30(term)
        rec["cm30"] = c["iv"] if c else None
        rec["cm30Pair"] = c["pair"] if c else None
    return rec


def history_oi(snap: dict) -> dict:
    spot = snap["spot"]["price"]
    out = {}
    for e in (snap.get("expiries") or [])[:HISTORY_OI_EXPIRIES]:
        o = (snap.get("oi") or {}).get(e["id"])
        if o:
            out[e["id"]] = [[r[0], r[1] or 0, r[5] or 0] for r in sorted(o["rows"]) if abs(r[0] - spot) / spot <= HISTORY_OI_BAND]
    return out


def history_oi_from_table(h: dict, tbl: dict, snap: dict) -> dict:
    """Per-strike OI for every session the options download holds (about a
    week), for the snapshot's near expiries — fills sessions no snapshot was
    committed for. The download is the source of the snapshot's own OI, so
    the overlapping sessions read the same."""
    spot = snap["spot"]["price"]
    oi = dict(h.get("oi", {}))
    for e in (snap.get("expiries") or [])[:HISTORY_OI_EXPIRIES]:
        for d, strikes in (tbl.get(e["id"]) or {}).get("dates", {}).items():
            oi.setdefault(d, {})[e["id"]] = [[k, (v.get("call") or {}).get("oi", 0), (v.get("put") or {}).get("oi", 0)]
                                             for k, v in sorted(strikes.items()) if abs(k - spot) / spot <= HISTORY_OI_BAND]
    h["oi"] = {d: oi[d] for d in sorted(oi)[-HISTORY_OI_SESSIONS:]}
    return h


def history_merge(h: dict | None, snap: dict) -> dict:
    """Fold one snapshot into the history. Later snapshots of the same session
    replace earlier ones; nothing older is rewritten except by its own date."""
    h = h or {}
    h.setdefault("version", 1)
    days = {d["date"]: d for d in h.get("days", [])}
    days[snap["date"]] = history_day(snap)
    h["days"] = [days[d] for d in sorted(days)]
    mk = snap.get("market") or {}
    pc = {r[0]: r for r in h.get("pc", [])}
    pcr = mk.get("pcRatio")
    if pcr:
        for x in pcr.get("series") or []:
            if "volRatio" in x:
                pc[x["date"]] = [x["date"], x["ratio"], x["volRatio"], x.get("putOi"), x.get("callOi")]
            elif x["date"] not in pc:
                pc[x["date"]] = [x["date"], x["ratio"], None, None, None]
        pc[pcr["date"]] = [pcr["date"], pcr["ratio"], pcr.get("volRatio"), pcr.get("putOi"), pcr.get("callOi")]
    h["pc"] = [pc[d] for d in sorted(pc)]
    fx = {r[0]: r for r in h.get("fx", [])}
    f = mk.get("foreign")
    if f:
        fx[f["date"]] = [f["date"], f["net"]]
        if f.get("prevDate") and f.get("prevNet") is not None and f["prevDate"] not in fx:
            fx[f["prevDate"]] = [f["prevDate"], f["prevNet"]]
    h["fx"] = [fx[d] for d in sorted(fx)]
    oi = dict(h.get("oi", {}))
    oi[snap["date"]] = history_oi(snap)
    h["oi"] = {d: oi[d] for d in sorted(oi)[-HISTORY_OI_SESSIONS:]}
    h["settle"] = sorted(h.get("settle", []), key=lambda x: x["date"])
    h["from"] = h["days"][0]["date"] if h["days"] else None
    h["to"] = h["days"][-1]["date"] if h["days"] else None
    return h


def history_settlements(h: dict) -> dict:
    """Add every expired contract on TAIFEX's final-settlement list (since
    HISTORY_SETTLE_FROM) that the history lacks. A contract whose download
    fails is left for the next run."""
    have = {x["month"] for x in h.get("settle", [])}
    try:
        fsp = _fetch_fsp()
    except Exception as e:
        print(f"final settlement list unavailable: {e}", file=sys.stderr)
        return h
    new = []
    for rec in fsp:
        if rec["date"] < HISTORY_SETTLE_FROM or rec["month"] in have:
            continue
        try:
            r = settlement_record(rec)
        except Exception as e:
            print(f"settlement {rec['month']} unavailable: {e}", file=sys.stderr)
            r = None
        if r:
            new.append(r)
        time.sleep(0.5)
    h["settle"] = sorted(h.get("settle", []) + new, key=lambda x: x["date"])
    return h


def read_history(path: str) -> dict | None:
    try:
        text = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        return None
    return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))


def write_history(path: str, h: dict) -> int:
    h.pop("builtAt", None)  # no timestamp: a run that adds nothing leaves the file byte-identical
    text = ("// Generated by server/taifex.py --history: TAIFEX daily history for the deployed app.\n"
            "// Do not edit; each run merges the new session in.\n"
            "window.TAIFEX_HISTORY = " + json.dumps(h, separators=(",", ":")) + ";\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return len(text)


# ── 1-minute archive ────────────────────────────────────────────────────────
# TAIFEX keeps its tick files for about two weeks, so an intraday history — the
# only way to test whether a level stops price within the session, which daily
# bars cannot show — has to be collected day by day. The daily workflow runs:
#
#     python3 taifex.py --archive-minutes ../data/tx-1m

def archive_minutes(out_dir: str, days_back: int = 20) -> list:
    """TX front-month 1-minute bars for every tick file the exchange still serves
    that out_dir lacks, one CSV per trading date (out_dir/YYYY/YYYYMMDD.csv):
    session (night = the session booked before that day, day = 08:45-13:45),
    time (hhmm, the bar's minute), month, open, high, low, close, lots.
    Returns the dates written."""
    written = []
    for back in range(days_back):
        d = date.today() - timedelta(days=back)
        path = os.path.join(out_dir, f"{d:%Y}", f"{d:%Y%m%d}.csv")
        if d.weekday() >= 5 or os.path.exists(path):
            continue
        try:
            raw = _fetch_tick_zip(d)
        except Exception:
            raw = None
        if raw is None:
            continue
        p = _parse_ticks(raw)
        if p["date"] != f"{d:%Y%m%d}":
            raise ValueError(f"{d}: tick file holds trading date {p['date']}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", newline="", encoding="ascii") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(["session", "time", "month", "open", "high", "low", "close", "lots"])
            for session in ("night", "day"):
                for b in _minute_series(p[session])["bars"] if p[session] else []:
                    w.writerow([session, b[0], p["month"], *(f"{x:.10g}" for x in b[1:5]), b[5]])
        written.append(p["date"])
    return written


def main(argv):
    if "--archive-minutes" in argv:
        i = argv.index("--archive-minutes")
        if i + 1 >= len(argv) or argv[i + 1].startswith("--"):
            print("usage: taifex.py --archive-minutes DIR", file=sys.stderr)
            return 2
        try:  # before any download: a tick file is tens of MB
            os.makedirs(argv[i + 1], exist_ok=True)
        except OSError as e:
            print(f"cannot create {argv[i + 1]}: {e}", file=sys.stderr)
            return 2
        written = archive_minutes(argv[i + 1])
        print("archived", written or "nothing new")
        return 0
    out = None
    if "--write" in argv:
        out = argv[argv.index("--write") + 1]
    proxy = argv[argv.index("--proxy") + 1] if "--proxy" in argv else None
    snap = asyncio.run(build_snapshot(proxy=proxy))
    if snap is None:
        print("TAIFEX unreachable — nothing written", file=sys.stderr)
        return 1
    text = ("// Generated by server/taifex.py --write: TAIFEX previous-session snapshot for the\n"
            "// deployed app (no local proxy needed). Do not edit; rebuild once per trading day.\n"
            "window.TAIFEX_EOD = " + json.dumps(snap, separators=(",", ":")) + ";\n")  # ASCII-safe: no charset dependence
    print(f"snapshot {snap['date']} (prev {snap['prevDate']}) spot {snap['spot']['price']} "
          f"expiries {[e['id'] for e in snap['expiries']]} chain rows {[len(c['rows']) for c in snap['chains'].values()]} "
          f"bars {len(snap['bars'])} day / {len(snap['barsFull'])} full; market {sorted((snap['market'] or {}).keys())}; "
          f"top20 {len((snap.get('top20') or {}).get('rows') or [])} rows; twse {(snap.get('twse') or {}).get('date')}; "
          f"premarket {len((snap.get('premarket') or {}).get('rows') or [])} rows; "
          f"intraday {((snap.get('intraday') or {}).get('date'))} {len(((snap.get('intraday') or {}).get('day') or {}).get('bars') or [])} min -> {len(text) // 1024} KB")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", out)
    if "--history" in argv:
        hpath = argv[argv.index("--history") + 1]
        h = history_merge(read_history(hpath), snap)
        if _cache.get("table"):
            h = history_oi_from_table(h, _cache["table"][1], snap)
        h = history_settlements(h)
        n = write_history(hpath, h)
        print(f"history {h['from']} -> {h['to']}: {len(h['days'])} days, pc {len(h['pc'])}, fx {len(h['fx'])}, "
              f"oi {len(h['oi'])} sessions, settle {len(h['settle'])} -> {n // 1024} KB; wrote {hpath}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
