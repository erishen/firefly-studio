# Firefly Studio — 可调试 C++ 的 Electron 数字人工作台

[English](./README.md) | 中文

将 firefly（React + three.js 3D 数字人）迁移到 Electron，主进程通过
node-addon-api 加载 **C++ 原生模块**（音频能量 / VAD / 麦克风采集 / ASR / TTS 封装），
集成 Whisper.cpp 本地语音识别、Piper 本地语音合成、音乐播放器等功能，
并支持在 VSCode 中直接打断点调试 C++ 代码。

## 技术栈

| 层级 | 技术 |
|---|---|
| 应用外壳 | Electron 37 + electron-vite |
| 渲染进程 | React 18 + three.js + @react-three/fiber + @react-three/drei（3D 数字人） |
| 原生模块 | C++17 + node-addon-api（音频能量 / VAD / ASR / TTS 封装） |
| 语音识别 | Whisper.cpp（本地离线 ASR） |
| 语音合成 | Piper（本地离线 TTS） |
| 音频处理 | RNNoise（噪声抑制）+ CoreAudio（音频播放） |
| 调试工具 | VSCode：Node 调试主进程 + lldb 附加调试 C++ |

## 目录结构

```
work/electron/firefly-studio/
├── electron.vite.config.mjs   # electron-vite 三进程构建配置
├── Makefile                    # 构建和开发命令
├── package.json                # 项目依赖和脚本
├── .env.example                # 环境变量配置模板
├── .gitignore                  # Git 忽略规则
│
├── scripts/                    # 构建和部署脚本
│   ├── prepare-electron.sh     # 一键准备 Electron + 重建 native
│   ├── install-electron.sh     # Electron 安装脚本（支持代理）
│   ├── build-native.sh         # C++ 原生模块构建脚本
│   └── dev.sh                  # dev 启动包装（Ctrl+C 干净退出）
│
├── src/                        # 应用源代码
│   ├── main/                   # 主进程
│   │   ├── index.js            # 主进程入口：加载 .node + IPC 桥接 + 窗口管理
│   │   ├── asr.js              # ASR 语音识别服务（Whisper.cpp）
│   │   ├── tts.js              # TTS 语音合成服务（Piper）
│   │   └── retry-utils.js      # 重试和守护进程工具
│   ├── preload/                # 预加载脚本
│   │   └── index.js            # contextBridge 安全暴露 API
│   └── renderer/               # 渲染进程（React）
│       ├── index.html          # HTML 入口
│       └── src/
│           ├── App.jsx         # 主应用组件（数字人 + 聊天 + 音乐播放器）
│           ├── main.jsx        # React 入口
│           ├── components/     # UI 组件
│           │   ├── Stage.jsx       # 3D 数字人舞台
│           │   ├── AvatarVRM.jsx   # VRM 模型渲染
│           │   ├── MusicPlayer.jsx # 音乐播放器
│           │   └── ...
│           ├── hooks/          # 自定义 Hooks
│           │   ├── useResolveChat.ts  # LLM 聊天 Hook（SSE 流式）
│           │   ├── useMic.js         # 麦克风采集 Hook
│           │   └── ...
│           └── utils/          # 工具函数
│               ├── audioEffects.js   # 音频效果处理（均衡器、混响等）
│               └── ...
│
├── native/                     # C++ 原生模块
│   ├── binding.gyp             # node-gyp 构建配置
│   ├── package.json            # 原生模块 package.json
│   ├── src/                    # C++ 源代码
│   │   ├── addon.cc            # N-API 入口（句柄表 + JS 绑定）
│   │   ├── audio_engine.*      # 音频能量 / VAD 检测（纯 C++）
│   │   ├── mic_capture.*       # 麦克风采集（CoreAudio）
│   │   ├── asr_whisper.*       # Whisper ASR 封装
│   │   └── ...
│   ├── asr/                    # ASR 相关配置和脚本
│   ├── models/                 # Whisper 模型文件（不提交到 Git）
│   ├── piper/                  # Piper TTS 服务
│   │   ├── piper_server.py     # Piper TTS 常驻服务
│   │   └── models/             # Piper 语音模型（不提交到 Git）
│   ├── piper-cpp/              # Piper C++ 封装（实验性）
│   ├── rnnoise/                # RNNoise 噪声抑制库
│   ├── whisper.cpp/            # Whisper.cpp 第三方库（构建时克隆）
│   └── build/                  # 构建产物（不提交到 Git）
│
├── server/                     # 内置轻量后端（可选）
│   └── standalone.js           # 独立 LLM 聊天服务（无工具调用）
│
├── .vscode/                    # VSCode 调试配置
│
├── docs/                       # 项目文档
│
├── CREDITS.md                  # 第三方素材借物表
├── LICENSE                     # MIT 许可证
├── PRIVACY.md                  # 隐私政策
├── SECURITY.md                 # 安全策略
├── TODO.md                     # 待办事项
├── README.md                   # 英文项目说明
└── README.zh.md                # 中文项目说明（本文件）
```

