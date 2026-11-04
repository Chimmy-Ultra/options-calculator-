#!/bin/bash
# Options Lab 即時報價（永豐金）— Mac 上按兩下就啟動。
# 第一次會問 API Key / Secret Key，存在 server/.env（只在這台電腦，不會上傳）。
# 視窗開著 = 有即時報價；關掉視窗就停止。
cd "$(dirname "$0")/server" || exit 1
PORT=8720

if ! command -v python3 >/dev/null 2>&1; then
  echo "找不到 python3。請到 https://www.python.org/downloads/ 安裝 Python 3.12，再按兩下這個檔案。"
  read -r -p "按 Enter 關閉…"; exit 1
fi

if [ ! -d .venv ]; then
  echo "第一次啟動：安裝需要的套件（約 1–2 分鐘）…"
  python3 -m venv .venv || { read -r -p "建立環境失敗，按 Enter 關閉…"; exit 1; }
fi
# shellcheck disable=SC1091
source .venv/bin/activate
if ! python -c "import shioaji, fastapi, uvicorn, ib_async" >/dev/null 2>&1; then
  pip install -q --upgrade pip
  pip install -q -r requirements.txt || { read -r -p "套件安裝失敗，把上面的訊息截圖給 Claude。按 Enter 關閉…"; exit 1; }
fi

if [ ! -f .env ]; then
  echo
  echo "請輸入永豐金 Shioaji 金鑰（只會存在這台電腦的 server/.env）。"
  read -r -p "API Key: " K
  read -r -s -p "Secret Key（輸入時不會顯示）: " S; echo
  umask 077
  printf 'SINOPAC_API_KEY=%s\nSINOPAC_SECRET_KEY=%s\nSINOPAC_SIMULATION=0\n' "$K" "$S" > .env
  echo "已存好。要換金鑰就刪掉 server/.env 再啟動一次。"
fi
set -a; source .env; set +a

echo
echo "檢查永豐金連線…"
if ! python check_sinopac.py; then
  echo
  echo "連線沒通過。把上面的訊息截圖給 Claude（裡面不含金鑰）。"
  read -r -p "按 Enter 關閉…"; exit 1
fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "已經在執行中，直接打開網頁。"
  open "http://127.0.0.1:$PORT/"; exit 0
fi

( sleep 3; open "http://127.0.0.1:$PORT/" ) &
echo
echo "啟動中 → http://127.0.0.1:$PORT/   （這個視窗開著才有即時報價，關掉就停止）"
exec uvicorn main:app --host 127.0.0.1 --port $PORT
