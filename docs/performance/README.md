# 性能测试报告

> 本目录包含 Firefly Studio 项目的性能测试报告，用于记录和追踪音频处理、TTS 语音合成等核心功能的性能指标。

---

## 📊 报告列表

| 报告文件 | 测试日期 | 大小 | 说明 |
|---------|---------|------|------|
| [pcm_benchmark_report.json](./pcm_benchmark_report.json) | 2026-08-29 | 981 B | C++ vs JavaScript PCM 音频处理性能基准测试 |
| [tts_quality_latency_stability_report.json](./tts_quality_latency_stability_report.json) | 2026-08-29 | 3.0 KB | TTS 音频质量、延迟、稳定性测试报告 |

---

## 📈 报告详情

### 1. PCM 音频处理性能基准测试

**文件**：`pcm_benchmark_report.json`  
**测试日期**：2026-08-29  
**测试配置**：
- 采样率：22050 Hz
- 音频时长：1000 ms
- 迭代次数：1000 次

**测试项目**：
- 淡入淡出（Fade In/Out）
- 音量调节（Volume Adjustment）
- 合并分段（Merge Segments）
- WAV 构造（WAV Construction）

**测试指标**：
- `cppAvgMs`：C++ 实现平均耗时（毫秒）
- `jsAvgMs`：JavaScript 实现平均耗时（毫秒）
- `speedup`：C++ 相对 JavaScript 的加速比

**关键结论**：
- 音量调节：C++ 比 JavaScript 快约 18.6 倍
- 淡入淡出：C++ 与 JavaScript 性能相当（加速比约 1）
- WAV 构造：C++ 比 JavaScript 略快
- 合并分段：JavaScript 比 C++ 快（可能是因为 C++ 实现的内存分配开销）

---

### 2. TTS 音频质量、延迟、稳定性测试

**文件**：`tts_quality_latency_stability_report.json`  
**测试日期**：2026-08-29  

**测试项目**：
- 原始音频质量分析
- 淡入淡出效果（50ms）对音频质量的影响
- 音量调节（+50%）对音频质量的影响
- 延迟测试
- 稳定性测试

**音频质量指标**：
- `samples`：采样点数
- `durationMs`：音频时长（毫秒）
- `rms`：均方根能量（衡量音量大小）
- `peak`：峰值振幅
- `dynamicRangeDb`：动态范围（分贝）
- `zeroCrossingRate`：过零率（衡量频率特性）
- `crestFactor`：波峰因数（峰值与有效值的比值）

**关键结论**：
- 淡入淡出效果对音频质量影响很小（RMS 从 9075.3 降到 8768.2，约 -3.4%）
- 音量 +50% 后，RMS 从 9075.3 增加到 13612.7（约 +50%），符合预期
- 峰值从 15144 增加到 22716（约 +50%），未出现削波
- 动态范围保持稳定（约 4.45 dB）

---

## 🔧 如何生成新的测试报告

### PCM 性能基准测试

```bash
# 运行 PCM 性能基准测试
node scripts/benchmark-pcm.js

# 报告将输出到 docs/performance/pcm_benchmark_report.json
```

### TTS 质量测试

```bash
# 运行 TTS 质量测试
node scripts/test-tts-quality.js

# 报告将输出到 docs/performance/tts_quality_latency_stability_report.json
```

---

## 📝 报告维护说明

1. **定期更新**：建议在重大性能优化后重新运行测试并更新报告
2. **版本对比**：可以保留历史版本的报告，用于对比性能变化
3. **数据格式**：所有报告采用 JSON 格式，便于程序化处理和可视化
4. **命名规范**：`{测试类型}_{指标}.json`，如 `pcm_benchmark_report.json`

---

## 📊 性能优化目标

| 指标 | 当前值 | 目标值 | 状态 |
|------|--------|--------|------|
| TTS 首字延迟 | < 500ms | < 300ms | 🟡 进行中 |
| 音频处理 CPU 占用 | < 10% | < 5% | 🟢 已达标 |
| 内存占用 | < 500MB | < 300MB | 🟡 进行中 |
| ASR 识别准确率 | > 95% | > 98% | 🟢 已达标 |
| 数字人口型同步延迟 | < 100ms | < 50ms | 🟢 已达标 |

---

**最后更新**：2026-08-31  
**维护者**：Firefly Studio Team
