// piper_tts.h —— C++ Piper TTS 封装层
// 方案：每次合成启动 Python 进程（简单可靠）
// 常驻服务管理由 tts.js 负责，C++ 层专注 PCM 处理
#pragma once

#include <cstdint>
#include <cstddef>
#include <functional>
#include <memory>
#include <string>
#include <vector>
#include <atomic>

namespace firefly {

// TTS 合成结果
struct TTSResult {
  std::vector<int16_t> pcm;       // 合成的 PCM 数据（16-bit mono）
  int sample_rate = 22050;        // 采样率
  int channels = 1;               // 声道数
  double duration_ms = 0;         // 时长（毫秒）
  std::vector<std::string> segments; // 分段文本
  bool success = false;
  std::string error;
};

// TTS 配置
struct TTSConfig {
  std::string python_path;        // Python 解释器路径
  std::string server_script;      // piper_server.py 路径（预留）
  std::string zh_model;           // 中文模型路径
  std::string en_model;           // 英文模型路径
  int sample_rate = 22050;        // 采样率
  float default_rate = 1.0f;      // 默认语速
  int silence_ms = 150;           // 段间静音（毫秒）
  int fade_ms = 10;               // 淡入淡出时长（毫秒）
};

// Piper TTS 封装类
class PiperTTS {
 public:
  PiperTTS();
  ~PiperTTS();

  // 初始化
  bool Init(const TTSConfig& config);

  // 同步合成（阻塞）
  TTSResult Synthesize(const std::string& text, float rate = 1.0f);

  // 停止
  void Stop();

  // 是否就绪
  bool ready() const { return ready_; }

  // 获取配置
  const TTSConfig& config() const { return config_; }

 private:
  TTSConfig config_;
  std::atomic<bool> ready_{false};
  std::atomic<bool> should_stop_{false};

  // 生成唯一 ID
  std::string GenerateId();

  // 以下为常驻服务版本的预留接口（当前未使用）
  bool StartServer();
  bool WaitForReady(int timeout_ms);
  void ReadLoop();
  void ProcessResponseLine(const std::string& line);
  TTSResult ParseJsonResponse(const std::string& json);
  bool SendRequest(const std::string& id, const std::string& text, float rate);
};

}  // namespace firefly
