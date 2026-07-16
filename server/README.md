# IB Proxy — 期貨選擇權即時資料 + 帳戶部位（唯讀）

把你本機 **TWS 或 IB Gateway** 的期貨選擇權行情（以及你的部位）餵給 Options Lab 前端。
前端偵測到這個 proxy 活著就自動切到真實數據（頂欄顯示 `● IB`），偵測不到就留在 mock（`○ MOCK`）。

支援商品：**ZC / ZS / ZW**（CBOT 玉米/黃豆/小麥）、**ES**（CME 小型標普500）、
**GC**（COMEX 黃金）、**CL / NG**（NYMEX 原油/天然氣）。
（TXO 台指不走 IB，永遠是 Black-Scholes mock。各商品規格見 `../docs/products.md`。）

```
瀏覽器 ──HTTP──▶ 這個 proxy (FastAPI, :8720) ──TWS API──▶ TWS / IB Gateway ──▶ IB
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

## 1. TWS / IB Gateway 設定（一次性）

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

瀏覽器開 `http://localhost:8080`，頂欄商品切到 **ZC / ZS / ZW / ES / GC / CL / NG**：

- 到期日列會換成 IB 的真實月選到期日
- Chain 頁是真實報價（bid/ask/last/IV/OI/Δ）
- spot 會跟著該到期日對應的期貨月份價格
- 連線後：報價每 10 秒、鏈每 30 秒自動刷新；頂欄時間戳超過 45 秒會變 `STALE`
- Calculator 的 Legs 面板出現 **⟳ IB**：一鍵把你的真實部位載入 legs（真實成本 + 各腿到期日）

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `IB_HOST` | `127.0.0.1` | TWS / Gateway 位址 |
| `IB_PORTS` | `7497,7496,4002,4001` | 依序嘗試的 port |
| `IB_CLIENT_ID` | `27` | API client id（跟其他程式撞了就換一個） |
| `IB_MARKET_DATA_TYPE` | `3` | 1=即時 3=延遲（沒訂閱自動退） |
| `RISK_FREE` | `0.04` | IV 反推用的無風險利率 |

## 端點（全部唯讀）

`{pid}` = `zc` / `zs` / `zw` / `es` / `gc` / `cl` / `ng`。

| 端點 | 回傳 |
|---|---|
| `GET /api/health` | `{connected, host, port, marketDataType}` |
| `GET /api/quote/{pid}` | 近月期貨報價 `{last, bid, ask, close, chgPct, month}` |
| `GET /api/expiries/{pid}` | `[{id: "20260821", label: "SEP", dte, date}]` |
| `GET /api/chain/{pid}?expiry=20260821` | `{underlying: {month, price}, rows: [...]}`（rows 跟前端 genChain 同形狀） |
| `GET /api/bars/{pid}?bar=1 day&duration=3 M` | 近月期貨歷史 K 棒 `{bars: [{t,o,h,l,c,v}]}` |
| `GET /api/positions/{pid}` | 帳戶內該商品的選擇權部位 `{positions: [{side, type, strike, premium, qty, expiry, dte}]}` |

`/api/positions` 只回 secType == FOP 且 symbol / tradingClass 對得上的部位；premium 已換算成
「點數」（averageCost ÷ multiplier），跟前端 legs 的 premium 慣例一致。**沒有任何下單端點。**

## 已知限制

- 只接標準月選（trading class `OZC` / `OZS` / `OZW` / `ES` / `OG` / `LO` / `ON`），weekly 先不接。
  新商品的 tradingClass 是標準月選的最佳猜測；對不上時 `_sec_def()` 會退到到期日最多的那個 class。
- IV Surface 3D 仍是造型化 mock，還沒接真實曲面。
- 期權鏈快照等 6 秒收一輪，延遲數據偶爾會有缺格（顯示 0）；30 秒內重複請求走快取。
- 期貨選擇權理論價用歐式 Black-76 近似（真實是美式），OI 靠 generic tick 101。
