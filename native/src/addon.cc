// firefly_native addon —— Electron 主进程通过它调用 C++ 能力。
// 暴露的模块结构：
//   {
//     version: string,
//     audio: {
//       create(sampleRate) -> handle,       // 创建 AudioEngine
//       feedRms(handle, pcmBuffer) -> rms,  // 计算 RMS 能量
//       isSpeech(handle, pcmBuffer) -> bool,
//       setThreshold(handle, t),
//       destroy(handle),
//     },
//     asr: {
//       create(address, token) -> handle,
//       start(handle, sampleRate) -> bool,
//       feed(handle, pcmBuffer) -> text,
//       finalize(handle) -> text,
//       destroy(handle),
//     },
//     test: test(loops) -> elapsedMs,      // 自检：跑一遍能量计算
//   }

#include <napi.h>

#include <chrono>
#include <cstdint>
#include <memory>
#include <unordered_map>

#include "asr_client.h"
#include "audio_engine.h"
#include "mic_capture.h"

namespace {

// ---- 句柄表：把 JS 句柄(int) 映射到 C++ 对象，避免直接暴露裸指针 ----
std::unordered_map<int64_t, std::unique_ptr<firefly::AudioEngine>> g_audio;
std::unordered_map<int64_t, std::unique_ptr<firefly::AsrClient>> g_asr;
std::unordered_map<int64_t, std::unique_ptr<firefly::MicCapture>> g_mic;
int64_t g_next_handle = 1;

int64_t AllocAudio(int sample_rate) {
  int64_t h = g_next_handle++;
  g_audio[h] = std::make_unique<firefly::AudioEngine>(sample_rate);
  return h;
}

int64_t AllocAsr(const std::string& address, const std::string& token) {
  auto client = std::make_unique<firefly::AsrClient>();
  client->Initialize(address, token);
  int64_t h = g_next_handle++;
  g_asr[h] = std::move(client);
  return h;
}

// 从 N-API Buffer 中取 int16 数据（跨进程传递的 PCM 帧）。
const int16_t* BufferToI16(const Napi::Buffer<int16_t>& buf, size_t* out_len) {
  *out_len = buf.Length();
  return buf.Data();
}

// ---- JS 绑定 ----

Napi::Value CreateAudio(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int sample_rate = info[0].IsNumber() ? info[0].As<Napi::Number>().Int32Value()
                                       : 16000;
  int64_t h = AllocAudio(sample_rate);
  return Napi::Number::New(env, static_cast<double>(h));
}

Napi::Value FeedRms(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_audio.find(h);
  if (it == g_audio.end()) {
    throw Napi::Error::New(env, "invalid audio handle");
  }
  auto buf = info[1].As<Napi::Buffer<int16_t>>();
  size_t len = 0;
  const int16_t* data = BufferToI16(buf, &len);
  double rms = it->second->ComputeRms(data, len);
  return Napi::Number::New(env, rms);
}

Napi::Value IsSpeech(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_audio.find(h);
  if (it == g_audio.end()) {
    throw Napi::Error::New(env, "invalid audio handle");
  }
  auto buf = info[1].As<Napi::Buffer<int16_t>>();
  size_t len = 0;
  const int16_t* data = BufferToI16(buf, &len);
  bool speech = it->second->IsSpeech(data, len);
  return Napi::Boolean::New(env, speech);
}

Napi::Value SetThreshold(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_audio.find(h);
  if (it == g_audio.end()) {
    throw Napi::Error::New(env, "invalid audio handle");
  }
  double t = info[1].As<Napi::Number>().DoubleValue();
  it->second->SetSpeechThreshold(t);
  return env.Undefined();
}

Napi::Value DestroyAudio(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_audio.erase(h);
  return env.Undefined();
}

Napi::Value CreateAsr(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string address =
      info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "";
  std::string token =
      info[1].IsString() ? info[1].As<Napi::String>().Utf8Value() : "";
  int64_t h = AllocAsr(address, token);
  return Napi::Number::New(env, static_cast<double>(h));
}

Napi::Value AsrStart(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_asr.find(h);
  if (it == g_asr.end()) {
    throw Napi::Error::New(env, "invalid asr handle");
  }
  int sample_rate = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value()
                                       : 16000;
  bool ok = it->second->Start(sample_rate);
  return Napi::Boolean::New(env, ok);
}

Napi::Value AsrFeed(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_asr.find(h);
  if (it == g_asr.end()) {
    throw Napi::Error::New(env, "invalid asr handle");
  }
  auto buf = info[1].As<Napi::Buffer<int16_t>>();
  size_t len = 0;
  const int16_t* data = BufferToI16(buf, &len);
  std::string text = it->second->Feed(data, len);
  return Napi::String::New(env, text);
}

Napi::Value AsrFinalize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_asr.find(h);
  if (it == g_asr.end()) {
    throw Napi::Error::New(env, "invalid asr handle");
  }
  std::string text = it->second->Finalize();
  return Napi::String::New(env, text);
}

