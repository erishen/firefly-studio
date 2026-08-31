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
#include "coreaudio_player.h"
#include "pcm_processor.h"
#include "audio_ring_buffer.h"
#include "audio_pipeline.h"
#include "piper_tts.h"
#include "audio_devices.h"

namespace {

// ---- 句柄表：把 JS 句柄(int) 映射到 C++ 对象，避免直接暴露裸指针 ----
std::unordered_map<int64_t, std::unique_ptr<firefly::AudioEngine>> g_audio;
std::unordered_map<int64_t, std::unique_ptr<firefly::AsrClient>> g_asr;
std::unordered_map<int64_t, std::unique_ptr<firefly::MicCapture>> g_mic;
std::unordered_map<int64_t, std::unique_ptr<firefly::CoreAudioPlayer>> g_player;
std::unordered_map<int64_t, std::unique_ptr<firefly::AudioRingBuffer>> g_ringbuf;
std::unordered_map<int64_t, std::unique_ptr<firefly::AudioPipeline>> g_pipeline;
std::unordered_map<int64_t, std::unique_ptr<firefly::PiperTTS>> g_tts;
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
    asr_cb = [asr_tsfn](const std::string& text, bool is_final) {
      asr_tsfn.BlockingCall([text, is_final](Napi::Env env, Napi::Function js_cb) {
        js_cb.Call({Napi::String::New(env, text), Napi::Boolean::New(env, is_final)});
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

// mic.setAdaptiveThreshold(handle, enabled)
Napi::Value MicSetAdaptiveThreshold(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_mic.find(h);
  if (it == g_mic.end()) throw Napi::Error::New(env, "invalid mic handle");
  bool enabled = info[1].As<Napi::Boolean>().Value();
  it->second->SetAdaptiveThreshold(enabled);
  return env.Undefined();
}

// mic.getStatus(handle) -> { running, currentThreshold, noiseFloor, adaptiveEnabled }
Napi::Value MicGetStatus(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_mic.find(h);
  if (it == g_mic.end()) throw Napi::Error::New(env, "invalid mic handle");
  Napi::Object obj = Napi::Object::New(env);
  obj.Set("running", Napi::Boolean::New(env, it->second->running()));
  obj.Set("currentThreshold", Napi::Number::New(env, it->second->GetCurrentThreshold()));
  obj.Set("noiseFloor", Napi::Number::New(env, it->second->GetNoiseFloor()));
  obj.Set("adaptiveEnabled", Napi::Boolean::New(env, it->second->IsAdaptiveThresholdEnabled()));
  return obj;
}

Napi::Value MicDestroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_mic.erase(h);
  return env.Undefined();
}

// ---- CoreAudio 播放器 ----
// player.create(sampleRate, channels) -> handle
Napi::Value PlayerCreate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int sample_rate = info[0].IsNumber() ? info[0].As<Napi::Number>().Int32Value() : 22050;
  int channels = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 1;
  auto player = std::make_unique<firefly::CoreAudioPlayer>();
  if (!player->Init(sample_rate, channels)) {
    throw Napi::Error::New(env, "CoreAudio player init failed");
  }
  int64_t h = g_next_handle++;
  g_player[h] = std::move(player);
  return Napi::Number::New(env, static_cast<double>(h));
}

// player.play(handle, pcmBuffer)
Napi::Value PlayerPlay(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_player.find(h);
  if (it == g_player.end()) throw Napi::Error::New(env, "invalid player handle");
  auto buf = info[1].As<Napi::Buffer<int16_t>>();
  size_t len = buf.Length();
  const int16_t* data = buf.Data();
  it->second->Play(data, len);
  return env.Undefined();
}

// player.stop(handle)
Napi::Value PlayerStop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_player.find(h);
  if (it != g_player.end()) it->second->Stop();
  return env.Undefined();
}

// player.destroy(handle)
Napi::Value PlayerDestroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_player.erase(h);
  return env.Undefined();
}

// ---- PCM 音频处理 ----
// pcm.applyFadeInOut(pcmBuffer, fadeMs, sampleRate) -> Buffer
Napi::Value PcmApplyFadeInOut(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  double fade_ms = info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 10.0;
  int sample_rate = info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 22050;

  std::vector<uint8_t> result = firefly::ApplyFadeInOut(
      buf.Data(), buf.Length(), fade_ms, sample_rate);

  return Napi::Buffer<uint8_t>::Copy(env, result.data(), result.size());
}

