#include "mic_capture.h"
#include "asr_whisper.h"
#include "rnnoise_denoiser.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <cstring>
#include <cmath>
#include <chrono>

namespace firefly {

struct MicCapture::Impl {
  AudioQueueRef queue = nullptr;
  AudioQueueBufferRef buffers[3] = {nullptr, nullptr, nullptr};
  int buffer_size = 0;
  MicCallback frame_callback;
  MicErrorCallback error_cb;
  double speech_threshold = 0.02;
  double smoothed_energy = 0.0;

  // RNNoise 实时降噪
  std::unique_ptr<RnnoiseDenoiser> denoiser;
  bool denoiser_enabled = true;

  // VAD 状态机
  enum class VadState { Idle, Speaking, Silence };
  VadState vad_state = VadState::Idle;
  int silence_frames = 0;
  int silence_threshold_frames = 0;  // 静音帧数阈值
  int min_speech_frames = 0;         // 最短语音帧数
  int speech_frame_count = 0;
  int hangover_frames = 0;            // 语音结束 hangover 计数（避免短暂停顿导致频繁切换）
  static constexpr int HANGOVER_THRESHOLD = 8;  // 8帧 ≈ 160ms，短暂停顿不算语音结束
  int total_frames = 0;               // 总帧数（用于自适应阈值更新）
  int partial_asr_frames = 0;         // 距离上次中间识别的帧数
  static constexpr int PARTIAL_ASR_INTERVAL = 50;  // 每50帧（约1秒）做一次中间识别

  // 音频缓冲（float32，供 Whisper 使用）
  std::vector<float> speech_buffer;
  int sample_rate = 16000;

  // 外部引用（用于触发 ASR）
  MicCapture* owner = nullptr;