Napi::Value DestroyAsr(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_asr.erase(h);
  return env.Undefined();
}

// ---- 麦克风采集 ----
// mic.start(sampleRate, frameMs, modelPath, onFrame, onAsr, onError, options) -> handle
// options: { threshold, silenceMs, minSpeechMs }
Napi::Value MicStart(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int sample_rate = info[0].IsNumber() ? info[0].As<Napi::Number>().Int32Value() : 16000;
  int frame_ms = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 20;
  std::string model_path = info[2].IsString() ? info[2].As<Napi::String>().Utf8Value() : "";
  Napi::Function on_frame = info[3].IsFunction() ? info[3].As<Napi::Function>() : Napi::Function();
  Napi::Function on_asr = info[4].IsFunction() ? info[4].As<Napi::Function>() : Napi::Function();
  Napi::Function on_error = info[5].IsFunction() ? info[5].As<Napi::Function>() : Napi::Function();

  double threshold = 0.02;
  int silence_ms = 700;
  int min_speech_ms = 300;
  if (info[6].IsObject()) {
    Napi::Object opts = info[6].As<Napi::Object>();
    if (opts.Has("threshold")) threshold = opts.Get("threshold").As<Napi::Number>().DoubleValue();
    if (opts.Has("silenceMs")) silence_ms = opts.Get("silenceMs").As<Napi::Number>().Int32Value();
    if (opts.Has("minSpeechMs")) min_speech_ms = opts.Get("minSpeechMs").As<Napi::Number>().Int32Value();
  }

  auto frame_tsfn = on_frame.IsFunction()
      ? Napi::ThreadSafeFunction::New(env, on_frame, "mic-frame", 0, 1, [](Napi::Env) {})
      : Napi::ThreadSafeFunction();

  auto asr_tsfn = on_asr.IsFunction()
      ? Napi::ThreadSafeFunction::New(env, on_asr, "mic-asr", 0, 1, [](Napi::Env) {})
      : Napi::ThreadSafeFunction();

  auto error_tsfn = on_error.IsFunction()
      ? Napi::ThreadSafeFunction::New(env, on_error, "mic-error", 0, 1, [](Napi::Env) {})
      : Napi::ThreadSafeFunction();

  int64_t h = g_next_handle++;
  auto mic = std::make_unique<firefly::MicCapture>();
  mic->SetSpeechThreshold(threshold);

  firefly::MicCallback frame_cb = nullptr;
  if (on_frame.IsFunction()) {
    frame_cb = [frame_tsfn](const firefly::MicFrame& frame) {
      double rms = frame.rms;
      bool is_speech = frame.is_speech;
      frame_tsfn.BlockingCall([rms, is_speech](Napi::Env env, Napi::Function js_cb) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("rms", Napi::Number::New(env, rms));
        obj.Set("isSpeech", Napi::Boolean::New(env, is_speech));
        js_cb.Call({obj});
      });
    };
  }

  firefly::AsrResultCallback asr_cb = nullptr;
  if (on_asr.IsFunction()) {
    asr_cb = [asr_tsfn](const std::string& text) {
      asr_tsfn.BlockingCall([text](Napi::Env env, Napi::Function js_cb) {
        js_cb.Call({Napi::String::New(env, text)});
      });
    };
  }

  firefly::MicErrorCallback err_cb = nullptr;
  if (on_error.IsFunction()) {
    err_cb = [error_tsfn](const std::string& msg) {
      error_tsfn.BlockingCall([msg](Napi::Env env, Napi::Function js_cb) {
        js_cb.Call({Napi::String::New(env, msg)});
      });
    };
  }

  bool ok = mic->Start(sample_rate, frame_ms, model_path,
                       silence_ms, min_speech_ms,
                       std::move(frame_cb), std::move(asr_cb), std::move(err_cb));
  if (!ok) {
    throw Napi::Error::New(env, "mic start failed");
  }

  g_mic[h] = std::move(mic);
  return Napi::Number::New(env, static_cast<double>(h));
}

