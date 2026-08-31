// CoreAudio 低延迟音频播放器。
// 使用 AudioQueue 播放 PCM 数据，支持流式播放（边喂边播）。
// 用于 TTS 语音播放，与数字人口型精确同步。
#pragma once

#include <AudioToolbox/AudioToolbox.h>
#include <cstdint>
#include <functional>
#include <mutex>
#include <vector>
#include <thread>
#include <condition_variable>

namespace firefly {

class CoreAudioPlayer {
 public:
  CoreAudioPlayer();
  ~CoreAudioPlayer();

  // 初始化播放器，sample_rate 通常 16000 或 22050
  bool Init(int sample_rate = 22050, int channels = 1);

  // 播放 PCM 数据（int16），异步播放，立即返回
  // 内部会缓冲，边喂边播
  void Play(const int16_t* pcm, size_t len);

  // 播放完成回调
  using OnComplete = std::function<void()>;
  void SetOnComplete(OnComplete cb) { on_complete_ = std::move(cb); }

  // 停止播放
  void Stop();

  // 是否正在播放
  bool IsPlaying() const { return playing_; }

  // 等待播放完成（阻塞）
  void WaitForComplete();

 private:
  AudioQueueRef queue_ = nullptr;
  AudioQueueBufferRef buffers_[3] = {nullptr, nullptr, nullptr};
  int sample_rate_ = 22050;
  int channels_ = 1;
  int buffer_size_ = 0;

  // 待播放的数据缓冲
  std::mutex data_mutex_;
  std::vector<int16_t> pending_data_;
  size_t read_pos_ = 0;
  bool playing_ = false;
  bool should_stop_ = false;

  OnComplete on_complete_;

  // 填充回调
  static void OnFillBuffer(void* user_data, AudioQueueRef queue,
                           AudioQueueBufferRef buffer);

  // 从 pending_data_ 读取数据填充 buffer
  size_t FillBuffer(int16_t* dst, size_t max_samples);
};

}  // namespace firefly
