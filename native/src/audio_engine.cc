#include "audio_engine.h"

#include <algorithm>
#include <cmath>

namespace firefly {

AudioEngine::AudioEngine(int sample_rate) {
  (void)sample_rate;  // 预留：后续 VAD 断句按采样率换算帧时长
}

double AudioEngine::ComputeRms(const int16_t* data, size_t len) {
  if (data == nullptr || len == 0) {
    return 0.0;
  }

  double sum_sq = 0.0;
  for (size_t i = 0; i < len; ++i) {
    // 归一化到 [-1, 1]
    double v = static_cast<double>(data[i]) / 32768.0;
    sum_sq += v * v;
  }
  double rms = std::sqrt(sum_sq / static_cast<double>(len));

  // 一阶低通平滑：smoothed = alpha * new + (1 - alpha) * old
  smoothed_energy_ =
      smoothing_alpha_ * rms + (1.0 - smoothing_alpha_) * smoothed_energy_;
  return smoothed_energy_;
}

bool AudioEngine::IsSpeech(const int16_t* data, size_t len) {
  double energy = ComputeRms(data, len);
  return energy >= speech_threshold_;
}

void AudioEngine::SetSpeechThreshold(double threshold) {
  speech_threshold_ = std::clamp(threshold, 0.0, 1.0);
}

void AudioEngine::Reset() { smoothed_energy_ = 0.0; }

}  // namespace firefly