// pcm.createSilence(durationMs, sampleRate) -> Buffer
Napi::Value PcmCreateSilence(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  double duration_ms = info[0].IsNumber() ? info[0].As<Napi::Number>().DoubleValue() : 100.0;
  int sample_rate = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 22050;

  std::vector<uint8_t> result = firefly::CreateSilence(duration_ms, sample_rate);

  return Napi::Buffer<uint8_t>::Copy(env, result.data(), result.size());
}

// pcm.clip(pcmBuffer) -> Buffer
Napi::Value PcmClip(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();

  std::vector<uint8_t> result = firefly::ClipPcm(buf.Data(), buf.Length());

  return Napi::Buffer<uint8_t>::Copy(env, result.data(), result.size());
}

// pcm.adjustVolume(pcmBuffer, volume) -> Buffer
Napi::Value PcmAdjustVolume(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  double volume = info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 1.0;

  std::vector<uint8_t> result = firefly::AdjustVolume(buf.Data(), buf.Length(), volume);

  return Napi::Buffer<uint8_t>::Copy(env, result.data(), result.size());
}

// pcm.mergeSegments(segmentBuffers, silenceMs, sampleRate, fadeMs) -> Buffer
Napi::Value PcmMergeSegments(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array segments_arr = info[0].As<Napi::Array>();
  double silence_ms = info[1].IsNumber() ? info[1].As<Napi::Number>().DoubleValue() : 150.0;
  int sample_rate = info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 22050;
  double fade_ms = info[3].IsNumber() ? info[3].As<Napi::Number>().DoubleValue() : 10.0;

  std::vector<std::vector<uint8_t>> segments;
  uint32_t len = segments_arr.Length();
  segments.reserve(len);

  for (uint32_t i = 0; i < len; ++i) {
    Napi::Value item = segments_arr.Get(i);
    if (item.IsBuffer()) {
      auto buf = item.As<Napi::Buffer<uint8_t>>();
      segments.emplace_back(buf.Data(), buf.Data() + buf.Length());
    }
  }

  std::vector<uint8_t> result = firefly::MergePcmSegments(
      segments, silence_ms, sample_rate, fade_ms);

  return Napi::Buffer<uint8_t>::Copy(env, result.data(), result.size());
}

// pcm.computeRms(pcmBuffer) -> number
Napi::Value PcmComputeRms(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();

  double rms = firefly::ComputeRms(buf.Data(), buf.Length());

  return Napi::Number::New(env, rms);
}

// pcm.computeDurationMs(pcmBuffer, sampleRate) -> number
Napi::Value PcmComputeDurationMs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  int sample_rate = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 22050;

  double duration_ms = firefly::ComputeDurationMs(buf.Data(), buf.Length(), sample_rate);

  return Napi::Number::New(env, duration_ms);
}

// pcm.toWav(pcmBuffer, sampleRate, channels) -> Buffer (WAV 文件)
Napi::Value PcmToWav(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  int sample_rate = info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 22050;
  int channels = info[2].IsNumber() ? info[2].As<Napi::Number>().Int32Value() : 1;
  int bits_per_sample = info[3].IsNumber() ? info[3].As<Napi::Number>().Int32Value() : 16;

  size_t pcm_size = buf.Length();
  size_t wav_size = 44 + pcm_size;

  std::vector<uint8_t> wav(wav_size);

  // RIFF header
  std::memcpy(wav.data(), "RIFF", 4);
  *reinterpret_cast<uint32_t*>(wav.data() + 4) = 36 + pcm_size;
  std::memcpy(wav.data() + 8, "WAVE", 4);

  // fmt chunk
  std::memcpy(wav.data() + 12, "fmt ", 4);
  *reinterpret_cast<uint32_t*>(wav.data() + 16) = 16;
  *reinterpret_cast<uint16_t*>(wav.data() + 20) = 1; // PCM
  *reinterpret_cast<uint16_t*>(wav.data() + 22) = channels;
  *reinterpret_cast<uint32_t*>(wav.data() + 24) = sample_rate;
  *reinterpret_cast<uint32_t*>(wav.data() + 28) = sample_rate * channels * bits_per_sample / 8;
  *reinterpret_cast<uint16_t*>(wav.data() + 32) = channels * bits_per_sample / 8;
  *reinterpret_cast<uint16_t*>(wav.data() + 34) = bits_per_sample;

  // data chunk
  std::memcpy(wav.data() + 36, "data", 4);
  *reinterpret_cast<uint32_t*>(wav.data() + 40) = pcm_size;
  std::memcpy(wav.data() + 44, buf.Data(), pcm_size);

  return Napi::Buffer<uint8_t>::Copy(env, wav.data(), wav.size());
}

