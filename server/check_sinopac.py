#!/usr/bin/env python3
"""永豐 Shioaji 連線自我檢查 — 在你自己的電腦上跑。

    cd server
    export SINOPAC_API_KEY=...
    export SINOPAC_SECRET_KEY=...
    python3 check_sinopac.py

逐步檢查套件 → 金鑰 → 登入 → 合約 → 報價，卡在哪一步一眼看到。
輸出刻意不含任何金鑰內容（只顯示長度），可以直接貼給別人求助。
"""

import os
import sys
from datetime import date, datetime

OK, BAD, WARN = "\033[32m✓\033[0m", "\033[31m✗\033[0m", "\033[33m!\033[0m"


def line(step, mark, msg):
    print(f"  {mark} {step:<14} {msg}")


def fail(msg, hint=""):
    print(f"\n{BAD} 停在這裡：{msg}")
    if hint:
        print(f"  → {hint}")
    sys.exit(1)


print("\n永豐 Shioaji 連線自我檢查")
print("─" * 52)

# 1. 套件
try:
    import shioaji as sj
    line("1 套件", OK, f"shioaji {getattr(sj, '__version__', '?')}")
except ImportError:
    fail("找不到 shioaji 套件", "pip install shioaji")

# 2. 金鑰（只印長度，不印內容）
api_key = os.environ.get("SINOPAC_API_KEY", "")
secret = os.environ.get("SINOPAC_SECRET_KEY", "")
if not api_key or not secret:
    missing = " 和 ".join(n for n, v in [("SINOPAC_API_KEY", api_key), ("SINOPAC_SECRET_KEY", secret)] if not v)
    fail(f"環境變數 {missing} 沒設",
         'export SINOPAC_API_KEY=xxx  （注意：值不要加引號，加了長度會多 2）')
line("2 金鑰", OK, f"API_KEY 長度 {len(api_key)}、SECRET_KEY 長度 {len(secret)}")
if api_key.startswith(("'", '"')) or secret.startswith(("'", '"')):
    line("", WARN, "金鑰開頭是引號 — export 時可能把引號一起吃進去了")

# 3. 模式
sim = os.environ.get("SINOPAC_SIMULATION", "1") not in ("0", "false", "False")
line("3 模式", OK, "模擬 simulation=True（不碰真錢）" if sim else "正式行情 simulation=False")

# 4. 登入
try:
    api = sj.Shioaji(simulation=sim)
    api.login(api_key=api_key, secret_key=secret, subscribe_trade=False)
    line("4 登入", OK, "成功")
except Exception as e:
    msg = str(e)[:200]
    hint = "金鑰錯誤或沒開通行情權限，到永豐後台確認"
    if "simulation" in msg.lower():
        hint = "模擬環境要另外申請；先試 SINOPAC_SIMULATION=0 用正式行情"
    elif "network" in msg.lower() or "connect" in msg.lower() or "timeout" in msg.lower():
        hint = "連不到永豐伺服器 — 檢查網路 / VPN / 防火牆"
    fail(f"登入失敗：{type(e).__name__}: {msg}", hint)

# 5. TXO 合約
cats = [c.strip() for c in os.environ.get("SINOPAC_TXO_CATEGORIES", "TXO,TX1,TX2,TX4,TX5").split(",") if c.strip()]
found, by_date = {}, {}
for cat in cats:
    group = getattr(api.Contracts.Options, cat, None)
    if group is None:
        continue
    n = 0
    for c in group:
        d = (c.delivery_date or "").replace("/", "")
        if d:
            by_date.setdefault(d, []).append(c)
            n += 1
    if n:
        found[cat] = n
if not by_date:
    fail("找不到任何 TXO 選擇權合約",
         f"這個帳號可能沒有期權行情權限；有嘗試的類別：{', '.join(cats)}")
future = sorted(d for d in by_date if d >= date.today().strftime("%Y%m%d"))
line("5 合約", OK, f"{sum(found.values())} 個（{', '.join(f'{k}:{v}' for k, v in found.items())}）")
line("", OK, f"未到期到期日 {len(future)} 個：{', '.join(future[:5])}{' …' if len(future) > 5 else ''}")

# 6. 加權指數報價（app 的 TXO spot）
try:
    idx = api.Contracts.Indexs.TSE["001"]
    snap = (api.snapshots([idx]) or [None])[0]
    px = float(snap.close) if snap and snap.close else None
    if px:
        line("6 指數報價", OK, f"加權指數 {px:,.2f}")
    else:
        line("6 指數報價", WARN, "拿到快照但沒有價格（非交易時段就會這樣）")
except Exception as e:
    line("6 指數報價", WARN, f"取得失敗：{type(e).__name__}: {str(e)[:90]}")
    px = None

# 7. 期權快照
if future:
    exp = future[0]
    cs = by_date[exp]
    center = px or (sorted(float(c.strike_price) for c in cs)[len(cs) // 4])
    near = sorted(cs, key=lambda c: abs(float(c.strike_price) - center))[:20]
    try:
        snaps = api.snapshots(near) or []
        quoted = sum(1 for s in snaps if (s.buy_price or 0) > 0 or (s.close or 0) > 0)
        mark = OK if quoted else WARN
        line("7 期權快照", mark, f"{exp} 取 {len(near)} 檔，{quoted} 檔有報價"
                                + ("" if quoted else "（非交易時段常見）"))
    except Exception as e:
        line("7 期權快照", WARN, f"失敗：{type(e).__name__}: {str(e)[:90]}")

print("─" * 52)
print(f"\n{OK} 檢查完成。接著就能啟動 proxy：")
print("    uvicorn main:app --host 127.0.0.1 --port 8720")
print("  再另開一個終端機跑前端：")
print("    cd ../design_handoff_options_lab && python3 -m http.server 8080")
print("  瀏覽器開 http://localhost:8080，TXO 頂欄會顯示 ● SinoPac\n")
try:
    api.logout()
except Exception:
    pass
