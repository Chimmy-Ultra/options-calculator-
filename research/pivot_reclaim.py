"""Backtest: buy one TX contract when price breaks below a floor-pivot support
and gets back above it, sell at the next trading day's close.

Levels are the ones the 關卡 tab's 關鍵價位 list shows (computeKeyLevels in
design_handoff_options_lab/obsidian3.jsx), from the previous day session's
H / L / C of the same contract:
    P = (H + L + C) / 3,  S1 = 2P - H,  S2 = P - (H - L),  S3 = L - 2(H - P),  PDL = L

Two versions:
  daily    -- research/data/tx_daily.csv. Signal: the day's low is below the
              level and the close is above it; buy at that close (13:45).
  1-minute -- data/tx-1m. Signal: during the day session, the first 1-minute
              close back above the level after a bar traded below it; buy at
              that close.
Both sell at the next trading day's day-session close (the night session in
between is held). "every day" buys every close: the baseline a signal has to
beat. Costs per round trip: SLIP points each side, TAX on both sides' contract
value, FEE NT$ each side.

    python3 research/pivot_reclaim.py
"""
import csv
import glob
import math
import os
import statistics as st
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MULT = 200          # NT$ per TX point
SLIP = 1.0          # points per side
TAX = 2e-5          # 期貨交易稅, 股價類期貨: 十萬分之二 of contract value, per side
FEE = 50            # NT$ per side, broker-dependent
LEVELS = ("S1", "S2", "S3", "PDL")


def load_daily():
    by = defaultdict(dict)
    for r in csv.DictReader(open(os.path.join(ROOT, "research", "data", "tx_daily.csv"))):
        if r["high"] and r["low"] and r["close"]:
            by[r["date"].replace("/", "")][r["month"]] = dict(
                h=float(r["high"]), l=float(r["low"]), c=float(r["close"]), v=int(r["volume"]))
    return by, sorted(by)


def front(by, d):
    return max(by[d], key=lambda m: by[d][m]["v"])


def levels(p):
    P = (p["h"] + p["l"] + p["c"]) / 3
    return {"S1": 2 * P - p["h"], "S2": P - (p["h"] - p["l"]), "S3": p["l"] - 2 * (p["h"] - P), "PDL": p["l"]}


def trade(entry, exit_):
    pts = exit_ - entry
    cost = 2 * SLIP * MULT + 2 * FEE + TAX * MULT * (entry + exit_)
    return dict(pts=pts, ret=pts / entry, net=pts * MULT - cost)


def exit_contract(by, d0, d1, m):
    """Hold m overnight; on its last trading day roll the trade to the next front."""
    if m in by[d1]:
        return m
    k = front(by, d1)
    return k if k in by[d0] else None


def report(name, ts, base=None):
    if not ts:
        print(f"  {name:10s} n=   0")
        return
    r = [t["ret"] for t in ts]
    se = st.stdev(r) / math.sqrt(len(r)) if len(r) > 1 else float("nan")
    line = (f"  {name:10s} n={len(ts):4d}  win={100 * sum(t['pts'] > 0 for t in ts) / len(ts):4.1f}%  "
            f"mean={100 * st.mean(r):+.3f}% (±{200 * se:.3f}% 2SE)  "
            f"avg pts={st.mean(t['pts'] for t in ts):+7.1f}  avg net NT${st.mean(t['net'] for t in ts):+8,.0f}  "
            f"total net NT${sum(t['net'] for t in ts):+11,.0f}  worst NT${min(t['net'] for t in ts):+9,.0f}")
    if base:
        line += f"  vs every-day mean {100 * st.mean(x['ret'] for x in base):+.3f}%"
    print(line)


def daily(by, dates):
    base, sig, skipped = [], defaultdict(list), 0
    for i in range(1, len(dates) - 1):
        d_prev, d0, d1 = dates[i - 1], dates[i], dates[i + 1]
        m = front(by, d0)
        p = by[d_prev].get(m)
        k = exit_contract(by, d0, d1, m)
        if not p or not k:
            skipped += 1
            continue
        b = by[d0][m]
        t = dict(trade(by[d0][k]["c"], by[d1][k]["c"]), date=d0)
        base.append(t)
        for name, x in levels(p).items():
            if b["l"] < x < b["c"]:
                sig[name].append(t)
    print(f"daily: {dates[1]}..{dates[-2]}, {len(base)} sessions ({skipped} skipped: no same-contract bar)")
    report("every day", base)
    for name in LEVELS:
        report(name, sig[name], base)
    print("  S3 by year (n, total net NT$):",
          {y: (len(v), round(sum(t["net"] for t in v))) for y, v in sorted(
              {y: [t for t in sig["S3"] if t["date"][:4] == y] for y in sorted({t["date"][:4] for t in base})}.items())})
    return sig


def minute(by, dates):
    print("1-minute (day session), data/tx-1m:")
    for f in sorted(glob.glob(os.path.join(ROOT, "data", "tx-1m", "*", "*.csv"))):
        d0 = os.path.basename(f)[:8]
        bars = [r for r in csv.DictReader(open(f)) if r["session"] == "day"]
        m = bars[0]["month"]
        i = dates.index(d0)
        p = by[dates[i - 1]].get(m)
        if not p:
            continue
        nxt = dates[i + 1] if i + 1 < len(dates) else None
        out = []
        for name, x in levels(p).items():
            broken = False
            for r in bars:
                if float(r["low"]) < x:
                    broken = True
                if broken and float(r["close"]) > x:
                    e = float(r["close"])
                    if nxt and m in by[nxt]:
                        t = trade(e, by[nxt][m]["c"])
                        out.append(f"{name} {x:.0f}: buy {r['time']} @{e:.0f} -> next close {by[nxt][m]['c']:.0f} "
                                   f"= {t['pts']:+.0f} pts, net NT${t['net']:+,.0f}")
                    else:
                        out.append(f"{name} {x:.0f}: buy {r['time']} @{e:.0f} -> next close not yet available")
                    break
        print(f"  {d0} (contract {m}, prev H/L/C {p['h']:.0f}/{p['l']:.0f}/{p['c']:.0f}, "
              f"S3 {levels(p)['S3']:.0f}, day low {min(float(r['low']) for r in bars):.0f}): "
              + ("; ".join(out) if out else "no signal"))


if __name__ == "__main__":
    by, dates = load_daily()
    daily(by, dates)
    minute(by, dates)
