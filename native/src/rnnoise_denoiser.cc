#include "rnnoise_denoiser.h"

#include <cstring>
#include <cmath>

extern "C" {
#include "rnnoise.h"
}

namespace firefly {

RnnoiseDenoiser::RnnoiseDenoiser() = default;

RnnoiseDenoiser::~RnnoiseDenoiser() {
  if (state_) {
    rnnoise_destroy(state_);
    state_ = nullptr;
  }
}

bool RnnoiseDenoiser::Init(int sample_rate) {
  if (state_) {
    rnnoise_destroy(state_);
    state_ = nullptr;
  }
  sample_rate_ = sample_rate;
  state_ = rnnoise_create(nullptr);
  if (!state_) return false;

  // 预分配工作缓冲：160 样本(16k) -> 480 样本(48k)
  work_48k_.resize(480);
  denoised_48k_.resize(480);
  input_buf_.clear();
  return true;
}

void RnnoiseDenoiser::Reset() {
  if (state_) {
    rnnoise_destroy(state_);
    state_ = rnnoise_create(nullptr);
  }
  input_buf_.clear();
}

// 简单线性插值上采样 16k -> 48k（3x）
void RnnoiseDenoiser::Upsample16kTo48k(const int16_t* in, size_t in_len, float* out) {
  // in_len 应该是 160，输出 480
  for (size_t i = 0; i < in_len; ++i) {
    float s0 = in[i] / 32768.0f;
    float s1 = (i + 1 < in_len) ? in[i + 1] / 32768.0f : s0;
    out[i * 3] = s0;
    out[i * 3 + 1] = s0 * 0.667f + s1 * 0.333f;
    out[i * 3 + 2] = s0 * 0.333f + s1 * 0.667f;
  }
}

// 简单抽取下采样 48k -> 16k（每 3 个取 1 个，加简单一阶低通防混叠）
void RnnoiseDenoiser::Downsample48kTo16k(const float* in, size_t in_len, int16_t* out) {
  // in_len 应该是 480，输出 160
  float prev = 0.0f;
  for (size_t i = 0; i < in_len / 3; ++i) {
    // 简单三点平均做低通
    float s = (in[i * 3] + in[i * 3 + 1] + in[i * 3 + 2]) / 3.0f;
    // 一阶 IIR 低通
    s = 0.7f * s + 0.3f * prev;
    prev = s;
    // 限幅
    if (s > 1.0f) s = 1.0f;
    if (s < -1.0f) s = -1.0f;
    out[i] = static_cast<int16_t>(s * 32767.0f);
  }
}

std::vector<int16_t> RnnoiseDenoiser::Process(const int16_t* pcm, size_t len) {
  if (!state_ || len == 0) return std::vector<int16_t>(pcm, pcm + len);

  // 追加到输入缓冲
  input_buf_.insert(input_buf_.end(), pcm, pcm + len);

  std::vector<int16_t> output;
  const size_t frame_size_16k = 160;  // 10ms @16k

  // 逐帧处理
  while (input_buf_.size() >= frame_size_16k) {
    // 上采样到 48k
    Upsample16kTo48k(input_buf_.data(), frame_size_16k, work_48k_.data());

    // RNNoise 处理（480 样本 = 10ms @48k）
    rnnoise_process_frame(state_, denoised_48k_.data(), work_48k_.data());

    // 下采样回 16k
    std::vector<int16_t> frame_out(frame_size_16k);
    Downsample48kTo16k(denoised_48k_.data(), 480, frame_out.data());

    output.insert(output.end(), frame_out.begin(), frame_out.end());

    // 移除已处理的帧
    input_buf_.erase(input_buf_.begin(), input_buf_.begin() + frame_size_16k);
  }

  return output;
}

}  // namespace firefly
