#!/usr/bin/env bash
# 针对 Electron ABI + 运行时架构构建 C++ 原生模块。
# 自动检测 Electron 运行时架构（arm64/x64），避免架构不匹配导致 dlopen 失败。
set -euo pipefail

cd "$(dirname "$0")/.."

ELECTRON_VERSION="$(node -e "console.log(require('./node_modules/electron/package.json').version)")"
ELECTRON_BIN="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

# 检测 Electron 运行时架构
if [ -x "$ELECTRON_BIN" ]; then
  RUNTIME_ARCH="$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" -e "process.stdout.write(process.arch)" 2>/dev/null || uname -m)"
else
  RUNTIME_ARCH="$(uname -m)"
fi
# uname -m 返回 arm64/x86_64，electron-rebuild 用 arm64/x64
if [ "$RUNTIME_ARCH" = "x86_64" ]; then RUNTIME_ARCH="x64"; fi

BUILD_TYPE="${1:-release}"  # release | debug
echo "==> 构建 firefly_native (Electron v${ELECTRON_VERSION}, arch: ${RUNTIME_ARCH}, type: ${BUILD_TYPE})"

# 确保 whisper.cpp 源码存在
if [ ! -d "native/whisper.cpp" ]; then
  echo "==> 克隆 whisper.cpp 源码 ..."
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git native/whisper.cpp
fi

# 确保模型存在（可选，没有也能编译，只是运行时 ASR 不可用）
if [ ! -f "native/models/ggml-base.bin" ]; then
  echo "⚠️  Whisper 模型未找到 (native/models/ggml-base.bin)，ASR 将不可用"
  echo "   下载: bash native/whisper.cpp/models/download-ggml-model.sh base"
fi

# 用 electron-rebuild 针对 Electron ABI 编译
PYTHON="${PYTHON:-python3}" ./node_modules/.bin/electron-rebuild \
  -f -v "${ELECTRON_VERSION}" -a "${RUNTIME_ARCH}" -m ./native

# electron-rebuild 默认只生成 Release，如需 Debug 额外编译
if [ "$BUILD_TYPE" = "debug" ]; then
  echo "==> 额外编译 Debug 版本 ..."
  cd native
  PYTHON="${PYTHON:-python3}" ../node_modules/.bin/node-gyp rebuild --debug \
    --target="${ELECTRON_VERSION}" --arch="${RUNTIME_ARCH}" --dist-url=https://electronjs.org/headers
  cd ..
fi

echo ""
echo "✅ 构建完成: native/build/Release/firefly_native.node"
ls -lh native/build/Release/firefly_native.node 2>/dev/null || true