  static void OnInputBuffer(void* user_data, AudioQueueRef queue,
                            AudioQueueBufferRef buffer,
                            const AudioTimeStamp* start_time,
                            UInt32 num_packets,
                            const AudioStreamPacketDescription* desc) {
    (void)start_time;
    (void)num_packets;
    (void)desc;
    auto* self = static_cast<Impl*>(user_data);
    if (!self->queue || !self->owner) {
      AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
      return;
    }

    try {
    const int16_t* pcm = reinterpret_cast<const int16_t*>(buffer->mAudioData);
    size_t sample_count = buffer->mAudioDataByteSize / sizeof(int16_t);

    // RNNoise 降噪（带异常隔离：失败时自动禁用降噪，使用原始音频）
    const int16_t* pcm_processed = pcm;
    size_t processed_count = sample_count;
    std::vector<int16_t> denoised_buf;
    if (self->denoiser && self->denoiser_enabled) {
      try {
        denoised_buf = self->denoiser->Process(pcm, sample_count);
        if (!denoised_buf.empty()) {
          pcm_processed = denoised_buf.data();
          processed_count = denoised_buf.size();
        }
      } catch (const std::exception& e) {
        // 降噪失败：自动禁用降噪，避免后续帧继续崩溃
        if (self->denoiser_enabled) {
          fprintf(stderr, "[mic] RNNoise 降噪异常，自动禁用: %s\n", e.what());
          self->denoiser_enabled = false;
        }
        pcm_processed = pcm;
        processed_count = sample_count;
      } catch (...) {
        // 未知异常：同样禁用降噪
        if (self->denoiser_enabled) {
          fprintf(stderr, "[mic] RNNoise 降噪未知异常，自动禁用\n");
          self->denoiser_enabled = false;
        }
        pcm_processed = pcm;
        processed_count = sample_count;
      }
    }

    // 计算 RMS（用降噪后的音频）
    double sum = 0.0;
    for (size_t i = 0; i < processed_count; ++i) {
      double s = pcm_processed[i] / 32768.0;
      sum += s * s;
    }
    double rms = std::sqrt(sum / std::max(processed_count, (size_t)1));
    self->smoothed_energy = rms;  // 保留字段用于调试显示

    // 自适应阈值：根据环境噪音动态调整
    self->total_frames++;
    double threshold = self->owner->speech_threshold_;
    if (self->owner->adaptive_threshold_enabled_) {
      // 只在非语音时段累积噪音样本（用当前阈值判断，避免语音污染噪音基线）
      if (rms < self->owner->current_threshold_ * 0.8) {
        self->owner->noise_floor_sum_ += rms;
        self->owner->noise_floor_count_++;
      }

      // 定期更新噪音基线和当前阈值
      if (self->total_frames % MicCapture::NOISE_UPDATE_INTERVAL == 0 &&
          self->owner->noise_floor_count_ > 0) {
        // 计算平均噪音基线
        double avg_noise = self->owner->noise_floor_sum_ / self->owner->noise_floor_count_;
        // 平滑更新噪音基线（避免突变）
        self->owner->noise_floor_ = 0.7 * self->owner->noise_floor_ + 0.3 * avg_noise;
        // 计算当前阈值：噪音基线 * 系数 + 偏移
        double adaptive_threshold = self->owner->noise_floor_ * MicCapture::NOISE_MULTIPLIER
                                    + MicCapture::NOISE_OFFSET;
        // 上下限保护
        adaptive_threshold = std::max(MicCapture::MIN_THRESHOLD,
                                       std::min(MicCapture::MAX_THRESHOLD, adaptive_threshold));
        self->owner->current_threshold_ = adaptive_threshold;
        // 重置累积
        self->owner->noise_floor_sum_ = 0.0;
        self->owner->noise_floor_count_ = 0;
      }
      threshold = self->owner->current_threshold_;
    }

    // 直接用 RMS 判断，不用能量平滑（平滑会导致语音结束后 is_speech 迟迟不变 false）
    // VAD 状态机本身有 silence_threshold_frames 做防抖，不需要额外平滑
    bool is_speech = rms > threshold;

    // VAD 状态机 + 音频缓冲（用降噪后的音频）
    self->owner->ProcessVad(pcm_processed, processed_count, is_speech);

    // 帧回调（用降噪后的音频）
    if (self->frame_callback) {
      MicFrame frame{pcm_processed, processed_count, rms, is_speech};
      self->frame_callback(frame);
    }

    } catch (const std::exception& e) {
      // 音频回调异常：记录错误，继续处理下一帧，避免崩溃
      fprintf(stderr, "[mic] 音频回调异常: %s\n", e.what());
    } catch (...) {
      fprintf(stderr, "[mic] 音频回调未知异常\n");
    }

    AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
  }
};

MicCapture::MicCapture() : impl_(std::make_unique<Impl>()) {
  impl_->owner = this;
}

MicCapture::~MicCapture() { Stop(); }

void MicCapture::ProcessVad(const int16_t* pcm, size_t len, bool is_speech) {
  // 转换为 float32 并缓冲
  switch (impl_->vad_state) {
    case Impl::VadState::Idle:
      if (is_speech) {
        impl_->vad_state = Impl::VadState::Speaking;
        impl_->speech_frame_count = 1;
        impl_->silence_frames = 0;
        impl_->speech_buffer.clear();
        fprintf(stderr, "[VAD] Idle -> Speaking, 开始录音\n");
        // 把当前帧加入缓冲
        for (size_t i = 0; i < len; ++i) {
          impl_->speech_buffer.push_back(pcm[i] / 32768.0f);
        }
      }
      break;

    case Impl::VadState::Speaking:
      impl_->speech_frame_count++;
      impl_->partial_asr_frames++;
      for (size_t i = 0; i < len; ++i) {
        impl_->speech_buffer.push_back(pcm[i] / 32768.0f);
      }
      // 每隔一定帧数做一次中间识别（流式 ASR）
      if (impl_->partial_asr_frames >= Impl::PARTIAL_ASR_INTERVAL &&
          impl_->speech_buffer.size() > 16000) {  // 至少1秒音频才做中间识别
        impl_->partial_asr_frames = 0;
        std::vector<float> partial_pcm = impl_->speech_buffer;
        {
          std::lock_guard<std::mutex> lock(asr_mutex_);
          partial_asr_pending_ = std::move(partial_pcm);
        }
        asr_cv_.notify_one();
        fprintf(stderr, "[ASR] 中间识别触发, 缓冲样本数=%zu\n", impl_->speech_buffer.size());
      }
      if (!is_speech) {
        impl_->hangover_frames++;
        if (impl_->hangover_frames >= Impl::HANGOVER_THRESHOLD) {
          impl_->vad_state = Impl::VadState::Silence;
          impl_->silence_frames = 1;
          impl_->hangover_frames = 0;
          fprintf(stderr, "[VAD] Speaking -> Silence (hangover=%d), 等待确认语音结束\n", Impl::HANGOVER_THRESHOLD);
        }
      } else {
        impl_->hangover_frames = 0;  // 重新检测到语音，重置 hangover
      }
      break;

    case Impl::VadState::Silence:
      impl_->speech_frame_count++;
      for (size_t i = 0; i < len; ++i) {
        impl_->speech_buffer.push_back(pcm[i] / 32768.0f);
      }
      if (is_speech) {
        impl_->vad_state = Impl::VadState::Speaking;
        impl_->silence_frames = 0;
        fprintf(stderr, "[VAD] Silence -> Speaking, 继续录音\n");
      } else {
        impl_->silence_frames++;
        if (impl_->silence_frames >= impl_->silence_threshold_frames) {
          // 说话结束，触发 ASR
          int total_frames = impl_->speech_frame_count;
          fprintf(stderr, "[VAD] 语音结束, 总帧数=%d, 缓冲样本数=%zu, 触发ASR\n",
                  total_frames, impl_->speech_buffer.size());
          if (total_frames >= impl_->min_speech_frames && !impl_->speech_buffer.empty()) {
            std::vector<float> pcm_copy = impl_->speech_buffer;
            {
              std::lock_guard<std::mutex> lock(asr_mutex_);
              asr_pending_ = std::move(pcm_copy);
            }
            asr_cv_.notify_one();
          } else {
            fprintf(stderr, "[VAD] 语音太短(帧数=%d < %d)，忽略\n",
                    total_frames, impl_->min_speech_frames);
          }
          impl_->vad_state = Impl::VadState::Idle;
          impl_->speech_buffer.clear();
          impl_->speech_frame_count = 0;
          impl_->silence_frames = 0;
        }
      }
      break;
  }
}

void MicCapture::AsrWorker() {
  while (!asr_should_stop_) {
    std::vector<float> pcm;
    bool is_final = false;
    {
      std::unique_lock<std::mutex> lock(asr_mutex_);
      asr_cv_.wait(lock, [this] {
        return asr_should_stop_ || !asr_pending_.empty() || !partial_asr_pending_.empty();
      });
      if (asr_should_stop_) break;
      // 优先处理最终识别，中间识别可以延迟
      if (!asr_pending_.empty()) {
        pcm = std::move(asr_pending_);
        is_final = true;
      } else if (!partial_asr_pending_.empty()) {
        pcm = std::move(partial_asr_pending_);
        is_final = false;
      }
    }

    if (!pcm.empty() && asr_callback_) {
      try {
        // 把 float32 PCM 转换为 int16，再 base64 编码，通过回调发给 Node.js
        // Node.js 会把数据发给 Python 子进程（faster-whisper）做识别
        std::vector<int16_t> pcm_int16(pcm.size());
        for (size_t i = 0; i < pcm.size(); ++i) {
          float v = pcm[i] * 32768.0f;
          if (v > 32767.0f) v = 32767.0f;
          if (v < -32768.0f) v = -32768.0f;
          pcm_int16[i] = static_cast<int16_t>(v);
        }

        // base64 编码
        static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string b64;
        b64.reserve((pcm_int16.size() * 2 + 2) / 3 * 4);
        const uint8_t* bytes = reinterpret_cast<const uint8_t*>(pcm_int16.data());
        size_t byte_len = pcm_int16.size() * 2;
        for (size_t i = 0; i < byte_len; i += 3) {
          uint32_t n = bytes[i] << 16;
          if (i + 1 < byte_len) n |= bytes[i + 1] << 8;
          if (i + 2 < byte_len) n |= bytes[i + 2];
          b64.push_back(b64_table[(n >> 18) & 0x3F]);
          b64.push_back(b64_table[(n >> 12) & 0x3F]);
          b64.push_back(i + 1 < byte_len ? b64_table[(n >> 6) & 0x3F] : '=');
          b64.push_back(i + 2 < byte_len ? b64_table[n & 0x3F] : '=');
        }

        asr_callback_(b64, is_final);
      } catch (const std::exception& e) {
        // ASR 处理异常：记录错误，继续处理下一段，避免线程崩溃
        fprintf(stderr, "[ASR] 处理异常: %s\n", e.what());
      } catch (...) {
        fprintf(stderr, "[ASR] 处理未知异常\n");
      }
    }
  }
}

bool MicCapture::Start(int sample_rate, int frame_ms,
                       const std::string& model_path,
                       int silence_ms, int min_speech_ms,
                       MicCallback frame_cb,
                       AsrResultCallback asr_cb,
                       MicErrorCallback error_cb) {
  if (impl_->queue) return false;

  impl_->frame_callback = std::move(frame_cb);
  impl_->error_cb = std::move(error_cb);
  impl_->speech_threshold = speech_threshold_;
  impl_->smoothed_energy = 0.0;
  impl_->vad_state = Impl::VadState::Idle;
  impl_->speech_buffer.clear();
  impl_->speech_frame_count = 0;
  impl_->silence_frames = 0;
  impl_->sample_rate = sample_rate;
  impl_->silence_threshold_frames = silence_ms / frame_ms;
  impl_->min_speech_frames = min_speech_ms / frame_ms;
  impl_->total_frames = 0;

  // 初始化自适应阈值
  if (adaptive_threshold_enabled_) {
    noise_floor_ = 0.01;
    noise_floor_sum_ = 0.0;
    noise_floor_count_ = 0;
    current_threshold_ = speech_threshold_;
  }

  // 初始化 RNNoise 降噪器
  impl_->denoiser = std::make_unique<RnnoiseDenoiser>();
  if (!impl_->denoiser->Init(sample_rate)) {
    if (impl_->error_cb) impl_->error_cb("RNNoise 初始化失败，将跳过降噪");
    impl_->denoiser_enabled = false;
  }

  // ASR 处理：不加载 Whisper（C++ 版会崩溃），只把 PCM 数据通过回调发给 Node.js
  // Node.js 会把数据转发给 Python 子进程（faster-whisper）做识别
  if (!model_path.empty()) {
    asr_callback_ = std::move(asr_cb);
    asr_should_stop_ = false;
    asr_thread_ = std::thread(&MicCapture::AsrWorker, this);
    if (impl_->error_cb) {
      impl_->error_cb("ASR 已启用（Python faster-whisper），语音段将转发识别");
    }
  }

  AudioStreamBasicDescription format = {};
  format.mSampleRate = sample_rate;
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags =
      kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  format.mBitsPerChannel = 16;
  format.mChannelsPerFrame = 1;
  format.mBytesPerFrame = 2;
  format.mFramesPerPacket = 1;
  format.mBytesPerPacket = 2;

  OSStatus status = AudioQueueNewInput(
      &format, &Impl::OnInputBuffer, impl_.get(), nullptr, kCFRunLoopCommonModes,
      0, &impl_->queue);
  if (status != noErr) {
    if (impl_->error_cb) impl_->error_cb("AudioQueueNewInput failed");
    return false;
  }

  int frame_size = sample_rate * frame_ms / 1000 * sizeof(int16_t);
  impl_->buffer_size = frame_size;
  for (int i = 0; i < 3; ++i) {
    AudioQueueAllocateBuffer(impl_->queue, frame_size, &impl_->buffers[i]);
    AudioQueueEnqueueBuffer(impl_->queue, impl_->buffers[i], 0, nullptr);
  }

  status = AudioQueueStart(impl_->queue, nullptr);
  if (status != noErr) {
    if (impl_->error_cb) impl_->error_cb("AudioQueueStart failed");
    AudioQueueDispose(impl_->queue, true);
    impl_->queue = nullptr;
    return false;
  }

  running_ = true;
  sample_rate_ = sample_rate;
  return true;
}

void MicCapture::Stop() {
  if (!running_ && !impl_->queue) return;
  running_ = false;

  if (impl_->queue) {
    AudioQueueStop(impl_->queue, true);
    AudioQueueDispose(impl_->queue, true);
    impl_->queue = nullptr;
  }

  // 停止 ASR 线程
  asr_should_stop_ = true;
  asr_cv_.notify_all();
  if (asr_thread_.joinable()) {
    asr_thread_.join();
  }

  impl_->vad_state = Impl::VadState::Idle;
  impl_->speech_buffer.clear();
  {
    std::lock_guard<std::mutex> lock(asr_mutex_);
    asr_pending_.clear();
  }
}

void MicCapture::SetSpeechThreshold(double threshold) {
  speech_threshold_ = threshold;
  impl_->speech_threshold = threshold;
}

void MicCapture::SetAdaptiveThreshold(bool enabled) {
  adaptive_threshold_enabled_ = enabled;
  if (enabled) {
    // 启用时重置噪音基线，重新采集
    noise_floor_ = 0.01;
    noise_floor_sum_ = 0.0;
    noise_floor_count_ = 0;
    current_threshold_ = speech_threshold_;
  }
}

}  // namespace firefly
