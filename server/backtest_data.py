"""Multi-year daily history for the frontend's strategy backtester.

    python3 backtest_data.py --write  PATH   # full rebuild from 2020/01/01
    python3 backtest_data.py --update PATH   # refetch the last ~15 calendar days

Writes window.BT_DATA (see PATH's header) with four series, oldest first, one
row per trading day:

  bars   [date, o, h, l, c, v]  TX day session (一般), front month = the outright
                                month with the most day-session volume that day
                                (spreads and weeklies excluded)
  pc     [date, ratio]          TXO put/call OI ratio as a decimal (pcRatioDown)
  fx     [date, net]            外資 net OI in TX equivalents, TX + MTX/4 + TMF/20
                                (taifex._tx_equiv, the market.foreign definition)
  retail [date, pct]            小台散戶多空比 %, −Σ三大法人 net ÷ MTX OI × 100
                                (taifex._retail_block's definition)

TAIFEX's institutional download (futContractsDateDown, and the per-day HTML
page behind it) only serves a rolling three years — on 2026/11/04 it refused
anything before 2023/11/04 with "日期時間錯誤" — so fx and retail start there
while bars and pc go back to 2020. Both modes merge into an existing file by
date (new rows win), so a later full rebuild keeps the older institutional
rows the exchange no longer serves.
"""
import json
import sys
import time
from datetime import date, datetime, timedelta

import taifex as tx

FROM = date(2020, 1, 1)
UPDATE_DAYS = 15
PAUSE_S = 1.0
INST_CHUNK_DAYS = 90     # the institutional download serves four months+ per request
SERIES = ("bars", "pc", "fx", "retail")


def _d(s: str) -> date:
    return datetime.strptime(s, "%Y/%m/%d").date()


def _num(x):
    """Prices as ints where they are whole numbers (TX always is), keeping the file small."""
    return int(x) if x is not None and float(x).is_integer() else x


def _chunks(start: date, end: date, days: int):
    while start <= end:
        e = min(start + timedelta(days=days - 1), end)
        yield start, e
        start = e + timedelta(days=1)


def fut_rows(commodity: str, start: date, end: date) -> list:
    """taifex._parse_fut_rows over [start, end] in 30-day requests (the download's limit)."""
    out = []
    for s, e in _chunks(start, end, 30):
        out += tx._parse_fut_rows(tx._fetch_csv(s, e, url=tx.FUT_CSV_URL, commodity=commodity), commodity)
        time.sleep(PAUSE_S)
    return out


def bar_rows(rows: list) -> list:
    """Day-session front month per date: the 6-digit (outright, non-weekly) month with the most volume."""
    best: dict = {}
    for r in rows:
        if r["session"] != "day" or not (len(r["month"]) == 6 and r["month"].isdigit()):
            continue
        if None in (r["o"], r["h"], r["l"], r["c"]):
            continue
        if r["date"] not in best or r["v"] > best[r["date"]]["v"]:
            best[r["date"]] = r
    return [[d, *(_num(best[d][k]) for k in ("o", "h", "l", "c")), best[d]["v"]] for d in sorted(best)]


def _last_trading_on_or_before(days: list, d: date) -> date | None:
    """Downloads that reject a non-trading end date get the latest trading day up to d."""
    ok = [x for x in days if x <= d]
    return ok[-1] if ok else None


def pc_rows(start: date, end: date, trading: list) -> list:
    """[date, ratio] from pcRatioDown in 30-day windows. Columns are matched by
    name and checked against putOi / callOi as in taifex._fetch_pc_ratio_csv."""
    out = {}
    for s, e in _chunks(start, end, 30):
        e = _last_trading_on_or_before(trading, e)
        if e is None or e < s:
            continue
        rows = tx._post_csv(tx.PC_CSV_URL, {"queryStartDate": s.strftime("%Y/%m/%d"), "queryEndDate": e.strftime("%Y/%m/%d")})
        time.sleep(PAUSE_S)

        def col(r, test):
            return next((v for k, v in r.items() if k and test(k)), None)

        for r in rows:
            parts = (col(r, lambda k: k.startswith("日期")) or "").split("/")
            if len(parts) != 3 or not all(x.isdigit() for x in parts):
                continue
            ratio = tx._num(col(r, lambda k: "未平倉" in k and "比" in k))
            put_oi = tx._num(col(r, lambda k: k.startswith("賣權未平倉")))
            call_oi = tx._num(col(r, lambda k: k.startswith("買權未平倉")))
            if ratio is None or not put_oi or not call_oi or abs(put_oi / call_oi * 100 - ratio) > 0.5:
                continue
            d = f"{int(parts[0]):04d}/{int(parts[1]):02d}/{int(parts[2]):02d}"
            out[d] = [d, round(ratio / 100, 4)]
    return [out[d] for d in sorted(out)]


