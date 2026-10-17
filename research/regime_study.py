"""What happens over the next 20 sessions after a given kind of day — the
numbers behind docs/daytrade-redesign.md §12.

Series: TX day session, front month = highest-volume outright that day. Price
changes are chained within one contract (day t vs day t-1 of the same month),
so a roll never shows up as a jump. Per day t:
    bull       chained log price above its 60-session mean (MA60)
    pivot bull close above today's floor pivot P from the previous day's H/L/C
    comp       mean 20-session day range (H-L)/C in the lowest third of the
               past year's values (sampled every 5 sessions)
    hv         stdev of the last 20 daily log changes x sqrt(252)
    fwd        log change over the next 20 sessions
    z          fwd / (hv x sqrt(20/252)): the move in units of the recent wiggle
END pins the data to what the write-up used; pass a later YYYYMMDD to extend.

    python3 research/regime_study.py [END]
"""
import math
import statistics as st
import sys

from pivot_reclaim import front, load_daily

H = 20


def series(by, dates):
    lvl, rng, piv = [0.0], [], []
    for i, d in enumerate(dates):
        m = front(by, d)
        b = by[d][m]
        p = by[dates[i - 1]].get(m) if i else None
        rng.append((b["h"] - b["l"]) / b["c"])
        if i:
            lvl.append(lvl[-1] + (math.log(b["c"] / p["c"]) if p else 0.0))
        piv.append(bool(p) and b["c"] > (p["h"] + p["l"] + p["c"]) / 3)
    return lvl, rng, piv


def day_rows(dates, lvl, rng, piv):
    rows = []
    for t in range(250, len(dates) - H):
        r20 = st.mean(rng[t - 19:t + 1])
        hist = sorted(st.mean(rng[s - 19:s + 1]) for s in range(t - 230, t + 1, 5))
        hv = st.pstdev([lvl[t + k] - lvl[t + k - 1] for k in range(-19, 1)]) * math.sqrt(252)
        fwd = lvl[t + H] - lvl[t]
        rows.append(dict(date=dates[t], bull=lvl[t] > st.mean(lvl[t - 59:t + 1]), piv=piv[t],
                         comp=r20 <= hist[len(hist) // 3], hv=hv, fwd=fwd, z=fwd / (hv * math.sqrt(H / 252))))
    return rows


def summ(name, rs, n_all):
    pct = lambda f: 100 * sum(1 for r in rs if f(r)) / len(rs)
    print(f"  {name:20s} n={len(rs):4d} ({100 * len(rs) / n_all:5.1f}%)  mean20d={100 * st.mean(r['fwd'] for r in rs):+.2f}%  "
          f"z>+1={pct(lambda r: r['z'] > 1):4.1f}%  z<-1={pct(lambda r: r['z'] < -1):4.1f}%  "
          f"z>+2={pct(lambda r: r['z'] > 2):4.1f}%  z<-2={pct(lambda r: r['z'] < -2):4.1f}%  |z|>1={pct(lambda r: abs(r['z']) > 1):4.1f}%  "
          f"worst={100 * min(r['fwd'] for r in rs):+.1f}%  best={100 * max(r['fwd'] for r in rs):+.1f}%")


def main(end):
    by, dates = load_daily()
    dates = [d for d in dates if d <= end]
    lvl, rng, piv = series(by, dates)

    print(f"1. Multi-session range vs one session ({dates[0]}..{dates[-1]}, non-overlapping windows)")
    bars = [by[d][front(by, d)] for d in dates]
    one = st.mean((b["h"] - b["l"]) / b["c"] for b in bars)
    for n in (1, 2, 3, 5, 10, 20):
        ws = [bars[i:i + n] for i in range(0, len(bars) - n + 1, n)]
        r = st.mean((max(b["h"] for b in w) - min(b["l"] for b in w)) / w[-1]["c"] for w in ws)
        print(f"  {n:2d} sessions: mean range {100 * r:.2f}%  = {r / one:.2f} x one session  (sqrt(n) {math.sqrt(n):.2f})")

    rows = day_rows(dates, lvl, rng, piv)
    N = len(rows)
    bc = [r for r in rows if r["bull"] and r["comp"]]
    print(f"\n2. Next {H} sessions by regime (signal days {rows[0]['date']}..{rows[-1]['date']})")
    for name, rs in (("all", rows), ("MA60 bull", [r for r in rows if r["bull"]]),
                     ("MA60 bear", [r for r in rows if not r["bull"]]), ("MA60 bull + comp", bc),
                     ("comp only", [r for r in rows if r["comp"]]),
                     ("pivot bull", [r for r in rows if r["piv"]]), ("pivot bear", [r for r in rows if not r["piv"]]),
                     ("pivot bull + comp", [r for r in rows if r["piv"] and r["comp"]]),
                     ("pivot bear + comp", [r for r in rows if not r["piv"] and r["comp"]])):
        summ(name, rs, N)
    print("  MA60 bull + comp by year:", {y: sum(1 for r in bc if r["date"][:4] == y) for y in sorted({r["date"][:4] for r in rows})})
    flips = lambda k: H * sum(1 for a, b in zip(rows, rows[1:]) if a[k] != b[k]) / N
    print(f"  label flips per {H} sessions: MA60 {flips('bull'):.1f}, pivot {flips('piv'):.1f}")

    print("\n3. Trend vs wiggle")
    for name, rs in (("all", rows), ("MA60 bull, not comp", [r for r in rows if r["bull"] and not r["comp"]]), ("MA60 bull + comp", bc)):
        sig = st.median(r["hv"] for r in rs) * math.sqrt(H / 252)
        f = st.mean(r["fwd"] for r in rs)
        print(f"  {name:20s} median HV20 {100 * st.median(r['hv'] for r in rs):.1f}%  sigma over {H} sessions {100 * sig:.2f}%  "
              f"mean move {100 * f:+.2f}%  = {f / sig:.2f} sigma")

    # 2026/09/24 settlement-day closes of the October monthly (snapshot taifex-eod.js),
    # forward 48129.4 from put-call parity. Today's prices on past moves: an order of
    # magnitude only — past calls were priced at their own IV.
    F = 48129.4
    print(f"\n4. Buying the 2026/09/24 October calls against past {H}-session moves (F {F})")
    for K, prem in ((48100, 1140), (49100, 645), (51100, 180)):
        for name, rs in (("MA60 bull + comp", bc), ("all", rows)):
            ends = [F * math.exp(r["fwd"]) for r in rs]
            pay = [max(0.0, e - K) for e in ends]
            print(f"  {K} paid {prem:4d}  {name:16s} in the money {100 * sum(e > K for e in ends) / len(ends):4.1f}%  "
                  f"above K+premium {100 * sum(e > K + prem for e in ends) / len(ends):4.1f}%  "
                  f"mean payoff {st.mean(pay):5.0f}  median payoff {st.median(pay):5.0f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "20260924")
