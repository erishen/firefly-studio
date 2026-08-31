# Firefly Studio — Debuggable C++ Electron Digital Human Workbench

English | [中文](./README.zh.md)

Porting firefly (React + three.js 3D digital human) to Electron, the main process loads
**C++ native modules** (audio energy / VAD / microphone capture / ASR / TTS wrapper) via
node-addon-api, integrating Whisper.cpp local speech recognition, Piper local speech synthesis,
music player, and other features, with support for setting breakpoints and debugging C++ code
directly in VSCode.

## Tech Stack

| Layer | Technology |
|---|---|
| Application Shell | Electron 37 + electron-vite |
| Renderer Process | React 18 + three.js + @react-three/fiber + @react-three/drei (3D digital human) |
| Native Module | C++17 + node-addon-api (audio energy / VAD / ASR / TTS wrapper) |
| Speech Recognition | Whisper.cpp (local offline ASR) |
| Speech Synthesis | Piper (local offline TTS) |
| Audio Processing | RNNoise (noise suppression) + CoreAudio (audio playback) |
| Debugging | VSCode: Node debug main process + lldb attach debug C++ |

## Directory Structure

```
work/electron/firefly-studio/
├── electron.vite.config.mjs   # electron-vite three-process build config
├── Makefile                    # Build and development commands
├── package.json                # Project dependencies and scripts
├── .env.example                # Environment variable config template
├── .gitignore                  # Git ignore rules
│
├── scripts/                    # Build and deployment scripts
│   ├── prepare-electron.sh     # One-click Electron setup + native rebuild
│   ├── install-electron.sh     # Electron install script (supports proxy)
│   ├── build-native.sh         # C++ native module build script
│   └── dev.sh                  # dev startup wrapper (Ctrl+C clean exit)
│
├── src/                        # Application source code
│   ├── main/                   # Main process
│   │   ├── index.js            # Main process entry: load .node + IPC bridge + window management
│   │   ├── asr.js              # ASR speech recognition service (Whisper.cpp)
│   │   ├── tts.js              # TTS speech synthesis service (Piper)
│   │   └── retry-utils.js      # Retry and daemon process utilities
│   ├── preload/                # Preload scripts
│   │   └── index.js            # contextBridge secure API exposure
│   └── renderer/               # Renderer process (React)
│       ├── index.html          # HTML entry
│       └── src/
│           ├── App.jsx         # Main app component (digital human + chat + music player)
│           ├── main.jsx        # React entry
│           ├── components/     # UI components
│           │   ├── Stage.jsx       # 3D digital human stage
│           │   ├── AvatarVRM.jsx   # VRM model rendering
│           │   ├── MusicPlayer.jsx # Music player
│           │   └── ...
│           ├── hooks/          # Custom Hooks
│           │   ├── useResolveChat.ts  # LLM chat Hook (SSE streaming)
│           │   ├── useMic.js         # Microphone capture Hook
│           │   └── ...
│           └── utils/          # Utility functions
│               ├── audioEffects.js   # Audio effects processing (EQ, reverb, etc.)
│               └── ...
│
├── native/                     # C++ native module
│   ├── binding.gyp             # node-gyp build config
│   ├── package.json            # Native module package.json
│   ├── src/                    # C++ source code
│   │   ├── addon.cc            # N-API entry (handle table + JS binding)
│   │   ├── audio_engine.*      # Audio energy / VAD detection (pure C++)
│   │   ├── mic_capture.*       # Microphone capture (CoreAudio)
│   │   ├── asr_whisper.*       # Whisper ASR wrapper
│   │   └── ...
│   ├── asr/                    # ASR related configs and scripts
│   ├── models/                 # Whisper model files (not committed to Git)
│   ├── piper/                  # Piper TTS service
│   │   ├── piper_server.py     # Piper TTS persistent service
│   │   └── models/             # Piper voice models (not committed to Git)
│   ├── piper-cpp/              # Piper C++ wrapper (experimental)
│   ├── rnnoise/                # RNNoise noise suppression library
│   ├── whisper.cpp/            # Whisper.cpp third-party library (cloned during build)
│   └── build/                  # Build artifacts (not committed to Git)
│
├── server/                     # Built-in lightweight backend (optional)
│   └── standalone.js           # Standalone LLM chat service (no tool calling)
│
├── .vscode/                    # VSCode debug config
│
├── docs/                       # Project documentation
│
├── CREDITS.md                  # Third-party materials credits
├── LICENSE                     # MIT License
├── PRIVACY.md                  # Privacy Policy
├── SECURITY.md                 # Security Policy
├── TODO.md                     # TODO items
├── README.md                   # English project docs (this file)
└── README.zh.md                # Chinese project docs
```

