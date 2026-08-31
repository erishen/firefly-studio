// TTS 语音合成模块。
// TTS 语音合成模块
// 支持两种提供商，通过 .env 的 TTS_PROVIDER 切换：
//   - piper: 本地离线，Piper 常驻服务（MIT 许可证，默认，推荐）
//   - edge-tts: 微软在线 TTS（GPL-3.0 许可证，可选，动态加载）
//
// edge-tts 实现已移至单独文件 tts-edge-tts.js，
// 只有当 TTS_PROVIDER=edge-tts 时才会动态加载，
// 避免默认情况下加载 GPL 代码，降低许可证传染性风险。
import { spawn } from 'child_process'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { readFile, unlink, existsSync } from 'fs'
import { promisify } from 'util'
import { createRequire } from 'module'
import { ProcessGuard } from './process-guard.js'
import { withRetry, isRetryableTtsError, globalRetryStats } from './retry-utils.js'

const require = createRequire(import.meta.url)
const readFileAsync = promisify(readFile)
const unlinkAsync = promisify(unlink)

// 加载 C++ 原生模块（用于 PCM 处理：淡入淡出、合并、裁剪、WAV 构造等）
let nativeAddon = null
try {
  nativeAddon = require(join(process.cwd(), 'native/build/Release/firefly_native.node'))
  console.log('[TTS] C++ 原生模块已加载，PCM 处理可用:', Object.keys(nativeAddon.pcm || {}))
} catch (e) {
  console.log('[TTS] C++ 原生模块加载失败，使用纯 JavaScript 处理:', e.message)
}

// 从 .env 读取配置（简单解析，不依赖 dotenv 库）
function loadEnv() {
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) return {}
  const content = require('fs').readFileSync(envPath, 'utf-8')
  const env = {}
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv()
const TTS_PROVIDER = (env.TTS_PROVIDER || process.env.TTS_PROVIDER || 'piper').toLowerCase()
const ENABLE_EDGE_TTS = (env.ENABLE_EDGE_TTS || process.env.ENABLE_EDGE_TTS || 'false').toLowerCase() === 'true'
const PIPER_ZH_MODEL = env.PIPER_ZH_MODEL || env.PIPER_MODEL || process.env.PIPER_ZH_MODEL || process.env.PIPER_MODEL || 'native/piper/models/zh_CN-xiao_ya-medium.onnx'
const PIPER_EN_MODEL = env.PIPER_EN_MODEL || process.env.PIPER_EN_MODEL || 'native/piper/models/en_US-amy-medium.onnx'

console.log(`[TTS] provider=${TTS_PROVIDER}, edge-tts enabled=${ENABLE_EDGE_TTS}`)

// 如果用户配置了 edge-tts 但未启用，给出警告并回退到 piper
let effectiveProvider = TTS_PROVIDER
if (TTS_PROVIDER === 'edge-tts' && !ENABLE_EDGE_TTS) {
  console.warn('[TTS] ⚠️ TTS_PROVIDER=edge-tts 但 ENABLE_EDGE_TTS=false，已自动回退到 piper')
  console.warn('[TTS] 如需启用 edge-tts，请在 .env 中设置 ENABLE_EDGE_TTS=true，并确保 tts-edge-tts.js 文件存在')
  effectiveProvider = 'piper'
}

// ============================================================
// Piper Provider（本地离线，Python 常驻服务）
// ============================================================
class PiperProvider {
  constructor() {
    this.process = null
    this.ready = false
    this.pending = new Map()
    this.buffer = ''

    // 进程守护
    this.guard = new ProcessGuard({
      name: 'TTS-Piper',
      maxRestarts: 3,
      restartDelay: 3000,
      healthCheckInterval: 15000,
      startFn: async () => {
        await this._startProcess()
      },
      stopFn: async () => {
        this._killProcess()
      },
      isHealthyFn: () => {
        return this.process !== null && this.ready && !this.process.killed
      },
    })
  }

