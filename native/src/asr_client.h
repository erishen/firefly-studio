#ifndef QT_NATIVE_ASR_CLIENT_H
#define QT_NATIVE_ASR_CLIENT_H

#include <functional>
#include <string>

namespace qtnative {

// ASR 客户端接口骨架。
// 目标形态：与 QtEngine 的 asr 模块对齐 ——
//   流式 PCM 输入 -> 云端 WS -> 回调文本（OnProgress / OnComplete）。
// 现阶段先用"占位实现"模拟识别流程，方便在主进程里打通 IPC 链路并调试，
// 后续接入真实 WS（或 QtEngine 的 asr 库）时保持接口不变。
class AsrClient {
 public:
  // 回调：中间结果 / 最终结果
  using ProgressCallback = std::function<void(const std::string&)>;
  using CompleteCallback = std::function<void(const std::string&)>;

  AsrClient();
  ~AsrClient();

  // 初始化：address 为 WS 地址，token 为鉴权令牌（可空）。
  bool Initialize(const std::string& address, const std::string& token);

  // 开始 / 停止一轮识别。
  bool Start(int sample_rate);
  void Stop();

  // 喂入一段 PCM16 数据。返回当前累计的中间文本。
  std::string Feed(const int16_t* data, size_t len);

  // 手动触发"完成"（占位实现：把累计 buffer 当最终文本）。
  std::string Finalize();

  void SetProgressCallback(ProgressCallback cb) { on_progress_ = std::move(cb); }
  void SetCompleteCallback(CompleteCallback cb) { on_complete_ = std::move(cb); }

  bool running() const { return running_; }

 private:
  bool running_ = false;
  int sample_rate_ = 16000;
  size_t total_samples_ = 0;
  std::string address_;
  std::string token_;
  std::string accumulated_;

  ProgressCallback on_progress_;
  CompleteCallback on_complete_;
};

}  // namespace qtnative

#endif  // QT_NATIVE_ASR_CLIENT_H
