# Day-trading redesign — what 自由人's tool does, and what we can actually build

Research note for the "redesign around 期貨當沖" question. Written 2026-09-12.
Chat summary is in the session; this file is the reference the next session
should start from.

## TL;DR

- 自由人's product is **多空指南針** (CMoney, subscription, iOS/Android + 電腦版).
  It is a **futures day-trading** tool. Its five advertised functions are
  籌碼差額, 主力成本線, 關卡價, a 盤中聊天室 and 語音通知. Options-specific
  readings (價平和, max-OI 支撐/壓力) are **not** in its feature list — those
  are standard tools found on 玩股網 / OP凱文 / 選擇權搖錢樹 / 康和 apps.
- Everything you named is buildable on the stack we already have, with one
  limit to pin down: **open interest is published end-of-day** by TAIFEX's
  daily report, and broker apps show that T-1 number. Max-OI levels are
  "yesterday's walls", which is how day traders use them. One open question:
  TAIFEX's own 行情資訊網 quote API (`mis.taifex.com.tw`) may carry OI during
  the session — step 4 of the probe checks that on your machine.
- 價平和 is computable **live right now** from the Shioaji chain we already
  fetch (ATM call last + ATM put last). Its intraday history needs a small
  sampler in the proxy, or `api.ticks()` on the two ATM contracts.
- The proposed first screen is a **price ladder** ("Levels"): one vertical axis
  with spot, 價平 ± 價平和, max Call OI (壓力), max Put OI (支撐), 關卡價 and
  成本線 drawn as horizontal lines — plus the K-line with the same lines
  overlaid. The 3D P&L / IV surfaces move to a "Lab" tab.
- Nothing here was verified from this container: every Taiwanese finance
  domain (TAIFEX, CMoney, 玩股網 …) is blocked by its egress proxy, for the
  browser as well as for fetches. Run `server/check_taifex.py` on your machine
  to turn "feasible" into "verified". To let a future session actually look at
  those sites, widen the environment's network policy (claude.ai/code →
  environment → network access) to include `cmoney.tw`, `wantgoo.com`,
  `optree.tw`, `opkevin.cc`, `taifex.com.tw`, `mis.taifex.com.tw`,
  `openapi.taifex.com.tw`, `histock.tw`, `ptt.cc`.

## 1. What 多空指南針 actually is

| Function (their wording) | What it is | Data it needs | Public? |
|---|---|---|---|
| 利用台指籌碼差額，1秒決定多空強弱 | A bull/bear strength read from "chip difference" — large-lot buy vs sell imbalance on 權值股 / futures | Tick-level trades classified 內盤/外盤 and by lot size | Proprietary formula; the inputs are public tick data |
| 獨門主力成本線，支撐壓力一線搞定 | A cost line that "shifts on high-volume breakouts" — a VWAP-family line re-anchored at volume spikes | Intraday futures ticks or 1-min bars | Proprietary anchoring rule; VWAP itself is trivial |
| 追蹤大盤量能振幅，判定今日關卡價 | Daily target levels from the past month's max/min 振幅 and volume | Daily OHLCV, ~30 sessions | Proprietary; reconstructable as open ± f(monthly range) |
| 盤中聊天室 / 語音訊息通知 | Community + push | — | Not relevant to us |
| 五大盤型 | A taxonomy of five intraday session shapes with a playbook each | Judgement / his course | Content, not code |