  /**
   * 内部：启动 Python 进程
   */
  _startProcess() {
    return new Promise((resolve, reject) => {
      const PYTHON = join(process.cwd(), '.venv-tts/bin/python')
      const PYTHON_ARGS = ['-u']
      const SCRIPT = join(process.cwd(), 'native/piper/piper_server.py')
      const ZH_MODEL = join(process.cwd(), PIPER_ZH_MODEL)
      const EN_MODEL = join(process.cwd(), PIPER_EN_MODEL)

      console.log('[TTS] 启动 Piper 常驻服务（中英文双模型）...')

      // 虚拟环境已包含所有依赖，无需额外设置 PYTHONPATH
      const cleanEnv = { ...process.env }
      for (const key of Object.keys(cleanEnv)) {
        if (key.startsWith('DYLD_') || key.startsWith('LD_')) delete cleanEnv[key]
      }
      // 抑制 transformers 的 PyTorch 未安装警告（Piper 使用 onnxruntime，不需要 PyTorch）
      cleanEnv.TRANSFORMERS_VERBOSITY = 'error'
      cleanEnv.TRANSFORMERS_NO_ADVISORY_WARNINGS = '1'

      this.process = spawn(PYTHON, [...PYTHON_ARGS, SCRIPT, ZH_MODEL, EN_MODEL], {
        env: cleanEnv,
        cwd: '/tmp',
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString()
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.status === 'ready') {
              console.log('[TTS] Piper 常驻服务已就绪')
              this.ready = true
              resolve()
            } else if (msg.id && this.pending.has(msg.id)) {
              const { resolve: res, reject: rej } = this.pending.get(msg.id)
              this.pending.delete(msg.id)
              if (msg.ok) res(msg)
              else rej(new Error(msg.error))
            } else if (msg.ok === false) {
              console.error('[TTS] Piper error:', msg.error)
              reject(new Error(msg.error || 'startup failed'))
            }
          } catch (e) {}
        }
      })

      this.process.stderr.on('data', (data) => {
        const msg = data.toString()
        // 过滤已知的无害警告（transformers PyTorch 未安装、onnxruntime 提示等）
        const harmlessPatterns = [
          /PyTorch was not found/i,
          /Models won't be available/i,
          /only tokenizers/i,
          /transformers/i,
          /Warning.*onnxruntime/i,
          /unauthenticated requests to the HF Hub/i,
          /HF_TOKEN/i,
          /huggingface/i,
          /^\s*$/,
        ]
        const isHarmless = harmlessPatterns.some(p => p.test(msg))
        if (!isHarmless) {
          console.warn('[TTS] stderr:', msg.slice(0, 300))
        }
      })

      // 捕获 stdin 写入错误（如 EPIPE），避免未捕获异常导致崩溃
      this.process.stdin.on('error', (err) => {
        console.warn('[TTS] stdin error:', err.message)
        // 不重置状态，让 exit 事件处理进程重启
      })

      this.process.on('error', (err) => {
        console.error('[TTS] process error:', err)
        this._resetState()
        reject(err)
      })

      this.process.on('exit', (code, signal) => {
        console.warn('[TTS] Piper 进程退出，code=', code, 'signal=', signal)
        const wasReady = this.ready
        this._resetState()
        // 通知进程守护
        if (wasReady) {
          this.guard.handleProcessExit(code, signal)
        }
      })