// ---- 音频环形缓冲区（零拷贝数据传递） ----
// ringbuf.create(capacitySamples) -> handle
Napi::Value RingBufCreate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  size_t capacity = info[0].IsNumber() ? info[0].As<Napi::Number>().Uint32Value() : 16000;
  int64_t h = g_next_handle++;
  g_ringbuf[h] = std::make_unique<firefly::AudioRingBuffer>(capacity);
  return Napi::Number::New(env, static_cast<double>(h));
}

// ringbuf.write(handle, pcmBuffer) -> number (samples written)
Napi::Value RingBufWrite(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_ringbuf.find(h);
  if (it == g_ringbuf.end()) throw Napi::Error::New(env, "invalid ringbuf handle");

  auto buf = info[1].As<Napi::Buffer<int16_t>>();
  size_t written = it->second->Write(buf.Data(), buf.Length());
  return Napi::Number::New(env, static_cast<double>(written));
}

// ringbuf.read(handle, maxSamples) -> Buffer (pcm data)
Napi::Value RingBufRead(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_ringbuf.find(h);
  if (it == g_ringbuf.end()) throw Napi::Error::New(env, "invalid ringbuf handle");

  size_t max_samples = info[1].IsNumber() ? info[1].As<Napi::Number>().Uint32Value() : 1600;
  std::vector<int16_t> out(max_samples);
  size_t read = it->second->Read(out.data(), max_samples);

  return Napi::Buffer<int16_t>::Copy(env, out.data(), read);
}

// ringbuf.available(handle) -> number
Napi::Value RingBufAvailable(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_ringbuf.find(h);
  if (it == g_ringbuf.end()) throw Napi::Error::New(env, "invalid ringbuf handle");

  return Napi::Number::New(env, static_cast<double>(it->second->Available()));
}

// ringbuf.clear(handle)
Napi::Value RingBufClear(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_ringbuf.find(h);
  if (it == g_ringbuf.end()) throw Napi::Error::New(env, "invalid ringbuf handle");
  it->second->Clear();
  return env.Undefined();
}

// ringbuf.mark(handle) - 标记当前读位置
Napi::Value RingBufMark(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_ringbuf.find(h);
  if (it == g_ringbuf.end()) throw Napi::Error::New(env, "invalid ringbuf handle");
  it->second->Mark();
  return env.Undefined();
}

// ringbuf.readFromMark(handle, maxSamples) -> Buffer (从标记位置读取，不消费)
Napi::Value RingBufReadFromMark(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_ringbuf.find(h);
  if (it == g_ringbuf.end()) throw Napi::Error::New(env, "invalid ringbuf handle");

  size_t max_samples = info[1].IsNumber() ? info[1].As<Napi::Number>().Uint32Value() : 16000;
  std::vector<int16_t> out(max_samples);
  size_t read = it->second->ReadFromMark(out.data(), max_samples);

  return Napi::Buffer<int16_t>::Copy(env, out.data(), read);
}

// ringbuf.destroy(handle)
Napi::Value RingBufDestroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_ringbuf.erase(h);
  return env.Undefined();
}

// ---- 音频流水线（零拷贝预处理：采集→降噪→VAD→ASR） ----
// pipeline.create(config) -> handle
// config: { sampleRate, frameMs, enableDenoise, enableVad, enableAsr, asrModelPath, silenceMs, minSpeechMs, vadThreshold }
Napi::Value PipelineCreate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  firefly::AudioPipelineConfig config;

  if (info[0].IsObject()) {
    Napi::Object opts = info[0].As<Napi::Object>();
    if (opts.Has("sampleRate")) config.sample_rate = opts.Get("sampleRate").As<Napi::Number>().Int32Value();
    if (opts.Has("frameMs")) config.frame_ms = opts.Get("frameMs").As<Napi::Number>().Int32Value();
    if (opts.Has("enableDenoise")) config.enable_denoise = opts.Get("enableDenoise").As<Napi::Boolean>().Value();
    if (opts.Has("enableVad")) config.enable_vad = opts.Get("enableVad").As<Napi::Boolean>().Value();
    if (opts.Has("enableAsr")) config.enable_asr = opts.Get("enableAsr").As<Napi::Boolean>().Value();
    if (opts.Has("asrModelPath")) config.asr_model_path = opts.Get("asrModelPath").As<Napi::String>().Utf8Value();
    if (opts.Has("silenceMs")) config.silence_ms = opts.Get("silenceMs").As<Napi::Number>().Int32Value();
    if (opts.Has("minSpeechMs")) config.min_speech_ms = opts.Get("minSpeechMs").As<Napi::Number>().Int32Value();
    if (opts.Has("vadThreshold")) config.vad_threshold = opts.Get("vadThreshold").As<Napi::Number>().DoubleValue();
  }

  auto pipeline = std::make_unique<firefly::AudioPipeline>();
  if (!pipeline->Init(config)) {
    throw Napi::Error::New(env, "pipeline init failed");
  }

  int64_t h = g_next_handle++;
  g_pipeline[h] = std::move(pipeline);
  return Napi::Number::New(env, static_cast<double>(h));
}

