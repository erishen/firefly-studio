// audio_ring_buffer.h —— 线程安全的音频环形缓冲区
// 用于采集线程 → 处理线程之间的零拷贝数据传递
#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>
#include <mutex>
#include <condition_variable>
#include <atomic>

namespace firefly {

class AudioRingBuffer {
 public:
  // capacity_samples: 缓冲区容量（样本数，不是字节数）
  explicit AudioRingBuffer(size_t capacity_samples);
  ~AudioRingBuffer();

  // 写入 PCM16 数据，返回实际写入的样本数
  // 如果缓冲区满，会覆盖最旧的数据（overwrite 模式）
  size_t Write(const int16_t* data, size_t samples);

  // 读取 PCM16 数据，返回实际读取的样本数
  // 非阻塞：如果没有足够数据，读取可用的部分
  size_t Read(int16_t* out, size_t samples);

  // 阻塞读取，直到读取到指定数量的样本
  // timeout_ms: 超时时间（毫秒），0 表示无限等待
  // 返回实际读取的样本数
  size_t ReadBlocking(int16_t* out, size_t samples, int timeout_ms = 0);

  // 查看但不消费数据（peek）
  // offset: 从当前读指针偏移多少样本
  size_t Peek(int16_t* out, size_t samples, size_t offset = 0) const;

  // 获取当前可读的样本数
  size_t Available() const;

  // 获取缓冲区容量
  size_t Capacity() const { return capacity_; }

  // 清空缓冲区
  void Clear();

  // 标记当前读指针位置（用于 ASR 累积的起点）
  void Mark();

  // 从标记位置读取到当前位置（不消费数据）
  // 用于 ASR：读取从说话开始到现在的所有数据
  size_t ReadFromMark(int16_t* out, size_t max_samples) const;

  // 重置标记到当前读指针位置
  void ResetMark();

  // 等待直到有数据可读
  void WaitForData(int timeout_ms = 0);

 private:
  std::vector<int16_t> buffer_;
  size_t capacity_;
  size_t write_pos_ = 0;
  size_t read_pos_ = 0;
  size_t mark_pos_ = 0;
  std::atomic<size_t> available_{0};

  mutable std::mutex mutex_;
  std::condition_variable cv_;
};

}  // namespace firefly
