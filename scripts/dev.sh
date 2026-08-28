#!/usr/bin/env bash
# 开发模式启动脚本：确保 Ctrl+C 时正确清理子进程、恢复终端状态。
# 直接用 npm run dev 时，Electron 子进程可能残留并改变 tty 状态，导致终端乱码。
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
  echo ""
  echo "==> 正在停止开发服务..."
  # 杀掉整个进程组（electron-vite + electron + 所有子进程）
  if [ -n "${DEV_PID:-}" ]; then
    # 向进程组发 SIGTERM
    kill -TERM -- -"$(ps -o pgid= -p "$DEV_PID" 2>/dev/null | tr -d ' ')" 2>/dev/null || kill "$DEV_PID" 2>/dev/null || true
    # 兜底：杀掉所有 electron 进程
    pkill -TERM -f "Electron" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  # 恢复终端状态
  stty sane 2>/dev/null || true
  echo "==> 已停止。"
  exit 0
}

trap cleanup INT TERM

echo "==> 启动 Firefly Studio 开发模式..."

# 启动前释放 8787 端口（防止上次残留或独立 make server 占用）
PORT=8787
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "==> 端口 $PORT 被占用，正在释放..."
  lsof -ti:$PORT | xargs kill -TERM 2>/dev/null || true
  sleep 1
  # 兜底强杀
  lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
fi

npm run dev &
DEV_PID=$!
wait "$DEV_PID"