Napi::Value MicStop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_mic.find(h);
  if (it != g_mic.end()) it->second->Stop();
  return env.Undefined();
}

Napi::Value MicSetThreshold(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_mic.find(h);
  if (it == g_mic.end()) throw Napi::Error::New(env, "invalid mic handle");
  double t = info[1].As<Napi::Number>().DoubleValue();
  it->second->SetSpeechThreshold(t);
  return env.Undefined();
}

Napi::Value MicDestroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_mic.erase(h);
  return env.Undefined();
}

// 自检：跑 N 次能量计算，返回耗时 ms。用于验证原生模块正常、也可做断点验证。
Napi::Value Test(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int loops = info[0].IsNumber() ? info[0].As<Napi::Number>().Int32Value() : 1000;

  firefly::AudioEngine engine(16000);
  std::vector<int16_t> frame(1600);  // 100ms @16k
  for (auto& s : frame) s = 1000;    // 固定电平

  auto t0 = std::chrono::steady_clock::now();
  double total = 0.0;
  for (int i = 0; i < loops; ++i) {
    total += engine.ComputeRms(frame.data(), frame.size());
  }
  auto t1 = std::chrono::steady_clock::now();
  auto ms = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count() /
            1000.0;

  Napi::Object out = Napi::Object::New(env);
  out.Set("elapsedMs", ms);
  out.Set("avgRms", total / loops);
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("version", Napi::String::New(env, "0.1.0"));

  // audio 命名空间
  Napi::Object audio = Napi::Object::New(env);
  audio.Set("create", Napi::Function::New(env, CreateAudio));
  audio.Set("feedRms", Napi::Function::New(env, FeedRms));
  audio.Set("isSpeech", Napi::Function::New(env, IsSpeech));
  audio.Set("setThreshold", Napi::Function::New(env, SetThreshold));
  audio.Set("destroy", Napi::Function::New(env, DestroyAudio));
  exports.Set("audio", audio);

  // asr 命名空间
  Napi::Object asr = Napi::Object::New(env);
  asr.Set("create", Napi::Function::New(env, CreateAsr));
  asr.Set("start", Napi::Function::New(env, AsrStart));
  asr.Set("feed", Napi::Function::New(env, AsrFeed));
  asr.Set("finalize", Napi::Function::New(env, AsrFinalize));
  asr.Set("destroy", Napi::Function::New(env, DestroyAsr));
  exports.Set("asr", asr);

  // mic 命名空间（CoreAudio 麦克风采集 + VAD）
  Napi::Object mic = Napi::Object::New(env);
  mic.Set("start", Napi::Function::New(env, MicStart));
  mic.Set("stop", Napi::Function::New(env, MicStop));
  mic.Set("setThreshold", Napi::Function::New(env, MicSetThreshold));
  mic.Set("destroy", Napi::Function::New(env, MicDestroy));
  exports.Set("mic", mic);

  exports.Set("test", Napi::Function::New(env, Test));
  return exports;
}

}  // namespace

NODE_API_MODULE(firefly_native, Init)