      setTimeout(() => { if (!this.ready) reject(new Error('Piper start timeout')) }, 60000)
    })
  }

  /**
   * 内部：重置状态
   */
  _resetState() {
    this.process = null
    this.ready = false
    for (const [, { reject: rej }] of this.pending) rej(new Error('Piper service reset'))
    this.pending.clear()
    this.buffer = ''
  }

  /**
   * 内部：强制杀死进程
   */
  _killProcess() {
    if (this.process) {
      try {
        this.process.kill('SIGTERM')
        // 5 秒后强制杀死
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL')
          }
        }, 5000)
      } catch (e) {
        console.warn('[TTS] 杀死进程时出错:', e.message)
      }
    }
    this._resetState()
  }

  async ensureStarted() {
    if (this.process && this.ready) return
    if (this.guard.isRunning) return
    await this.guard.start()
  }

  async synthesize(text, { rate = 1.0, returnPcm = false, volume = 1.0 } = {}) {
    const cleanText = text.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').replace(/\s+/g, ' ').trim()
    if (!cleanText) throw new Error('文本为空')
    await this.ensureStarted()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })

      // 写入前检查进程和 stdin 状态
      if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
        this.pending.delete(id)
        reject(new Error('TTS process stdin is not writable (process may have exited)'))
        return
      }

      const payload = JSON.stringify({ id, text: cleanText, rate }) + '\n'

      // 使用回调处理写入错误，避免 EPIPE 未捕获异常
      this.process.stdin.write(payload, (err) => {
        if (err) {
          console.warn('[TTS] stdin write error:', err.message)
          this.pending.delete(id)
          reject(new Error(`TTS stdin write failed: ${err.message}`))
        }
      })
    }).then(async (msg) => {
      const sampleRate = msg.sample_rate || 22050

      // 检查是否返回了分段 PCM 数据（新协议）
      if (msg.segment_pcms && Array.isArray(msg.segment_pcms) && nativeAddon) {
        // 用 C++ 模块合并各段 PCM（含段间静音和每段淡入淡出）
        // 注意：Python 端已做每段 20ms 淡入淡出，这里合并时再做 10ms 交叉淡化
        const segments = msg.segment_pcms.map(b64 => Buffer.from(b64, 'base64'))
        const mergedPcm = nativeAddon.pcm.mergeSegments(segments, 200, sampleRate, 15)

        // 音量调节（如果不是默认音量）
        let finalPcm = mergedPcm
        if (volume !== 1.0 && nativeAddon.pcm.adjustVolume) {
          finalPcm = nativeAddon.pcm.adjustVolume(finalPcm, volume)
        }

        // 对整体应用淡入淡出（更长的淡出，避免末尾爆音）
        finalPcm = nativeAddon.pcm.applyFadeInOut(finalPcm, 80, sampleRate)

        if (returnPcm) {
          // 末尾追加 200ms 静音，让 CoreAudio 播放器自然结束，避免突然停止产生爆音
          const tailSilence = nativeAddon.pcm.createSilence(200, sampleRate)
          const pcmWithTail = Buffer.concat([finalPcm, tailSilence])
          return { pcm: pcmWithTail, sampleRate, channels: 1, provider: 'piper', segments: msg.segments }
        }

        // 使用 C++ 模块构造 WAV 文件（减少 JavaScript 层数据处理）
        const wavBuf = nativeAddon.pcm.toWav(finalPcm, sampleRate, 1, 16)
        return { wavBase64: wavBuf.toString('base64'), size: wavBuf.length, provider: 'piper', sampleRate, segments: msg.segments }
      }

      // 兼容旧协议：WAV 文件
      if (msg.wav_path) {
        const wavBuf = await readFileAsync(msg.wav_path)
        unlinkAsync(msg.wav_path).catch(() => {})
        if (returnPcm) {
          let pcmBuf = wavBuf.slice(44)
          // 音量调节
          if (volume !== 1.0 && nativeAddon?.pcm?.adjustVolume) {
            pcmBuf = nativeAddon.pcm.adjustVolume(pcmBuf, volume)
          }
          // 淡入淡出
          if (nativeAddon?.pcm?.applyFadeInOut) {
            pcmBuf = nativeAddon.pcm.applyFadeInOut(pcmBuf, 80, sampleRate)
          }
          // 末尾追加 200ms 静音
          if (nativeAddon?.pcm?.createSilence) {
            const tailSilence = nativeAddon.pcm.createSilence(200, sampleRate)
            pcmBuf = Buffer.concat([pcmBuf, tailSilence])
          }
          return { pcm: pcmBuf, sampleRate, channels: 1, provider: 'piper', lang: msg.lang }
        }
        return { wavBase64: wavBuf.toString('base64'), size: wavBuf.length, provider: 'piper', lang: msg.lang, sampleRate }
      }

      throw new Error('Invalid response: no segment_pcms or wav_path')
    })
  }
}

