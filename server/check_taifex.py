#!/usr/bin/env python3
"""TAIFEX open-data probe — run on your own machine.

Answers one question before we build a `taifex.py` source: which free TAIFEX
endpoints answer, and which of them carry per-strike open interest for TXO.
No credentials, nothing written to disk. Every step is independent; a failing
step prints why and the probe moves on, so the whole output is worth pasting.

    python3 check_taifex.py
"""
import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

OPENAPI = "https://openapi.taifex.com.tw/v1/"
SWAGGER = "https://openapi.taifex.com.tw/swagger.json"
CSV_DOWN = "https://www.taifex.com.tw/cht/3/optDataDown"
OI_KEY = re.compile(r"未沖銷|未平倉|open.?interest|\boi\b", re.I)
OPT_PATH = re.compile(r"opt|option|putcall|put_call", re.I)
TIMEOUT = 20


def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "options-lab-probe/1"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def decode(raw):
    for enc in ("utf-8-sig", "big5", "cp950"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def step(title):
    print(f"\n── {title}")


def report_rows(name, rows):
    if not isinstance(rows, list) or not rows:
        print(f"  {name}: no rows (got {type(rows).__name__})")
        return
    keys = list(rows[0].keys()) if isinstance(rows[0], dict) else []
    oi = [k for k in keys if OI_KEY.search(k)]
    print(f"  {name}: {len(rows)} rows")
    print(f"    columns: {keys}")
    print(f"    OI column: {oi or 'NONE'}")
    # Show one TXO row if the payload is per-contract.
    txo = next((r for r in rows if isinstance(r, dict) and any(str(v).startswith("TXO") for v in r.values())), None)
    if txo:
        print(f"    sample TXO row: {json.dumps(txo, ensure_ascii=False)[:300]}")


def main():
    print("TAIFEX open-data probe")
    ok_any = False

    step("1 OpenAPI catalogue (swagger.json)")
    opt_paths = []
    try:
        spec = json.loads(decode(fetch(SWAGGER)))
        paths = sorted(spec.get("paths", {}).keys())
        opt_paths = [p for p in paths if OPT_PATH.search(p)]
        print(f"  {len(paths)} paths total; options-related:")
        for p in opt_paths:
            summ = ""
            for m in spec["paths"][p].values():
                if isinstance(m, dict):
                    summ = m.get("summary") or m.get("description") or ""
                    break
            print(f"    {p}  {summ[:70]}")
        ok_any = True
    except Exception as e:  # network, proxy, schema
        print(f"  ✗ {type(e).__name__}: {e}")

    step("2 OpenAPI endpoints (latest trading day only)")
    # Known-good names from projects that wrap this API, plus whatever step 1
    # found. The options daily report is the one we care about.
    names = ["PutCallRatio", "DailyMarketReportFut", "DailyMarketReportOpt",
             "MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate",
             "OpenInterestOfLargeTradersFutures"]
    for p in opt_paths:
        n = p.strip("/").split("/")[-1]
        if n not in names:
            names.append(n)
    for n in names:
        try:
            rows = json.loads(decode(fetch(OPENAPI + n)))
            report_rows(n, rows)
            ok_any = True
        except urllib.error.HTTPError as e:
            print(f"  {n}: HTTP {e.code}")
        except Exception as e:
            print(f"  {n}: ✗ {type(e).__name__}: {e}")

    step("3 Website CSV download (history, per strike)")
    today = dt.date.today()
    start = today - dt.timedelta(days=7)
    form = urllib.parse.urlencode({
        "down_type": "1", "commodity_id": "TXO",
        "queryStartDate": start.strftime("%Y/%m/%d"),
        "queryEndDate": today.strftime("%Y/%m/%d"),
    }).encode()
    try:
        text = decode(fetch(CSV_DOWN, data=form))
        rows = list(csv.reader(io.StringIO(text)))
        if len(rows) < 2:
            print(f"  optDataDown answered but no table (first 200 chars): {text[:200]!r}")
        else:
            header = [h.strip() for h in rows[0]]
            oi = [h for h in header if OI_KEY.search(h)]
            print(f"  optDataDown: {len(rows) - 1} rows, {len(header)} columns")
            print(f"    columns: {header}")
            print(f"    OI column: {oi or 'NONE'}")
            print(f"    first row: {rows[1][:12]}")
            ok_any = True
    except Exception as e:
        print(f"  optDataDown: ✗ {type(e).__name__}: {e}")

    print()
    if ok_any:
        print("Done — paste everything above back into the chat.")
    else:
        print("Nothing answered. If you are behind a corporate proxy or a firewall, "
              "try from a home connection; TAIFEX serves all of this without a login.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
