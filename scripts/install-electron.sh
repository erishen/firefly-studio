#!/usr/bin/env bash
# 安装 electron，自动配置代理（走本机 7897 端口）
# @electron/get 需要 ELECTRON_GET_USE_PROXY + GLOBAL_AGENT_HTTP_PROXY 才能走代理
set -euo pipefail

cd "$(dirname "$0")/.."

PROXY="${PROXY:-http://127.0.0.1:7897}"
ELECTRON_VERSION="${1:-31.7.7}"

echo "==> 安装 electron@${ELECTRON_VERSION}，代理: ${PROXY}"

# 清理旧版本
rm -rf node_modules/electron

# npm 走 .npmrc 里的代理
# electron 二进制下载走 @electron/get，需要额外环境变量
ELECTRON_GET_USE_PROXY=true \
GLOBAL_AGENT_HTTP_PROXY="${PROXY}" \
GLOBAL_AGENT_HTTPS_PROXY="${PROXY}" \
npm install "electron@${ELECTRON_VERSION}"

echo ""
echo "✅ electron 安装完成"
file node_modules/electron/dist/Electron.app/Contents/MacOS/Electron 2>/dev/null || true
