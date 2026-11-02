"""One-off: seed design_handoff_options_lab/taifex-history.js from the git
history of taifex-eod.js, then add TAIFEX's own longer series (the put/call
download's ~100 days and the final-settlement list).

Every committed snapshot is one session as the pipeline saw it on the day, so
replaying them through taifex.history_merge gives the same records a daily
run would have written. Later commits of the same session win. Snapshots
before the `term` block existed carry only five weekly / monthly chains, so
those days have no 30-day constant-maturity IV (nothing listed bracketed 30
days) — the history records that as absent rather than extrapolating.

    python3 history_backfill.py [git-ref] [out]

needs a full clone (`git fetch --unshallow`); defaults: origin/main and
../design_handoff_options_lab/taifex-history.js. Read-only against TAIFEX.
"""

import json
import subprocess
import sys

import taifex

PATH = "design_handoff_options_lab/taifex-eod.js"


def snapshots(ref: str):
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
    commits = subprocess.run(["git", "-C", top, "log", "--format=%H", ref, "--", PATH], capture_output=True, text=True, check=True).stdout.split()
    seen = {}
    for c in commits:  # newest first: the first commit seen for a session is its last rebuild
        text = subprocess.run(["git", "-C", top, "show", f"{c}:{PATH}"], capture_output=True, text=True).stdout
        if "=" not in text:
            continue
        snap = json.loads(text[text.index("=") + 1:].strip().rstrip(";"))
        seen.setdefault(snap["date"], snap)
    return [seen[d] for d in sorted(seen)]


def main(argv):
    ref = argv[0] if argv else "origin/main"
    out = argv[1] if len(argv) > 1 else "../design_handoff_options_lab/taifex-history.js"
    h = None
    snaps = snapshots(ref)
    for s in snaps:
        h = taifex.history_merge(h, s)
    print(f"replayed {len(snaps)} snapshots {snaps[0]['date']} -> {snaps[-1]['date']}")
    # TAIFEX's own longer put/call series (oldest sessions the snapshots never held)
    pc = {r[0]: r for r in h["pc"]}
    for x in taifex._pc_ratio():
        pc[x["date"]] = [x["date"], x["ratio"], x["volRatio"], x["putOi"], x["callOi"]]
    h["pc"] = [pc[d] for d in sorted(pc)]
    # per-strike OI for sessions no snapshot was committed for (the last two weeks the download serves)
    from datetime import date, timedelta
    tbl = taifex._parse(taifex._fetch_csv(date.today() - timedelta(days=14), date.today()))
    h = taifex.history_oi_from_table(h, tbl, snaps[-1])
    h = taifex.history_settlements(h)
    n = taifex.write_history(out, h)
    print(f"history {h['from']} -> {h['to']}: {len(h['days'])} days, pc {len(h['pc'])}, fx {len(h['fx'])}, "
          f"oi {len(h['oi'])} sessions, settle {len(h['settle'])} -> {n // 1024} KB; wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
