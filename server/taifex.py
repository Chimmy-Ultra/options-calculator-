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
    """Futures CSV → {YYYYMMDD: bar} for the front month (the day-session row
    with the most volume on each date)."""
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        return {}
    col = {h.strip(): i for i, h in enumerate(rows[0])}
    out: dict = {}
    for r in rows[1:]:
        if len(r) < len(col) - 1 or r[col["契約"]].strip() != FUT_COMMODITY or r[col["交易時段"]].strip() != "一般":
            continue
        o, h, l, c = (_num(r[col[k]]) for k in ("開盤價", "最高價", "最低價", "收盤價"))
        v = int(_num(r[col["成交量"]], 0) or 0)
        if None in (o, h, l, c):
            continue
        t = r[col["交易日期"]].strip().replace("/", "")
        if t not in out or v > out[t]["v"]:
            out[t] = {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}
    return out


def _fetch_bars(days: int = 90) -> list:
    """Real TX daily bars for the last `days` calendar days (30-day windows —
    the download's limit per request), oldest first."""
    today = date.today()
    bars: dict = {}
    end = today
    while (today - end).days < days:
        start = end - timedelta(days=29)
        bars.update(_parse_bars(_fetch_csv(start, end, url=FUT_CSV_URL, commodity=FUT_COMMODITY)))
        end = start - timedelta(days=1)
    return [bars[t] for t in sorted(bars)]


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
        "expiries": expiries, "chains": chains, "oi": oi, "bars": bars,
    }


def main(argv):
    out = None
    if "--write" in argv:
        out = argv[argv.index("--write") + 1]
    snap = asyncio.run(build_snapshot())
    if snap is None:
        print("TAIFEX unreachable — nothing written", file=sys.stderr)
        return 1
    text = ("// Generated by server/taifex.py --write — TAIFEX previous-session snapshot for the\n"
            "// deployed app (no local proxy needed). Do not edit; rebuild once per trading day.\n"
            "window.TAIFEX_EOD = " + json.dumps(snap, separators=(",", ":")) + ";\n")  # ASCII-safe: no charset dependence
    print(f"snapshot {snap['date']} (prev {snap['prevDate']}) spot {snap['spot']['price']} "
          f"expiries {[e['id'] for e in snap['expiries']]} chain rows {[len(c['rows']) for c in snap['chains'].values()]} "
          f"bars {len(snap['bars'])} → {len(text) // 1024} KB")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
