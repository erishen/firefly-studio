// audio_pipeline.cc —— 零拷贝音频预处理流水线实现
#include "audio_pipeline.h"
#include "rnnoise_denoiser.h"
#include "asr_whisper.h"

#include <cmath>
#include <cstring>
#include <chrono>

namespace firefly {

AudioPipeline::AudioPipeline() = default;

AudioPipeline::~AudioPipeline() {
  Stop();
}

bool AudioPipeline::Init(const AudioPipelineConfig& config,
                          const AudioPipelineCallbacks& callbacks) {
  config_ = config;
  callbacks_ = callbacks;

  // 创建环形缓冲区（容量 5 秒的音频数据）
  size_t capacity = config.sample_rate * 5;
  ring_buffer_ = std::make_unique<AudioRingBuffer>(capacity);

  // 初始化降噪器
  if (config.enable_denoise) {
    denoiser_ = std::make_unique<RnnoiseDenoiser>();
    if (!denoiser_->Init(config.sample_rate)) {
      if (callbacks_.on_error) callbacks_.on_error("RNNoise init failed");
      return false;
    }
  }

  // 初始化 ASR
  if (config.enable_asr && !config.asr_model_path.empty()) {
    asr_ = std::make_unique<AsrWhisper>();
    // AsrWhisper 的初始化需要在 Start 中进行（因为可能需要加载模型）
  }

  return true;
}

size_t AudioPipeline::Feed(const int16_t* pcm, size_t samples) {
  if (!ring_buffer_) return 0;
  return ring_buffer_->Write(pcm, samples);
}

bool AudioPipeline::Start() {
  if (running_) return false;

  running_ = true;
  process_thread_ = std::thread(&AudioPipeline::ProcessLoop, this);
  return true;
}

void AudioPipeline::Stop() {
  running_ = false;
  if (process_thread_.joinable()) {
    process_thread_.join();
  }
}

size_t AudioPipeline::Available() const {
  return ring_buffer_ ? ring_buffer_->Available() : 0;
}

void AudioPipeline::Clear() {
  if (ring_buffer_) ring_buffer_->Clear();
  vad_state_ = VadState::Idle;
  silence_frames_ = 0;
  speech_frames_ = 0;
  asr_marked_ = false;
}

double AudioPipeline::ComputeRms(const int16_t* pcm, size_t len) {
  if (len == 0) return 0.0;
  double sum = 0.0;
  for (size_t i = 0; i < len; ++i) {
    double s = pcm[i] / 32768.0;
    sum += s * s;
  }
  return std::sqrt(sum / len);
}

void AudioPipeline::ProcessFrame(const int16_t* pcm, size_t len) {
  if (!pcm || len == 0) return;

  // 降噪（RNNoise 内部需要 160 样本对齐，会自动缓冲）
  const int16_t* processed = pcm;
  size_t processed_len = len;
  std::vector<int16_t> denoised;

  if (denoiser_ && config_.enable_denoise) {
    denoised = denoiser_->Process(pcm, len);
    if (!denoised.empty()) {
      processed = denoised.data();
      processed_len = denoised.size();
    }
  }

  // 计算 RMS
  double rms = ComputeRms(processed, processed_len);
  smoothed_energy_ = 0.2 * rms + 0.8 * smoothed_energy_;
  bool is_speech = smoothed_energy_ > config_.vad_threshold;

  // VAD 状态机
  if (config_.enable_vad) {
    int frame_samples = config_.sample_rate * config_.frame_ms / 1000;
    int silence_threshold = config_.silence_ms / config_.frame_ms;
    int min_speech_frames = config_.min_speech_ms / config_.frame_ms;

    switch (vad_state_) {
      case VadState::Idle:
        if (is_speech) {
          vad_state_ = VadState::Speaking;
          speech_frames_ = 1;
          // 标记环形缓冲区位置（ASR 累积起点，零拷贝）
          if (asr_ && config_.enable_asr) {
            ring_buffer_->Mark();
            asr_marked_ = true;
          }
        }
        break;

      case VadState::Speaking:
        speech_frames_++;
        if (!is_speech) {
          silence_frames_ = 1;
          vad_state_ = VadState::Silence;
        }
        break;

      case VadState::Silence:
        silence_frames_++;
        if (is_speech) {
          vad_state_ = VadState::Speaking;
          silence_frames_ = 0;
        } else if (silence_frames_ >= silence_threshold) {
          // 说话结束
          if (speech_frames_ >= min_speech_frames && asr_ && asr_marked_) {
            // 从环形缓冲区读取累积的语音数据（零拷贝，只在读取时复制一次）
            size_t max_samples = config_.sample_rate * 30; // 最多 30 秒
            std::vector<int16_t> speech_data(max_samples);
            size_t read = ring_buffer_->ReadFromMark(speech_data.data(), max_samples);

            if (read > 0 && callbacks_.on_asr_result) {
              // 转换为 float32 并调用 ASR
              std::vector<float> float_data(read);
              for (size_t i = 0; i < read; ++i) {
                float_data[i] = speech_data[i] / 32768.0f;
              }
              // TODO: 调用 AsrWhisper 进行识别
              // std::string text = asr_->Transcribe(float_data.data(), read);
              // callbacks_.on_asr_result(text);
            }
          }

          // 重置状态
          vad_state_ = VadState::Idle;
          speech_frames_ = 0;
          silence_frames_ = 0;
          asr_marked_ = false;
        }
        break;
    }
  }

  // 帧回调
  if (callbacks_.on_frame) {
    callbacks_.on_frame(processed, processed_len, rms, is_speech);
  }
}

void AudioPipeline::ProcessLoop() {
  size_t frame_samples = config_.sample_rate * config_.frame_ms / 1000;
  std::vector<int16_t> frame_buf(frame_samples);

  while (running_) {
    // 从环形缓冲区读取一帧数据（阻塞等待）
    size_t read = ring_buffer_->ReadBlocking(frame_buf.data(), frame_samples, 100);
    if (read == 0) {
      continue;
    }

    // 处理这一帧
    ProcessFrame(frame_buf.data(), read);
  }
}

}  // namespace firefly
