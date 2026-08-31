// preload：在 contextIsolation 下通过 contextBridge 暴露安全 API。
// 渲染进程只能通过这些白名单方法访问 C++ 能力，不能直接 require。

import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 原生自检
  nativeTest: (loops) => ipcRenderer.invoke('native:test', loops),

  // 音频引擎
  audio: {
    create: (sampleRate) => ipcRenderer.invoke('audio:create', sampleRate),
    feedRms: (handle, buf) => ipcRenderer.invoke('audio:feedRms', handle, buf),
    isSpeech: (handle, buf) => ipcRenderer.invoke('audio:isSpeech', handle, buf),
    setThreshold: (handle, t) =>
      ipcRenderer.invoke('audio:setThreshold', handle, t),
    destroy: (handle) => ipcRenderer.invoke('audio:destroy', handle),
  },

  // ASR 客户端
  asr: {
    create: (address, token) => ipcRenderer.invoke('asr:create', address, token),
    start: (handle, sampleRate) =>
      ipcRenderer.invoke('asr:start', handle, sampleRate),
    feed: (handle, buf) => ipcRenderer.invoke('asr:feed', handle, buf),
    finalize: (handle) => ipcRenderer.invoke('asr:finalize', handle),
    destroy: (handle) => ipcRenderer.invoke('asr:destroy', handle),
  },

  // 麦克风采集（CoreAudio + VAD + Whisper ASR）
  mic: {
    start: (sampleRate, frameMs, modelPath, options) =>
      ipcRenderer.invoke('mic:start', sampleRate, frameMs, modelPath, options),
    stop: (handle) => ipcRenderer.invoke('mic:stop', handle),
    setThreshold: (handle, t) =>
      ipcRenderer.invoke('mic:setThreshold', handle, t),
    setAdaptiveThreshold: (handle, enabled) =>
      ipcRenderer.invoke('mic:setAdaptiveThreshold', handle, enabled),
    getStatus: (handle) => ipcRenderer.invoke('mic:getStatus', handle),
    destroy: (handle) => ipcRenderer.invoke('mic:destroy', handle),
    onFrame: (cb) => ipcRenderer.on('mic:frame', (_e, data) => cb(data)),
    onAsr: (cb) => ipcRenderer.on('mic:asr', (_e, text) => cb(text)),
    onAsrPartial: (cb) => ipcRenderer.on('mic:asr:partial', (_e, text) => cb(text)),
    onError: (cb) => ipcRenderer.on('mic:error', (_e, msg) => cb(msg)),
    removeListeners: () => {
      ipcRenderer.removeAllListeners('mic:frame')
      ipcRenderer.removeAllListeners('mic:asr')
      ipcRenderer.removeAllListeners('mic:asr:partial')
      ipcRenderer.removeAllListeners('mic:error')
    },
  },

  // TTS 语音合成（Piper 本地离线，常驻服务）
  tts: {
    available: () => ipcRenderer.invoke('tts:available'),
    synthesize: (text, options) =>
      ipcRenderer.invoke('tts:synthesize', text, options),
    clearCache: () => ipcRenderer.invoke('tts:clearCache'),
    cacheStats: () => ipcRenderer.invoke('tts:cacheStats'),
    edgeTtsAvailable: () => ipcRenderer.invoke('tts:edgeTtsAvailable'),
  },

  // CoreAudio 低延迟播放器
  player: {
    create: (sampleRate, channels) =>
      ipcRenderer.invoke('player:create', sampleRate, channels),
    play: (handle, buf) => ipcRenderer.invoke('player:play', handle, buf),
    stop: (handle) => ipcRenderer.invoke('player:stop', handle),
    destroy: (handle) => ipcRenderer.invoke('player:destroy', handle),
  },

  // 应用配置管理
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (updates) => ipcRenderer.invoke('config:set', updates),
  },

  // 文件读取（用于播放本地音乐文件，绕过 file:// 协议的安全限制）
  file: {
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  },

  // 文件选择对话框（用于添加音乐文件，直接获取文件路径）
  dialog: {
    openFiles: (options) => ipcRenderer.invoke('dialog:openFiles', options),
  },

  // 进程守护（ASR/TTS Python 服务自动重启、健康检查）
  guard: {
    status: () => ipcRenderer.invoke('guard:status'),
    restart: (service) => ipcRenderer.invoke('guard:restart', service),
    reset: (service) => ipcRenderer.invoke('guard:reset', service),
    onEvent: (cb) => ipcRenderer.on('guard:event', (_e, data) => cb(data)),
    removeListeners: () => {
      ipcRenderer.removeAllListeners('guard:event')
    },
  },

  // 音频设备枚举
  devices: {
    getInputDevices: () => ipcRenderer.invoke('devices:getInputDevices'),
    getOutputDevices: () => ipcRenderer.invoke('devices:getOutputDevices'),
    getDefaultInputDevice: () => ipcRenderer.invoke('devices:getDefaultInputDevice'),
    getDefaultOutputDevice: () => ipcRenderer.invoke('devices:getDefaultOutputDevice'),
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)
