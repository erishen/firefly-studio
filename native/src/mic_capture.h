#ifndef FIREFLY_NATIVE_MIC_CAPTURE_H
#define FIREFLY_NATIVE_MIC_CAPTURE_H

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include <mutex>
#include <atomic>
#include <condition_variable>

namespace firefly {

class AsrWhisper;

// 麦克风采集回调：每帧 PCM16 数据 + RMS 能量 + 是否语音
struct MicFrame {
  const int16_t* pcm;
  size_t len;
  double rms;
  bool is_speech;
};

// ASR 识别结果回调
using AsrResultCallback = std::function<void(const std::string& text)>;
using MicCallback = std::function<void(const MicFrame&)>;
using MicErrorCallback = std::function<void(const std::string&)>;

// macOS CoreAudio 麦克风采集 + VAD + Whisper 本地 ASR。
// - 音频线程采集，做 VAD，累积语音片段
// - 检测到说话结束（静音超过 silence_ms），触发独立线程做 Whisper 推理
// - 推理结果通过 asr_callback 回调
class MicCapture {
 public:
  MicCapture();
  ~MicCapture();

  // 启动采集。
  // model_path: Whisper ggml 模型路径（如 ggml-base.bin），为空则不做 ASR
  // silence_ms: 说话结束判定的静音时长（毫秒）
  // min_speech_ms: 最短语音时长（毫秒），低于此忽略
  bool Start(int sample_rate, int frame_ms,
             const std::string& model_path,
             int silence_ms = 700,
             int min_speech_ms = 300,
             MicCallback frame_cb = nullptr,
             AsrResultCallback asr_cb = nullptr,
             MicErrorCallback error_cb = nullptr);

  // 停止采集。
  void Stop();

  bool running() const { return running_; }
  int sample_rate() const { return sample_rate_; }

  // 设置 VAD 阈值（RMS 0.0~1.0）
  void SetSpeechThreshold(double threshold);

  // VAD 状态机处理（由音频回调调用）
  void ProcessVad(const int16_t* pcm, size_t len, bool is_speech);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  bool running_ = false;
  int sample_rate_ = 16000;
  double speech_threshold_ = 0.02;

  // ASR 线程
  std::thread asr_thread_;
  std::mutex asr_mutex_;
  std::condition_variable asr_cv_;
  std::vector<float> asr_pending_;
  std::atomic<bool> asr_should_stop_{false};
  std::unique_ptr<AsrWhisper> whisper_;
  AsrResultCallback asr_callback_;

  void AsrWorker();
};

}  // namespace firefly

#endif  // FIREFLY_NATIVE_MIC_CAPTURE_H
