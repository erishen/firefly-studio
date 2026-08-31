#ifndef FIREFLY_NATIVE_AUDIO_DEVICES_H
#define FIREFLY_NATIVE_AUDIO_DEVICES_H

#include <string>
#include <vector>

namespace firefly {

// 音频设备信息
struct AudioDevice {
  std::string id;           // 设备唯一 ID
  std::string name;         // 设备名称
  std::string manufacturer; // 制造商
  bool is_default;          // 是否是默认设备
  int input_channels;       // 输入声道数（输入设备）
  int output_channels;      // 输出声道数（输出设备）
  double sample_rate;       // 采样率
};

// 音频设备枚举类
class AudioDevices {
 public:
  // 枚举所有输入设备（麦克风）
  static std::vector<AudioDevice> GetInputDevices();

  // 枚举所有输出设备（扬声器/耳机）
  static std::vector<AudioDevice> GetOutputDevices();

  // 获取默认输入设备
  static AudioDevice GetDefaultInputDevice();

  // 获取默认输出设备
  static AudioDevice GetDefaultOutputDevice();

  // 根据 ID 获取输入设备
  static AudioDevice GetInputDeviceById(const std::string& id);

  // 根据 ID 获取输出设备
  static AudioDevice GetOutputDeviceById(const std::string& id);
};

}  // namespace firefly

#endif  // FIREFLY_NATIVE_AUDIO_DEVICES_H
