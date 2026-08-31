// 主进程入口。
// 职责：
//   1. 创建 BrowserWindow
//   2. 加载 C++ 原生模块（firefly_native.node）
//   3. 通过 IPC 把 C++ 能力桥接给渲染进程

import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { startServer } from '../../server/index.js'
import { synthesize, isAvailable, preload, clearCache, getCacheStats, getTtsGuardStatus, restartTts, getTtsGuard, shutdownTts } from './tts.js'
import { transcribe, startAsr, getAsrGuardStatus, restartAsr, getAsrGuard, stopAsr } from './asr.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ---- 应用配置（运行时可动态修改，无需重启）----
const appConfig = {
  // TTS 配置
  ttsProvider: 'piper',              // TTS 提供商：piper / edge-tts
  ttsVoice: 'zh-CN-XiaoxiaoNeural',  // edge-tts 声音
  ttsRate: 1.0,                         // 语速
  ttsVolume: 1.0,                       // 音量（0.0 - 1.0）
  // ASR 配置
  asrModel: 'base',                     // ASR 模型：tiny / base / small / medium
  asrPostprocess: true,                 // ASR 识别结果后处理（去重复词、加标点）
  streamingAsr: true,                   // 流式 ASR（边说边识别）
  vadThreshold: 0.015,                  // VAD 阈值（自适应禁用时使用）
  adaptiveThreshold: true,              // 自适应阈值开关
  // 显示配置
  showAvatar: true,                      // 数字人显示开关
  showBubble: true,                      // 气泡显示开关
  autoPlayVoice: true,                   // 自动播放语音开关
  // 其他
  voiceEnabled: true,                    // TTS 语音开关
}

// 获取配置
function getConfig() {
  return { ...appConfig }
}

// 更新配置
function updateConfig(updates) {
  Object.assign(appConfig, updates)
  console.log('[config] updated:', updates)
  return getConfig()
}

// ---- 禁用 Chromium 联网组件（避免大陆网络下 SSL 握手错误刷屏）----
// 这些组件（自动更新、安全浏览、组件更新）在无外网时会反复报 SSL handshake failed
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,NetworkServiceInProcess,GpuServiceInProcess')
app.commandLine.appendSwitch('safebrowsing-disable-auto-update')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-background-networking')
// 忽略证书错误（开发期；生产环境应移除）
app.commandLine.appendSwitch('ignore-certificate-errors')

// ---- GPU 稳定性配置（减少 GPU 进程崩溃，同时保留 3D 渲染能力）----
// 禁用 GPU 看门狗（避免长时间渲染被强制杀死）
app.commandLine.appendSwitch('disable-gpu-watchdog')
// 禁用 GPU 驱动错误解决方法（避免某些驱动 workaround 导致崩溃）
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds')
// 软件渲染兜底（GPU 不可用时自动切换）
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

