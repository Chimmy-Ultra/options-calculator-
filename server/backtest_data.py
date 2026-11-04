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
  gex    [date, total, flip, callWall, putWall]
                                TXO dealer gamma exposure over every listed
                                expiry (weeklies + monthlies, T > 0) from the
                                session's 結算價 + 未沖銷契約數: total in NT$ 億
                                per 1% move (calls +, puts −, SqueezeMetrics),
                                flip = zero-gamma level in points (null when the
                                ±10% grid has no crossing), walls = strike with
                                the largest call / most negative put GEX summed
                                across expiries (see gex_day for the definition)

The gex series uses obsidian3.jsx computeGex's formula with two deliberate
differences, because it aggregates the whole board instead of one chain: each
expiry's gamma is taken at its own parity forward (the frontend uses the spot
for every strike), and each strike's IV is the OTM side's (the frontend
averages the call and put IV). On 2026/11/04, the 11/06 F1 expiry alone gives
26.36 億 at the forward and 28.96 億 with gamma at the spot 43,204 — the site
shows ≈29.1 — so the gap is the forward (43,015 that day), not the data.
dlOptDataDown serves TXO back to 2020 (one calendar month per request, ~1–10
MB each), so gex starts with bars. One method over the whole span, but the
board it sums grows: Wednesday weeklies are listed throughout, Friday weeklies
(codes YYYYMMFn) from 2025/06/27, so a session lists a median 6 series in
2020–22, 7 in 2023–24, 8 in 2025 and 9 in 2026 (the expiring one included).
The total is dominated by series one day from expiry, so its extremes (and
the negative days) cluster on the eve of an expiry and become more frequent
once there are two expiries a week. Through 2020 the 100-point strikes near
the money often leave fewer than the five strikes taifex._parity_forward
needs, so those expiries use the TX close as the forward. flip is null (never
clipped to the grid edge) when the total does not change sign within ±10% —
4 sessions, all in 2020.

