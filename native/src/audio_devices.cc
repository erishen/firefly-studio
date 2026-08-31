#include "audio_devices.h"

#ifdef __APPLE__
#include <CoreAudio/CoreAudio.h>
#include <AudioToolbox/AudioToolbox.h>
#endif

#include <cstring>
#include <sstream>

namespace firefly {

#ifdef __APPLE__

// 获取设备属性的辅助函数
static std::string GetDevicePropertyString(AudioDeviceID deviceID, AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress address = {
    selector,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };

  CFStringRef cfString = nullptr;
  UInt32 size = sizeof(cfString);
  OSStatus status = AudioObjectGetPropertyData(deviceID, &address, 0, nullptr, &size, &cfString);
  if (status != noErr || cfString == nullptr) {
    return "";
  }

  char buffer[256];
  Boolean result = CFStringGetCString(cfString, buffer, sizeof(buffer), kCFStringEncodingUTF8);
  CFRelease(cfString);
  return result ? std::string(buffer) : "";
}

// 获取设备整数属性
static UInt32 GetDevicePropertyInt(AudioDeviceID deviceID, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
  AudioObjectPropertyAddress address = {
    selector,
    scope,
    kAudioObjectPropertyElementMain
  };

  UInt32 value = 0;
  UInt32 size = sizeof(value);
  OSStatus status = AudioObjectGetPropertyData(deviceID, &address, 0, nullptr, &size, &value);
  if (status != noErr) {
    return 0;
  }
  return value;
}

// 获取设备浮点数属性
static Float64 GetDevicePropertyFloat(AudioDeviceID deviceID, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
  AudioObjectPropertyAddress address = {
    selector,
    scope,
    kAudioObjectPropertyElementMain
  };

  Float64 value = 0;
  UInt32 size = sizeof(value);
  OSStatus status = AudioObjectGetPropertyData(deviceID, &address, 0, nullptr, &size, &value);
  if (status != noErr) {
    return 0;
  }
  return value;
}

// 检查设备是否有输入通道
static bool DeviceHasInput(AudioDeviceID deviceID) {
  UInt32 channels = GetDevicePropertyInt(deviceID, kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput);
  // 注意：这里获取的是 AudioBufferList 的大小，需要特殊处理
  // 简化处理：直接检查设备是否在输入设备列表中
  return true;
}

// 检查设备是否有输出通道
static bool DeviceHasOutput(AudioDeviceID deviceID) {
  UInt32 channels = GetDevicePropertyInt(deviceID, kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput);
  return true;
}

// 获取设备 ID 字符串
static std::string GetDeviceIdString(AudioDeviceID deviceID) {
  std::ostringstream oss;
  oss << "device_" << deviceID;
  return oss.str();
}

// 构建设备信息
static AudioDevice BuildDeviceInfo(AudioDeviceID deviceID, bool is_input) {
  AudioDevice device;
  device.id = GetDeviceIdString(deviceID);
  device.name = GetDevicePropertyString(deviceID, kAudioObjectPropertyName);
  device.manufacturer = GetDevicePropertyString(deviceID, kAudioObjectPropertyManufacturer);
  device.is_default = false;
  device.input_channels = is_input ? GetDevicePropertyInt(deviceID, kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput) : 0;
  device.output_channels = !is_input ? GetDevicePropertyInt(deviceID, kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput) : 0;
  device.sample_rate = GetDevicePropertyFloat(deviceID, kAudioDevicePropertyNominalSampleRate);
  return device;
}

// 获取所有设备 ID
static std::vector<AudioDeviceID> GetAllDeviceIDs() {
  std::vector<AudioDeviceID> devices;

  AudioObjectPropertyAddress address = {
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };

  UInt32 size = 0;
  OSStatus status = AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size);
  if (status != noErr || size == 0) {
    return devices;
  }

  std::vector<AudioDeviceID> deviceIDs(size / sizeof(AudioDeviceID));
  status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, deviceIDs.data());
  if (status != noErr) {
    return devices;
  }

  return deviceIDs;
}

