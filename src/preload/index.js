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
}

contextBridge.exposeInMainWorld('electronAPI', api)
