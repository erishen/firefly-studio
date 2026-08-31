#include "coreaudio_player.h"

#include <cstring>
#include <iostream>

namespace firefly {

CoreAudioPlayer::CoreAudioPlayer() = default;

CoreAudioPlayer::~CoreAudioPlayer() {
  Stop();
}

bool CoreAudioPlayer::Init(int sample_rate, int channels) {
  if (queue_) return true;

  sample_rate_ = sample_rate;
  channels_ = channels;

  AudioStreamBasicDescription format = {};
  format.mSampleRate = sample_rate;
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  format.mBitsPerChannel = 16;
  format.mChannelsPerFrame = channels;
  format.mBytesPerFrame = 2 * channels;
  format.mFramesPerPacket = 1;
  format.mBytesPerPacket = 2 * channels;

  OSStatus status = AudioQueueNewOutput(
      &format, &CoreAudioPlayer::OnFillBuffer, this,
      nullptr, kCFRunLoopCommonModes, 0, &queue_);
  if (status != noErr) {
    std::cerr << "[CoreAudio] AudioQueueNewOutput failed: " << status << std::endl;
    return false;
  }

  // 每个缓冲 100ms
  buffer_size_ = sample_rate * 0.1 * 2 * channels;
  for (int i = 0; i < 3; ++i) {
    AudioQueueAllocateBuffer(queue_, buffer_size_, &buffers_[i]);
    // 初始填充静音
    memset(buffers_[i]->mAudioData, 0, buffer_size_);
    buffers_[i]->mAudioDataByteSize = buffer_size_;
    AudioQueueEnqueueBuffer(queue_, buffers_[i], 0, nullptr);
  }

  // 设置音量
  Float32 gain = 1.0;
  AudioQueueSetParameter(queue_, kAudioQueueParam_Volume, gain);

  return true;
}

void CoreAudioPlayer::Play(const int16_t* pcm, size_t len) {
  if (!queue_ || len == 0) return;

  {
    std::lock_guard<std::mutex> lock(data_mutex_);
    pending_data_.insert(pending_data_.end(), pcm, pcm + len);
  }

  if (!playing_) {
    playing_ = true;
    should_stop_ = false;
    AudioQueueStart(queue_, nullptr);
  }
}

void CoreAudioPlayer::Stop() {
  should_stop_ = true;
  if (queue_) {
    AudioQueueStop(queue_, true);
    AudioQueueDispose(queue_, true);
    queue_ = nullptr;
  }
  {
    std::lock_guard<std::mutex> lock(data_mutex_);
    pending_data_.clear();
    read_pos_ = 0;
  }
  playing_ = false;
}

void CoreAudioPlayer::WaitForComplete() {
  while (playing_) {
    usleep(10000);  // 10ms
    {
      std::lock_guard<std::mutex> lock(data_mutex_);
      if (pending_data_.empty() && read_pos_ >= pending_data_.size()) {
        // 检查 AudioQueue 是否还有缓冲在播放
        // 简单等待 200ms 让队列排空
        usleep(200000);
        break;
      }
    }
  }
}

size_t CoreAudioPlayer::FillBuffer(int16_t* dst, size_t max_samples) {
  std::lock_guard<std::mutex> lock(data_mutex_);
  size_t available = pending_data_.size() - read_pos_;
  size_t to_copy = std::min(available, max_samples);
  if (to_copy > 0) {
    memcpy(dst, pending_data_.data() + read_pos_, to_copy * sizeof(int16_t));
    read_pos_ += to_copy;
  }
  // 剩余部分填充静音
  if (to_copy < max_samples) {
    memset(dst + to_copy, 0, (max_samples - to_copy) * sizeof(int16_t));
  }
  return to_copy;
}

void CoreAudioPlayer::OnFillBuffer(void* user_data, AudioQueueRef queue,
                                    AudioQueueBufferRef buffer) {
  auto* self = static_cast<CoreAudioPlayer*>(user_data);
  if (!self || self->should_stop_) {
    buffer->mAudioDataByteSize = 0;
    AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
    return;
  }

  size_t max_samples = buffer->mAudioDataBytesCapacity / sizeof(int16_t);
  int16_t* dst = static_cast<int16_t*>(buffer->mAudioData);
  size_t filled = self->FillBuffer(dst, max_samples);
  buffer->mAudioDataByteSize = max_samples * sizeof(int16_t);

  AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);

  // 检查是否播放完成
  if (filled == 0) {
    std::lock_guard<std::mutex> lock(self->data_mutex_);
    if (self->pending_data_.size() > 0 && self->read_pos_ >= self->pending_data_.size()) {
      // 所有数据已播放完，停止
      self->playing_ = false;
      if (self->on_complete_) {
        auto cb = self->on_complete_;
        cb();
      }
    }
  }
}

}  // namespace firefly
