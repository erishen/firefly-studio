#ifndef QT_NATIVE_AUDIO_ENGINE_H
#define QT_NATIVE_AUDIO_ENGINE_H

#include <cstdint>
#include <string>
#include <vector>

namespace qtnative {

// 简单的音频能量 / VAD 检测引擎。
// 后续可替换 / 扩展为 QtEngine 的 audio_level + portaudio 采集。
// 保持纯 C++、无第三方依赖，便于直接在调试器中单步跟踪。
class AudioEngine {
 public:
  explicit AudioEngine(int sample_rate = 16000);

  // 输入一段 PCM16 数据，返回 RMS 能量（0.0 ~ 1.0）。
  double ComputeRms(const int16_t* data, size_t len);

  // VAD：基于阈值判断该帧是否"有人说话"。
  // 内部做滑动平均，避免单帧抖动。
  bool IsSpeech(const int16_t* data, size_t len);

  // 设置静音判定阈值（RMS，0.0~1.0）。
  void SetSpeechThreshold(double threshold);

  // 重置内部状态（滑动均值等）。
  void Reset();

  // 状态查询（用于 UI 展示 / 调试）。
  double speech_threshold() const { return speech_threshold_; }
  double smoothed_energy() const { return smoothed_energy_; }

 private:
  double speech_threshold_ = 0.05;
  double smoothed_energy_ = 0.0;
  double smoothing_alpha_ = 0.2;  // 一阶低通平滑系数
};

}  // namespace qtnative

#endif  // QT_NATIVE_AUDIO_ENGINE_H
