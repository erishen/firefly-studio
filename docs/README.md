# Firefly Studio 文档中心

> 本文档中心整理了 Firefly Studio 项目的所有文档，按类别进行索引，方便快速查找和阅读。

---

## 📚 文档分类总览

| 类别 | 文档数量 | 说明 |
|------|---------|------|
| [🚀 入门指南](#-入门指南) | 2 | 项目介绍、快速开始、安装配置 |
| [🏗️ 架构与设计](#️-架构与设计) | 1 | 系统架构、技术选型、设计决策 |
| [💻 开发文档](#-开发文档) | 2 | 待办事项、依赖配置、开发指南 |
| [⚖️ 合规与法律](#️-合规与法律) | 4 | 许可证、隐私政策、安全策略、第三方素材 |
| [📊 性能测试](#-性能测试) | 3 | 音频处理基准测试、TTS 质量测试、性能优化目标 |
| [📁 数据与配置](#-数据与配置) | 2 | 字音映射表、配置文件 |

---

## 🚀 入门指南

### 1. [README.md](../README.md) — 英文项目说明

**文件位置**：`/README.md`  
**语言**：英文  
**适用人群**：国际开发者、英文用户

**内容概要**：
- 项目概述和核心功能
- 技术栈详解
- 快速开始（安装、配置、启动）
- 后端服务配置（resolve-studio / 内置后端）
- 模型文件下载指南
- C++ 代码调试方法
- 功能特性列表
- 合规与隐私说明

---

### 2. [README.zh.md](../README.zh.md) — 中文项目说明

**文件位置**：`/README.zh.md`  
**语言**：中文  
**适用人群**：中文开发者、国内用户

**内容概要**：
- 与英文版内容完全对应
- 项目概述和核心功能
- 技术栈详解
- 快速开始（安装、配置、启动）
- 后端服务配置
- 模型文件下载指南
- C++ 代码调试方法
- 功能特性列表
- 合规与隐私说明

**语言切换**：两个 README 文件的开头和结尾都提供了中英文切换链接。

---

## 🏗️ 架构与设计

### 3. [ARCHITECTURE.md](./ARCHITECTURE.md) — 系统架构文档

**文件位置**：`/docs/ARCHITECTURE.md`  
**语言**：中文  
**适用人群**：架构师、核心开发者、技术决策者

**内容概要**：
- **项目概述**：核心目标、应用场景
- **整体架构**：五层架构图（渲染进程 / 主进程 / C++ 原生模块 / 后端服务 / LLM）
- **技术栈详解**：应用层 / 原生层 / 服务层的完整技术清单
- **核心模块**：
  - 渲染进程模块（App.jsx、Stage、MusicPlayer、Hooks）
  - 主进程模块（index.js、ASR、TTS）
  - C++ 原生模块（addon、audio_engine、mic_capture、asr_whisper）
- **数据流与交互流程**：
  - 语音对话完整流程（20+ 步骤）
  - 文字聊天流程
  - 音乐播放与闪避流程
- **技术术语表**：7 大分类，60+ 术语详解（音频处理、ASR、TTS、LLM、PSE、Electron、3D 渲染）
- **设计决策与权衡**：5 个关键技术决策的原因和权衡
- **扩展性与未来规划**：短期 / 中期 / 长期规划、技术债务

---

## 💻 开发文档

### 4. [TODO.md](../TODO.md) — 待办事项与开发计划

**文件位置**：`/TODO.md`  
**语言**：中文  
**适用人群**：开发者、项目维护者

**内容概要**：
- 项目待办事项清单
- 功能开发计划和优先级
- 已知问题和 Bug 列表
- 性能优化计划
- 技术债务记录
- 版本发布计划

**使用方式**：
- 开发前查看待办事项，了解当前开发重点
- 完成任务后标记为已完成
- 发现新问题时添加到待办列表

---

### 5. [requirements-tts.txt](../requirements-tts.txt) — TTS Python 依赖配置

**文件位置**：`/requirements-tts.txt`  
**语言**：英文（配置文件格式）  
**适用人群**：开发者、运维人员

**内容概要**：
- TTS（语音合成）相关的 Python 依赖包列表
- Piper TTS 工具的依赖
- 版本号锁定，确保环境一致性

**相关配置文件**：
- `pyproject.toml` - Python 项目配置（uv 格式）
- `uv.lock` - uv 依赖锁定文件（自动生成）

**使用方式（推荐使用 uv）**：
```bash
# 方式一：使用 Makefile（推荐）
make tts-install

# 方式二：手动使用 uv
# 1. 创建虚拟环境（Python 3.11）
uv venv .venv-tts --python 3.11

# 2. 安装依赖
uv pip install --python .venv-tts/bin/python -r requirements-tts.txt

# 3. 激活虚拟环境
source .venv-tts/bin/activate
```

**注意**：
- 推荐使用 [uv](https://github.com/astral-sh/uv) 管理 Python 环境，速度比 pip 快 10-100 倍
- 虚拟环境目录 `.venv-tts/` 已加入 `.gitignore`，不会提交到仓库
- `uv.lock` 和 `pyproject.toml` 会提交到仓库，用于锁定依赖版本

---

## ⚖️ 合规与法律

### 6. [LICENSE](../LICENSE) — MIT 开源许可证

**文件位置**：`/LICENSE`  
**语言**：英文（法律文本）  
**适用人群**：所有使用者、贡献者

**许可证类型**：MIT License

**核心条款**：
- ✅ 允许商业使用
- ✅ 允许修改
- ✅ 允许分发
- ✅ 允许私有使用
- ✅ 提供专利授权
- ❌ 不提供担保
- ❌ 不承担责任

**要求**：
- 必须包含版权声明
- 必须包含许可证声明

---

### 7. [CREDITS.md](../CREDITS.md) — 第三方素材借物表

**文件位置**：`/CREDITS.md`  
**语言**：中文  
**适用人群**：所有使用者、分发者

**内容概要**：
- **3D 模型**：VRM/GLB 模型的来源、作者、许可证
- **ASR 模型**：Whisper.cpp 模型的来源、作者、许可证
- **TTS 模型**：Piper 语音模型的来源、作者、许可证
- **开源库**：项目使用的所有开源库的来源、作者、许可证
- **音频素材**：音效、背景音乐等素材的来源、作者、许可证

**重要提示**：
- 部分模型许可证要求"须附完整借物表"
- 分发项目时请确保包含此文件
- 请遵守各第三方素材的使用许可

---

### 8. [PRIVACY.md](../PRIVACY.md) — 隐私政策

**文件位置**：`/PRIVACY.md`  
**语言**：中文  
**适用人群**：所有用户

**内容概要**：
- **数据收集**：明确说明不收集个人身份信息
- **本地处理的数据**：
  - 麦克风录音（本地离线识别，识别完成后立即删除）
  - 聊天记录（仅存储在内存中，应用关闭后自动清除）
  - 播放列表（仅保存歌曲名称和本地文件路径）
  - 应用设置（存储在 localStorage 中）
- **可能发送到第三方的数据**：
  - LLM 对话（仅在主动发送消息时发送到配置的 LLM 服务）
- **数据存储**：所有本地数据均存储在用户设备上
- **数据清除**：提供清除数据的方法
- **第三方服务**：列出使用的第三方服务及其隐私政策
- **儿童隐私**：说明不面向 13 岁以下儿童
- **政策更新**：说明政策更新方式

**核心原则**：本地优先，绝大多数数据仅在用户设备上处理，不会上传到任何服务器。

---

### 9. [SECURITY.md](../SECURITY.md) — 安全策略

**文件位置**：`/SECURITY.md`  
**语言**：中文  
**适用人群**：安全研究者、开发者、用户

**内容概要**：
- **报告安全漏洞**：
  - 报告方式（GitHub Security Advisories）
  - 报告流程和时间线
  - 漏洞披露政策
- **支持的版本**：
  - 最新开发版（完全支持）
  - 最新稳定版（完全支持）
  - 历史版本（不再支持）
- **安全最佳实践**：
  - 用户侧（从官方来源下载、验证完整性、谨慎配置 LLM 服务等）
  - 开发者侧（依赖安全、代码审查、输入验证、最小权限原则等）
- **已知的安全考虑**：
  - 本地文件访问
  - 麦克风访问
  - 第三方 LLM 服务
- **漏洞披露流程**：
  - 报告 → 确认 → 评估 → 修复 → 发布 → 致谢
- **免责声明**

---

## 📊 性能测试

### 9. [performance/README.md](./performance/README.md) — 性能测试报告索引

**文件位置**：`/docs/performance/README.md`  
**语言**：中文  
**适用人群**：开发者、性能优化工程师

**内容概要**：
- 性能测试报告列表和说明
- PCM 音频处理性能基准测试（C++ vs JavaScript）
- TTS 音频质量、延迟、稳定性测试
- 性能优化目标和当前状态
- 如何生成新的测试报告

---

### 9.1 [performance/pcm_benchmark_report.json](./performance/pcm_benchmark_report.json) — PCM 音频处理性能基准测试

**文件位置**：`/docs/performance/pcm_benchmark_report.json`  
**格式**：JSON  
**测试日期**：2026-08-29

**测试项目**：
- 淡入淡出（Fade In/Out）
- 音量调节（Volume Adjustment）
- 合并分段（Merge Segments）
- WAV 构造（WAV Construction）

**关键结论**：
- 音量调节：C++ 比 JavaScript 快约 18.6 倍
- 淡入淡出：C++ 与 JavaScript 性能相当
- WAV 构造：C++ 比 JavaScript 略快

---

### 9.2 [performance/tts_quality_latency_stability_report.json](./performance/tts_quality_latency_stability_report.json) — TTS 音频质量测试报告

**文件位置**：`/docs/performance/tts_quality_latency_stability_report.json`  
**格式**：JSON  
**测试日期**：2026-08-29

**测试项目**：
- 原始音频质量分析
- 淡入淡出效果对音频质量的影响
- 音量调节对音频质量的影响
- 延迟测试
- 稳定性测试

**音频质量指标**：
- RMS（均方根能量）
- Peak（峰值振幅）
- Dynamic Range（动态范围）
- Zero Crossing Rate（过零率）
- Crest Factor（波峰因数）

---

## 📁 数据与配置

### 10. [g2pW/MONOPHONIC_CHARS.txt](../g2pW/MONOPHONIC_CHARS.txt) — 单音字表

**文件位置**：`/g2pW/MONOPHONIC_CHARS.txt`  
**语言**：中文（数据文件）  
**适用人群**：开发者、NLP 研究者

**内容概要**：
- 中文单音字的字音映射表
- 每个汉字对应的唯一读音
- 用于 TTS（语音合成）的字音转换
- 用于中文文本的发音预测

**数据格式**：每行一个汉字和对应的拼音，用空格或制表符分隔。

---

### 11. [g2pW/POLYPHONIC_CHARS.txt](../g2pW/POLYPHONIC_CHARS.txt) — 多音字表

**文件位置**：`/g2pW/POLYPHONIC_CHARS.txt`  
**语言**：中文（数据文件）  
**适用人群**：开发者、NLP 研究者

**内容概要**：
- 中文多音字的字音映射表
- 每个汉字对应的多个读音
- 用于 TTS（语音合成）的多音字处理
- 用于中文文本的发音预测和消歧

**数据格式**：每行一个汉字和对应的多个拼音，用空格或制表符分隔。

---

## 📁 文档目录结构

```
firefly-studio/
├── README.md                    # 🚀 入门指南（英文）
├── README.zh.md                 # 🚀 入门指南（中文）
├── LICENSE                      # ⚖️ MIT 许可证
├── CREDITS.md                   # ⚖️ 第三方素材借物表
├── PRIVACY.md                   # ⚖️ 隐私政策
├── SECURITY.md                  # ⚖️ 安全策略
├── TODO.md                      # 💻 待办事项与开发计划
├── requirements-tts.txt         # 💻 TTS Python 依赖（pip 格式）
├── pyproject.toml               # 💻 Python 项目配置（uv 格式）
├── uv.lock                      # 💻 uv 依赖锁定文件（自动生成）
├── Makefile                     # 🔧 构建脚本（含 uv 命令）
│
├── docs/                        # 📚 文档中心
│   ├── README.md                # 📖 本文档（文档索引）
│   ├── ARCHITECTURE.md         # 🏗️ 系统架构文档
│   └── performance/             # 📊 性能测试报告
│       ├── README.md            # 性能测试报告索引
│       ├── pcm_benchmark_report.json      # PCM 音频处理基准测试
│       └── tts_quality_latency_stability_report.json  # TTS 质量测试报告
│
└── g2pW/                        # 📁 字音映射数据
    ├── MONOPHONIC_CHARS.txt    # 单音字表
    └── POLYPHONIC_CHARS.txt    # 多音字表
```

---

## 🔗 相关链接

- [项目主页](https://github.com/erishen/firefly-studio)（如有）
- [Issue 追踪](https://github.com/erishen/firefly-studio/issues)（如有）
- [讨论区](https://github.com/erishen/firefly-studio/discussions)（如有）
- [resolve-studio 项目](../resolve-studio/README.md)（配套后端服务）

---

## 📝 文档贡献指南

欢迎贡献文档！请参考以下指南：

1. **文档格式**：使用 Markdown 格式，遵循项目现有的文档风格
2. **语言**：核心文档提供中英文版本，其他文档可使用中文
3. **分类**：新文档请添加到合适的分类中，并更新本文档索引
4. **链接**：确保文档中的内部链接和外部链接有效
5. **更新**：修改代码后请同步更新相关文档

---

**文档版本**：v1.0  
**最后更新**：2026-08-31  
**维护者**：Firefly Studio Team