// ============================================================
// edge-tts Provider 已移至单独文件 tts-edge-tts.js
// 原因：edge-tts 使用 GPL-3.0 许可证，通过动态加载避免
// 默认情况下加载 GPL 代码，降低许可证传染性风险。
// 只有当用户在 .env 中设置 TTS_PROVIDER=edge-tts 时才会加载。
// ============================================================

// ============================================================
// LRU 缓存（TTS 合成结果缓存，避免重复合成相同文本）
// ============================================================
class LRUCache {
  constructor(maxSize = 50) {
    this.maxSize = maxSize
    this.cache = new Map() // Map 保持插入顺序，用于 LRU
  }

  get(key) {
    if (!this.cache.has(key)) return null
    // 命中：删除并重新插入，更新为最近使用
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // 满了：删除最旧的（Map 的第一个元素）
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  has(key) {
    return this.cache.has(key)
  }

  clear() {
    this.cache.clear()
  }

  size() {
    return this.cache.size
  }
}

// TTS 缓存：key = 文本 + 语速 + 提供商 + returnPcm，value = 合成结果
const ttsCache = new LRUCache(50)
let cacheHits = 0
let cacheMisses = 0

// ============================================================
// 工厂函数
// ============================================================
let provider = null
async function getProvider() {
  if (!provider) {
    if (effectiveProvider === 'edge-tts') {
      // 动态加载 edge-tts 提供器（GPL-3.0 许可证，可选功能）
      // 该文件不提交到 GitHub，用户需自行准备
      console.log('[TTS] 使用 edge-tts（GPL-3.0，可选功能）')
      try {
        const { EdgeTtsProvider } = await import('./tts-edge-tts.js')
        provider = new EdgeTtsProvider()
      } catch (e) {
        console.error(`[TTS] ❌ 加载 edge-tts 失败: ${e.message}`)
        console.error('[TTS] 可能原因：tts-edge-tts.js 文件不存在（该文件不提交到 GitHub），或 ENABLE_EDGE_TTS 未设置为 true')
        console.error('[TTS] 已自动回退到 piper（MIT 许可证）')
        provider = new PiperProvider()
        effectiveProvider = 'piper'
      }
    } else {
      provider = new PiperProvider()
    }
  }
  return provider
}

export async function synthesize(text, options = {}) {
  // 生成缓存 key
  const cacheKey = JSON.stringify({
    text: text.trim(),
    rate: options.rate || 1.0,
    returnPcm: options.returnPcm || false,
    provider: effectiveProvider,
  })

  // 检查缓存
  const cached = ttsCache.get(cacheKey)
  if (cached) {
    cacheHits++
    console.log(`[TTS] 缓存命中 (${cacheHits}/${cacheHits + cacheMisses}, 命中率 ${Math.round(cacheHits / (cacheHits + cacheMisses) * 100)}%)`)
    // 返回缓存的深拷贝，避免修改缓存数据
    return { ...cached, fromCache: true }
  }

  cacheMisses++

  let attempt = 0
  let lastError = null
  let usedProvider = TTS_PROVIDER

  try {
    const result = await withRetry(
      async () => {
        attempt++
        // 第一次用默认提供商，重试时切换提供商（如果 edge-tts 可用）
        if (attempt > 1 && usedProvider === 'piper' && ENABLE_EDGE_TTS) {
          console.log('[TTS] 重试时切换到 edge-tts...')
          usedProvider = 'edge-tts'
        }

        let p
        if (usedProvider === 'edge-tts') {
          // 动态加载 edge-tts 提供器（GPL-3.0，可选功能，文件不提交到 GitHub）
          try {
            const { EdgeTtsProvider } = await import('./tts-edge-tts.js')
            p = new EdgeTtsProvider()
          } catch (e) {
            console.warn(`[TTS] ⚠️ 加载 edge-tts 失败（${e.message}），回退到 piper 重试`)
            usedProvider = 'piper'
            p = await getProvider()
          }
        } else {
          p = await getProvider()
        }
        const result = await p.synthesize(text, options)
        result.provider = usedProvider
        return result
      },
      {
        maxRetries: options.retries || 2,
        baseDelay: 800,
        maxDelay: 3000,
        shouldRetry: (error) => isRetryableTtsError(error),
        name: 'TTS',
        onRetry: (error, attemptNum) => {
          console.warn(`[TTS] 第 ${attemptNum} 次重试，原因:`, error.message)
        },
      }
    )

    // 只缓存成功的结果
    if (result && (result.pcm || result.wavBase64)) {
      ttsCache.set(cacheKey, result)
      console.log(`[TTS] 缓存已保存，当前缓存大小: ${ttsCache.size()}/50`)
    }

    // 记录统计
    globalRetryStats.record('TTS', true, attempt - 1)
    result.retries = attempt - 1
    return result
  } catch (error) {
    lastError = error
    console.error(`[TTS] 合成失败 (尝试 ${attempt} 次):`, error.message)
    globalRetryStats.record('TTS', false, attempt - 1, error)
    throw error
  }
}

export function clearCache() {
  ttsCache.clear()
  cacheHits = 0
  cacheMisses = 0
  console.log('[TTS] 缓存已清空')
}

export function getCacheStats() {
  return {
    size: ttsCache.size(),
    maxSize: 50,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits + cacheMisses > 0 ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100) : 0,
  }
}

