# Firefly Studio — Makefile
# 常用命令封装，避免记 npm script 名

.PHONY: help install prepare dev build start server native native-release native-clean clean distclean tts-install tts-clean tts-venv

# 默认目标：显示帮助
help:
	@echo "Firefly Studio 常用命令："
	@echo "  make install      安装 npm 依赖"
	@echo "  make prepare      下载 arm64 Electron + 针对其 ABI 重建 C++ 原生模块"
	@echo "  make dev          启动 Electron 开发模式（含内置后端，热重载）"
	@echo "  make server       单独启动后端（不启动 Electron，用于前端调试）"
	@echo "  make build        构建三进程产物到 out/"
	@echo "  make start        预览构建产物（electron-vite preview）"
	@echo "  make native       编译 C++ 原生模块（Debug，可调试）"
	@echo "  make native-release  编译 C++ 原生模块（Release）"
	@echo "  make native-clean    清理 native/build"
	@echo "  make tts-install  使用 uv 安装 Python TTS/ASR 依赖到 .venv-tts"
	@echo "  make tts-venv     仅创建 .venv-tts 虚拟环境（Python 3.11）"
	@echo "  make tts-clean    清理 .venv-tts 虚拟环境"
	@echo "  make clean        清理构建产物 out/ + native/build"
	@echo "  make distclean    清理所有产物 + node_modules + .venv-tts"

# 安装依赖
install:
	npm install

# 一键准备：下载 arm64 Electron + electron-rebuild 原生模块
prepare:
	bash scripts/prepare-electron.sh

# 开发模式（用包装脚本确保 Ctrl+C 正确清理）
dev:
	bash scripts/dev.sh

# 单独启动后端（不启动 Electron）
server:
	npm run server

# 构建
build:
	npm run build

# 预览构建产物
start:
	npm run start

# C++ 原生模块（Debug）
native:
	npm run native:build

# C++ 原生模块（Release）
native-release:
	npm run native:release

# 清理原生构建
native-clean:
	npm run native:clean

# 使用 uv 创建 Python 虚拟环境
tts-venv:
	uv venv .venv-tts --python 3.11

# 使用 uv 安装 Python TTS/ASR 依赖
tts-install: tts-venv
	uv pip install --python .venv-tts/bin/python -r requirements-tts.txt
	@echo ""
	@echo "✅ Python 依赖安装完成！"
	@echo "虚拟环境路径: .venv-tts"
	@echo "Python 版本: $$(.venv-tts/bin/python --version)"
	@echo "激活方式: source .venv-tts/bin/activate"

# 清理 Python 虚拟环境
tts-clean:
	rm -rf .venv-tts
	@echo "✅ .venv-tts 已清理"

# 清理构建产物
clean:
	rm -rf out
	rm -rf native/build
	rm -rf native/bin

# 彻底清理（含依赖）
distclean: clean
	rm -rf node_modules
	rm -rf .venv-tts
