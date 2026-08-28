# Firefly Studio — 可调试 C++ 的 Electron 数字人工作台

把 firefly（React + three.js 3D 数字人）迁到 Electron，主进程通过
node-addon-api 加载 **C++ 原生模块**（音频能量 / VAD / ASR 客户端骨架），
并支持在 VSCode 里直接打断点调试 C++ 代码。

## 技术栈

| 层 | 技术 |
|---|---|
| 外壳 | Electron 31 + electron-vite |
| 渲染进程 | React 18 + three.js（数字人主体，待迁入 firefly 代码） |
| 原生模块 | C++17 + node-addon-api（`native/` 目录） |
| 调试 | VSCode：Node 调主进程 + lldb 附加调 C++ |

## 目录结构

```
work/electron/firefly-studio/
├── electron.vite.config.mjs   # electron-vite 三进程构建配置
├── scripts/
│   ├── prepare-electron.sh    # 一键准备 Electron + 重建 native
│   └── dev.sh                 # dev 启动包装（Ctrl+C 干净退出）
├── src/
│   ├── main/index.js          # 主进程：加载 .node + IPC 桥接
│   ├── preload/index.js       # contextBridge 安全暴露 API
│   └── renderer/              # React 页面（原生能力测试面板）
├── native/                    # C++ 原生模块
│   ├── binding.gyp            # node-gyp 构建配置
│   └── src/
│       ├── addon.cc           # N-API 入口（句柄表 + JS 绑定）
│       ├── audio_engine.*     # 音频能量 / VAD 检测（纯 C++）
│       └── asr_client.*       # ASR 客户端骨架（占位实现）
└── .vscode/                   # 调试配置
```

## 快速开始

```bash
make install       # 安装依赖
make prepare       # 下载 Electron + 针对其 ABI 重建 C++ 原生模块
make dev           # 启动 Electron
```

> **为什么要 `make prepare`**：electron 官方二进制源在大陆网络不稳，且
> Electron 运行时架构可能与机器架构不同（如 Apple Silicon 上通过 Rosetta
> 运行 x64 Electron）。该脚本用 npmmirror 镜像下载 Electron v31.7.7，
> 解压到 `node_modules/electron/dist`，自动检测运行时架构，并用
> `electron-rebuild` 针对 Electron ABI 重新编译
> `native/build/Release/firefly_native.node`（否则会 `ERR_DLOPEN_FAILED`）。

打开窗口后点击面板按钮，即可验证：
1. **C++ 原生自检** —— 主进程调用 firefly_native.node 跑 5000 次能量计算
2. **音频引擎** —— 创建 C++ AudioEngine，喂 PCM 计算 RMS + VAD 判断
3. **ASR 骨架** —— 模拟流式喂 PCM，观察占位"识别"输出

## C++ 代码调试

### 方式一：VSCode（推荐）
1. 安装扩展 **CodeLLDB**（`vadimcn.vscode-lldb`）
2. 先 `make dev` 启动应用
3. 在 VSCode「运行和调试」选 **Debug C++ Native (lldb attach)**
4. 选择 Electron 进程附加，然后在 `native/src/*.cc` 里打断点即可

> 注意：lldb 附加的是整个 Electron 进程，断点会命中渲染/主进程任意线程里对
> 该 C++ 模块的调用。若要只调试某个调用路径，先让应用停在触发该调用的 UI
> 按钮处。

### 方式二：命令行日志
主进程启动时打印 `[native] 已加载 C++ 模块 @ <路径>`。若找不到模块会报错，
此时先执行 `make prepare`（它会同时完成 electron 部署和 native 重建）。

## 后续扩展

`native/src/asr_client.h` 的接口（`Initialize / Start / Feed / Finalize`）
是标准 ASR 客户端形态。接真实能力时：
- ASR：把 `Feed` 里的占位逻辑换成通过 WebSocket 发送 PCM 到云端识别服务
- 音频：把 `AudioEngine` 的输入换成 portaudio 采集（或 Electron
  `getUserMedia` 在主进程转流）

## 已知说明

- 本仓库的开发环境为 **Apple Silicon**；`scripts/prepare-electron.sh` 会
  自动检测 Electron 运行时架构（arm64 / x64）并编译对应版本。
- C++ 模块必须用 Electron 对应 ABI 编译（`make prepare` 里的
  `electron-rebuild` 已处理）；直接用 `node-gyp` 编的是 Node ABI，Electron 无法加载。
- electron-rebuild 需要 Python 3.11（含 distutils）；若用 3.12+ 会报
  `ModuleNotFoundError: No module named 'distutils'`，脚本已指定
  `/opt/homebrew/bin/python3.11`，按需修改。
