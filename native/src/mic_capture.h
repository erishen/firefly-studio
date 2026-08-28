#ifndef FIREFLY_NATIVE_MIC_CAPTURE_H
#define FIREFLY_NATIVE_MIC_CAPTURE_H

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace firefly {

// 麦克风采集回调：每帧 PCM16 数据 + RMS 能量 + 是否语音
struct MicFrame {
  const int16_t* pcm;
  size_t len;
  double rms;
  bool is_speech;
};

using MicCallback = std::function<void(const MicFrame&)>;
using MicErrorCallback = std::function<void(const std::string&)>;

// macOS CoreAudio 麦克风采集。
// 在独立音频线程采集，通过回调把数据抛给调用方（调用方需自行保证线程安全）。
class MicCapture {
 public:
  MicCapture();
  ~MicCapture();

  // 启动采集。sample_rate 建议 16000，frame_ms 建议 20~30ms。
  // callback 在音频线程调用，不要做耗时操作。
  bool Start(int sample_rate, int frame_ms, MicCallback callback,
             MicErrorCallback error_cb = nullptr);

  // 停止采集。
  void Stop();

  bool running() const { return running_; }
  int sample_rate() const { return sample_rate_; }

  // 设置 VAD 阈值（RMS 0.0~1.0）
  void SetSpeechThreshold(double threshold);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  bool running_ = false;
  int sample_rate_ = 16000;
  double speech_threshold_ = 0.03;
};

}  // namespace firefly

#endif  // FIREFLY_NATIVE_MIC_CAPTURE_H
