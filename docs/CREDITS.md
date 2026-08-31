# Firefly Studio 第三方素材借物表（CREDITS）

> 本文件列出 Firefly Studio 项目中使用的所有第三方素材（3D 模型、ASR/TTS 模型、开源库、音频素材等）的来源、作者和许可证信息。
>
> 部分素材许可证要求"须附完整借物表"，分发本项目时请确保包含此文件。

---

## 📦 3D 模型

### 内置模型

| 模型文件 | 格式 | 来源 | 作者 | 许可证 | 说明 |
|---------|------|------|------|--------|------|
| `avatar.vrm` | VRM | VRoid Studio | - | VRoid 模型使用许可 | 二次元风格，自带面部 blendshape（眨眼+口型） |
| `avatar.glb` | GLB | Ready Player Me | - | Ready Player Me 许可协议 | 写实风格 |
| `avatar-avaturn.glb` | GLB | Avaturn | - | Avaturn 许可协议 | 静态网格 |

### 萤火女仆模型（fireflyMaid.vrm）

| 项目 | 内容 |
|------|------|
| **模型文件** | `fireflyMaid.vrm` |
| **格式** | VRM |
| **来源** | 第三方 VRoid 创作 |
| **许可证** | **OnlyAuthor + redistribution=disallow** |
| **说明** | 仅作者可商用/再分发；请勿在其他站点嵌入或匿名公开分发裸链 |
| **注意** | 模型文件不包含在 GitHub 仓库中；生产环境 URL 通过 `.env` 中的 `VITE_FIREFLY_VRM_PROD_URL` 配置 |

---

## 🎙️ ASR（语音识别）模型

### Whisper.cpp

| 项目 | 内容 |
|------|------|
| **模型文件** | `ggml-base.bin`（base 模型，约 140MB） |
| **来源** | OpenAI Whisper |
| **作者** | OpenAI |
| **C++ 实现** | [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) |
| **许可证** | MIT License |
| **说明** | 本地离线语音识别，支持多语言（中文、英文等） |
| **模型下载** | 首次运行时自动下载，或手动下载到 `native/models/` 目录 |

---

## 🔊 TTS（语音合成）模型

### Piper TTS