// pipeline.feed(handle, pcmBuffer) -> number (samples written)
Napi::Value PipelineFeed(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_pipeline.find(h);
  if (it == g_pipeline.end()) throw Napi::Error::New(env, "invalid pipeline handle");

  auto buf = info[1].As<Napi::Buffer<int16_t>>();
  size_t written = it->second->Feed(buf.Data(), buf.Length());
  return Napi::Number::New(env, static_cast<double>(written));
}

// pipeline.start(handle) -> bool
Napi::Value PipelineStart(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_pipeline.find(h);
  if (it == g_pipeline.end()) throw Napi::Error::New(env, "invalid pipeline handle");

  bool ok = it->second->Start();
  return Napi::Boolean::New(env, ok);
}

// pipeline.stop(handle)
Napi::Value PipelineStop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_pipeline.find(h);
  if (it != g_pipeline.end()) it->second->Stop();
  return env.Undefined();
}

// pipeline.available(handle) -> number
Napi::Value PipelineAvailable(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_pipeline.find(h);
  if (it == g_pipeline.end()) throw Napi::Error::New(env, "invalid pipeline handle");
  return Napi::Number::New(env, static_cast<double>(it->second->Available()));
}

// pipeline.clear(handle)
Napi::Value PipelineClear(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_pipeline.find(h);
  if (it != g_pipeline.end()) it->second->Clear();
  return env.Undefined();
}

// pipeline.destroy(handle)
Napi::Value PipelineDestroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_pipeline.erase(h);
  return env.Undefined();
}

// ---- Piper TTS 封装层 ----
// tts.create(config) -> handle
// config: { pythonPath, serverScript, zhModel, enModel, sampleRate, defaultRate, silenceMs, fadeMs }
Napi::Value TtsCreate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  firefly::TTSConfig config;

  if (info[0].IsObject()) {
    Napi::Object opts = info[0].As<Napi::Object>();
    if (opts.Has("pythonPath")) config.python_path = opts.Get("pythonPath").As<Napi::String>().Utf8Value();
    if (opts.Has("serverScript")) config.server_script = opts.Get("serverScript").As<Napi::String>().Utf8Value();
    if (opts.Has("zhModel")) config.zh_model = opts.Get("zhModel").As<Napi::String>().Utf8Value();
    if (opts.Has("enModel")) config.en_model = opts.Get("enModel").As<Napi::String>().Utf8Value();
    if (opts.Has("sampleRate")) config.sample_rate = opts.Get("sampleRate").As<Napi::Number>().Int32Value();
    if (opts.Has("defaultRate")) config.default_rate = opts.Get("defaultRate").As<Napi::Number>().FloatValue();
    if (opts.Has("silenceMs")) config.silence_ms = opts.Get("silenceMs").As<Napi::Number>().Int32Value();
    if (opts.Has("fadeMs")) config.fade_ms = opts.Get("fadeMs").As<Napi::Number>().Int32Value();
  }

  auto tts = std::make_unique<firefly::PiperTTS>();
  if (!tts->Init(config)) {
    throw Napi::Error::New(env, "tts init failed");
  }

  int64_t h = g_next_handle++;
  g_tts[h] = std::move(tts);
  return Napi::Number::New(env, static_cast<double>(h));
}

