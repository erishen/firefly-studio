// piper_tts.cc —— C++ Piper TTS 封装层实现
// 方案：每次合成启动 Python 进程（简单可靠，已验证）
// 常驻服务管理由 tts.js 负责，C++ 层专注 PCM 处理
#include "piper_tts.h"
#include "pcm_processor.h"

#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <unistd.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <signal.h>
#include <sstream>
#include <chrono>
#include <thread>

namespace firefly {

PiperTTS::PiperTTS() = default;

PiperTTS::~PiperTTS() {
  Stop();
}

std::string PiperTTS::GenerateId() {
  static std::atomic<int> counter{0};
  return "tts_" + std::to_string(getpid()) + "_" + std::to_string(counter++);
}

bool PiperTTS::Init(const TTSConfig& config) {
  config_ = config;
  ready_ = true;
  return true;
}

TTSResult PiperTTS::Synthesize(const std::string& text, float rate) {
  TTSResult result;
  result.sample_rate = config_.sample_rate;
  result.channels = 1;

  if (!ready_) {
    result.success = false;
    result.error = "服务未就绪";
    return result;
  }

  if (text.empty()) {
    result.success = false;
    result.error = "文本为空";
    return result;
  }

  // 构造临时文件路径
  char tmp_path[] = "/tmp/piper_tts_XXXXXX.wav";
  int fd = mkstemps(tmp_path, 4);
  if (fd < 0) {
    result.success = false;
    result.error = "创建临时文件失败";
    return result;
  }
  close(fd);

  // 构造临时 Python 脚本
  char script_path[] = "/tmp/piper_tts_XXXXXX.py";
  int script_fd = mkstemps(script_path, 3);
  if (script_fd < 0) {
    result.success = false;
    result.error = "创建脚本文件失败";
    unlink(tmp_path);
    return result;
  }

  // 构造临时文本文件
  char text_path[] = "/tmp/piper_tts_XXXXXX.txt";
  int text_fd = mkstemps(text_path, 4);
  if (text_fd < 0) {
    result.success = false;
    result.error = "创建文本文件失败";
    unlink(tmp_path);
    unlink(script_path);
    return result;
  }
  write(text_fd, text.c_str(), text.size());
  close(text_fd);

  // 写入 Python 脚本
  std::ostringstream script;
  script << "import sys\n";
  script << "from piper import PiperVoice\n";
  script << "import wave\n";
  script << "voice = PiperVoice.load('" << config_.zh_model << "')\n";
  script << "with open('" << text_path << "', 'r') as f:\n";
  script << "    text = f.read()\n";
  script << "audio = list(voice.synthesize(text))\n";
  script << "with wave.open('" << tmp_path << "', 'wb') as wf:\n";
  script << "    wf.setnchannels(1)\n";
  script << "    wf.setsampwidth(2)\n";
  script << "    wf.setframerate(22050)\n";
  script << "    wf.writeframes(b''.join(a.audio_int16_bytes for a in audio))\n";

  std::string script_content = script.str();
  write(script_fd, script_content.c_str(), script_content.size());
  close(script_fd);

  // 构造命令：python 脚本
  std::ostringstream cmd;
  cmd << config_.python_path << " " << script_path << " 2>&1";

  // 执行命令并获取输出
  FILE* pipe = popen(cmd.str().c_str(), "r");
  if (!pipe) {
    result.success = false;
    result.error = "popen 失败";
    unlink(script_path);
    unlink(text_path);
    unlink(tmp_path);
    return result;
  }

  std::string output;
  char buffer[1024];
  while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
    output += buffer;
  }
  int ret = pclose(pipe);

  // 清理临时文件
  unlink(script_path);
  unlink(text_path);

  if (ret != 0) {
    result.success = false;
    result.error = "Python 合成失败 (exit: " + std::to_string(ret) + "): " + output;
    unlink(tmp_path);
    return result;
  }

  // 读取 WAV 文件
  FILE* fp = fopen(tmp_path, "rb");
  if (!fp) {
    result.success = false;
    result.error = "打开输出文件失败";
    unlink(tmp_path);
    return result;
  }

  fseek(fp, 0, SEEK_END);
  long file_size = ftell(fp);
  fseek(fp, 0, SEEK_SET);

  if (file_size < 44) {
    result.success = false;
    result.error = "WAV 文件太小";
    fclose(fp);
    unlink(tmp_path);
    return result;
  }

  // 读取 WAV 头
  uint8_t header[44];
  fread(header, 1, 44, fp);

  // 解析采样率
  int sample_rate = *reinterpret_cast<int*>(header + 24);
  result.sample_rate = sample_rate;

  // 读取 PCM 数据
  long pcm_size = file_size - 44;
  std::vector<uint8_t> pcm_bytes(pcm_size);
  fread(pcm_bytes.data(), 1, pcm_size, fp);
  fclose(fp);
  unlink(tmp_path);

  // 转换为 int16
  size_t num_samples = pcm_size / 2;
  result.pcm.resize(num_samples);
  std::memcpy(result.pcm.data(), pcm_bytes.data(), pcm_size);

  // 应用淡入淡出
  std::vector<uint8_t> faded = ApplyFadeInOut(
      reinterpret_cast<const uint8_t*>(result.pcm.data()),
      result.pcm.size() * sizeof(int16_t),
      config_.fade_ms, sample_rate);

  // 转换回 int16
  result.pcm.resize(faded.size() / sizeof(int16_t));
  std::memcpy(result.pcm.data(), faded.data(), faded.size());

  // 计算时长
  result.duration_ms = ComputeDurationMs(
      reinterpret_cast<const uint8_t*>(result.pcm.data()),
      result.pcm.size() * sizeof(int16_t), sample_rate);

  result.success = true;
  return result;
}

void PiperTTS::Stop() {
  ready_ = false;
  should_stop_ = true;
}

// 以下为常驻服务版本的占位实现（当前未使用）
bool PiperTTS::StartServer() { return true; }
bool PiperTTS::WaitForReady(int timeout_ms) { return true; }
void PiperTTS::ReadLoop() {}
void PiperTTS::ProcessResponseLine(const std::string& line) {}
TTSResult PiperTTS::ParseJsonResponse(const std::string& json) { return TTSResult(); }
bool PiperTTS::SendRequest(const std::string& id, const std::string& text, float rate) { return false; }

}  // namespace firefly
