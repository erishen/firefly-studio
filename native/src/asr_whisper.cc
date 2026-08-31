#include "asr_whisper.h"

#include <whisper.h>

#include <cstring>
#include <iostream>
#include <sstream>

namespace firefly {

AsrWhisper::AsrWhisper() = default;

AsrWhisper::~AsrWhisper() {
  if (ctx_) {
    whisper_free(ctx_);
    ctx_ = nullptr;
  }
}

bool AsrWhisper::LoadModel(const std::string& model_path) {
  if (ctx_) {
    whisper_free(ctx_);
    ctx_ = nullptr;
  }

  std::cout << "[Whisper] Loading model: " << model_path << std::endl;

  // 使用旧版 API，避免新版后端系统（ggml-backend）的注册问题
  // 新版 whisper_init_from_file_with_params 在某些编译配置下会因 devices=0 崩溃
  ctx_ = whisper_init_from_file(model_path.c_str());

  if (!ctx_) {
    std::cerr << "[Whisper] Failed to load model: " << model_path << std::endl;
    return false;
  }

  std::cout << "[Whisper] Model loaded successfully" << std::endl;
  return true;
}

std::string AsrWhisper::Transcribe(const float* pcm, size_t len,
                                   const char* language) {
  if (!ctx_ || !pcm || len == 0) return "";

  whisper_full_params wparams =
      whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  wparams.print_realtime = false;
  wparams.print_progress = false;
  wparams.print_timestamps = false;
  wparams.print_special = false;
  wparams.translate = false;
  wparams.language = language ? language : "zh";
  wparams.n_threads = 4;
  wparams.no_context = true;
  wparams.single_segment = true;

  if (whisper_full(ctx_, wparams, pcm, static_cast<int>(len)) != 0) {
    return "";
  }

  std::ostringstream oss;
  int n_segments = whisper_full_n_segments(ctx_);
  for (int i = 0; i < n_segments; ++i) {
    const char* text = whisper_full_get_segment_text(ctx_, i);
    if (text) oss << text;
  }

  std::string result = oss.str();
  // 去除首尾空白
  size_t start = result.find_first_not_of(" \t\n\r");
  if (start == std::string::npos) return "";
  size_t end = result.find_last_not_of(" \t\n\r");
  return result.substr(start, end - start + 1);
}

}  // namespace firefly
