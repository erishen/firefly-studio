#ifndef FIREFLY_NATIVE_ASR_WHISPER_H
#define FIREFLY_NATIVE_ASR_WHISPER_H

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

struct whisper_context;

namespace firefly {

// Whisper.cpp 本地离线 ASR 封装。
// 模型加载一次，可反复推理。推理在调用线程执行（建议放独立线程）。
class AsrWhisper {
 public:
  AsrWhisper();
  ~AsrWhisper();

  // 加载 ggml 模型（如 ggml-base.bin）。返回是否成功。
  bool LoadModel(const std::string& model_path);

  // 推理：输入 16kHz float32 单声道 PCM，返回识别文本。
  // language: "zh" / "en" / nullptr（自动检测）
  std::string Transcribe(const float* pcm, size_t len,
                         const char* language = "zh");

  bool loaded() const { return ctx_ != nullptr; }

 private:
  whisper_context* ctx_ = nullptr;
};

}  // namespace firefly

#endif  // FIREFLY_NATIVE_ASR_WHISPER_H