export function isAvailable() {
  return true
}

export async function preload() {
  try {
    const p = await getProvider()
    if (p.ensureStarted) await p.ensureStarted()
    return true
  } catch (e) {
    console.warn('[TTS] preload failed:', e.message)
    return false
  }
}

// ============================================================
// 进程守护相关方法
// ============================================================

/**
 * 获取 TTS 进程守护状态
 */
export async function getTtsGuardStatus() {
  const p = await getProvider()
  if (p.guard) {
    return p.guard.getStatus()
  }
  return {
    name: 'TTS',
    isRunning: true,
    isRestarting: false,
    restartCount: 0,
    maxRestarts: 0,
    consecutiveFailures: 0,
    note: 'edge-tts 不需要进程守护',
  }
}

/**
 * 手动重启 TTS 服务
 */
export async function restartTts() {
  const p = await getProvider()
  if (p.guard) {
    return p.guard.restart('manual')
  }
  console.log('[TTS] edge-tts 不需要重启')
  return true
}

/**
 * 获取 TTS 进程守护实例（用于事件监听）
 */
export async function getTtsGuard() {
  const p = await getProvider()
  return p.guard || null
}

/**
 * 关闭 TTS 服务，清理子进程（应用退出时调用）
 */
export function shutdownTts() {
  try {
    if (provider) {
      console.log('[TTS] 正在关闭 TTS 服务...')
      // 停止进程守护
      if (provider.guard) {
        provider.guard.stop?.()
      }
      // 强制杀死 Piper 进程
      if (typeof provider._killProcess === 'function') {
        provider._killProcess()
      }
      provider = null
      console.log('[TTS] TTS 服务已关闭')
    }
  } catch (e) {
    console.warn('[TTS] 关闭 TTS 服务时出错:', e.message)
  }
}