Sources: [CMoney 電腦版 page](https://www.cmoney.tw/app/itemcontent.aspx?id=3092),
[CMoney APP page](https://www.cmoney.tw/app/itemcontent.aspx?id=3461),
[App Store](https://apps.apple.com/tw/app/%E8%87%AA%E7%94%B1%E4%BA%BA-%E5%A4%9A%E7%A9%BA%E6%8C%87%E5%8D%97%E9%87%9D/id1443991843),
[Google Play](https://play.google.com/store/apps/details?id=com.cmoney.Freeman).
All four are blocked from this container; the table is built from search
snippets of those pages, so treat wording as approximate.

Takeaway: the value of that product is the *reading discipline* (levels first,
then a playbook per session type), not exotic data. That is good news — the
data is either already on our proxy or free from TAIFEX.

## 2. The readings you asked about

### 價平和 (ATM straddle sum)

- **Definition**: premium of the ATM call + premium of the ATM put on the
  nearest expiry (usually 當週). ATM = the strike closest to the futures price.
  Example from the literature: ATM 15100, call 131, put 158 → 價平和 289.
- **Why it matters**: adding the two premiums cancels direction and strike;
  what is left is the market's priced-in move until expiry (pure vol, in index
  points). Rising 價平和 = expected range widening; it decays into settlement.
- **How it is used for 當沖**: (a) 價平 ± 價平和 as the outer expected range
  for the week; (b) its intraday change as a "is the market pricing a bigger
  move today" gauge; (c) rule of thumb from the same literature — an ATM
  option moves about ½–⅔ of the futures move in points.
- **Visual**: a number tile with today's change, an intraday line, and the
  ± band drawn on the price ladder / K-line.

### Max OI 支撐 / 壓力 (選擇權支撐壓力表)

- **Rule**: read it from the seller's side. The strike with the largest Call
  OI is 壓力 (sellers do not expect the index to close above it); the largest
  Put OI is 支撐. OI *change* vs the previous day is the second column
  everyone shows — a wall that is being built matters more than a static one.
- **Visual** (every Taiwanese site converges on this): a table by strike with
  Call OI on the left and Put OI on the right, max cells highlighted, an
  OI-change column, and the same data as a mirrored bar chart. Weekly and
  monthly are shown separately.
- We already have `OIProfile` and `MaxPain` components that render exactly
  this shape — they just receive `oi: 0` from the Shioaji feed today.

Sources: [OP凱文 價平和](https://opkevin.cc/%E9%81%B8%E6%93%87%E6%AC%8A%E5%83%B9%E5%B9%B3%E5%92%8C/),
[Dcard 價平和](https://www.dcard.tw/@jacobyaxn/post/240063299),
[康和 選擇權教學](https://www.barits.com.tw/op-2/),
[選擇權搖錢樹 最大未平倉量](https://www.optree.tw/home/tools/max_oi_amount),
[玩股網 支撐壓力表](https://www.wantgoo.com/option/support-resistance),
[永豐期貨 未平倉教學](https://www.spf.com.tw/mktinfo/Futures/OA/option-001.html),
[Win投資 未平倉](https://winvest.tw/Knowledge/Article/318).

## 3. Data feasibility

### What Shioaji gives us (verified by introspecting the installed 1.7.2)

| Object | Fields | Useful for |
|---|---|---|
| `Snapshot` | ts, code, open/high/low/close, change_price/rate, average_price, volume, total_volume, amount, total_amount, yesterday_volume, buy/sell price+volume, tick_type, volume_ratio | 價平和 (ATM call/put `close`), futures price, session VWAP (`average_price`) |
| `Ticks` | ts, close, volume, bid/ask price+volume, `tick_type` (內盤/外盤) | 籌碼差額 proxy (外盤 − 內盤 volume), 成本線 anchoring, intraday 價平和 history |
| `Kbars` | ts, Open/High/Low/Close/Amount/Volume (1-min) | K-line, 關卡價 inputs, VWAP |
| `Option` / `Future` contract | code, delivery_date, strike_price, option_right, reference, limit_up/down … | chain construction (already done) |

**No open-interest field exists anywhere** — not on Snapshot, Ticks, Kbars
or the contract objects (checked the class attributes and the package source).
That is why `sinopac.py` reports `oi: 0` and the liquidity score falls back
to spread-only for TXO.

### What TAIFEX gives us (free, no key)

| Source | What | Latency | Notes |
|---|---|---|---|
| `https://openapi.taifex.com.tw/v1/…` (JSON, [Swagger](https://openapi.taifex.com.tw/)) | `DailyMarketReportFut` (futures OHLC + OI), `PutCallRatio`, `MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate` (三大法人), `OpenInterestOfLargeTradersFutures` (大額交易人), `IndexFuturesAndOptionsMargining`, and an options daily report with per-strike 未沖銷契約量 (exact path: read it from `swagger.json`; the probe script does this) | **Latest trading day only**, published after the close | Endpoint names confirmed from [edwardhu/future_prediction](https://github.com/edwardhu/future_prediction) and [twjackysu/TWSEMCPServer](https://github.com/twjackysu/TWSEMCPServer); both note "僅最新一個交易日" |
| `https://www.taifex.com.tw/cht/3/dlOptDataDown` (POST → CSV) | Historical options daily report, per strike. Params `down_type=1`, `commodity_id=TXO`, `queryStartDate`, `queryEndDate` (yyyy/mm/dd, ≤ 30 days per request). Columns: 交易日期, 契約, 到期月份(週別), 履約價, 買賣權, 開/高/低/收盤價, 成交量, 結算價, **未沖銷契約數** (= OI) | Daily | For OI-change vs yesterday and for backfilling. Columns confirmed from [histockhero's notebook](https://github.com/histockhero/youtube_code/blob/main/Part4_%E9%81%B8%E6%93%87%E6%AC%8A%E8%B3%87%E6%96%99%E4%B8%8B%E8%BC%89%EF%BC%86%E6%8A%80%E8%A1%93%E5%88%86%E6%9E%90/4.2%E9%81%B8%E6%93%87%E6%AC%8A%E6%8A%80%E8%A1%93%E5%88%86%E6%9E%90/%E5%8F%B0%E6%8C%87%E9%81%B8%E6%94%AF%E6%92%90%E5%A3%93%E5%8A%9B%E5%9C%96(%E5%90%AB%E5%B7%AE%E5%80%BC).ipynb); older code calls it `optDataDown` ([PTT](https://www.ptt.cc/bbs/Python/M.1646569595.A.6B8.html)) |
| `https://mis.taifex.com.tw/futures/api/getQuoteList` (POST JSON `{MarketType:"0", SymbolType:"F"/"O", KindID:"1", CID:"TXF"/"TXO"}`) | The quote list behind TAIFEX's 行情資訊網: bid/ask, last, volume, open/high/low, reference. [TaiexChipAnalyzer](https://github.com/joekisoul-code/TaiexChipAnalyzer) reports it also carries OI for TXF | Real-time | **Unverified whether the OI value is intraday or the last settlement.** If it moves during the session, the "end-of-day" limit above disappears for TXO too |
| `data.gov.tw` datasets [11320](https://data.gov.tw/dataset/11320) 選擇權每日交易行情, [45746](https://data.gov.tw/dataset/45746) 未平倉量增減, [11322](https://data.gov.tw/dataset/11322) P/C ratio, [11600](https://data.gov.tw/dataset/11600) 三大法人選擇權 | Same data, catalogued | Daily | Point at the same TAIFEX resources |

**Working assumption**: OI is a settlement-time number — design the levels
as "yesterday's walls", refreshed once when TAIFEX publishes (day session
~15:00; the combined-session file lands the next morning). If the MIS quote
list turns out to update OI intraday, the same panel simply re-polls it.

**Deployment note**: the daily TAIFEX numbers do not need the local proxy at
all. TaiexChipAnalyzer's pattern — a GitHub Actions cron fetches TAIFEX, writes
static JSON into the repo, GitHub Pages / Vercel serves it — means the
deployed site can show OI walls, P/C ratio and 三大法人 for every visitor,
with the local proxy only needed for live quotes and 價平和.

### Per-indicator verdict

| Indicator | Source | Latency | Already have | Effort |
|---|---|---|---|---|
| 價平和 (live) | Shioaji chain, ATM row | 10 s (existing chain poll) | chain + ATM detection | S — one derived number |
| 價平和 intraday line | proxy samples the two ATM contracts, or `api.ticks()` for the day | 10 s | `sinopac.py` scaffolding | S–M |
| Max Call/Put OI, OI change | TAIFEX options daily report (today) + `optDataDown` (yesterday) | daily | `OIProfile`, `MaxPain`, chain row shape | M — new `taifex.py` source + merge OI into chain rows |
| P/C ratio, 三大法人 futures net OI, 大額交易人 | TAIFEX OpenAPI | daily | nothing | S — read-only fetch + tiles |
| K-line with level overlays | Shioaji kbars (have) + the levels above | 10 s | `KBarChart` | S — add horizontal-line prop |
| 主力成本線 | Shioaji 1-min kbars → VWAP, re-anchor on volume spike | 10 s | bars endpoint | M — the anchoring rule is ours to define |
| 關卡價 | 30 daily bars → monthly max/min 振幅 → open ± k·range | daily | bars endpoint | S — formula is an approximation of his |
| 籌碼差額 | Shioaji TXF ticks, tick_type × volume, large-lot filter | seconds | nothing | M — tick subscription in the proxy; proxy stays read-only |
| 五大盤型 | his course | — | — | Out of scope for code; could be a help-drawer page |

Everything stays inside the existing constraints: the proxy remains
read-only (no order endpoints), the frontend stays zero-build, and the
frontend keeps working on mock data when the proxy is absent.

## 4. Proposed shape

First screen = **Levels**. One price ladder, vertical, spot in the middle:

```
   22,300 ── 壓力  max Call OI 18,420 口  (+2,310 vs yday)
   22,150 ── 關卡 上
   22,050 ┄┄ 價平 + 價平和 (289)
   21,873 ●  TXF  +0.85%   價平和 289 ▲ +14 since open
   21,850 ── 成本線 (VWAP)  21,812
   21,650 ┄┄ 價平 − 價平和
   21,600 ── 關卡 下
   21,500 ── 支撐  max Put OI 21,960 口  (+840)
```

Beside it: the K-line (existing `KBarChart`) with the same lines overlaid; a
mirrored OI bar chart by strike (existing `OIProfile`, now with real OI and an
OI-change column); tiles for P/C ratio, 三大法人 淨OI, 籌碼差額. Weekly /
monthly toggle applies to the options-derived lines.

Demote, don't delete: the 3D P&L surface, the IV surface and the strategy
builder move under a **Lab** tab. They keep working unchanged.

## 5. Phasing

- **P0 (one PR)**: `taifex.py` source in the proxy (options daily report +
  `optDataDown` for yesterday, cached per day); OI merged into TXO chain rows;
  live 價平和 tile; Levels ladder with spot / 價平和 band / max OI walls;
  K-line overlays. Verify: `OIProfile` shows non-zero TXO OI; ladder lines
  match the TAIFEX numbers by hand.
- **P1**: 價平和 intraday sampler; 關卡價 and 成本線; P/C ratio and 三大法人
  tiles.
- **P2**: 籌碼差額 proxy from ticks; weekly/monthly ladder toggle; Lab tab
  reshuffle and mobile layout of the ladder.

## 6. Verify on your machine first

```bash
cd server
python3 check_taifex.py
```

It reads TAIFEX's `swagger.json`, prints every options-related path, calls
the daily report(s) and the CSV download, and tells you which one carries a
per-strike OI column and how many rows came back. Step 4 posts to the MIS
quote list for TXF and TXO and prints any OI-like key — run it twice a few
minutes apart during a session to see whether that number moves. No credentials, nothing is
written. Paste the output back and the P0 `taifex.py` can be written against
the real field names instead of guesses.