## 快速开始

```bash
make install       # 安装依赖
make prepare       # 下载 Electron + 针对其 ABI 重建 C++ 原生模块
make dev           # 启动 Electron
```

> **为什么需要 `make prepare`**：electron 官方二进制源在大陆网络不稳定，且
> Electron 运行时架构可能与机器架构不同（如 Apple Silicon 上通过 Rosetta
> 运行 x64 Electron）。该脚本使用 npmmirror 镜像下载 Electron，
> 解压到 `node_modules/electron/dist`，自动检测运行时架构，并使用
> `electron-rebuild` 针对 Electron ABI 重新编译
> `native/build/Release/firefly_native.node`（否则会出现 `ERR_DLOPEN_FAILED`）。

打开应用后，你可以体验以下核心功能：
1. **3D 数字人交互** —— 点击数字人触发随机对话和表情动画
2. **语音对话** —— 点击麦克风按钮进行语音输入（Whisper.cpp 本地识别），数字人用 Piper 本地语音回复
3. **文字聊天** —— 在输入框输入文字，支持流式输出和 Markdown 渲染
4. **音乐播放** —— 内置音乐播放器，支持播放列表、均衡器、音量控制、音乐闪避（数字人说话时自动降低音乐音量）
5. **角色切换** —— 支持多个数字人角色（萤火女仆等），可在设置中切换
6. **C++ 原生模块** —— 音频能量计算、VAD 语音活动检测、麦克风采集等均由 C++ 实现，可在 VSCode 中打断点调试

## 后端服务配置（重要）

Firefly Studio 的聊天功能（LLM 对话、工具调用）**需要后端服务支持**，有两种使用方式：

### 方式一：配套 resolve-studio 使用（推荐，默认）

Firefly Studio 默认连接 **resolve-studio** 的后端服务（`http://127.0.0.1:8787`），利用其完整的 agent loop、工具调用、PSE 三角色等能力。

**启动步骤**：
```bash
# 1. 先启动 resolve-studio 后端（在 resolve-studio 项目目录下）
cd work/harness/resolve-studio
make dev          # 启动后端(8787) + 前端(5173)，使用真实 LLM 模型

# 2. 再启动 Firefly Studio（在本项目目录下）
cd work/electron/firefly-studio
make dev          # 启动 Electron 应用，自动连接 127.0.0.1:8787
```

**resolve-studio 配置**：
- resolve-studio 需要配置 `.env` 文件，填入 LLM API key（支持 OpenAI 兼容接口）
- 默认使用 `cordis.openai.web.yml` 配置（真实模型）
- 详细配置见 resolve-studio 项目的 README

**优点**：
- 完整的 agent loop 和工具调用能力
- 支持 PSE 三角色（Planner/Specialist/Evaluator）
- 丰富的工具生态（文章写作、投资分析、简历优化、面试题生成等）
- 会话历史管理、流式输出

### 方式二：使用内置后端（轻量，无需 resolve-studio）

Firefly Studio 也自带一个轻量级内置后端（`server/` 目录），支持基础的 LLM 对话功能，但**不支持工具调用和 PSE**。

**配置步骤**：
1. 复制 `.env.example` 为 `.env`，填入 LLM 配置：
```bash
cp .env.example .env
# 编辑 .env，填入：
# LLM_API_KEY=your-api-key-here
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini
```

2. 修改 `src/renderer/src/App.jsx` 中的 endpoint 配置：
```javascript
// 将默认的 resolve-studio 地址改为内置后端地址
const chat = useResolveChat({
  endpoint: 'http://127.0.0.1:8788',  // 内置后端默认端口
  model: 'gpt-4o-mini',
  systemPrompt: currentCharacter.systemPrompt,
})
```

3. 启动应用（`make dev` 会自动启动内置后端）

**内置后端限制**：
- 仅支持基础的 LLM 对话（流式输出）
- 不支持工具调用（article-write、juejin-draft 等工具不可用）
- 不支持 PSE 三角色
- 不支持会话历史持久化（由前端 localStorage 管理）

### 端口说明

| 服务 | 默认端口 | 说明 |
|------|---------|------|
| resolve-studio 后端 | 8787 | 完整 agent loop + 工具调用（推荐） |
| Firefly 内置后端 | 8788 | 轻量 LLM 对话（无工具调用） |
| Firefly 前端（Vite） | 5180 | Electron 渲染进程开发服务器 |

