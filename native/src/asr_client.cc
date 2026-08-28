#include "asr_client.h"

namespace firefly {

AsrClient::AsrClient() = default;
AsrClient::~AsrClient() = default;

bool AsrClient::Initialize(const std::string& address, const std::string& token) {
  address_ = address;
  token_ = token;
  // 占位：真实实现里这里会创建 WS 连接并鉴权。
  return true;
}

bool AsrClient::Start(int sample_rate) {
  if (running_) return false;
  sample_rate_ = sample_rate;
  running_ = true;
  total_samples_ = 0;
  accumulated_.clear();
  return true;
}

void AsrClient::Stop() {
  running_ = false;
  // 停止时如果还有未 finalize 的内容，触发完成回调。
  if (!accumulated_.empty() && on_complete_) {
    on_complete_(accumulated_);
  }
}

std::string AsrClient::Feed(const int16_t* data, size_t len) {
  if (!running_ || data == nullptr || len == 0) {
    return accumulated_;
  }

  total_samples_ += len;

  // 占位"识别"：累计若干帧后，把字节数转成一段假文本，模拟流式出字。
  // 真实实现中应把 PCM 通过 WS 发送到云端 ASR。
  size_t frames = total_samples_ / sample_rate_;
  std::string candidate;
  for (size_t i = 0; i < frames; ++i) {
    candidate += "识别中 ";
  }
  if (candidate != accumulated_) {
    accumulated_ = candidate;
    if (on_progress_) {
      on_progress_(accumulated_);
    }
  }
  return accumulated_;
}

std::string AsrClient::Finalize() {
  running_ = false;
  std::string result = accumulated_.empty() ? "(无语音)" : accumulated_;
  if (on_complete_) {
    on_complete_(result);
  }
  accumulated_.clear();
  return result;
}

}  // namespace firefly