| 项目 | 内容 |
|------|------|
| **引擎** | Piper TTS |
| **来源** | [rhasspy/piper](https://github.com/rhasspy/piper) |
| **作者** | Michael Hansen (synesthesiam) |
| **许可证** | MIT License |
| **说明** | 轻量级本地 TTS 引擎，基于 ONNX runtime，速度快、音质好 |

### 中文语音模型

| 模型文件 | 大小 | 来源 | 许可证 | 说明 |
|---------|------|------|--------|------|
| `zh_CN-huayan-medium.onnx` + `.json` | ~60MB | Piper 官方模型库 | MIT | 中文华研女声（默认，音色自然） |
| `zh_CN-xiao_ya-medium.onnx` + `.json` | ~60MB | Piper 官方模型库 | MIT | 中文小雅女声（标点停顿更好） |

### 英文语音模型

| 模型文件 | 大小 | 来源 | 许可证 | 说明 |
|---------|------|------|--------|------|
| `en_US-libritts-high.onnx` + `.json` | ~100MB | Piper 官方模型库 | MIT | 英文高质量女声（中英文分段时使用） |
| `en_US-amy-medium.onnx` + `.json` | ~60MB | Piper 官方模型库 | MIT | 英文 Amy 女声（备用） |

### 模型下载

- 首次运行时自动下载
- 或手动下载到 `native/piper/models/` 目录
- 模型文件不包含在 GitHub 仓库中（大文件）

---

## 📚 开源库

### 前端 / 应用层

| 库名 | 版本 | 来源 | 许可证 | 用途 |
|------|------|------|--------|------|
| Electron | 37.x | [electron/electron](https://github.com/electron/electron) | MIT | 桌面应用外壳 |
| React | 18.x | [facebook/react](https://github.com/facebook/react) | MIT | UI 框架 |
| three.js | 0.169.x | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | 3D 渲染引擎 |
| @react-three/fiber | 8.x | [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | React 3D 渲染器 |
| @react-three/drei | 9.x | [pmndrs/drei](https://github.com/pmndrs/drei) | MIT | three.js 常用组件库 |
| @pixiv/three-vrm | 3.x | [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | MIT | VRM 模型加载和动画 |
| react-markdown | 10.x | [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) | MIT | Markdown 渲染 |
| remark-gfm | 4.x | [remarkjs/remark-gfm](https://github.com/remarkjs/remark-gfm) | MIT | GitHub Flavored Markdown |

### 原生层 / C++

| 库名 | 来源 | 许可证 | 用途 |
|------|------|--------|------|
| node-addon-api | [nodejs/node-addon-api](https://github.com/nodejs/node-addon-api) | MIT | Node.js C++ 插件 API |
| Whisper.cpp | [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) | MIT | 本地离线语音识别 |
| GGML | [ggerganov/ggml](https://github.com/ggerganov/ggml) | MIT | 张量计算库（Whisper.cpp 底层） |
| RNNoise | [xiph/rnnoise](https://github.com/xiph/rnnoise) | BSD-3-Clause | 实时噪声抑制 |
| Piper C++ | [rhasspy/piper-cpp](https://github.com/rhasspy/piper-cpp) | MIT | Piper TTS C++ 实现 |
| ONNX Runtime | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT | ONNX 推理引擎 |

### Python 依赖

| 库名 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| piper-tts | 1.7.0 | MIT | Piper TTS Python 接口 |
| onnxruntime | 1.29.0 | MIT | ONNX 推理引擎 |
| numpy | 2.4.6 | BSD-3-Clause | 数值计算 |
| transformers | 5.16.1 | Apache-2.0 | 模型处理 |
| huggingface-hub | 1.29.0 | Apache-2.0 | HuggingFace 模型下载 |
| faster-whisper | - | MIT | 快速 Whisper 推理（可选） |
| g2pw | 0.1.1 | - | 中文多音字处理 |

### 构建工具

| 工具 | 来源 | 许可证 | 用途 |
|------|------|--------|------|
| electron-vite | [electron-vite/electron-vite](https://github.com/electron-vite/electron-vite) | MIT | Electron 构建工具 |
| node-gyp | [nodejs/node-gyp](https://github.com/nodejs/node-gyp) | MIT | C++ 原生模块构建 |
| uv | [astral-sh/uv](https://github.com/astral-sh/uv) | MIT | Python 包管理 |

---

## 🎵 音频素材

### 示例音频

| 文件 | 来源 | 许可证 | 说明 |
|------|------|--------|------|
| `sample-song.mp3` | - | - | 示例音乐文件（不包含在仓库中） |

### 音效

- 数字人口型同步使用实时音频能量驱动，无预录音效
- 麦克风采集使用系统默认设备，无额外音频素材

---

## 📝 其他素材

### g2pW 字音映射数据

| 项目 | 内容 |
|------|------|
| **来源** | [g2pW](https://github.com/kaka2234/g2pW) |
| **许可证** | - |
| **说明** | 中文多音字字音转换模型和数据 |
| **模型文件** | `g2pW/g2pw.onnx`（约 152MB，不包含在仓库中） |

---

## ⚠️ 许可证注意事项

1. **VRM 模型**：部分 VRM 模型许可证可能限制商用或再分发，请在使用前确认模型许可证
2. **Piper 语音模型**：Piper 官方模型采用 MIT 许可证，可自由使用
3. **Whisper 模型**：OpenAI Whisper 模型采用 MIT 许可证，可自由使用
4. **RNNoise**：采用 BSD-3-Clause 许可证，可自由使用
5. **ONNX Runtime**：采用 MIT 许可证，可自由使用

---

## 📋 借物表使用说明

- 分发本项目时，请确保包含此文件
- 如模型许可证要求"须附完整借物表"，请确保在分发物中包含此文件
- 新增第三方素材时，请及时更新此文件
- 如有疑问，请参考各素材的原始许可证文件

---

**最后更新**：2026-08-31  
**维护者**：Firefly Studio Team