// tts.synthesize(handle, text, rate) -> { pcm: Buffer, sampleRate, channels, durationMs, success, error }
Napi::Value TtsSynthesize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  auto it = g_tts.find(h);
  if (it == g_tts.end()) throw Napi::Error::New(env, "invalid tts handle");

  std::string text = info[1].As<Napi::String>().Utf8Value();
  float rate = info[2].IsNumber() ? info[2].As<Napi::Number>().FloatValue() : 1.0f;

  firefly::TTSResult result = it->second->Synthesize(text, rate);

  Napi::Object out = Napi::Object::New(env);
  out.Set("success", Napi::Boolean::New(env, result.success));
  out.Set("sampleRate", Napi::Number::New(env, result.sample_rate));
  out.Set("channels", Napi::Number::New(env, result.channels));
  out.Set("durationMs", Napi::Number::New(env, result.duration_ms));

  if (result.success && !result.pcm.empty()) {
    Napi::Buffer<int16_t> pcm_buf = Napi::Buffer<int16_t>::Copy(env, result.pcm.data(), result.pcm.size());
    out.Set("pcm", pcm_buf);
  } else {
    out.Set("pcm", env.Null());
  }

  if (!result.error.empty()) {
    out.Set("error", Napi::String::New(env, result.error));
  } else {
    out.Set("error", env.Null());
  }

  return out;
}

// tts.destroy(handle)
Napi::Value TtsDestroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int64_t h = info[0].As<Napi::Number>().Int64Value();
  g_tts.erase(h);
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

// ---- 音频设备枚举 ----

Napi::Value GetInputDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::vector<firefly::AudioDevice> devices = firefly::AudioDevices::GetInputDevices();

  Napi::Array result = Napi::Array::New(env, devices.size());
  for (size_t i = 0; i < devices.size(); ++i) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("id", Napi::String::New(env, devices[i].id));
    obj.Set("name", Napi::String::New(env, devices[i].name));
    obj.Set("manufacturer", Napi::String::New(env, devices[i].manufacturer));
    obj.Set("isDefault", Napi::Boolean::New(env, devices[i].is_default));
    obj.Set("inputChannels", Napi::Number::New(env, devices[i].input_channels));
    obj.Set("outputChannels", Napi::Number::New(env, devices[i].output_channels));
    obj.Set("sampleRate", Napi::Number::New(env, devices[i].sample_rate));
    result.Set(i, obj);
  }
  return result;
}

Napi::Value GetOutputDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::vector<firefly::AudioDevice> devices = firefly::AudioDevices::GetOutputDevices();

  Napi::Array result = Napi::Array::New(env, devices.size());
  for (size_t i = 0; i < devices.size(); ++i) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("id", Napi::String::New(env, devices[i].id));
    obj.Set("name", Napi::String::New(env, devices[i].name));
    obj.Set("manufacturer", Napi::String::New(env, devices[i].manufacturer));
    obj.Set("isDefault", Napi::Boolean::New(env, devices[i].is_default));
    obj.Set("inputChannels", Napi::Number::New(env, devices[i].input_channels));
    obj.Set("outputChannels", Napi::Number::New(env, devices[i].output_channels));
    obj.Set("sampleRate", Napi::Number::New(env, devices[i].sample_rate));
    result.Set(i, obj);
  }
  return result;
}

Napi::Value GetDefaultInputDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  firefly::AudioDevice device = firefly::AudioDevices::GetDefaultInputDevice();

  Napi::Object obj = Napi::Object::New(env);
  obj.Set("id", Napi::String::New(env, device.id));
  obj.Set("name", Napi::String::New(env, device.name));
  obj.Set("manufacturer", Napi::String::New(env, device.manufacturer));
  obj.Set("isDefault", Napi::Boolean::New(env, device.is_default));
  obj.Set("inputChannels", Napi::Number::New(env, device.input_channels));
  obj.Set("outputChannels", Napi::Number::New(env, device.output_channels));
  obj.Set("sampleRate", Napi::Number::New(env, device.sample_rate));
  return obj;
}