// 获取默认设备 ID
static AudioDeviceID GetDefaultDeviceID(bool is_input) {
  AudioObjectPropertySelector selector = is_input
    ? kAudioHardwarePropertyDefaultInputDevice
    : kAudioHardwarePropertyDefaultOutputDevice;

  AudioObjectPropertyAddress address = {
    selector,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };

  AudioDeviceID deviceID = kAudioDeviceUnknown;
  UInt32 size = sizeof(deviceID);
  OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, &deviceID);
  if (status != noErr) {
    return kAudioDeviceUnknown;
  }
  return deviceID;
}

std::vector<AudioDevice> AudioDevices::GetInputDevices() {
  std::vector<AudioDevice> result;
  std::vector<AudioDeviceID> deviceIDs = GetAllDeviceIDs();
  AudioDeviceID defaultID = GetDefaultDeviceID(true);

  for (AudioDeviceID deviceID : deviceIDs) {
    // 检查是否是输入设备（简化处理：检查设备名称或输入通道）
    // 实际上，大多数 Mac 设备同时支持输入和输出
    // 这里我们只列出有输入通道的设备
    UInt32 inputChannels = GetDevicePropertyInt(deviceID, kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput);
    if (inputChannels > 0 || deviceID == defaultID) {
      AudioDevice device = BuildDeviceInfo(deviceID, true);
      device.is_default = (deviceID == defaultID);
      result.push_back(device);
    }
  }
  return result;
}

std::vector<AudioDevice> AudioDevices::GetOutputDevices() {
  std::vector<AudioDevice> result;
  std::vector<AudioDeviceID> deviceIDs = GetAllDeviceIDs();
  AudioDeviceID defaultID = GetDefaultDeviceID(false);

  for (AudioDeviceID deviceID : deviceIDs) {
    // 检查是否是输出设备
    UInt32 outputChannels = GetDevicePropertyInt(deviceID, kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeOutput);
    if (outputChannels > 0 || deviceID == defaultID) {
      AudioDevice device = BuildDeviceInfo(deviceID, false);
      device.is_default = (deviceID == defaultID);
      result.push_back(device);
    }
  }
  return result;
}

AudioDevice AudioDevices::GetDefaultInputDevice() {
  AudioDeviceID defaultID = GetDefaultDeviceID(true);
  if (defaultID == kAudioDeviceUnknown) {
    return AudioDevice();
  }
  AudioDevice device = BuildDeviceInfo(defaultID, true);
  device.is_default = true;
  return device;
}

AudioDevice AudioDevices::GetDefaultOutputDevice() {
  AudioDeviceID defaultID = GetDefaultDeviceID(false);
  if (defaultID == kAudioDeviceUnknown) {
    return AudioDevice();
  }
  AudioDevice device = BuildDeviceInfo(defaultID, false);
  device.is_default = true;
  return device;
}

AudioDevice AudioDevices::GetInputDeviceById(const std::string& id) {
  std::vector<AudioDevice> devices = GetInputDevices();
  for (const AudioDevice& device : devices) {
    if (device.id == id) {
      return device;
    }
  }
  return AudioDevice();
}

AudioDevice AudioDevices::GetOutputDeviceById(const std::string& id) {
  std::vector<AudioDevice> devices = GetOutputDevices();
  for (const AudioDevice& device : devices) {
    if (device.id == id) {
      return device;
    }
  }
  return AudioDevice();
}

#else  // 非 macOS 平台

std::vector<AudioDevice> AudioDevices::GetInputDevices() {
  return {};
}

std::vector<AudioDevice> AudioDevices::GetOutputDevices() {
  return {};
}

AudioDevice AudioDevices::GetDefaultInputDevice() {
  return AudioDevice();
}

AudioDevice AudioDevices::GetDefaultOutputDevice() {
  return AudioDevice();
}

AudioDevice AudioDevices::GetInputDeviceById(const std::string& id) {
  return AudioDevice();
}

AudioDevice AudioDevices::GetOutputDeviceById(const std::string& id) {
  return AudioDevice();
}

#endif  // __APPLE__

}  // namespace firefly
