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
- **Verified 2026-09-13** (network policy widened): the TAIFEX endpoints were
  probed from the authoring container and the reference sites were opened in a
  headless browser — see §2b for what each one actually shows and §3 for the
  real field names. Only 玩股網 stayed out of reach (Cloudflare challenge).
- **P0 is built** on this branch: `server/taifex.py` (daily per-strike OI +
  change, merged into the TXO chain and served whole by `/api/oi/txo`), a
  **Levels** tab (ladder, 價平和 tiles, walls on the K-line, OI table with the
  change column). See §5 for the status per item.

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

## 2b. Reference sites — what they actually show

Opened 2026-09-13 in headless Chromium (all requests relayed through the
sandbox proxy), full-page screenshots in `design-reference/refs/`. Only what
is visible on those pages is recorded here; the TAIFEX numbers on the 搖錢樹
page were cross-checked against our own `taifex.py` output and match.

### 選擇權搖錢樹 · 最大未平倉量 (`optree.tw/home/tools/max_oi_amount`)

`refs/optree-max-oi-full.jpg`, `refs/optree-max-oi-fold.jpg`

- **Context row** above the table: 大盤指數 46184.9 (−755.6), 期貨指數 46331.0
  (−411.0), 大盤20日均線 46025.3, 大盤5日均線 46948.2, 資料時間 2026/09/11
  16:30:10 — a post-close, once-a-day view.
- **Summary strip**: 日期 · 到期月份 (dropdown 台指2609 / 台指2610 / 台指4W2609)
  · 買權最大未平倉量 **SC50000** · 賣權最大未平倉量 **SP43000**. The SC / SP
  prefix (sell call / sell put) bakes the seller's-side reading into the label.
- **Body "選擇權未平倉變化 2026-09-11 [台指2609]"**: one row per strike over the
  whole listed range (55800 down to 35600), calls left, puts right, strike in the
  middle. Each cell is `(±change) OI` plus a horizontal bar: call bars grow to
  the left in pink, put bars to the right in light green, and the **max cell on
  each side is a saturated bar**. The change is colored red for + and green
  for −. Dashed horizontal lines mark 5MA(46948.2) (orange) and 20MA(46025.3)
  (blue) at their price rows; the strike nearest the index (46150) is a dark
  badge.
- Takeaway: strike axis = price axis. The OI table *is* the price ladder; the
  walls are simply the longest bar per side, and OI change is a first-class
  column, not a tooltip.

### OP凱文 · 選擇權價平和 (`opkevin.cc/選擇權價平和/` → now `opop.tw`)

`refs/opkevin-atm-straddle-fold.jpg`, `refs/atm-straddle-intraday.jpg`

- The article itself is text: 價平和 = 價平 Call 權利金 + 價平 Put 權利金.
  Adding the two removes direction; always using the ATM strike removes strike;
  rates barely matter; compare on the same weekday and time drops out — what is
  left is volatility. Two worked weeks (Wed→Tue 263→117 vs 284→121) show a
  higher-straddle week = higher-volatility week. Rule: 價平和 normally shrinks
  every session; *not shrinking much* hints volatility is expanding, *rising*
  means it certainly is. Warning: some brokers' T-quote ATM is the wrong strike.
- The one screenshot in the article (from 選擇權駕訓班, 2024/1/17 night session)
  is the actual visualization: a **tile row** — 即時日期 · 夜盤日期 · 時間 · 加權
  17346.9 · 週小台 · 大台 17328 · **前盤價平和 100 · 流失 −25 · 即時價平和 75.5 ·
  價平合約 17350** · 夜盤 2401W3 — then an **intraday 價平和 line** (y 56–119)
  with a horizontal reference at the previous session's value and one at the
  current value, and under it the futures price line on the same time axis.
- Takeaway: show the straddle as *number tiles* (previous session, current,
  decay "流失", the ATM contract) and as an *intraday line against the
  previous-session reference*, paired with the price chart.

### CMoney · 自由人 多空指南針 (PC `id=3092`, APP `id=3461`, App Store `id1443991843`)

`refs/cmoney-compass-pc-fold.jpg`, `refs/compass-pc-levels-panel.jpg`,
`refs/compass-pc-costline-netflow.jpg`, `refs/compass-app-1..4.jpg`

Marketing pages, no interactive tool; the UI is visible in the product
screenshots they embed.

