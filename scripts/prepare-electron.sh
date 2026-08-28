#!/usr/bin/env bash
# 一键准备 Electron 并构建 C++ 原生模块。
# 背景：electron 官方源在大陆网络不稳；且 Electron 运行时架构可能与机器架构不同
#       （例如 Apple Silicon 上通过 Rosetta 运行 x64 Electron）。
# 此脚本用 npmmirror 镜像下载，解压后自动检测 Electron 运行时架构，再编译对应架构的 native 模块。
set -euo pipefail

cd "$(dirname "$0")/.."

ELECTRON_VERSION="${1:-31.7.7}"
MACHINE_ARCH="$(uname -m)"           # arm64 | x86_64（下载用）
MIRROR="https://npmmirror.com/mirrors/electron"
ZIP="/tmp/electron-v${ELECTRON_VERSION}-darwin-${MACHINE_ARCH}.zip"
DIST_DIR="node_modules/electron/dist"
ELECTRON_BIN="$DIST_DIR/Electron.app/Contents/MacOS/Electron"

echo "==> 目标: Electron v${ELECTRON_VERSION} (机器架构: ${MACHINE_ARCH})"

# 1. 下载（若未缓存）
if [ ! -f "$ZIP" ]; then
  echo "==> 下载 $ZIP ..."
  curl -L --fail --retry 3 -o "$ZIP" \
    "${MIRROR}/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-darwin-${MACHINE_ARCH}.zip"
fi

# 2. 解压替换 dist
echo "==> 解压到 $DIST_DIR ..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
TMP_DIR="/tmp/electron-extract-$$"
rm -rf "$TMP_DIR" && mkdir -p "$TMP_DIR"
unzip -q "$ZIP" -d "$TMP_DIR"
cp -R "$TMP_DIR"/. "$DIST_DIR"/
rm -rf "$TMP_DIR"

# 3. 写 path.txt
printf 'Electron.app/Contents/MacOS/Electron' > "node_modules/electron/path.txt"

# 4. 统一 node_modules/electron/package.json 版本
node -e "
const fs=require('fs');
const p='node_modules/electron/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.version='${ELECTRON_VERSION}';
fs.writeFileSync(p, JSON.stringify(j,null,2));
"

# 5. 检测 Electron 运行时架构（可能与机器架构不同，如 Rosetta 下 x64）
echo "==> 检测 Electron 运行时架构 ..."
RUNTIME_ARCH="$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e "process.stdout.write(process.arch)" 2>/dev/null || echo "$MACHINE_ARCH")"
# electron-rebuild 用 arm64/x64，process.arch 返回 arm64/x64，直接映射
echo "    运行时架构: $RUNTIME_ARCH"

# 6. 针对 Electron ABI + 运行时架构重建原生模块
echo "==> 针对 Electron ${ELECTRON_VERSION} (${RUNTIME_ARCH}) 重建 C++ 原生模块 ..."
PYTHON=/opt/homebrew/bin/python3.11 ./node_modules/.bin/electron-rebuild \
  -f -v "${ELECTRON_VERSION}" -a "${RUNTIME_ARCH}" -m ./native

echo ""
echo "✅ 完成！Electron v${ELECTRON_VERSION} (运行时: ${RUNTIME_ARCH}) 已就绪。"
echo "   下一步：npm run dev  或  npm run start"
echo "   若要在 VSCode 里调试 C++：先 npm run dev，再用 lldb attach"
