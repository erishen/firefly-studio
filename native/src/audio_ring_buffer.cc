// audio_ring_buffer.cc —— 线程安全的音频环形缓冲区实现
#include "audio_ring_buffer.h"

#include <algorithm>
#include <cstring>

namespace firefly {

AudioRingBuffer::AudioRingBuffer(size_t capacity_samples)
    : capacity_(capacity_samples) {
  buffer_.resize(capacity_);
}

AudioRingBuffer::~AudioRingBuffer() = default;

size_t AudioRingBuffer::Write(const int16_t* data, size_t samples) {
  if (!data || samples == 0) return 0;

  std::lock_guard<std::mutex> lock(mutex_);

  // 限制写入量不超过容量
  size_t to_write = std::min(samples, capacity_);

  for (size_t i = 0; i < to_write; ++i) {
    buffer_[write_pos_] = data[i];
    write_pos_ = (write_pos_ + 1) % capacity_;
  }

  // 更新可读样本数
  size_t new_available = available_.load() + to_write;
  if (new_available > capacity_) {
    // 缓冲区满，覆盖最旧的数据，移动读指针
    size_t overflow = new_available - capacity_;
    read_pos_ = (read_pos_ + overflow) % capacity_;
    if (mark_pos_ < overflow) {
      mark_pos_ = 0;
    } else {
      mark_pos_ -= overflow;
    }
    new_available = capacity_;
  }
  available_.store(new_available);

  cv_.notify_one();
  return to_write;
}

size_t AudioRingBuffer::Read(int16_t* out, size_t samples) {
  if (!out || samples == 0) return 0;

  std::lock_guard<std::mutex> lock(mutex_);

  size_t avail = available_.load();
  size_t to_read = std::min(samples, avail);

  for (size_t i = 0; i < to_read; ++i) {
    out[i] = buffer_[read_pos_];
    read_pos_ = (read_pos_ + 1) % capacity_;
  }

  available_.store(avail - to_read);
  return to_read;
}

size_t AudioRingBuffer::ReadBlocking(int16_t* out, size_t samples, int timeout_ms) {
  if (!out || samples == 0) return 0;

  size_t total_read = 0;
  size_t remaining = samples;

  while (remaining > 0) {
    {
      std::unique_lock<std::mutex> lock(mutex_);
      size_t avail = available_.load();

      if (avail == 0) {
        if (timeout_ms > 0) {
          cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms));
        } else {
          cv_.wait(lock);
        }
        avail = available_.load();
        if (avail == 0) {
          // 超时，返回已读取的
          break;
        }
      }

      size_t to_read = std::min(remaining, avail);
      for (size_t i = 0; i < to_read; ++i) {
        out[total_read + i] = buffer_[read_pos_];
        read_pos_ = (read_pos_ + 1) % capacity_;
      }

      available_.store(avail - to_read);
      total_read += to_read;
      remaining -= to_read;
    }
  }

  return total_read;
}

size_t AudioRingBuffer::Peek(int16_t* out, size_t samples, size_t offset) const {
  if (!out || samples == 0) return 0;

  std::lock_guard<std::mutex> lock(mutex_);

  size_t avail = available_.load();
  if (offset >= avail) return 0;

  size_t to_peek = std::min(samples, avail - offset);
  size_t pos = (read_pos_ + offset) % capacity_;

  for (size_t i = 0; i < to_peek; ++i) {
    out[i] = buffer_[pos];
    pos = (pos + 1) % capacity_;
  }

  return to_peek;
}

size_t AudioRingBuffer::Available() const {
  return available_.load();
}

void AudioRingBuffer::Clear() {
  std::lock_guard<std::mutex> lock(mutex_);
  write_pos_ = 0;
  read_pos_ = 0;
  mark_pos_ = 0;
  available_.store(0);
}

void AudioRingBuffer::Mark() {
  std::lock_guard<std::mutex> lock(mutex_);
  mark_pos_ = read_pos_;
}

size_t AudioRingBuffer::ReadFromMark(int16_t* out, size_t max_samples) const {
  if (!out || max_samples == 0) return 0;

  std::lock_guard<std::mutex> lock(mutex_);

  // 计算从 mark 到当前读指针的样本数
  size_t avail;
  if (write_pos_ >= mark_pos_) {
    avail = write_pos_ - mark_pos_;
  } else {
    avail = capacity_ - mark_pos_ + write_pos_;
  }

  size_t to_read = std::min(max_samples, avail);
  size_t pos = mark_pos_;

  for (size_t i = 0; i < to_read; ++i) {
    out[i] = buffer_[pos];
    pos = (pos + 1) % capacity_;
  }

  return to_read;
}

void AudioRingBuffer::ResetMark() {
  std::lock_guard<std::mutex> lock(mutex_);
  mark_pos_ = read_pos_;
}

void AudioRingBuffer::WaitForData(int timeout_ms) {
  std::unique_lock<std::mutex> lock(mutex_);
  if (available_.load() > 0) return;

  if (timeout_ms > 0) {
    cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms));
  } else {
    cv_.wait(lock);
  }
}

}  // namespace firefly