Napi::Value GetDefaultOutputDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  firefly::AudioDevice device = firefly::AudioDevices::GetDefaultOutputDevice();

  Napi::Object obj = Napi::Object::New(env);
  obj.Set("id", Napi::String::New(env, device.id));
  obj.Set("name", Napi::String::New(env, device.name));
  obj.Set("manufacturer", Napi::String::New(env, device.manufacturer));
  obj.Set("isDefault", Napi::Boolean::New(env, device.is_default));
  obj.Set("inputChannels", Napi::Number::New(env, device.input_channels));
  obj.Set("outputChannels", Napi::Number::New(env, device.output_channels));
  obj.Set("sampleRate", Napi::Number::New(env, device.sample_rate));
  return obj;
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
  mic.Set("setAdaptiveThreshold", Napi::Function::New(env, MicSetAdaptiveThreshold));
  mic.Set("getStatus", Napi::Function::New(env, MicGetStatus));
  mic.Set("destroy", Napi::Function::New(env, MicDestroy));
  exports.Set("mic", mic);

  // player 命名空间（CoreAudio 低延迟播放）
  Napi::Object player = Napi::Object::New(env);
  player.Set("create", Napi::Function::New(env, PlayerCreate));
  player.Set("play", Napi::Function::New(env, PlayerPlay));
  player.Set("stop", Napi::Function::New(env, PlayerStop));
  player.Set("destroy", Napi::Function::New(env, PlayerDestroy));
  exports.Set("player", player);

  // pcm 命名空间（PCM 音频处理：淡入淡出、静音、裁剪、合并、音量）
  Napi::Object pcm = Napi::Object::New(env);
  pcm.Set("applyFadeInOut", Napi::Function::New(env, PcmApplyFadeInOut));
  pcm.Set("createSilence", Napi::Function::New(env, PcmCreateSilence));
  pcm.Set("clip", Napi::Function::New(env, PcmClip));
  pcm.Set("adjustVolume", Napi::Function::New(env, PcmAdjustVolume));
  pcm.Set("mergeSegments", Napi::Function::New(env, PcmMergeSegments));
  pcm.Set("computeRms", Napi::Function::New(env, PcmComputeRms));
  pcm.Set("computeDurationMs", Napi::Function::New(env, PcmComputeDurationMs));
  pcm.Set("toWav", Napi::Function::New(env, PcmToWav));
  exports.Set("pcm", pcm);

  // ringbuf 命名空间（音频环形缓冲区：零拷贝数据传递）
  Napi::Object ringbuf = Napi::Object::New(env);
  ringbuf.Set("create", Napi::Function::New(env, RingBufCreate));
  ringbuf.Set("write", Napi::Function::New(env, RingBufWrite));
  ringbuf.Set("read", Napi::Function::New(env, RingBufRead));
  ringbuf.Set("available", Napi::Function::New(env, RingBufAvailable));
  ringbuf.Set("clear", Napi::Function::New(env, RingBufClear));
  ringbuf.Set("mark", Napi::Function::New(env, RingBufMark));
  ringbuf.Set("readFromMark", Napi::Function::New(env, RingBufReadFromMark));
  ringbuf.Set("destroy", Napi::Function::New(env, RingBufDestroy));
  exports.Set("ringbuf", ringbuf);

  // pipeline 命名空间（零拷贝音频预处理流水线）
  Napi::Object pipeline = Napi::Object::New(env);
  pipeline.Set("create", Napi::Function::New(env, PipelineCreate));
  pipeline.Set("feed", Napi::Function::New(env, PipelineFeed));
  pipeline.Set("start", Napi::Function::New(env, PipelineStart));
  pipeline.Set("stop", Napi::Function::New(env, PipelineStop));
  pipeline.Set("available", Napi::Function::New(env, PipelineAvailable));
  pipeline.Set("clear", Napi::Function::New(env, PipelineClear));
  pipeline.Set("destroy", Napi::Function::New(env, PipelineDestroy));
  exports.Set("pipeline", pipeline);

  // tts 命名空间（Piper TTS C++ 封装层）
  Napi::Object tts = Napi::Object::New(env);
  tts.Set("create", Napi::Function::New(env, TtsCreate));
  tts.Set("synthesize", Napi::Function::New(env, TtsSynthesize));
  tts.Set("destroy", Napi::Function::New(env, TtsDestroy));
  exports.Set("tts", tts);

  // devices 命名空间（音频设备枚举）
  Napi::Object devices = Napi::Object::New(env);
  devices.Set("getInputDevices", Napi::Function::New(env, GetInputDevices));
  devices.Set("getOutputDevices", Napi::Function::New(env, GetOutputDevices));
  devices.Set("getDefaultInputDevice", Napi::Function::New(env, GetDefaultInputDevice));
  devices.Set("getDefaultOutputDevice", Napi::Function::New(env, GetDefaultOutputDevice));
  exports.Set("devices", devices);

  exports.Set("test", Napi::Function::New(env, Test));
  return exports;
}

}  // namespace

NODE_API_MODULE(firefly_native, Init)