## Quick Start

```bash
make install       # Install dependencies
make prepare       # Download Electron + rebuild C++ native module for its ABI
make dev           # Start Electron
```

> **Why `make prepare` is needed**: The official Electron binary source is unstable in mainland China networks,
> and the Electron runtime architecture may differ from the machine architecture (e.g., running x64 Electron
> via Rosetta on Apple Silicon). This script downloads Electron using the npmmirror mirror,
> extracts it to `node_modules/electron/dist`, automatically detects the runtime architecture, and uses
> `electron-rebuild` to recompile for the Electron ABI
> `native/build/Release/firefly_native.node` (otherwise you'll get `ERR_DLOPEN_FAILED`).

After opening the app, you can experience the following core features:
1. **3D Digital Human Interaction** — Click the digital human to trigger random conversations and expression animations
2. **Voice Conversation** — Click the microphone button for voice input (Whisper.cpp local recognition), the digital human replies with Piper local voice
3. **Text Chat** — Type text in the input box, supports streaming output and Markdown rendering
4. **Music Playback** — Built-in music player, supports playlists, equalizer, volume control, music ducking (automatically lower music volume when digital human speaks)
5. **Character Switching** — Supports multiple digital human characters (Firefly Maid, etc.), switchable in settings
6. **C++ Native Module** — Audio energy calculation, VAD voice activity detection, microphone capture, etc. are all implemented in C++, debuggable with breakpoints in VSCode

## Backend Service Configuration (Important)

The chat functionality (LLM conversation, tool calling) of Firefly Studio **requires backend service support**. There are two ways to use it:

### Method 1: Use with resolve-studio (Recommended, Default)

Firefly Studio connects to **resolve-studio**'s backend service (`http://127.0.0.1:8787`) by default, leveraging its complete agent loop, tool calling, PSE three-role, and other capabilities.

**Startup Steps**:
```bash
# 1. First start resolve-studio backend (in the resolve-studio project directory)
cd work/harness/resolve-studio
make dev          # Start backend (8787) + frontend (5173), using real LLM model

# 2. Then start Firefly Studio (in this project directory)
cd work/electron/firefly-studio
make dev          # Start Electron app, automatically connects to 127.0.0.1:8787
```

**resolve-studio Configuration**:
- resolve-studio requires configuring the `.env` file with your LLM API key (supports OpenAI-compatible interfaces)
- Default uses `cordis.openai.web.yml` config (real model)
- For detailed configuration, see the README of the resolve-studio project

**Advantages**:
- Complete agent loop and tool calling capabilities
- Supports PSE three roles (Planner/Specialist/Evaluator)
- Rich tool ecosystem (article writing, investment analysis, resume optimization, interview question generation, etc.)
- Conversation history management, streaming output

### Method 2: Use Built-in Backend (Lightweight, no resolve-studio needed)

Firefly Studio also comes with a lightweight built-in backend (`server/` directory), supporting basic LLM conversation functionality, but **does not support tool calling and PSE**.

**Configuration Steps**:
1. Copy `.env.example` to `.env` and fill in the LLM configuration:
```bash
cp .env.example .env
# Edit .env, fill in:
# LLM_API_KEY=your-api-key-here
# LLM_BASE_URL=https://api.openai.com/v1
# LLM_MODEL=gpt-4o-mini
```

2. Modify the endpoint configuration in `src/renderer/src/App.jsx`:
```javascript
// Change the default resolve-studio address to the built-in backend address
const chat = useResolveChat({
  endpoint: 'http://127.0.0.1:8788',  // Built-in backend default port
  model: 'gpt-4o-mini',
  systemPrompt: currentCharacter.systemPrompt,
})
```

3. Start the app (`make dev` will automatically start the built-in backend)

**Built-in Backend Limitations**:
- Only supports basic LLM conversation (streaming output)
- Does not support tool calling (article-write, juejin-draft, etc. tools are unavailable)
- Does not support PSE three roles
- Does not support conversation history persistence (managed by frontend localStorage)

### Port Description

| Service | Default Port | Description |
|------|---------|------|
| resolve-studio backend | 8787 | Complete agent loop + tool calling (recommended) |
| Firefly built-in backend | 8788 | Lightweight LLM chat (no tool calling) |
| Firefly frontend (Vite) | 5180 | Electron renderer process dev server |

> **Note**: If the port is occupied, you can modify the built-in backend port via `SERVER_PORT` in `.env`. The resolve-studio port is modified via `BACKEND_PORT` in its `Makefile`.

## Model Files (Need to download on first run)

Due to large file sizes and some licensing restrictions, model files are **not included in git version control** (already excluded in `.gitignore`). After first cloning, you need to manually download the following models:

### 1. 3D Digital Human Models
**Directory**: `src/renderer/public/`

| Filename | Size | Type | Description |
|--------|------|------|------|
| `fireflyMaid.vrm` | ~14MB | VRM | Firefly Maid character (default character, third-party VRoid creation, OnlyAuthor + redistribution=disallow) |
| `avatar.vrm` | ~11MB | VRM | VRoid anime style (with built-in facial blendshape, blink + lip sync) |
| `avatar.glb` | ~10MB | GLB | Ready Player Me style realistic avatar |
| `avatar-avaturn.glb` | ~2.6MB | GLB | Avaturn style static mesh (no facial blendshape) |

**How to get**:
- Download free VRM models from [VRoid Hub](https://hub.vroid.com/), or use your own created models
- Or put your own VRM/GLB models into this directory and modify the loading path in `Stage.jsx`
- When models are missing, the app will automatically fall back to the built-in procedural character, no white screen

> **Note**: All 3D model files (`*.glb`, `*.vrm`) are excluded in `.gitignore` and will not be committed to GitHub. After first cloning, you need to prepare model files yourself.

### 2. Whisper ASR Speech Recognition Model
**Directory**: `native/models/`

| Filename | Size | Description |
|--------|------|------|
| `ggml-base.bin` | ~140MB | Whisper base model (Chinese-English recognition, balanced speed and accuracy) |

**How to get**:
```bash
# Download from Hugging Face
mkdir -p native/models
curl -L -o native/models/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```
- You can also download other sizes: `tiny` (~75MB, faster), `small` (~460MB, more accurate), `medium` (~1.5GB)
- After downloading, configure the model size via `ASR_MODEL` in `.env` (default base)

### 3. Piper TTS Speech Synthesis Model
**Directory**: `native/piper/models/`

| Filename | Size | Description |
|--------|------|------|
| `zh_CN-xiao_ya-medium.onnx` + `.json` | ~60MB | Chinese Xiao Ya female voice (default, better punctuation pauses) |
| `en_US-amy-medium.onnx` + `.json` | ~60MB | English Amy female voice (default, used for Chinese-English segmented speech) |

**How to get**:
```bash
# Download models from Hugging Face
mkdir -p native/piper/models

# Chinese Xiao Ya female voice (default)
curl -L -o native/piper/models/zh_CN-xiao_ya-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx
curl -L -o native/piper/models/zh_CN-xiao_ya-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/xiao_ya/medium/zh_CN-xiao_ya-medium.onnx.json

# English Amy female voice (default)
curl -L -o native/piper/models/en_US-amy-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -L -o native/piper/models/en_US-amy-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```
- For more models, see [Piper Voices](https://huggingface.co/rhasspy/piper-voices)
- After downloading, configure the model to use via `PIPER_ZH_MODEL` / `PIPER_EN_MODEL` in `.env`

### Behavior when models are missing
- **3D model missing**: Automatically falls back to built-in procedural character, app runs normally
- **ASR model missing**: Speech recognition functionality unavailable, text chat unaffected
- **TTS model missing**: Piper local voice unavailable, voice playback disabled

> **Note**: The above models are all open-source free models, please refer to their respective sources for license agreements. If using third-party created VRM models, please pay attention to complying with the original author's usage license (such as OnlyAuthor, redistribution=disallow, etc.).
>
> **📋 Complete Credits**: For the source, author, and license information of all third-party materials (3D models, ASR/TTS models, open-source libraries) used in this project, please see [CREDITS.md](./CREDITS.md). If the model license requires "complete credits must be attached", please ensure this file is included when distributing.

## C++ Code Debugging

### Method 1: VSCode (Recommended)
1. Install the extension **CodeLLDB** (`vadimcn.vscode-lldb`)
2. First `make dev` to start the app
3. In VSCode "Run and Debug", select **Debug C++ Native (lldb attach)**
4. Select the Electron process to attach, then set breakpoints in `native/src/*.cc`

> Note: lldb attaches to the entire Electron process, breakpoints will hit calls to this C++ module
> in any thread of the renderer/main process. If you only want to debug a specific call path, first let the app
> stop at the UI button that triggers that call.

### Method 2: Command-line logs
When the main process starts, it prints `[native] C++ module loaded @ <path>`. If the module cannot be found, an error will be reported.
At this point, first execute `make prepare` (it will complete both electron deployment and native rebuild).

## Features

### Implemented Features

- ✅ **3D Digital Human Rendering**: Supports VRM/GLB models, facial expressions, lip sync, blink animation
- ✅ **Speech Recognition (ASR)**: Whisper.cpp local offline recognition, supports Chinese and English, streaming recognition
- ✅ **Speech Synthesis (TTS)**: Piper local offline synthesis, supports Chinese and English, automatic language switching
- ✅ **Voice Conversation**: Microphone capture → ASR recognition → LLM conversation → TTS synthesis → digital human broadcast
- ✅ **Text Chat**: Supports streaming output, Markdown rendering, code highlighting
- ✅ **Music Player**: Playlist, equalizer (EQ), reverb, volume control, playback mode
- ✅ **Music Ducking**: Automatically lower music volume when digital human speaks, restore after speaking
- ✅ **Character Switching**: Supports multiple digital human characters, customizable character names and personalities
- ✅ **C++ Native Module**: Audio energy, VAD, microphone capture, ASR/TTS wrapper
- ✅ **Theme Switching**: Supports light/dark/follow system theme
- ✅ **Panel Layout**: Collapsible left and right panels, draggable panel width adjustment
- ✅ **resolve-studio Integration**: Can connect to resolve-studio backend, use complete agent loop and tool calling capabilities

### TODO Features (see TODO.md for details)

- 🚧 **Digital Human Singing**: Voice synthesis (RVC / So-VITS-SVC and other solutions, RVC related code has been removed)
- 🚧 **Gesture/Action Library**: Richer digital human actions and gestures
- 🚧 **Multimodal Input**: Support image input and understanding
- 🚧 **Conversation History Persistence**: Chat record saving and loading
- 🚧 **Plugin System**: Support third-party plugin extension functionality

## Known Notes

- The development environment of this repository is **Apple Silicon**; `scripts/prepare-electron.sh` will
  automatically detect the Electron runtime architecture (arm64 / x64) and compile the corresponding version.
- C++ modules must be compiled with the Electron corresponding ABI (`make prepare`'s
  `electron-rebuild` has handled this); directly compiling with `node-gyp` produces Node ABI, which Electron cannot load.
- electron-rebuild requires Python 3.11 (including distutils); if using 3.12+ you will get
  `ModuleNotFoundError: No module named 'distutils'`, the script has specified
  `/opt/homebrew/bin/python3.11`, modify as needed.

## Compliance and Privacy

### License

This project is open-sourced under the **MIT License**, see [LICENSE](./LICENSE) for details.

### Privacy Policy

This project is a **local-first** desktop application. The vast majority of data is processed only on your device and will not be uploaded to any server. See [PRIVACY.md](./PRIVACY.md) for details.

**Core Principles**:
- Microphone recording: Local offline recognition (Whisper.cpp), immediately deleted after recognition
- Chat records: Only stored in memory, automatically cleared after app closes
- Playlist: Only saves song names and local file paths, does not include audio content
- LLM conversation: Only when you actively send a message, the message content will be sent to your configured LLM service

### Security Policy

If you discover a security vulnerability, please report it privately via GitHub Security Advisories, do not disclose it in public Issues. See [SECURITY.md](./SECURITY.md) for details.

### VRM Model License Instructions

The 3D models used in the project have their respective licenses:
- **Built-in models** (avatar.glb, avatar-avaturn.glb, avatar.vrm): See their respective source licenses
- **Firefly Maid model** (fireflyMaid.vrm): Third-party VRoid creation, license is **OnlyAuthor + redistribution=disallow**
  - Only the author can commercially use / redistribute
  - Please do not embed on other sites or anonymously publicly distribute bare links
  - Model files are not included in the GitHub repository
  - Production environment URL is configured via `VITE_FIREFLY_VRM_PROD_URL` in `.env`

### Third-party Materials

For the source, author, and license information of all third-party materials (3D models, ASR/TTS models, open-source libraries) used in this project, see [CREDITS.md](./CREDITS.md).

If the model license requires "complete credits must be attached", please ensure this file is included when distributing.

---

**English | [中文](./README.zh.md)**
