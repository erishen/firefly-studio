#include "mic_capture.h"
#include "asr_whisper.h"

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

  // VAD 状态机
  enum class VadState { Idle, Speaking, Silence };
  VadState vad_state = VadState::Idle;
  int silence_frames = 0;
  int silence_threshold_frames = 0;  // 静音帧数阈值
  int min_speech_frames = 0;         // 最短语音帧数
  int speech_frame_count = 0;

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

    const int16_t* pcm = reinterpret_cast<const int16_t*>(buffer->mAudioData);
    size_t sample_count = buffer->mAudioDataByteSize / sizeof(int16_t);

    // 计算 RMS
    double sum = 0.0;
    for (size_t i = 0; i < sample_count; ++i) {
      double s = pcm[i] / 32768.0;
      sum += s * s;
    }
    double rms = std::sqrt(sum / std::max(sample_count, (size_t)1));
    self->smoothed_energy = 0.2 * rms + 0.8 * self->smoothed_energy;
    bool is_speech = self->smoothed_energy > self->speech_threshold;

    // VAD 状态机 + 音频缓冲
    self->owner->ProcessVad(pcm, sample_count, is_speech);

    // 帧回调
    if (self->frame_callback) {
      MicFrame frame{pcm, sample_count, rms, is_speech};
      self->frame_callback(frame);
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
        // 把当前帧加入缓冲
        for (size_t i = 0; i < len; ++i) {
          impl_->speech_buffer.push_back(pcm[i] / 32768.0f);
        }
      }
      break;

    case Impl::VadState::Speaking:
      impl_->speech_frame_count++;
      for (size_t i = 0; i < len; ++i) {
        impl_->speech_buffer.push_back(pcm[i] / 32768.0f);
      }
      if (!is_speech) {
        impl_->vad_state = Impl::VadState::Silence;
        impl_->silence_frames = 1;
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
      } else {
        impl_->silence_frames++;
        if (impl_->silence_frames >= impl_->silence_threshold_frames) {
          // 说话结束，触发 ASR
          int total_frames = impl_->speech_frame_count;
          if (total_frames >= impl_->min_speech_frames && !impl_->speech_buffer.empty()) {
            std::vector<float> pcm_copy = impl_->speech_buffer;
            {
              std::lock_guard<std::mutex> lock(asr_mutex_);
              asr_pending_ = std::move(pcm_copy);
            }
            asr_cv_.notify_one();
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
    {
      std::unique_lock<std::mutex> lock(asr_mutex_);
      asr_cv_.wait(lock, [this] { return asr_should_stop_ || !asr_pending_.empty(); });
      if (asr_should_stop_) break;
      pcm = std::move(asr_pending_);
    }

    if (whisper_ && whisper_->loaded() && !pcm.empty()) {
      std::string text = whisper_->Transcribe(pcm.data(), pcm.size(), "zh");
      if (!text.empty() && asr_callback_) {
        asr_callback_(text);
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

  // 加载 Whisper 模型
  if (!model_path.empty()) {
    whisper_ = std::make_unique<AsrWhisper>();
    if (!whisper_->LoadModel(model_path)) {
      if (impl_->error_cb) impl_->error_cb("Whisper 模型加载失败: " + model_path);
      whisper_.reset();
    } else {
      asr_callback_ = std::move(asr_cb);
      asr_should_stop_ = false;
      asr_thread_ = std::thread(&MicCapture::AsrWorker, this);
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

}  // namespace firefly
