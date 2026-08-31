// pcm_processor.cc —— PCM 音频数据处理实现
#include "pcm_processor.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace firefly {

namespace {

// 将字节数据转换为 int16 样本向量
std::vector<int16_t> BytesToSamples(const uint8_t* pcm, size_t pcm_len) {
  size_t num_samples = pcm_len / 2;
  std::vector<int16_t> samples(num_samples);
  std::memcpy(samples.data(), pcm, num_samples * 2);
  return samples;
}

// 将 int16 样本向量转换为字节数据
std::vector<uint8_t> SamplesToBytes(const std::vector<int16_t>& samples) {
  std::vector<uint8_t> bytes(samples.size() * 2);
  std::memcpy(bytes.data(), samples.data(), samples.size() * 2);
  return bytes;
}

}  // namespace

std::vector<uint8_t> ApplyFadeInOut(const uint8_t* pcm, size_t pcm_len,
                                      double fade_ms, int sample_rate) {
  if (pcm_len == 0 || fade_ms <= 0) {
    return std::vector<uint8_t>(pcm, pcm + pcm_len);
  }

  std::vector<int16_t> samples = BytesToSamples(pcm, pcm_len);
  size_t num_samples = samples.size();
  size_t fade_samples = static_cast<size_t>(sample_rate * fade_ms / 1000.0);
  fade_samples = std::min(fade_samples, num_samples / 2);

  if (fade_samples == 0) {
    return std::vector<uint8_t>(pcm, pcm + pcm_len);
  }

  // 淡入
  for (size_t i = 0; i < fade_samples; ++i) {
    double factor = static_cast<double>(i) / fade_samples;
    samples[i] = ClipSample(static_cast<int32_t>(samples[i] * factor));
  }

  // 淡出
  for (size_t i = 0; i < fade_samples; ++i) {
    double factor = static_cast<double>(i) / fade_samples;
    size_t idx = num_samples - 1 - i;
    samples[idx] = ClipSample(static_cast<int32_t>(samples[idx] * factor));
  }

  return SamplesToBytes(samples);
}

std::vector<uint8_t> CreateSilence(double duration_ms, int sample_rate) {
  if (duration_ms <= 0) {
    return {};
  }
  size_t num_samples = static_cast<size_t>(sample_rate * duration_ms / 1000.0);
  // 16-bit mono，每个样本 2 字节，静音全 0
  return std::vector<uint8_t>(num_samples * 2, 0);
}

std::vector<uint8_t> ClipPcm(const uint8_t* pcm, size_t pcm_len) {
  if (pcm_len == 0) {
    return {};
  }

  std::vector<int16_t> samples = BytesToSamples(pcm, pcm_len);
  for (auto& s : samples) {
    s = ClipSample(s);
  }
  return SamplesToBytes(samples);
}

std::vector<uint8_t> AdjustVolume(const uint8_t* pcm, size_t pcm_len, double volume) {
  if (pcm_len == 0 || volume == 1.0) {
    return std::vector<uint8_t>(pcm, pcm + pcm_len);
  }

  volume = std::max(0.0, std::min(2.0, volume));
  std::vector<int16_t> samples = BytesToSamples(pcm, pcm_len);
  for (auto& s : samples) {
    s = ClipSample(static_cast<int32_t>(s * volume));
  }
  return SamplesToBytes(samples);
}

std::vector<uint8_t> MergePcmSegments(const std::vector<std::vector<uint8_t>>& segments,
                                        double silence_ms, int sample_rate,
                                        double fade_ms) {
  if (segments.empty()) {
    return {};
  }

  std::vector<uint8_t> silence = CreateSilence(silence_ms, sample_rate);
  std::vector<uint8_t> result;

  // 预分配空间，减少重新分配
  size_t total_size = 0;
  for (const auto& seg : segments) {
    total_size += seg.size();
  }
  total_size += silence.size() * (segments.size() - 1);
  result.reserve(total_size);

  for (size_t i = 0; i < segments.size(); ++i) {
    if (segments[i].empty()) continue;

    // 对每段应用淡入淡出
    std::vector<uint8_t> processed = ApplyFadeInOut(
        segments[i].data(), segments[i].size(), fade_ms, sample_rate);
    // 裁剪到 16-bit 范围
    processed = ClipPcm(processed.data(), processed.size());

    result.insert(result.end(), processed.begin(), processed.end());

    // 段间添加静音（最后一段不加）
    if (i < segments.size() - 1 && !silence.empty()) {
      result.insert(result.end(), silence.begin(), silence.end());
    }
  }

  return result;
}

double ComputeRms(const uint8_t* pcm, size_t pcm_len) {
  if (pcm_len < 2) {
    return 0.0;
  }

  size_t num_samples = pcm_len / 2;
  const int16_t* samples = reinterpret_cast<const int16_t*>(pcm);

  double sum_sq = 0.0;
  for (size_t i = 0; i < num_samples; ++i) {
    double sample = static_cast<double>(samples[i]) / 32768.0;
    sum_sq += sample * sample;
  }

  return std::sqrt(sum_sq / num_samples);
}

double ComputeDurationMs(const uint8_t* pcm, size_t pcm_len, int sample_rate) {
  if (sample_rate <= 0 || pcm_len < 2) {
    return 0.0;
  }
  size_t num_samples = pcm_len / 2;
  return static_cast<double>(num_samples) / sample_rate * 1000.0;
}

}  // namespace firefly
