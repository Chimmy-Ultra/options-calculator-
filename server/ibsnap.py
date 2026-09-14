"""ibsnap.py — assemble the IB end-of-day snapshot the deployed app reads.

    python3 server/ibsnap.py <capture-dir> --write design_handoff_options_lab/ib-eod.js

Input: one JSON per product in <capture-dir> (es.json, nq.json, …) in the
capture shape written by the IBKR capture workers: per product the front future, the selected
option expiries — each with its own underlying future and ±8 strikes of raw
per-contract quotes (last / bid / ask / midpoint IV / OI / volume) — and a
year of daily futures bars. Every number is IB's; this script only reshapes:

- rows take the frontend `genChain` shape (`strike`, `atm`, `itmCall`,
  `itmPut`, `call` / `put` = { bid, ask, last, iv, oi, oiChg, vol, delta });
- `iv` is IB's midpoint IV when it reported one, else the mid (or last)
  inverted with `pricing.implied_vol` under the product's model (Black-76 on
  the expiry's own future) — the same inversion the live proxy uses;
- `delta` is the model delta at that IV; `oiChg` is unknown from IB → 0.

Output: `window.IB_EOD = { es: {...}, nq: {...} }`, each product in the same
shape as `window.TAIFEX_EOD` so `data-live.js` answers from it unchanged:
`spot`, `expiries`, `chains[id].rows` + `chains[id].underlying`, `bars`,
`barsFull`, plus `label` for the top-bar badge. Pure ASCII.
"""

import glob
import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pricing  # noqa: E402

RISK_FREE = 0.04
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v and v > 0 else None  # NaN / non-positive → None


