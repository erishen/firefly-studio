#!/usr/bin/env bash
# 一键准备 arm64 Electron 并构建 C++ 原生模块。
# 背景：electron 官方源在大陆网络不稳，且本机（Apple Silicon）需要 arm64 版。
# 此脚本用 npmmirror 镜像下载并解压到 node_modules/electron/dist。
set -euo pipefail

cd "$(dirname "$0")/.."

ELECTRON_VERSION="${1:-31.7.7}"
ARCH="$(uname -m)"           # arm64 | x86_64
MIRROR="https://npmmirror.com/mirrors/electron"
ZIP="/tmp/electron-v${ELECTRON_VERSION}-darwin-${ARCH}.zip"
DIST_DIR="node_modules/electron/dist"

echo "==> 目标: Electron v${ELECTRON_VERSION} (${ARCH})"

# 1. 下载（若未缓存）
if [ ! -f "$ZIP" ]; then
  echo "==> 下载 $ZIP ..."
  curl -L --fail --retry 3 -o "$ZIP" \
    "${MIRROR}/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-darwin-${ARCH}.zip"
fi

# 2. 解压替换 dist
echo "==> 解压到 $DIST_DIR ..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
# 用临时目录解压再复制，避免半成品
TMP_DIR="/tmp/electron-extract-$$"
rm -rf "$TMP_DIR" && mkdir -p "$TMP_DIR"
unzip -q "$ZIP" -d "$TMP_DIR"
cp -R "$TMP_DIR"/. "$DIST_DIR"/
rm -rf "$TMP_DIR"

# 3. 写 path.txt（electron 模块靠它定位可执行文件）
printf 'Electron.app/Contents/MacOS/Electron' > "node_modules/electron/path.txt"

# 4. 统一 node_modules/electron/package.json 版本，避免与 dist 不一致
node -e "
const fs=require('fs');
const p='node_modules/electron/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.version='${ELECTRON_VERSION}';
fs.writeFileSync(p, JSON.stringify(j,null,2));
"

# 5. 针对 Electron ABI 重建原生模块
echo "==> 针对 Electron ${ELECTRON_VERSION} 重建 C++ 原生模块 ..."
PYTHON=/opt/homebrew/bin/python3.11 ./node_modules/.bin/electron-rebuild \
  -f -v "${ELECTRON_VERSION}" -a "${ARCH}" -m ./native

echo ""
echo "✅ 完成！Electron v${ELECTRON_VERSION} (${ARCH}) 已就绪。"
echo "   下一步：npm run dev  或  npm run start"
echo "   若要在 VSCode 里调试 C++：先 npm run dev，再用 lldb attach"