TAIFEX's institutional download (futContractsDateDown, and the per-day HTML
page behind it) only serves a rolling three years — on 2026/11/04 it refused
anything before 2023/11/04 with "日期時間錯誤" — so fx and retail start there
while bars and pc go back to 2020. Both modes merge into an existing file by
date (new rows win), so a later full rebuild keeps the older institutional
rows the exchange no longer serves.
"""
import csv
import io
import json
import math
import sys
import time
from datetime import date, datetime, timedelta

import taifex as tx

FROM = date(2020, 1, 1)
UPDATE_DAYS = 15
PAUSE_S = 1.0
INST_CHUNK_DAYS = 90     # the institutional download serves four months+ per request
SERIES = ("bars", "pc", "fx", "retail", "gex")
TMF_LISTED = date(2024, 7, 29)   # 微型臺指期貨's first session; before it the download answers an error page


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


def _months(start: date, end: date):
    """Calendar-month windows. The daily-report downloads cap a request at one
    calendar month, not 30 days: 2021/01/31-03/01 and 2022/02/25-03/26 both
    answered an error page while every other 30-day window loaded."""
    while start <= end:
        nxt = date(start.year + start.month // 12, start.month % 12 + 1, 1)
        e = min(nxt - timedelta(days=1), end)
        yield start, e
        start = e + timedelta(days=1)


def fut_rows(commodity: str, start: date, end: date) -> list:
    """taifex._parse_fut_rows over [start, end] one calendar month per request (the download's limit)."""
    out = []
    for s, e in _months(start, end):
        out += _retry(lambda: tx._parse_fut_rows(tx._fetch_csv(s, e, url=tx.FUT_CSV_URL, commodity=commodity), commodity))
        time.sleep(PAUSE_S)
    return out


def _retry(fn, tries: int = 3):
    """A long walk meets the odd error page in place of a table (one TX window
    in the first full build; the same request answered normally a minute
    later), so a window is retried after 10 s and 30 s before giving up."""
    for i in range(tries):
        try:
            return fn()
        except ValueError:
            if i == tries - 1:
                raise
            time.sleep(10 if i == 0 else 30)


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
    """[date, ratio] from pcRatioDown one calendar month per request. Columns are matched by
    name and checked against putOi / callOi as in taifex._fetch_pc_ratio_csv."""
    out = {}
    for s, e in _months(start, end):
        e = _last_trading_on_or_before(trading, e)
        if e is None or e < s:
            continue
        rows = _retry(lambda: tx._post_csv(tx.PC_CSV_URL, {"queryStartDate": s.strftime("%Y/%m/%d"), "queryEndDate": e.strftime("%Y/%m/%d")}))
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
            form = {"queryType": "1", "queryStartDate": s.strftime("%Y/%m/%d"),
                    "queryEndDate": e.strftime("%Y/%m/%d"), "commodityId": cid}
            try:
                rows = _retry(lambda: tx._post_csv(tx.INST_CSV_URL, form), tries=1 if cid == "TMF" and e < TMF_LISTED else 3)
            except ValueError:
                if cid == "TMF" and s < TMF_LISTED:
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


GEX_MULT = 50            # TXO: NT$50 per index point (products.js txo.mult)
GEX_STRIKE_STEP = 50     # products.js txo.strikeStep, for the flip grid's step


def _opt_days(text: str):
    """dlOptDataDown CSV → ({date: {code: {strike: [callSettle, callOi, putSettle, putOi]}}},
    {code: stated expiry date}). Day-session (一般) TXO rows only. A settlement of 0
    or '-' is None. 契約到期日 is read when the file has it; the archive back to
    2020 does not (it was added later), so taifex._parse cannot be used here."""
    rows = csv.reader(io.StringIO(text))
    header = [h.strip() for h in next(rows, [])]
    col = {n: i for i, n in enumerate(header)}
    need = ("交易日期", "契約", "到期月份(週別)", "履約價", "買賣權", "結算價", "未沖銷契約數", "交易時段")
    if any(n not in col for n in need):
        raise ValueError("TAIFEX answered without an option table")
    ie = col.get("契約到期日")
    days: dict = {}
    stated: dict = {}
    for r in rows:
        if len(r) < len(header) - 1 or r[col["契約"]].strip() != tx.COMMODITY or r[col["交易時段"]].strip() != "一般":
            continue
        k = tx._num(r[col["履約價"]])
        code = r[col["到期月份(週別)"]].strip()
        if k is None or not code:
            continue
        if ie is not None and r[ie].strip().isdigit():
            stated[code] = datetime.strptime(r[ie].strip(), "%Y%m%d").date()
        st = tx._num(r[col["結算價"]])
        oi = int(tx._num(r[col["未沖銷契約數"]], 0) or 0)
        cell = days.setdefault(r[col["交易日期"]].strip(), {}).setdefault(code, {}).setdefault(k, [None, 0, None, 0])
        j = 0 if r[col["買賣權"]].strip() == "買權" else 2
        cell[j], cell[j + 1] = (st if st and st > 0 else None), oi
    return days, stated


def _nominal_expiry(code: str) -> date:
    """Calendar expiry of a contract code when the data has not shown it yet:
    YYYYMM = third Wednesday, YYYYMMWn = nth Wednesday, YYYYMMFn = nth Friday.
    Holidays move the real date (2020/01 W4 settled on 01/30, not 01/22, over
    Lunar New Year), so this is only used for series that are still trading at
    the end of the downloaded range — a month or more out for a full build."""
    y, m = int(code[:4]), int(code[4:6])
    wd, n = (2, 3) if len(code) == 6 else ((4 if code[6] == "F" else 2), int(code[7:]))
    first = date(y, m, 1)
    return first + timedelta(days=(wd - first.weekday()) % 7 + 7 * (n - 1))


def _gamma_terms(f: float, k: float, iv: float, t: float, r: float):
    """(ln(F/K), σ√T, e^-rT) — Black-76 gamma = e^-rT · n(d1) / (F σ√T), the
    frontend's bsGreeks(..., 'b76').gamma."""
    return math.log(f / k), iv * math.sqrt(t), math.exp(-r * t)


def _gex_at(rows, x: float, s: float) -> float:
    """Total GEX (NT$ per 1% move) with every forward scaled by x = S'/S."""
    lx, tot = math.log(x), 0.0
    for lfk, a, f, w in rows:
        d1 = (lfk + lx) / a + a / 2
        tot += w * math.exp(-d1 * d1 / 2) / (f * x * a)
    return tot / math.sqrt(2 * math.pi) * GEX_MULT * (s * x) ** 2 * 0.01


def gex_day(chains: dict, day: date, spot: float, expiry_of, r: float = tx.RISK_FREE_TW, detail: list | None = None):
    """[total 億/1%, flip, callWall, putWall] over every TXO expiry listed on `day`.

    Per expiry: T = calendar days to expiry / 365 (expiries on `day` itself are
    dropped); F = taifex._parity_forward on the settlements, else `spot`; IV per
    strike from 結算價 of the OTM side (call at/above F, put below), Black-76;
    a strike whose settle is ≤ 0.1 point or whose inversion fails takes the
    nearest valid strike's IV in the same expiry. Gamma is evaluated at F,
    GEX_i = γ_i · (callOi − putOi) · 50 · S² · 0.01 with S = `spot` (the TX
    front-month day-session close, the same S the walls and flip use).
    Flip: the total re-priced on S' ∈ [0.9 S, 1.1 S] (step max(25, 0.1% S),
    computeGex's grid) with every forward moved by S'/S; nearest crossing to S."""
    import pricing
    rows, by_k = [], {}
    for code, strikes in chains.items():
        exp = expiry_of(code)
        dte = (exp - day).days
        if dte <= 0:
            continue
        t = dte / 365.0
        cur = {k: {"call": {"settle": v[0]}, "put": {"settle": v[2]}} for k, v in strikes.items() if v[0] and v[2]}
        f = tx._parity_forward(cur, spot, t, r) or spot
        ivs = {}
        for k, (cs, _, ps, _) in strikes.items():
            right, st = ("C", cs) if k >= f else ("P", ps)
            if st is not None and st > 0.1:
                iv = pricing.implied_vol(right, f, k, st, t, r, "b76")
                if iv:
                    ivs[k] = iv
        if not ivs:
            continue
        valid = sorted(ivs)
        part = 0.0
        for k, (_, coi, _, poi) in strikes.items():
            if not coi and not poi:
                continue
            iv = ivs.get(k) or ivs[min(valid, key=lambda q: abs(q - k))]
            lfk, a, df = _gamma_terms(f, k, iv, t, r)
            g = df * math.exp(-(lfk / a + a / 2) ** 2 / 2) / (math.sqrt(2 * math.pi) * f * a)
            unit = g * GEX_MULT * spot * spot * 0.01
            c, p = by_k.setdefault(k, [0.0, 0.0])
            by_k[k] = [c + unit * coi, p - unit * poi]
            part += unit * (coi - poi)
            if coi != poi:
                rows.append((lfk, a, f, df * (coi - poi)))
        if detail is not None:
            detail.append({"code": code, "expiry": exp.strftime("%Y/%m/%d"), "dte": dte, "fwd": round(f, 1),
                           "ivStrikes": len(ivs), "gex": round(part / 1e8, 2)})
    if not by_k:
        return None
    total = sum(c + p for c, p in by_k.values())
    cw = max(by_k, key=lambda k: by_k[k][0])
    pw = min(by_k, key=lambda k: by_k[k][1])
    flip, prev = None, None
    step = max(GEX_STRIKE_STEP / 2, spot * 0.001)
    s1 = spot * 0.9
    while s1 <= spot * 1.1:
        tot = _gex_at(rows, s1 / spot, spot)
        if prev and (prev[1] > 0) != (tot > 0) and tot != 0:
            z = prev[0] + (s1 - prev[0]) * (prev[1] / (prev[1] - tot))
            if flip is None or abs(z - spot) < abs(flip - spot):
                flip = z
        prev = (s1, tot)
        s1 += step
    return [round(total / 1e8, 2), None if flip is None else round(flip),
            int(cw) if by_k[cw][0] > 0 else None, int(pw) if by_k[pw][1] < 0 else None]


def gex_rows(start: date, end: date, closes: dict) -> list:
    """[date, total, flip, callWall, putWall] for each trading day in [start, end]
    that has a TX close. One calendar month per request, and each month is
    computed after the next one has loaded so that a series' expiry is the last
    day it traded (the exchange's real date, holidays included); only series
    still trading at the end of the range fall back to _nominal_expiry, unless
    the file states 契約到期日."""
    out, stated, last_seen = [], {}, {}
    horizon = start

    def expiry_of(code):
        if code in stated:
            return stated[code]
        seen = last_seen[code]
        return seen if seen < horizon else max(_nominal_expiry(code), horizon)

    def flush(days):
        for d in sorted(days):
            dd = _d(d)
            if d in closes:
                row = gex_day(days[d], dd, closes[d], expiry_of)
                if row:
                    out.append([d, *row])

    pending = None
    for s, e in _months(start, end):
        days, st = _retry(lambda: _opt_days(tx._fetch_csv(s, e)))
        time.sleep(PAUSE_S)
        stated.update(st)
        for d, ch in days.items():
            dd = _d(d)
            horizon = max(horizon, dd)
            for code in ch:
                last_seen[code] = max(last_seen.get(code, dd), dd)
        if pending:
            flush(pending)
        pending = days
        print(f"gex {s:%Y/%m} {len(days)} days", file=sys.stderr)
    if pending:
        flush(pending)
    return out


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
    gex = gex_rows(start, end, {b[0]: b[4] for b in bars})
    print(f"gex {len(gex)}", file=sys.stderr)
    return {"bars": bars, "pc": pc, "fx": fx, "retail": retail, "gex": gex}


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