> **注意**：如果端口被占用，可在 `.env` 中通过 `SERVER_PORT` 修改内置后端端口，resolve-studio 的端口在其 `Makefile` 中通过 `BACKEND_PORT` 修改。

## 模型文件（首次运行需下载）

由于模型文件较大且部分有许可限制，**不纳入 git 版本管理**（已在 `.gitignore` 中排除）。首次克隆后需手动下载以下模型：

### 1. 3D 数字人模型
**目录**：`src/renderer/public/`

| 文件名 | 大小 | 类型 | 说明 |
|--------|------|------|------|
| `fireflyMaid.vrm` | ~14MB | VRM | 萤火女仆角色（默认角色，第三方 VRoid 创作，OnlyAuthor + redistribution=disallow） |
| `avatar.vrm` | ~11MB | VRM | VRoid 二次元风格（自带面部 blendshape，眨眼+口型） |
| `avatar.glb` | ~10MB | GLB | Ready Player Me 风格写实头像 |
| `avatar-avaturn.glb` | ~2.6MB | GLB | Avaturn 风格静态网格（无面部 blendshape） |

**获取方式**：
- 可从 [VRoid Hub](https://hub.vroid.com/) 下载免费 VRM 模型，或使用自己创作的模型
- 或将自己的 VRM/GLB 模型放入该目录，并在 `Stage.jsx` 中修改加载路径
- 缺少模型时应用会自动回退到内置程序化角色，不会白屏

> **注意**：所有 3D 模型文件（`*.glb`、`*.vrm`）都已在 `.gitignore` 中排除，不会提交到 GitHub。首次克隆后需自行准备模型文件。

### 2. Whisper ASR 语音识别模型
**目录**：`native/models/`

| 文件名 | 大小 | 说明 |
|--------|------|------|
| `ggml-base.bin` | ~140MB | Whisper base 模型（中英文识别，平衡速度与准确率） |

**获取方式**：
```bash
# 从 Hugging Face 下载
mkdir -p native/models
curl -L -o native/models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```
- 也可下载其他尺寸：`tiny`（~75MB，更快）、`small`（~460MB，更准）、`medium`（~1.5GB）
- 下载后在 `.env` 中通过 `ASR_MODEL` 配置使用的模型尺寸（默认 base）

### 3. Piper TTS 语音合成模型
**目录**：`native/piper/models/`

| 文件名 | 大小 | 说明 |
|--------|------|------|
| `zh_CN-xiao_ya-medium.onnx` + `.json` | ~60MB | 中文小雅女声（默认，标点停顿更好） |
| `en_US-amy-medium.onnx` + `.json` | ~60MB | 英文 Amy 女声（默认，中英文分段时使用） |

**获取方式**：
```bash
# 从 Hugging Face 下载模型
mkdir -p native/piper/models

# 中文小雅女声（默认）
curl -L -o native/piper/models/zh_CN-xiao_ya-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx
curl -L -o native/piper/models/zh_CN-xiao_ya-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx.json

# 英文 Amy 女声（默认）
curl -L -o native/piper/models/en_US-amy-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -L -o native/piper/models/en_US-amy-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```
- 更多模型见 [Piper Voices](https://huggingface.co/rhasspy/piper-voices)
- 下载后在 `.env` 中通过 `PIPER_ZH_MODEL` / `PIPER_EN_MODEL` 配置使用的模型

### 模型缺失时的行为
- **3D 模型缺失**：自动回退到内置程序化角色，应用可正常运行
- **ASR 模型缺失**：语音识别功能不可用，文字聊天不受影响
- **TTS 模型缺失**：Piper 本地语音不可用，语音播放功能关闭

> **注意**：以上模型均为开源免费模型，许可协议请参考各自来源。VRM 模型如使用第三方创作，请注意遵守原作者的使用许可（如 OnlyAuthor、redistribution=disallow 等）。
>
> **📋 完整借物表**：本项目使用的所有第三方素材（3D 模型、ASR/TTS 模型、开源库）的来源、作者、许可证信息，请参见 [CREDITS.md](./CREDITS.md)。如模型许可证要求"须附完整借物表"，分发时请确保包含该文件。

## C++ 代码调试

### 方式一：VSCode（推荐）
1. 安装扩展 **CodeLLDB**（`vadimcn.vscode-lldb`）
2. 先 `make dev` 启动应用
3. 在 VSCode「运行和调试」选择 **Debug C++ Native (lldb attach)**
4. 选择 Electron 进程附加，然后在 `native/src/*.cc` 里打断点即可

> 注意：lldb 附加的是整个 Electron 进程，断点会命中渲染/主进程任意线程里对
> 该 C++ 模块的调用。若要只调试某个调用路径，先让应用停在触发该调用的 UI
> 按钮处。

### 方式二：命令行日志
主进程启动时打印 `[native] 已加载 C++ 模块 @ <路径>`。若找不到模块会报错，
此时先执行 `make prepare`（它会同时完成 electron 部署和 native 重建）。

## 功能特性

### 已实现功能

- ✅ **3D 数字人渲染**：支持 VRM/GLB 模型，面部表情、口型同步、眨眼动画
- ✅ **语音识别（ASR）**：Whisper.cpp 本地离线识别，支持中英文，流式识别
- ✅ **语音合成（TTS）**：Piper 本地离线合成，支持中英文，自动语言切换
- ✅ **语音对话**：麦克风采集 → ASR 识别 → LLM 对话 → TTS 合成 → 数字人播报
- ✅ **文字聊天**：支持流式输出、Markdown 渲染、代码高亮
- ✅ **音乐播放器**：播放列表、均衡器（EQ）、混响、音量控制、播放模式
- ✅ **音乐闪避**：数字人说话时自动降低音乐音量，说完后恢复
- ✅ **角色切换**：支持多个数字人角色，可自定义角色名称和性格
- ✅ **C++ 原生模块**：音频能量、VAD、麦克风采集、ASR/TTS 封装
- ✅ **主题切换**：支持亮色/暗色/跟随系统主题
- ✅ **面板布局**：可折叠左右面板，可拖拽调整面板宽度
- ✅ **配套 resolve-studio**：可连接 resolve-studio 后端，使用完整的 agent loop 和工具调用能力

### 待实现功能（详见 TODO.md）

- 🚧 **数字人唱歌**：歌声合成（RVC / So-VITS-SVC 等方案，已移除 RVC 相关代码）
- 🚧 **手势/动作库**：更丰富的数字人动作和手势
- 🚧 **多模态输入**：支持图片输入和理解
- 🚧 **会话历史持久化**：聊天记录保存和加载
- 🚧 **插件系统**：支持第三方插件扩展功能

## 已知说明

- 本仓库的开发环境为 **Apple Silicon**；`scripts/prepare-electron.sh` 会
  自动检测 Electron 运行时架构（arm64 / x64）并编译对应版本。
- C++ 模块必须用 Electron 对应 ABI 编译（`make prepare` 里的
  `electron-rebuild` 已处理）；直接用 `node-gyp` 编的是 Node ABI，Electron 无法加载。
- electron-rebuild 需要 Python 3.11（含 distutils）；若用 3.12+ 会报
  `ModuleNotFoundError: No module named 'distutils'`，脚本已指定
  `/opt/homebrew/bin/python3.11`，按需修改。

## 合规与隐私

### 许可证

本项目采用 **MIT License** 开源，详见 [LICENSE](./LICENSE)。

### 隐私政策

本项目是一款**本地优先**的桌面应用，绝大多数数据仅在您的设备上处理，不会上传到任何服务器。详见 [PRIVACY.md](./PRIVACY.md)。

**核心原则**：
- 麦克风录音：本地离线识别（Whisper.cpp），识别完成后立即删除
- 聊天记录：仅存储在内存中，应用关闭后自动清除
- 播放列表：仅保存歌曲名称和本地文件路径，不包含音频内容
- LLM 对话：仅在您主动发送消息时，消息内容才会发送到您配置的 LLM 服务

### 安全策略

如果您发现了安全漏洞，请通过 GitHub Security Advisories 私下报告，不要在公开 Issues 中披露。详见 [SECURITY.md](./SECURITY.md)。

### VRM 模型许可说明

项目中使用的 3D 模型有各自的许可证：
- **内置模型**（avatar.glb、avatar-avaturn.glb、avatar.vrm）：详见各自来源的许可证
- **萤火女仆模型**（fireflyMaid.vrm）：第三方 VRoid 创作，许可证为 **OnlyAuthor + redistribution=disallow**
  - 仅作者可商用/再分发
  - 请勿在其他站点嵌入或匿名公开分发裸链
  - 模型文件不包含在 GitHub 仓库中
  - 生产环境 URL 通过 `.env` 中的 `VITE_FIREFLY_VRM_PROD_URL` 配置

### 第三方素材

本项目使用的所有第三方素材（3D 模型、ASR/TTS 模型、开源库）的来源、作者、许可证信息，详见 [CREDITS.md](./CREDITS.md)。

如模型许可证要求"须附完整借物表"，分发时请确保包含该文件。

---

**[English](./README.md) | 中文**