def institutional(start: date, end: date, trading: list) -> dict:
    """{date: {contract name: {身份別: {long, short, net}}}} — taifex._fetch_institutional's
    shape over an explicit range. A contract that did not exist yet (TMF before
    2024/07) answers with an error page and is skipped for that window; TX and
    MTX must load."""
    out: dict = {}
    for s, e in _chunks(start, end, INST_CHUNK_DAYS):
        e = _last_trading_on_or_before(trading, e)
        if e is None or e < s:
            continue
        for cid in tx.INST_IDS:
            try:
                rows = tx._post_csv(tx.INST_CSV_URL, {"queryType": "1", "queryStartDate": s.strftime("%Y/%m/%d"),
                                                      "queryEndDate": e.strftime("%Y/%m/%d"), "commodityId": cid})
            except ValueError:
                if cid == "TMF":
                    continue
                raise
            finally:
                time.sleep(PAUSE_S)
            for r in rows:
                net, lg, sh = (tx._num(r.get(c)) for c in ("多空未平倉口數淨額", "多方未平倉口數", "空方未平倉口數"))
                if None in (net, lg, sh):
                    continue
                out.setdefault(r["日期"], {}).setdefault(r["商品名稱"], {})[r["身份別"]] = {"long": int(lg), "short": int(sh), "net": int(net)}
    return out


def fx_rows(inst: dict) -> list:
    net = tx._inst_net(inst)
    return [[d, round(tx._tx_equiv(net[d], tx.FOREIGN))] for d in sorted(net) if "臺股期貨" in net[d]]


def retail_rows(inst: dict, mtx: list) -> list:
    r = tx._retail_block(inst, {"MTX": mtx})
    return [[x["date"], x["ratio"]] for x in ((r or {}).get("MTX") or {}).get("series") or [] if x["ratio"] is not None]


def build(start: date, end: date) -> dict:
    tx_rows = fut_rows(tx.FUT_COMMODITY, start, end)
    bars = bar_rows(tx_rows)
    if not bars:
        raise ValueError("no TX bars in range")
    trading = [_d(b[0]) for b in bars]
    print(f"bars {len(bars)} {bars[0][0]} -> {bars[-1][0]}", file=sys.stderr)
    pc = pc_rows(start, end, trading)
    print(f"pc {len(pc)}", file=sys.stderr)
    # the institutional download's rolling window: three years back from today
    # (a day of margin for a run that straddles midnight in Taipei)
    today = date.today()
    three_years = today.replace(year=today.year - 3, day=28) if (today.month, today.day) == (2, 29) else today.replace(year=today.year - 3)
    i_start = max(start, three_years + timedelta(days=1))
    inst = institutional(i_start, end, trading)
    mtx = fut_rows("MTX", i_start, end) if inst else []
    fx, retail = fx_rows(inst), retail_rows(inst, mtx)
    print(f"fx {len(fx)}, retail {len(retail)}", file=sys.stderr)
    return {"bars": bars, "pc": pc, "fx": fx, "retail": retail}


def read(path: str) -> dict | None:
    try:
        text = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        return None
    return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))


def merge(old: dict | None, new: dict) -> dict:
    out = {"version": 1}
    for k in SERIES:
        by = {r[0]: r for r in (old or {}).get(k, [])}
        by.update({r[0]: r for r in new.get(k, [])})
        out[k] = [by[d] for d in sorted(by)]
    out["from"] = min(out[k][0][0] for k in SERIES if out[k])
    out["to"] = out["bars"][-1][0]
    return out


def write(path: str, data: dict) -> int:
    lines = ["// Generated by server/backtest_data.py: multi-year TAIFEX daily history for the",
             "// strategy backtester. Do not edit; --update merges each new session in.",
             "window.BT_DATA = {",
             f'"version":{data["version"]},"from":{json.dumps(data["from"])},"to":{json.dumps(data["to"])},']
    for i, k in enumerate(SERIES):
        rows = ",\n".join(json.dumps(r, separators=(",", ":")) for r in data[k])
        lines.append(f'"{k}":[\n{rows}\n]' + ("," if i < len(SERIES) - 1 else ""))
    lines.append("};")
    text = "\n".join(lines) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return len(text)


def main(argv):
    mode = next((m for m in ("--write", "--update") if m in argv), None)
    i = argv.index(mode) + 1 if mode else -1
    if not mode or i >= len(argv):
        print("usage: backtest_data.py --write PATH | --update PATH", file=sys.stderr)
        return 2
    path = argv[i]
    old = read(path)
    end = date.today()
    start = FROM if mode == "--write" or not old else end - timedelta(days=UPDATE_DAYS)
    data = merge(old, build(start, end))
    n = write(path, data)
    print(f"{data['from']} -> {data['to']}: " + ", ".join(
        f"{k} {len(data[k])} ({data[k][0][0]}..{data[k][-1][0]})" for k in SERIES if data[k]) + f" -> {n // 1024} KB; wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
