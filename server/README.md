# 行情代理 — 期貨選擇權 + 台指選擇權（唯讀）

把兩個券商的期權行情餵給 Options Lab 前端。前端偵測到這個 proxy 活著就自動切到真實
數據（頂欄顯示 `● IB` 或 `● SinoPac`），偵測不到就留在 mock（`○ MOCK`）。

| 資料源 | 商品 | 需要 |
|---|---|---|
| **IB**（Interactive Brokers）| ZC / ZS / ZW（CBOT 穀物）、ES（CME 小標普）、GC（COMEX 黃金）、CL / NG（NYMEX 原油/天然氣）| 本機開著 TWS 或 IB Gateway |
| **SinoPac**（永豐金 Shioaji）| **TXO 台指選擇權** | API key + secret key（不用憑證）|

每個商品在 `main.py` 的 `PRODUCTS` 用 `source` 欄位指定走哪一邊，前端則看 `products.js`
的 `live` 欄位。各商品合約規格見 `../docs/products.md`。

```
                       ┌─ TWS API ─▶ TWS / IB Gateway ─▶ IB
瀏覽器 ─HTTP─▶ proxy ──┤
              (:8720)  └─ Shioaji ──▶ 永豐金
```

## 只做研究、不下單 — 這樣接就對了

這個 proxy **只讀行情與持倉，永遠不送任何委託單**（沒有下單端點）。純研究的話：

1. **勾 Read-Only API 最安全**。TWS → Global Configuration → API → Settings 把
   **Read-Only API 打勾**，這樣連理論上都不可能下單，proxy 照樣能讀行情跟部位。
2. **不用付即時行情訂閱也能用**。沒訂閱交易所即時數據時，IB 會給**延遲 15 分鐘**的資料；
   proxy 預設就是走這個（`IB_MARKET_DATA_TYPE=3`）。要即時報價才需要各交易所的月費訂閱。
3. **紙上帳戶（paper）就夠**做純研究、拿延遲資料，不碰真錢。
   ⚠️ 但**部位匯入（⟳ IB）只有帳戶真的持有那些選擇權才會有東西**；paper 沒部位就回空陣列。
4. **線上 Vercel 版打不到你本機 proxy**（瀏覽器擋 public 頁面呼叫 localhost）。
   要用真實資料，前端也要在本機跑（見下面第 3 步）。

會踩到的實際上限：串流報價「行數」IB 預設約 100 條（鏈一次抓 ~34 個合約收完就取消，不會爆）；
歷史 K 棒有 pacing 限制（proxy 快取 5 分鐘）。

## 1a. 永豐 Shioaji 設定（TXO，一次性）

純研究只要 **API key + secret key**，**不需要電子憑證**（憑證只有下單和查帳務才要）。

