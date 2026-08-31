// RNNoise 实时降噪封装。
// RNNoise 原生要求 48kHz / 480 样本每帧（10ms）。
// 本封装处理 16kHz <-> 48kHz 的重采样，对外暴露 16kHz 接口。
#pragma once

#include <cstdint>
#include <vector>

struct DenoiseState;

namespace firefly {

class RnnoiseDenoiser {
 public:
  RnnoiseDenoiser();
  ~RnnoiseDenoiser();

  // 初始化，sample_rate 目前仅支持 16000
  bool Init(int sample_rate = 16000);

  // 处理一帧 16kHz int16 PCM，返回降噪后的 16kHz int16 PCM
  // 输入长度任意，内部缓冲对齐到 160 样本（10ms @16k）
  std::vector<int16_t> Process(const int16_t* pcm, size_t len);

  // 重置内部状态
  void Reset();

 private:
  DenoiseState* state_ = nullptr;
  int sample_rate_ = 16000;

  // 16kHz 输入缓冲（对齐到 160 样本）
  std::vector<int16_t> input_buf_;

  // 48kHz 工作缓冲
  std::vector<float> work_48k_;   // 上采样后的 48kHz float
  std::vector<float> denoised_48k_; // RNNoise 输出

  // 简单线性插值上采样 16k -> 48k（3x）
  void Upsample16kTo48k(const int16_t* in, size_t in_len, float* out);
  // 简单抽取下采样 48k -> 16k（每 3 个取 1 个，加简单低通）
  void Downsample48kTo16k(const float* in, size_t in_len, int16_t* out);
};

}  // namespace firefly