- **PC** (dark terminal): top bar 成交價 (large, red) ▲171 · 成本價 (yellow).
  A 1-minute candle chart (red up / green down) with a cyan 5MA and the yellow
  **成本線 drawn as a step line** — flat until a volume breakout, then it
  ratchets — plus a white horizontal line at the open. A right-hand **關卡價
  panel**: 場外關卡價 16628 / 全壘關卡價 16724 / 三壘關卡價 16764 / 二壘關卡價
  16790 / 一壘關卡價 16821 as green rows with an 自動 / 上 / 下 toggle, and
  "近1日 波動放大 2/20 …" ranks. Lower pane: the cumulative **多空差額** line
  (yellow) over per-minute red/green bars, and a **多空溫度計** — one horizontal
  red bar with the number (13269). The 五大盤型 are tabs (長紅K突破 / 長黑K突破 /
  V轉紅K / A轉黑K / 盤整抓轉折). Time & sales on the right.
- **App** (iPhone): header 成交價 22087 ▼65 · 成本價 22130 · **距一壘 22041 差 46
  點** (distance to the next 關卡) with a diamond 壘包 indicator. The 1-minute
  chart carries **right-axis price tags** 開22181 / 昨22152 / 成22130 on dashed
  lines, the 5MA, the step 成本線, and the session high/low labeled (22211 /
  22048). The 台指振幅 tab is a plain **list of levels**: 場外 24267 / 全壘 23287
  / 三壘 22929 / 二壘 22691 / 一壘 22340 / 近周低 21998, 近周振幅 452, with
  自動 / 上方 / 下方. Tabs: 台指K線圖 · 台指振幅 · 聊天室 · 學習區 · 更多.
- Takeaway: levels are a **list** (not a scaled chart), the same levels are
  **price tags on the K-line's right axis**, and the headline number is
  **distance to the next level**. No options reading anywhere — confirms §1.

### 玩股網 · 選擇權支撐壓力表 (`wantgoo.com/option/support-resistance`) — not captured

Both curl and the relayed headless browser get Cloudflare's "Just a moment…"
challenge (HTTP 403). Needs a human browser session; nothing recorded.

### What the Levels tab takes from each

| Element | From | In our Levels tab |
|---|---|---|
| Level **list** with distance from spot | 多空指南針 app (距一壘 … 差 46 點) | The ladder: price · what it is · Δ pts / Δ % per row |
| Price **tags on the K-line's right axis** | 多空指南針 app (開 / 昨 / 成) | `PriceChart levels` — dashed line + tag for 壓力 / ±straddle / 支撐 |
| Mirrored OI bars, `(±chg) OI`, saturated max bar | 搖錢樹 | `OIProfile showChange walls` centered on ATM |
| 價平和 tiles: current · 前盤 · 流失 | 選擇權駕訓班 screen | ATM straddle tile + "vs prev settle" tile (previous session's TAIFEX settlement of the same two contracts) |
| Seller's-side labels (SC / SP) | 搖錢樹 | "max call OI" / "max put OI" spelled out under 壓力 / 支撐 |

Not taken (P1/P2): 關卡價, 成本線, 籌碼差額, the intraday 價平和 line.

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

#### Probe results (run from this container, 2026-09-13)

`python3 server/check_taifex.py` answered on every step:

- **OpenAPI** `DailyMarketReportOpt`: latest trading day only (2026-09-11),
  12,060 rows, columns `Date, Contract, ContractMonth(Week), StrikePrice,
  CallPut, Open, High, Low, Close, Volume, SettlementPrice, OpenInterest,
  BestBid, BestAsk, …, TradingSession`. OI is on the 一般 rows; 盤後 rows show
  `-`. Contract codes seen: `202609` (monthly), `202609F2/F3/F4` (Friday
  weeklies), `202609W4` (Wednesday weekly). No expiry *date* column.
  `DailyMarketReportFut` (TX rows carry `OpenInterest`, e.g. 202609 = 88,464)
  and `PutCallRatio` (23 rows with `PutOI`, `CallOI`, `PutCallOIRatio%`) work
  too; most other catalogue paths return non-JSON.
- **CSV** `dlOptDataDown` (POST): 22 columns incl. `未沖銷契約數` **and**
  `契約到期日` (YYYYMMDD) — which is why `taifex.py` uses this and not the JSON:
  one request gives today, the previous sessions (for the change column) and
  the expiry-date mapping to the frontend's `YYYYMMDD` expiry ids.
- **MIS quote list** `getQuoteList`: TXO rows do carry an `OpenInterest` key
  (1,873 of 3,083 rows non-empty on a Saturday). An F2 contract that had
  already expired on 9/11 still showed a non-zero value, which looks like the
  last settlement's number rather than a live one — **intraday behaviour is
  still unverified**; run step 4 twice during a session to settle it.

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

- **P0 — done on this branch** (`claude/gracious-galileo-wr2whl`):
  - `server/taifex.py`: one `dlOptDataDown` request (7-day window, cached 15
    min) → per-strike OI, OI change vs the previous session, settlement prices,
    and the contract-month → expiry-date map. `GET /api/oi/txo?expiry=YYYYMMDD`
    serves the whole strike range with the max-OI strikes and totals;
    `/api/chain/txo` merges the same OI (+ `oiChg`) into the rows it already
    returns. Public data — works without Shioaji credentials.
  - Frontend: **Levels** tab (first tab, default for new users): tiles (ATM
    straddle, vs prev settle, 壓力, 支撐, put/call OI), the ladder, the K-line
    with the four option levels tagged on the right axis, and the OI table with
    the change column and highlighted walls. `products.js` `oiSource: 'taifex'`
    on TXO turns the OI fetch on; everything else derives from the chain rows.
    Mock mode keeps working and is labeled `○ MOCK OI`.
  - Verified in headless Chromium against a stubbed Shioaji feed + the real
    TAIFEX data for 2026-09-11: 壓力 50,000 (3,245, +274) / 支撐 43,000
    (2,899, +891) for the 9/16 monthly — the same numbers 搖錢樹 shows — and
    the chain's OI column matches its rows (45800 call 434, 46000 call 459 /
    put 941). Zero console errors in dark, light, phone and mock runs.
  - Not in P0: the intraday 價平和 line, 關卡價 / 成本線 (P1); mobile ladder (P2).
