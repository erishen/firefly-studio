#include "mic_capture.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <cstring>
#include <cmath>

namespace firefly {

struct MicCapture::Impl {
  AudioQueueRef queue = nullptr;
  AudioQueueBufferRef buffers[3] = {nullptr, nullptr, nullptr};
  int buffer_size = 0;
  MicCallback callback;
  MicErrorCallback error_cb;
  double speech_threshold = 0.03;
  double smoothed_energy = 0.0;
  bool running = false;

  static void OnInputBuffer(void* user_data, AudioQueueRef queue,
                            AudioQueueBufferRef buffer,
                            const AudioTimeStamp* start_time,
                            UInt32 num_packets,
                            const AudioStreamPacketDescription* desc) {
    auto* self = static_cast<Impl*>(user_data);
    if (!self->running || !self->callback) {
      AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
      return;
    }

    // 计算 RMS
    const int16_t* pcm = reinterpret_cast<const int16_t*>(buffer->mAudioData);
    size_t sample_count = buffer->mAudioDataByteSize / sizeof(int16_t);
    double sum = 0.0;
    for (size_t i = 0; i < sample_count; ++i) {
      double s = pcm[i] / 32768.0;
      sum += s * s;
    }
    double rms = std::sqrt(sum / std::max(sample_count, (size_t)1));

    // 一阶低通平滑
    self->smoothed_energy = 0.2 * rms + 0.8 * self->smoothed_energy;
    bool is_speech = self->smoothed_energy > self->speech_threshold;

    MicFrame frame{pcm, sample_count, rms, is_speech};
    self->callback(frame);

    AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
  }
};

MicCapture::MicCapture() : impl_(std::make_unique<Impl>()) {}

MicCapture::~MicCapture() { Stop(); }

bool MicCapture::Start(int sample_rate, int frame_ms, MicCallback callback,
                       MicErrorCallback error_cb) {
  if (impl_->running) return false;

  impl_->callback = std::move(callback);
  impl_->error_cb = std::move(error_cb);
  impl_->speech_threshold = speech_threshold_;
  impl_->smoothed_energy = 0.0;

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
    if (impl_->error_cb) impl_->error_cb("AudioQueueNewInput failed: " + std::to_string(status));
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
    if (impl_->error_cb) impl_->error_cb("AudioQueueStart failed: " + std::to_string(status));
    AudioQueueDispose(impl_->queue, true);
    impl_->queue = nullptr;
    return false;
  }

  impl_->running = true;
  running_ = true;
  sample_rate_ = sample_rate;
  return true;
}

void MicCapture::Stop() {
  if (!impl_->running) return;
  impl_->running = false;
  running_ = false;
  if (impl_->queue) {
    AudioQueueStop(impl_->queue, true);
    AudioQueueDispose(impl_->queue, true);
    impl_->queue = nullptr;
  }
}

void MicCapture::SetSpeechThreshold(double threshold) {
  speech_threshold_ = threshold;
  impl_->speech_threshold = threshold;
}

}  // namespace firefly