1. 到永豐 [Shioaji 憑證與金鑰頁](https://sinotrade.github.io/zh_TW/tutor/prepare/token/) 產生
   API key / secret key。行情權限即可，不必開「交易」權限。
2. 裝套件並設環境變數後啟動 proxy：

```bash
pip install shioaji                      # 只有要用 TXO 才需要
export SINOPAC_API_KEY=你的_api_key
export SINOPAC_SECRET_KEY=你的_secret_key
export SINOPAC_SIMULATION=1              # 1=模擬(預設，不碰真錢) 0=正式行情
uvicorn main:app --host 127.0.0.1 --port 8720
```

**接不上時先跑自我檢查**（逐步檢查套件 → 金鑰 → 登入 → 合約 → 報價）：

```bash
python3 check_sinopac.py
```

它會告訴你確切卡在哪一步，並針對常見原因給建議（金鑰帶到引號、沒開行情權限、
模擬環境沒申請、連不到伺服器…）。**輸出只顯示金鑰長度、不含金鑰內容**，可以安全貼給別人求助。

proxy 起來後也能查：`curl "http://127.0.0.1:8720/api/health?pid=txo"` → `"connected": true`。
回傳的 `sinopac` 區塊會分別告訴你 `installed`（套件裝了沒）和 `configured`（金鑰設了沒）。

**這條路徑的已知限制**
- Shioaji 快照**不含未平倉量（OI）**。proxy 改從 **期交所每日行情**補上（`taifex.py`，見下方
  「TAIFEX 未平倉」）：`/api/chain/txo` 的 rows 會帶前一交易日的 `oi` 與 `oiChg`，Levels 頁的
  壓力 / 支撐牆走 `/api/oi/txo`。期交所連不上時 rows 的 `oi` 維持 0（前端偵測到整條鏈都沒 OI 時，
  流動性評分會自動改用買賣價差判斷，不會誤標成「乾涸」）。
- 快照也不含希臘值 → IV 由權利金反推（Black-Scholes on 加權指數，跟前端 TXO 定價同一套）。
- **不提供部位匯入**：帳務要憑證，唯讀研究刻意不設，所以 TXO 沒有 `⟳` 匯入鈕。

## 1b. TWS / IB Gateway 設定（期貨選擇權，一次性）

1. 登入 TWS（或 IB Gateway）。
2. **File → Global Configuration → API → Settings**：
   - 勾選 **Enable ActiveX and Socket Clients**
   - 純研究建議勾 **Read-Only API**（proxy 只讀，勾了更保險）
   - Socket port 記下來：TWS 紙上 `7497`、TWS 實盤 `7496`、Gateway 紙上 `4002`、Gateway 實盤 `4001`（proxy 會依序自動試這四個）
   - Trusted IPs 加 `127.0.0.1`
3. 沒訂閱即時行情也沒關係——proxy 預設 `IB_MARKET_DATA_TYPE=3`，自動用 **15 分鐘延遲數據**。

## 2. 啟動 proxy

```bash
cd server
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8720
```

檢查：`curl http://127.0.0.1:8720/api/health` → `"connected": true` 就通了。

## 3. 開前端（本機）

```bash
cd design_handoff_options_lab
python3 -m http.server 8080
```

瀏覽器開 `http://localhost:8080`，切商品：**TXO** 走永豐、其餘走 IB。

- 到期日列會換成 IB 的真實月選到期日
- Chain 頁是真實報價（bid/ask/last/IV/OI/Δ）
- spot 會跟著該到期日對應的期貨月份價格
- 連線後：報價每 10 秒、鏈每 30 秒自動刷新；頂欄時間戳超過 45 秒會變 `STALE`
- Calculator 的 Legs 面板出現 **⟳ IB**：一鍵把你的真實部位載入 legs（真實成本 + 各腿到期日）

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `SINOPAC_API_KEY` | — | 永豐 API key（TXO 必需）|
| `SINOPAC_SECRET_KEY` | — | 永豐 secret key |
| `SINOPAC_SIMULATION` | `1` | 1=模擬 0=正式行情 |
| `SINOPAC_TXO_CATEGORIES` | `TXO,TX1,TX2,TX4,TX5` | 要收的選擇權類別（月選 + 週選）|
| `RISK_FREE_TW` | `0.015` | TXO 反推 IV 用的無風險利率 |
| `IB_HOST` | `127.0.0.1` | TWS / Gateway 位址 |
| `IB_PORTS` | `7497,7496,4002,4001` | 依序嘗試的 port |
| `IB_CLIENT_ID` | `27` | API client id（跟其他程式撞了就換一個） |
| `IB_MARKET_DATA_TYPE` | `3` | 1=即時 3=延遲（沒訂閱自動退） |
| `RISK_FREE` | `0.04` | IV 反推用的無風險利率 |

## 端點（全部唯讀）

`{pid}` = `txo`（永豐）/ `zc` / `zs` / `zw` / `es` / `gc` / `cl` / `ng`（IB）。
端點形狀兩邊一致，前端不需要知道背後是哪個券商。

| 端點 | 回傳 |
|---|---|
| `GET /api/health?pid=` | `{connected, source, ib:{...}, sinopac:{...}}` — 帶 `pid` 時只回報服務該商品的那個資料源 |
| `GET /api/quote/{pid}` | 近月期貨報價 `{last, bid, ask, close, chgPct, month}` |
| `GET /api/expiries/{pid}` | `[{id: "20260821", label: "SEP", dte, date}]` |
| `GET /api/chain/{pid}?expiry=20260821` | `{underlying: {month, price}, rows: [...]}`（rows 跟前端 genChain 同形狀） |
| `GET /api/bars/{pid}?bar=1 day&duration=3 M` | 近月期貨歷史 K 棒 `{bars: [{t,o,h,l,c,v}]}` |
| `GET /api/positions/{pid}` | 帳戶內該商品的選擇權部位 `{positions: [{side, type, strike, premium, qty, expiry, dte}]}` |
| `GET /api/oi/txo?expiry=20260916` | 該到期日**全部履約價**的未平倉（期交所前一交易日）`{date, prevDate, rows: [{strike, call: {oi, oiChg, vol, settle}, put}], maxCallOi, maxPutOi, totals}`；只有 `PRODUCTS` 標了 `"oi": "taifex"` 的商品有，其他回 404 |
| `GET /api/market/txo` | 籌碼（期交所前一交易日）`{pcRatio: {ratio, chg, series[23 日]}, foreign: {net, chg, byContract}, top10: {net, chg, specificNet, month}}`。外資淨未平倉是大台＋小台/4＋微台/20 的大台當量口數（期交所大額交易人表自己的換算） |

`/api/positions` 只回 secType == FOP 且 symbol / tradingClass 對得上的部位；premium 已換算成
「點數」（averageCost ÷ multiplier），跟前端 legs 的 premium 慣例一致。**沒有任何下單端點。**

## 已知限制

- IB 路徑只接標準月選（trading class `OZC` / `OZS` / `OZW` / `ES` / `OG` / `LO` / `ON`），weekly 先不接。
  新商品的 tradingClass 是標準月選的最佳猜測；對不上時 `_sec_def()` 會退到到期日最多的那個 class。
  （永豐路徑的 TXO 月選 + 週選都收。）
- IV Surface 3D 仍是造型化 mock，還沒接真實曲面。
- 期權鏈快照等 6 秒收一輪，延遲數據偶爾會有缺格（顯示 0）；30 秒內重複請求走快取。
- 期貨選擇權理論價用歐式 Black-76 近似（真實是美式），OI 靠 generic tick 101。

## TAIFEX 未平倉（`taifex.py`）

Shioaji 沒有 OI；期交所每天收盤後（日盤約 15:00）公布每檔履約價的**未沖銷契約數**。
`taifex.py` 只打一支公開端點——期交所「選擇權每日交易行情」的 CSV 下載
（`https://www.taifex.com.tw/cht/3/dlOptDataDown`，不用帳號）——抓最近 7 天的 TXO 日盤資料，
一次得到：

- 最新交易日每檔的 OI、成交量、結算價；
- 前一交易日的 OI → `oiChg`（未平倉增減，跟各家「支撐壓力表」的變化欄一樣）；
- `契約到期日` → 對到前端的到期日 id（`YYYYMMDD`），週選 / 月選都對得上。

快取 15 分鐘；期交所連不上時回 `None`，前端安靜留在原本的資料。**這是前一交易日的數字**
（「昨天的牆」），設計上就是這樣用；盤中不會變。

- `/api/chain/txo` 自動把 OI 併進 rows（`oi`, `oiChg`），Chain 頁的 OI 欄 / OI Profile / Max Pain 就有資料。
- `/api/oi/txo?expiry=YYYYMMDD` 回**整個履約價範圍**（鏈只有 ±8 檔），附最大 Call OI（壓力）/
  最大 Put OI（支撐）的履約價與總量，給 Levels 頁用。不帶 `expiry` → 最近一個未到期的。
- `/api/market/txo` 回籌碼三項：OpenAPI `PutCallRatio`（全市場 P/C，約 23 個交易日）、
  三大法人期貨 CSV（`futContractsDateDown`，TXF / MXF / TMF 三支）算出外資大台當量淨未平倉與對前日增減、
  大額交易人 CSV（`largeTraderFutDown`）的近月前十大淨部位與特定法人子集。

**收盤快照**：`python3 taifex.py --write ../design_handoff_options_lab/taifex-eod.js` 把上面所有東西
（加權指數收盤、五個到期日的每檔收盤/最佳買賣/結算/OI、約 100 根真實台指期日 K（日盤與全日盤兩組，
全日盤 = 期交所記在同一營業日下的盤後列 + 日盤列，一根 15:00 → 13:45）、籌碼三項）寫成一個
純 ASCII 的 JS 檔；前端沒有 proxy 時就吃它（`data-live.js` 的 fallback），頂欄標 `● TAIFEX 09/11 EOD`。
Vercel 上看到的就是這份；交易日 15:00 後重跑一次再 commit 就是新的。

要先確認你的機器連得到期交所（含 OpenAPI 與 MIS 即時報價的 OI 欄位）：

```bash
python3 check_taifex.py
```

它會列出 OpenAPI 的選擇權相關路徑、呼叫每日行情與 CSV 下載，回報哪一個帶每檔 OI 欄位；
第 4 步另外查 MIS 即時報價（`mis.taifex.com.tw`）的 `OpenInterest` 盤中會不會動——如果會，
Levels 的牆就能改成盤中刷新。不需要帳號、不會寫入任何東西。設計背景見 `../docs/daytrade-redesign.md`。