- **Done since (same branch)**: 籌碼 strip (P/C ratio with history, 外資 net
  futures in TX-equivalent contracts, top-10 traders), the end-of-day snapshot
  + a daily GitHub Action so the deployed site carries real previous-session
  numbers, K-line MA5/10/20/60 + 日盤/全日盤, and the **Lab tab** (3D P&L
  surface and IV surface demoted out of the working tabs; Calculator's centre
  is now the full-size payoff chart).
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

## 7. 關卡價 — what could be reverse-engineered (2026-09-13)

自由人 publishes no formula. CMoney's product copy says the app "tracks daily
volume and range, takes the largest and smallest range of the last month and
derives the day's target levels", and that "二壘 is reached on about 70% of
days" (both quoted on cmoney.tw; a third-party write-up of his book's
日振幅操盤法 uses a 5-day window instead — that variant does **not** fit the
app's numbers below). So the screenshots were matched against TAIFEX's own TX
daily history (front month = highest-volume contract, day session):

| Screenshot | Date found | Evidence |
|---|---|---|
| PC, 下方關卡價 16628 / 16724 / 16764 / 16790 / 16821, 成交價 16888 ▲171 | **2023/06/09** close | TX 202306: open 16802, high = close 16888, prev settle 16717 → +171 ✓ |
| APP 日盤, 成交價 22087 ▼65, 開 22181, 昨 22152, 距一壘 22041 差 46 | **2024/08/28** 10:36 | TX 202409: open 22181, prev settle 22152 ✓; running high 22211 |
| APP 周振幅, 近周低 21998 / 近周振幅 452, upper 22340 / 22691 / 22929 / 23287 / 24267 | week of **2024/08/26** | day-session low 21998 (8/27), high 22450 (8/26) → 452 ✓ |

Brute force over bases (open / high / low / prev close / prev settle / night
H-L) × range statistics (min / max / mean / median / σ / quantiles over 1–40
sessions, day / night / full session, calendar-month and weekly variants) ×
multipliers gave exactly **one** combination that fits both day-mode samples
with multiplier 1:

    下方一壘 = 今日高 − min(日盤振幅 of the previous N sessions), any N in 14–26
    2023/06/09: 16888 − 67  (5/22's range) = 16821 ✓
    2024/08/28: 22211 − 170 (8/16's range) = 22041 ✓

N = 20 ("一個月") is what the app uses. The other four levels have only one
5-level sample, so they are **this site's definition**, chosen to be natural
statistics of the same 20 ranges and to land within a point where that is
possible: 二壘 = 30th percentile (his "70%" statement; 16791 vs his 16790),
三壘 = mean (16765 vs 16764), 全壘 = mean + 1σ (16724 = 16724), 場外 = max
(16644 vs his 16628 — his 場外 is wider; not reproduced). Upper levels mirror
the lower ones from today's low. The 周振幅 tab could not be reproduced at all
(no weekly-range statistic gives 342 above the week's low); it is not built.

The app labels this: "一壘＝驗證自由人公式；其餘為本站統計定義". More dated
screenshots (any day, both lists visible) would pin down the rest — the
matching scripts live in the session scratchpad (`re/find_dates.py`,
`re/consistent.py`).
