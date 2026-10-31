"""Download TX daily futures bars from TAIFEX into research/data/tx_daily.csv.

Day session (一般) only, outright contract months only (spreads like
202610/202611 are dropped), one row per date and contract month. The study in
regime_study.py picks the front month itself (highest volume that day), so
every listed month is kept.

    python3 research/fetch_tx_daily.py                 # 2019-01 .. this month
    python3 research/fetch_tx_daily.py 2026-09 2026-09 out.csv
"""
import csv
import io
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
import taifex  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
COLUMNS = ["date", "month", "open", "high", "low", "close", "volume", "settle"]


def _months(first, last):
    y, m = first
    while (y, m) <= last:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def _num(x):
    x = x.strip()
    return "" if x in ("", "-") else f"{float(x):.10g}"


def parse(text):
    """TAIFEX futures CSV text -> rows in COLUMNS order (strings)."""
    out = []
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 18 or r[1].strip() != "TX" or "/" in r[2] or r[17].strip() != "一般":
            continue
        vol = r[9].strip()
        out.append([r[0].strip(), r[2].strip(), _num(r[3]), _num(r[4]), _num(r[5]), _num(r[6]),
                    vol if vol.isdigit() else "0", _num(r[10])])
    return out


def fetch(first, last):
    rows = []
    for y, m in _months(first, last):
        a = date(y, m, 1)
        b = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
        for attempt in range(3):
            try:
                text = taifex._fetch_csv(a, b, url=taifex.FUT_CSV_URL, commodity="TX")
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3)
        rows += parse(text)
        time.sleep(0.8)  # one request per month; stay polite
    return sorted(rows, key=lambda r: (r[0], r[1]))


def main(argv):
    ym = lambda s: (int(s[:4]), int(s[5:7]))
    today = date.today()
    first = ym(argv[1]) if len(argv) > 1 else (2019, 1)
    last = ym(argv[2]) if len(argv) > 2 else (today.year, today.month)
    path = argv[3] if len(argv) > 3 else os.path.join(HERE, "data", "tx_daily.csv")
    rows = fetch(first, last)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        w.writerows(rows)
    print(f"{len(rows)} rows, {rows[0][0]} .. {rows[-1][0]} -> {path}")


if __name__ == "__main__":
    main(sys.argv)
