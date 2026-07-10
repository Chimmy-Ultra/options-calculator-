# IB Proxy — 農產品期貨選擇權（ZC / ZS / ZW）

把你本機 **TWS 或 IB Gateway** 的 CBOT 穀物期貨選擇權行情餵給 Options Lab 前端。
前端偵測到這個 proxy 活著就自動切到真實數據（頂欄顯示 `● IB`），偵測不到就留在 mock（`○ MOCK`）。

```
瀏覽器 ──HTTP──▶ 這個 proxy (FastAPI, :8720) ──TWS API──▶ TWS / IB Gateway ──▶ IB
```

## 1. TWS / IB Gateway 設定（一次性）

1. 登入 TWS（或 IB Gateway）。
2. **File → Global Configuration → API → Settings**：
   - 勾選 **Enable ActiveX and Socket Clients**
   - 取消勾選 **Read-Only API**（本 proxy 只讀行情，勾著其實也行）
   - Socket port 記下來：TWS 紙上 `7497`、TWS 實盤 `7496`、Gateway 紙上 `4002`、Gateway 實盤 `4001`（proxy 會依序自動試這四個）
   - Trusted IPs 加 `127.0.0.1`
3. 沒訂閱 CME 即時行情也沒關係——proxy 預設 `IB_MARKET_DATA_TYPE=3`，自動用 **15 分鐘延遲數據**。

## 2. 啟動 proxy

```bash
cd server
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8720
```

檢查：`curl http://127.0.0.1:8720/api/health` → `"connected": true` 就通了。

## 3. 開前端

```bash
cd design_handoff_options_lab
python3 -m http.server 8080
```

瀏覽器開 `http://localhost:8080`，頂欄商品切到 **ZC / ZS / ZW**：

- 到期日列會換成 IB 的真實月選到期日
- Chain 頁是真實報價（bid/ask/last/IV/OI）
- spot 會跟著該到期日對應的期貨月份價格

> Vercel 上的線上版打不到你本機的 proxy（瀏覽器擋 private network），要用真實數據請照上面在本機開前端。

## 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `IB_HOST` | `127.0.0.1` | TWS / Gateway 位址 |
| `IB_PORTS` | `7497,7496,4002,4001` | 依序嘗試的 port |
| `IB_CLIENT_ID` | `27` | API client id（跟其他程式撞了就換一個） |
| `IB_MARKET_DATA_TYPE` | `3` | 1=即時 3=延遲（沒訂閱自動退） |
| `RISK_FREE` | `0.04` | IV 反推用的無風險利率 |

## 端點

| 端點 | 回傳 |
|---|---|
| `GET /api/health` | `{connected, host, port, marketDataType}` |
| `GET /api/quote/zc` | 近月期貨報價 `{last, bid, ask, close, chgPct, month}` |
| `GET /api/expiries/zc` | `[{id: "20260821", label: "SEP", dte, date}]` |
| `GET /api/chain/zc?expiry=20260821` | `{underlying: {month, price}, rows: [...]}`（rows 跟前端 genChain 同形狀） |

## 已知限制（v1）

- 只接標準月選（trading class `OZC` / `OZS` / `OZW`），weekly 先不接。
- IV Surface 3D 仍是造型化 mock，還沒接真實曲面。
- 期權鏈快照等 6 秒收一輪，延遲數據偶爾會有缺格（顯示 0）；30 秒內重複請求走快取。
