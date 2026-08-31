// pcm_processor.h —— PCM 音频数据处理工具
// 功能：淡入淡出、静音生成、范围裁剪、分段合并、音量调节
#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>

namespace firefly {

// 16-bit signed PCM 样本范围
constexpr int16_t PCM_MIN = -32768;
constexpr int16_t PCM_MAX = 32767;

// 将样本裁剪到 16-bit 范围
inline int16_t ClipSample(int32_t sample) {
  if (sample > PCM_MAX) return PCM_MAX;
  if (sample < PCM_MIN) return PCM_MIN;
  return static_cast<int16_t>(sample);
}

// 对 PCM 数据应用淡入淡出
// pcm: 16-bit little-endian mono PCM 字节数据
// fade_ms: 淡入淡出时长（毫秒）
// sample_rate: 采样率
// 返回处理后的 PCM 字节数据
std::vector<uint8_t> ApplyFadeInOut(const uint8_t* pcm, size_t pcm_len,
                                      double fade_ms, int sample_rate);

// 创建指定时长的静音 PCM 数据
// duration_ms: 时长（毫秒）
// sample_rate: 采样率
// 返回静音 PCM 字节数据
std::vector<uint8_t> CreateSilence(double duration_ms, int sample_rate);

// 裁剪 PCM 数据到 16-bit 范围，避免溢出爆音
std::vector<uint8_t> ClipPcm(const uint8_t* pcm, size_t pcm_len);

// 调节音量
// volume: 0.0 ~ 2.0（1.0 为原音量）
std::vector<uint8_t> AdjustVolume(const uint8_t* pcm, size_t pcm_len, double volume);

// 合并多个 PCM 段，段间添加指定时长的静音
// segments: 多个 PCM 字节数据段
// silence_ms: 段间静音时长（毫秒）
// sample_rate: 采样率
// fade_ms: 每段淡入淡出时长（毫秒），0 表示不处理
// 返回合并后的 PCM 字节数据
std::vector<uint8_t> MergePcmSegments(const std::vector<std::vector<uint8_t>>& segments,
                                        double silence_ms, int sample_rate,
                                        double fade_ms = 10.0);

// 计算 PCM 数据的 RMS 能量
double ComputeRms(const uint8_t* pcm, size_t pcm_len);

// 计算 PCM 数据的时长（毫秒）
double ComputeDurationMs(const uint8_t* pcm, size_t pcm_len, int sample_rate);

}  // namespace firefly