def _bar_date(t) -> str | None:
    """Capture bar timestamps vary by tool response shape; normalise to YYYYMMDD."""
    if t is None:
        return None
    if isinstance(t, (int, float)):
        ms = float(t)
        if ms > 1e12:
            ms /= 1000.0
        return datetime.utcfromtimestamp(ms).strftime("%Y%m%d")
    s = str(t).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10].replace("-", "")
    if len(s) >= 8 and s[:8].isdigit():
        return s[:8]
    for fmt in ("%Y%m%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d-%b-%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:19], fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    return None


def _field(raw: dict, key: str, right: str, *names):
    """A quote field the worker may have stored raw (IB's own object) instead
    of flat: pick the named sub-key, else the side's own (call / put) entry,
    else the first numeric value. Never a guess beyond IB's object."""
    v = raw.get(key)
    if not isinstance(v, dict):
        return v
    side = "call" if right == "C" else "put"
    for n in names:
        if n in v:
            return v[n]
    for n, x in v.items():
        if side in n.lower():
            return x
    for x in v.values():
        if isinstance(x, (int, float)):
            return x
    return None


def _side(raw: dict, right: str, f: float, k: float, t: float) -> dict:
    """One side of a chain row from the raw contract quote."""
    bid, ask = _num(_field(raw, "bid", right, "bid")), _num(_field(raw, "ask", right, "ask"))
    last = _num(_field(raw, "last", right, "price", "last"))
    mid = (bid + ask) / 2 if (bid and ask) else None
    ivf = _field(raw, "iv", right, "annualIv", "iv")
    if isinstance(raw.get("iv"), dict) and raw["iv"].get("isValid") is False:
        ivf = None  # the connector itself flags the midpoint IV invalid
    iv = _num(ivf)
    if iv is not None:
        iv = iv * 100 if iv < 3 else iv  # IB reports a fraction (0.15); guard a % feed
    else:
        prem = mid or last
        inv = pricing.implied_vol(right, f, k, prem, t, RISK_FREE, "b76") if prem else None
        iv = inv * 100 if inv else 0.0
    delta = pricing.delta(right, f, k, max(iv / 100, 1e-4), t, RISK_FREE, "b76") if iv > 0 else (1.0 if (right == "C" and k < f) else -1.0 if (right == "P" and k > f) else 0.0)
    return {"bid": bid or 0.0, "ask": ask or 0.0, "last": last or (mid or 0.0),
            "iv": round(iv, 2), "oi": int(_num(_field(raw, "oi", right, "openInterest", "oi")) or 0), "oiChg": 0,
            "vol": int(_num(_field(raw, "vol", right, "volume", "vol")) or 0), "delta": round(delta, 4)}


def build_product(cap: dict) -> dict | None:
    pid = cap["pid"]
    bars = []
    for b in cap.get("bars") or []:
        d = _bar_date(b.get("t"))
        if not d or _num(b.get("c")) is None:
            continue
        bars.append({"t": d, "o": b.get("o"), "h": b.get("h"), "l": b.get("l"), "c": b.get("c"), "v": int(b.get("v") or 0)})
    bars.sort(key=lambda b: b["t"])
    front = cap.get("front") or {}
    notes = list(cap.get("notes") or [])
    spot = _num(front.get("last")) or _num(front.get("priorClose")) or (bars[-1]["c"] if bars else None)
    if cap.get("secType") == "OPT" and bars:
        spot = bars[-1]["c"]  # VIX: the index level; the chains price off each expiry's VX future
    if spot is None:
        return None
    # IB's history endpoint quotes CBOT grains in $/bu while the snapshots and
    # strikes are in cents: bring the bars to the quote unit by the power of
    # ten that matches the front price (1 / 10 / 100 / 1000), never a free factor.
    if bars and cap.get("secType") != "OPT":
        ratio = spot / bars[-1]["c"]
        scale = min((1, 10, 100, 1000), key=lambda x: abs(ratio / x - 1))
        if scale != 1 and abs(ratio / scale - 1) < 0.25:
            for b in bars:
                for k in ("o", "h", "l", "c"):
                    b[k] = round(b[k] * scale, 6) if _num(b[k]) is not None else b[k]
            notes.append(f"bars scaled x{scale} to the quote unit (front {spot} vs last close {bars[-1]['c'] / scale})")
    ref = _num(front.get("priorClose"))
    if ref is None and _num(front.get("last")) and front.get("chg") is not None:
        ref = round(front["last"] - front["chg"], 6)  # IB gave the change but not the prior close
    # The quotes are as of the capture (a Sunday-night Globex session counts),
    # so time-to-expiry and the badge follow capturedAt, not the last daily bar.
    cap_dt = datetime.fromisoformat(cap["capturedAt"].replace("Z", "+00:00"))
    asof = cap_dt.strftime("%Y%m%d")
    asof_d = cap_dt.date()

    expiries, chains = [], {}
    for e in sorted(cap.get("expiries") or [], key=lambda x: x["date"]):
        eid = e["date"]
        if eid in chains or datetime.strptime(eid, "%Y%m%d").date() <= asof_d:
            continue
        u = e.get("underlying") or {}
        f = _num(u.get("last")) or _num(u.get("priorClose"))
        if f is None:
            continue
        d = datetime.strptime(eid, "%Y%m%d").date()
        t = max((d - asof_d).days, 0.5) / 365.0
        rows = []
        for r in sorted(e.get("rows") or [], key=lambda x: x["strike"]):
            k = float(r["strike"])
            rows.append({"strike": k, "atm": False, "itmCall": k < f, "itmPut": k > f,
                         "call": _side(r.get("call") or {}, "C", f, k, t),
                         "put": _side(r.get("put") or {}, "P", f, k, t)})
        if not rows or not any(x[s]["last"] > 0 or x[s]["bid"] > 0 or x[s]["ask"] > 0 for x in rows for s in ("call", "put")):
            notes.append(f"{eid} {e.get('tradingClass')}: no quotes on any contract, dropped")
            continue
        min(rows, key=lambda x: abs(x["strike"] - f))["atm"] = True
        monthly = e.get("kind") == "monthly"
        expiries.append({"id": eid, "label": MONTHS[int(eid[4:6]) - 1] if monthly else (e.get("tradingClass") or "W"),
                         "type": "monthly" if monthly else "weekly", "date": f"{d.month}/{d.day:02d}",
                         "month": u.get("contractMonth"), "tradingClass": e.get("tradingClass")})
        chains[eid] = {"rows": rows, "underlying": {"month": u.get("contractMonth"), "price": f, "prevClose": _num(u.get("priorClose"))}}
    if not expiries:
        return None
    return {
        "product": pid, "source": "ib-eod", "symbol": cap.get("symbol"),
        "label": f"IB {asof[4:6]}/{asof[6:]} {cap_dt.strftime('%H:%M')}Z",
        "date": f"{asof[:4]}/{asof[4:6]}/{asof[6:]}", "prevDate": None, "asOf": asof,
        "capturedAt": cap.get("capturedAt"), "builtAt": datetime.now().isoformat(timespec="seconds"),
        "spot": {"price": spot, "ref": ref if cap.get("secType") != "OPT" else (bars[-2]["c"] if len(bars) > 1 else None),
                 "date": asof, "time": None},
        "front": {"month": front.get("contractMonth"), "lastTradingDate": front.get("lastTradingDate"), "price": _num(front.get("last")),
                  "prevClose": _num(front.get("priorClose"))},
        "expiries": expiries, "chains": chains,
        "bars": bars, "barsFull": bars,
        "notes": notes,
        "sampleDescription": cap.get("sampleDescription"),
    }


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    src = argv[0]
    out = argv[argv.index("--write") + 1] if "--write" in argv else None
    snaps = {}
    for path in sorted(glob.glob(os.path.join(src, "*.json"))):
        with open(path, encoding="utf-8") as f:
            cap = json.load(f)
        if not isinstance(cap, dict) or "pid" not in cap or "expiries" not in cap:
            continue  # a worker's scratch file, not a capture
        s = build_product(cap)
        if s is None:
            print(f"{os.path.basename(path)}: nothing usable", file=sys.stderr)
            continue
        snaps[s["product"]] = s
        print(f"{s['product']}: {s['date']} spot {s['spot']['price']} expiries {[e['id'] for e in s['expiries']]} "
              f"rows {[len(c['rows']) for c in s['chains'].values()]} bars {len(s['bars'])} · {s['sampleDescription']}")
    text = ("// Generated by server/ibsnap.py: previous-session IB option chains per product\n"
            "// (window.IB_EOD[pid]). Do not edit; rebuild once per trading day.\n"
            "window.IB_EOD = " + json.dumps(snaps, separators=(",", ":")) + ";\n")
    print(f"{len(snaps)} products -> {len(text) // 1024} KB")
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
