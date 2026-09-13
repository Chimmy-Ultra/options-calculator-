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
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

CSV_URL = "https://www.taifex.com.tw/cht/3/dlOptDataDown"
COMMODITY = "TXO"
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


def _fetch_csv(start: date, end: date) -> str:
    form = urllib.parse.urlencode({
        "down_type": "1", "commodity_id": COMMODITY,
        "queryStartDate": start.strftime("%Y/%m/%d"),
        "queryEndDate": end.strftime("%Y/%m/%d"),
    }).encode()
    req = urllib.request.Request(CSV_URL, data=form, headers={"User-Agent": "options-lab/1"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        raw = r.read()
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
    need = ("交易日期", "契約", "到期月份(週別)", "履約價", "買賣權", "收盤價", "成交量", "結算價", "未沖銷契約數", "交易時段", "契約到期日")
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
    empty = {"oi": 0, "vol": 0, "settle": None, "close": None}
    rows = []
    for k in sorted(cur):
        row = {"strike": k}
        for side in ("call", "put"):
            s = cur[k].get(side, empty)
            p = old.get(k, {}).get(side, empty)
            row[side] = {**s, "oiChg": s["oi"] - p["oi"]}
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
