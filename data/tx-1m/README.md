# TX 1-minute bars

One CSV per trading date (`YYYY/YYYYMMDD.csv`), built from TAIFEX's daily tick
file by `python3 server/taifex.py --archive-minutes data/tx-1m`. The
`taifex-eod` workflow runs it every trading day; TAIFEX deletes its tick files
after about two weeks, so this archive is the only intraday history the repo
has.

| column | meaning |
|---|---|
| `session` | `night` = the session booked before this trading date (15:00 the previous business day to 05:00), `day` = 08:45–13:45 |
| `time` | the bar's minute, `hhmm` in Taipei time; night rows cross midnight |
| `month` | the contract: the outright month with the most day-session lots that date |
| `open` `high` `low` `close` | index points |
| `lots` | outright trades only, (B+S) / 2 from the tick file |

- The day session's open / high / low / close equal TAIFEX's official daily
  bar for the same contract (checked on 2026/09/09–09/24, all twelve dates).
- `lots` excludes spread trades, so it runs below the exchange's daily volume,
  most around a roll (2026/09/14: 53,082 against 94,885).
- A minute with no trade has no row.