// ---- 加载 C++ 原生模块 ----
// 开发期在 native/build/Debug/firefly_native.node；electron-vite 会把主进程
// 产物输出到 out/main。这里用 createRequire 解析绝对路径。
let nativeMod = null
function loadNative() {
  if (nativeMod) return nativeMod
  // 多种定位方式兜底：
  // 1) 相对当前模块（dev 时 out/main，实际文件在源码树里）
  // 2) 相对 app 根目录
  // 3) 相对 cwd
  const baseDirs = [
    dirname(fileURLToPath(import.meta.url)), // out/main（源码树内）
    app.getAppPath(), // app 根
    process.cwd(),
  ]
  const candidates = []
  // 相对 out/main 时 native 在 ../../native；相对 app 根 / cwd 时在 native/
  candidates.push(join(baseDirs[0], '../../native/build/Release/firefly_native.node'))
  candidates.push(join(baseDirs[0], '../../native/build/Debug/firefly_native.node'))
  for (const base of baseDirs.slice(1)) {
    candidates.push(join(base, 'native/build/Release/firefly_native.node'))
    candidates.push(join(base, 'native/build/Debug/firefly_native.node'))
  }
  const errors = []
  for (const p of candidates) {
    try {
      nativeMod = require(p)
      console.log('[native] 已加载 C++ 模块 @', p)
      return nativeMod
    } catch (e) {
      errors.push(`${p}: ${e.code || e.message}`)
    }
  }
  throw new Error(
    'firefly_native.node 未找到，请先执行: npm run native:build。\n尝试过的路径:\n' +
      errors.slice(0, 4).join('\n')
  )
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Firefly Studio',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // 允许调用本地 resolve-studio 后端（8787端口）
    },
  })

  // 开发模式加载 dev server，生产加载打包产物
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// ---- IPC：把 C++ 能力暴露给渲染进程 ----
function registerIpc() {
  // 原生模块自检
  ipcMain.handle('native:test', (_e, loops) => {
    const mod = loadNative()
    return mod.test(loops || 1000)
  })

  // 把 IPC 传来的 ArrayBuffer / Uint8Array 转成 Node Buffer（C++ 模块需要 Buffer）
  const toBuffer = (buf) => {
    if (Buffer.isBuffer(buf)) return buf
    if (buf instanceof ArrayBuffer) return Buffer.from(buf)
    if (buf?.buffer instanceof ArrayBuffer) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
    if (ArrayBuffer.isView(buf)) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
    return buf
  }

  // 音频引擎
  ipcMain.handle('audio:create', (_e, sampleRate) => {
    return loadNative().audio.create(sampleRate || 16000)
  })
  ipcMain.handle('audio:feedRms', (_e, handle, buf) => {
    return loadNative().audio.feedRms(handle, toBuffer(buf))
  })
  ipcMain.handle('audio:isSpeech', (_e, handle, buf) => {
    return loadNative().audio.isSpeech(handle, toBuffer(buf))
  })
  ipcMain.handle('audio:setThreshold', (_e, handle, t) => {
    return loadNative().audio.setThreshold(handle, t)
  })
  ipcMain.handle('audio:destroy', (_e, handle) => {
    return loadNative().audio.destroy(handle)
  })

  // ASR 客户端
  ipcMain.handle('asr:create', (_e, address, token) => {
    return loadNative().asr.create(address || '', token || '')
  })
  ipcMain.handle('asr:start', (_e, handle, sampleRate) => {
    return loadNative().asr.start(handle, sampleRate || 16000)
  })
  ipcMain.handle('asr:feed', (_e, handle, buf) => {
    return loadNative().asr.feed(handle, toBuffer(buf))
  })
  ipcMain.handle('asr:finalize', (_e, handle) => {
    return loadNative().asr.finalize(handle)
  })
  ipcMain.handle('asr:destroy', (_e, handle) => {
    return loadNative().asr.destroy(handle)
  })

  // 麦克风采集（CoreAudio + VAD + Whisper ASR）
  ipcMain.handle('mic:start', (e, sampleRate, frameMs, modelPath, options) => {
    const win = e.sender
    try {
      const mod = loadNative()
      // 转换为绝对路径，避免相对路径导致模型找不到
      const absModelPath = modelPath && !isAbsolute(modelPath)
        ? join(process.cwd(), modelPath)
        : modelPath
      console.log('[mic] starting, model:', absModelPath)
      const handle = mod.mic.start(
        sampleRate || 16000,
        frameMs || 20,
        absModelPath || '',
        // onFrame
        (() => {
          let frameCount = 0
          let lastLog = 0
          return (frame) => {
            frameCount++
            const now = Date.now()
            if (now - lastLog > 1000) {
              console.log(`[mic] frame=${frameCount}, rms=${frame.rms.toFixed(4)}, isSpeech=${frame.isSpeech}`)
              lastLog = now
            }
            win.send('mic:frame', { rms: frame.rms, isSpeech: frame.isSpeech })
          }
        })(),
        // onAsr（收到的是 base64 编码的 PCM16 数据，转发给 Python faster-whisper 做识别）
        // is_final: true=最终结果（语音结束）, false=中间结果（说话过程中定期识别）
        (pcmB64, isFinal) => {
          try {
            const pcmBuffer = Buffer.from(pcmB64, 'base64')
            if (isFinal) {
              console.log('[ASR] 收到最终语音段，长度:', pcmBuffer.length, '字节，开始识别...')
            } else {
              console.log('[ASR] 收到中间语音段，长度:', pcmBuffer.length, '字节，开始中间识别...')
            }
            transcribe(pcmBuffer, { language: 'zh', sampleRate: sampleRate || 16000, postprocess: isFinal })
              .then((result) => {
                if (isFinal) {
                  console.log('[ASR] 最终识别结果:', result.text)
                } else {
                  console.log('[ASR] 中间识别结果:', result.text)
                }
                if (result.text && result.text.trim()) {
                  if (isFinal) {
                    win.send('mic:asr', result.text)
                  } else {
                    win.send('mic:asr:partial', result.text)
                  }
                }
              })
              .catch((err) => {
                console.error('[ASR] 识别失败:', err.message)
                if (isFinal) {
                  win.send('mic:error', '语音识别失败: ' + err.message)
                }
                // 中间识别失败不报错，避免干扰
              })
          } catch (err) {
            console.error('[ASR] 处理语音段失败:', err.message)
          }
        },
        // onError
        (err) => { win.send('mic:error', err) },
        options || {}
      )
      console.log('[mic] started, handle:', handle)
      return handle
    } catch (err) {
      console.error('[mic] start failed:', err.message)
      win.send('mic:error', '麦克风启动失败: ' + err.message)
      return -1
    }
  })
  ipcMain.handle('mic:stop', (_e, handle) => {
    return loadNative().mic.stop(handle)
  })
  ipcMain.handle('mic:setThreshold', (_e, handle, t) => {
    return loadNative().mic.setThreshold(handle, t)
  })
  ipcMain.handle('mic:setAdaptiveThreshold', (_e, handle, enabled) => {
    return loadNative().mic.setAdaptiveThreshold(handle, enabled)
  })
  ipcMain.handle('mic:getStatus', (_e, handle) => {
    return loadNative().mic.getStatus(handle)
  })
  ipcMain.handle('mic:destroy', (_e, handle) => {
    return loadNative().mic.destroy(handle)
  })

  // CoreAudio 低延迟播放器
  ipcMain.handle('player:create', (_e, sampleRate, channels) => {
    return loadNative().player.create(sampleRate || 22050, channels || 1)
  })
  ipcMain.handle('player:play', (_e, handle, buf) => {
    return loadNative().player.play(handle, toBuffer(buf))
  })
  ipcMain.handle('player:stop', (_e, handle) => {
    return loadNative().player.stop(handle)
  })
  ipcMain.handle('player:destroy', (_e, handle) => {
    return loadNative().player.destroy(handle)
  })

  // 应用配置管理
  ipcMain.handle('config:get', () => {
    return getConfig()
  })
  ipcMain.handle('config:set', (_e, updates) => {
    return updateConfig(updates || {})
  })

  // 文件读取（用于播放本地音乐文件，绕过 file:// 协议的安全限制）
  ipcMain.handle('file:read', async (_e, filePath) => {
    try {
      const fs = require('fs')
      const path = require('path')
      // 安全检查：防止路径遍历攻击
      const resolvedPath = path.resolve(filePath)
      if (!fs.existsSync(resolvedPath)) {
        return { ok: false, error: `文件不存在: ${filePath}` }
      }
      const data = fs.readFileSync(resolvedPath)
      // 转换为 ArrayBuffer（通过 Uint8Array 传递）
      return {
        ok: true,
        data: new Uint8Array(data),
        size: data.length,
        name: path.basename(resolvedPath),
      }
    } catch (e) {
      console.error('[file:read] 读取文件失败:', e)
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('file:exists', (_e, filePath) => {
    try {
      const fs = require('fs')
      return fs.existsSync(filePath)
    } catch (e) {
      return false
    }
  })

  // 文件选择对话框（用于添加音乐文件，直接获取文件路径，比 File.path 更可靠）
  ipcMain.handle('dialog:openFiles', async (_e, options) => {
    try {
      const { dialog } = require('electron')
      const result = await dialog.showOpenDialog({
        title: options?.title || '选择音乐文件',
        filters: options?.filters || [
          { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        properties: options?.properties || ['openFile', 'multiSelections'],
      })
      if (result.canceled) {
        return { ok: true, canceled: true, files: [] }
      }
      return { ok: true, canceled: false, files: result.filePaths }
    } catch (e) {
      console.error('[dialog:openFiles] 打开文件对话框失败:', e)
      return { ok: false, error: e.message, files: [] }
    }
  })

  // TTS 语音合成（Piper 本地离线，常驻服务）
  ipcMain.handle('tts:available', () => {
    return isAvailable()
  })
  ipcMain.handle('tts:synthesize', async (_e, text, options) => {
    try {
      const result = await synthesize(text, options || {})
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
  ipcMain.handle('tts:clearCache', () => {
    clearCache()
    return true
  })
  ipcMain.handle('tts:cacheStats', () => {
    return getCacheStats()
  })

  // ============================================================
  // 进程守护相关 IPC 接口
  // ============================================================

  // 获取 ASR 和 TTS 进程守护状态
  ipcMain.handle('guard:status', async () => {
    return {
      asr: getAsrGuardStatus(),
      tts: await getTtsGuardStatus(),
    }
  })

  // 手动重启指定服务
  ipcMain.handle('guard:restart', async (_e, service) => {
    try {
      if (service === 'asr') {
        const ok = await restartAsr()
        return { ok, service }
      } else if (service === 'tts') {
        const ok = await restartTts()
        return { ok, service }
      } else {
        return { ok: false, error: `Unknown service: ${service}` }
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // 重置重启计数（手动恢复后调用）
  ipcMain.handle('guard:reset', async (_e, service) => {
    try {
      if (service === 'asr') {
        const guard = getAsrGuard()
        if (guard) guard.resetRestartCount()
        return { ok: true, service }
      } else if (service === 'tts') {
        const guard = await getTtsGuard()
        if (guard) guard.resetRestartCount()
        return { ok: true, service }
      } else {
        return { ok: false, error: `Unknown service: ${service}` }
      }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ============================================================
  // 音频设备枚举 IPC 接口
  // ============================================================

  // 获取输入设备列表
  ipcMain.handle('devices:getInputDevices', () => {
    try {
      const mod = loadNative()
      if (mod.devices && mod.devices.getInputDevices) {
        return mod.devices.getInputDevices()
      }
      return []
    } catch (e) {
      console.warn('[devices] 获取输入设备失败:', e.message)
      return []
    }
  })

  // 获取输出设备列表
  ipcMain.handle('devices:getOutputDevices', () => {
    try {
      const mod = loadNative()
      if (mod.devices && mod.devices.getOutputDevices) {
        return mod.devices.getOutputDevices()
      }
      return []
    } catch (e) {
      console.warn('[devices] 获取输出设备失败:', e.message)
      return []
    }
  })

  // 获取默认输入设备
  ipcMain.handle('devices:getDefaultInputDevice', () => {
    try {
      const mod = loadNative()
      if (mod.devices && mod.devices.getDefaultInputDevice) {
        return mod.devices.getDefaultInputDevice()
      }
      return null
    } catch (e) {
      console.warn('[devices] 获取默认输入设备失败:', e.message)
      return null
    }
  })

  // 获取默认输出设备
  ipcMain.handle('devices:getDefaultOutputDevice', () => {
    try {
      const mod = loadNative()
      if (mod.devices && mod.devices.getDefaultOutputDevice) {
        return mod.devices.getDefaultOutputDevice()
      }
      return null
    } catch (e) {
      console.warn('[devices] 获取默认输出设备失败:', e.message)
      return null
    }
  })
}

app.whenReady().then(async () => {
  // 提前加载原生模块，启动即验证
  try {
    loadNative()
  } catch (e) {
    console.warn('[native] 启动时加载失败：', e.message)
  }
  registerIpc()
  // 启动内置后端（/api/chat SSE），渲染进程直接调用本地 8788
  try {
    startServer({ port: 8788, host: '127.0.0.1' })
  } catch (e) {
    console.warn('[server] 内置后端启动失败：', e.message)
  }
  // 模型懒加载：应用启动时不预加载 ASR 和 TTS，首次使用时才加载
  // 这样可以提升启动速度，减少初始内存占用
  // 预启动 TTS（macOS say 无需加载，Piper 则提前加载模型）
  // if (isAvailable()) {
  //   preload().then((ok) => {
  //     if (ok) console.log('[TTS] 语音合成已就绪')
  //   })
  // }
  // 预启动 ASR（faster-whisper，提前加载模型，首次使用不等待）
  // startAsr().then(() => {
  //   console.log('[ASR] 语音识别已就绪')
  // }).catch((e) => {
  //   console.warn('[ASR] 预启动失败:', e.message)
  // })
  console.log('[懒加载] ASR 和 TTS 模型将在首次使用时加载')
  const win = createWindow()

  // ============================================================
  // 进程守护事件监听（通知渲染进程，给用户友好提示）
  // ============================================================
  async function setupGuardEvents() {
    const asrGuard = getAsrGuard()
    const ttsGuard = await getTtsGuard()

    const sendGuardEvent = (service, event, data) => {
      try {
        win.send('guard:event', { service, event, data, timestamp: Date.now() })
      } catch (e) {
        // 窗口可能已关闭，忽略
      }
    }

    // ASR 守护事件
    if (asrGuard) {
      asrGuard.on('restarting', (count, reason) => {
        console.log(`[Guard:ASR] 正在重启 (第 ${count} 次)，原因: ${reason}`)
        sendGuardEvent('asr', 'restarting', { count, reason })
      })
      asrGuard.on('restarted', (count) => {
        console.log(`[Guard:ASR] 重启成功 (第 ${count} 次)`)
        sendGuardEvent('asr', 'restarted', { count })
      })
      asrGuard.on('restartFailed', (count, err) => {
        console.error(`[Guard:ASR] 重启失败 (第 ${count} 次):`, err?.message)
        sendGuardEvent('asr', 'restartFailed', { count, error: err?.message })
      })
      asrGuard.on('maxRestartsReached', () => {
        console.error('[Guard:ASR] 已达到最大重启次数，停止自动重启')
        sendGuardEvent('asr', 'maxRestartsReached', {})
      })
      asrGuard.on('processExited', (code, signal) => {
        console.warn(`[Guard:ASR] 进程异常退出 (code=${code}, signal=${signal})`)
        sendGuardEvent('asr', 'processExited', { code, signal })
      })
      asrGuard.on('healthCheckFailed', () => {
        console.warn('[Guard:ASR] 健康检查失败')
        sendGuardEvent('asr', 'healthCheckFailed', {})
      })
    }

    // TTS 守护事件
    if (ttsGuard) {
      ttsGuard.on('restarting', (count, reason) => {
        console.log(`[Guard:TTS] 正在重启 (第 ${count} 次)，原因: ${reason}`)
        sendGuardEvent('tts', 'restarting', { count, reason })
      })
      ttsGuard.on('restarted', (count) => {
        console.log(`[Guard:TTS] 重启成功 (第 ${count} 次)`)
        sendGuardEvent('tts', 'restarted', { count })
      })
      ttsGuard.on('restartFailed', (count, err) => {
        console.error(`[Guard:TTS] 重启失败 (第 ${count} 次):`, err?.message)
        sendGuardEvent('tts', 'restartFailed', { count, error: err?.message })
      })
      ttsGuard.on('maxRestartsReached', () => {
        console.error('[Guard:TTS] 已达到最大重启次数，停止自动重启')
        sendGuardEvent('tts', 'maxRestartsReached', {})
      })
      ttsGuard.on('processExited', (code, signal) => {
        console.warn(`[Guard:TTS] 进程异常退出 (code=${code}, signal=${signal})`)
        sendGuardEvent('tts', 'processExited', { code, signal })
      })
      ttsGuard.on('healthCheckFailed', () => {
        console.warn('[Guard:TTS] 健康检查失败')
        sendGuardEvent('tts', 'healthCheckFailed', {})
      })
    }

    console.log('[Guard] 进程守护事件监听已设置')
  }

  // 延迟设置事件监听（确保窗口已创建）
  setTimeout(() => {
    setupGuardEvents().catch(err => {
      console.warn('[Guard] 设置进程守护事件监听失败:', err.message)
    })
  }, 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  console.log('[app] 所有窗口已关闭，开始清理...')
  // 清理 ASR 服务
  try {
    stopAsr()
    console.log('[app] ASR 服务已停止')
  } catch (e) {
    console.warn('[app] 停止 ASR 服务时出错:', e.message)
  }
  // 清理 TTS 服务
  try {
    shutdownTts()
    console.log('[app] TTS 服务已关闭')
  } catch (e) {
    console.warn('[app] 关闭 TTS 服务时出错:', e.message)
  }
  console.log('[app] 清理完成，退出应用')
  if (process.platform !== 'darwin') app.quit()
})

// 应用退出前清理（确保 macOS 上手动退出时也能清理子进程）
app.on('before-quit', (event) => {
  console.log('[app] 应用即将退出，执行最终清理...')
  try {
    stopAsr()
  } catch (e) {}
  try {
    shutdownTts()
  } catch (e) {}
  console.log('[app] 最终清理完成')
})
