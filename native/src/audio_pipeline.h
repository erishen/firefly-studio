// audio_pipeline.h —— 零拷贝音频预处理流水线
// 整合：采集 → 环形缓冲区 → 降噪 → VAD → ASR
#pragma once

#include <cstdint>
#include <cstddef>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include <atomic>
#include <mutex>

#include "audio_ring_buffer.h"

namespace firefly {

class RnnoiseDenoiser;
class AsrWhisper;

// 流水线配置
struct AudioPipelineConfig {
  int sample_rate = 16000;
  int frame_ms = 20;           // 每帧时长（毫秒）
  bool enable_denoise = true;  // 是否启用降噪
  bool enable_vad = true;      // 是否启用 VAD
  bool enable_asr = false;     // 是否启用 ASR
  std::string asr_model_path;  // Whisper 模型路径
  int silence_ms = 700;        // 说话结束静音时长
  int min_speech_ms = 300;     // 最短语音时长
  double vad_threshold = 0.02; // VAD 阈值
};

// 流水线回调
struct AudioPipelineCallbacks {
  // 每帧回调（PCM 数据 + RMS + 是否语音）
  std::function<void(const int16_t* pcm, size_t len, double rms, bool is_speech)> on_frame;
  // ASR 结果回调
  std::function<void(const std::string& text)> on_asr_result;
  // 错误回调
  std::function<void(const std::string& error)> on_error;
};

// 零拷贝音频预处理流水线
// 采集线程直接写入环形缓冲区，处理线程从环形缓冲区读取，减少数据拷贝
class AudioPipeline {
 public:
  AudioPipeline();
  ~AudioPipeline();

  // 初始化流水线
  bool Init(const AudioPipelineConfig& config,
            const AudioPipelineCallbacks& callbacks = {});

  // 输入 PCM 数据（由采集线程调用，直接写入环形缓冲区）
  // 返回实际写入的样本数
  size_t Feed(const int16_t* pcm, size_t samples);

  // 启动处理线程
  bool Start();

  // 停止处理线程
  void Stop();

  // 是否运行中
  bool running() const { return running_; }

  // 获取环形缓冲区引用（高级用法）
  AudioRingBuffer* ring_buffer() { return ring_buffer_.get(); }

  // 获取当前可读样本数
  size_t Available() const;

  // 清空缓冲区
  void Clear();

 private:
  AudioPipelineConfig config_;
  AudioPipelineCallbacks callbacks_;

  std::unique_ptr<AudioRingBuffer> ring_buffer_;
  std::unique_ptr<RnnoiseDenoiser> denoiser_;
  std::unique_ptr<AsrWhisper> asr_;

  std::atomic<bool> running_{false};
  std::thread process_thread_;

  // VAD 状态
  enum class VadState { Idle, Speaking, Silence };
  VadState vad_state_ = VadState::Idle;
  int silence_frames_ = 0;
  int speech_frames_ = 0;
  double smoothed_energy_ = 0.0;

  // ASR 累积（用环形缓冲区的 mark 机制，不复制数据）
  bool asr_marked_ = false;

  void ProcessLoop();
  void ProcessFrame(const int16_t* pcm, size_t len);
  double ComputeRms(const int16_t* pcm, size_t len);
};

}  // namespace firefly
