// ASR 语音识别服务（Python faster-whisper 常驻进程）
// 与 TTS 的 Piper 服务类似，启动 Python 常驻进程，通过 stdin/stdout 通信
import { spawn } from 'child_process'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { ProcessGuard } from './process-guard.js'
import { withRetry, isRetryableAsrError, globalRetryStats } from './retry-utils.js'

// ============================================================
// ASR 识别结果后处理
// ============================================================

/**
 * 去除连续重复词
 * "你好你好你好" → "你好"
 * "谢谢谢谢" → "谢谢"
 * "我我我觉得" → "我觉得"
 */
function removeRepeatedWords(text) {
  if (!text || text.length < 2) return text

  let result = text

  // 第一步：去除连续重复的词（2-4 字词，至少重复 2 次）
  // "你好你好" → "你好"，"谢谢谢谢" → "谢谢"
  for (let wordLen = 4; wordLen >= 2; wordLen--) {
    const regex = new RegExp(`([\\u4e00-\\u9fff]{${wordLen}})\\1{1,}`, 'g')
    result = result.replace(regex, '$1')
  }

  // 第二步：去除 3 个及以上连续重复的单字（"我我我" → "我"，但"谢谢"保留）
  result = result.replace(/([\u4e00-\u9fff])\1{2,}/g, '$1')

  // 英文：按词去重（连续相同的词只保留一个）
  result = result.replace(/\b(\w+)\s+\1\b/gi, '$1')

  return result
}

/**
 * 自动加标点
 * 根据句末语气词和疑问词判断标点类型
 */
function addPunctuation(text) {
  if (!text || text.length === 0) return text

  // 去除首尾空白
  text = text.trim()

  // 如果已经有标点，不再添加
  if (/[。！？.!?]$/.test(text)) return text

  // 疑问语气：检查整个文本是否包含疑问词模式
  const questionPatterns = /[吗呢啊么怎]$|是不是|对不对|好不好|有没有|能不能|可不可以|为什么|怎么|什么|哪里|哪个|谁|多少|几$|吗$|呢$/
  if (questionPatterns.test(text)) {
    return text + '？'
  }

  // 感叹语气：句末语气词
  if (/[吧呀哇哦噢啦哈]$/.test(text)) {
    return text + '！'
  }

  // 默认句号
  return text + '。'
}

/**
 * 英文大小写修正
 * - 句子首字母大写
 * - "i" → "I"
 */
function fixEnglishCase(text) {
  if (!text) return text

  // 独立的 "i" → "I"
  text = text.replace(/\bi\b/g, 'I')

  // 句子首字母大写（句号/问号/感叹号后的第一个字母）
  text = text.replace(/([.!?。！？]\s*)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase())

  // 文本开头的第一个字母大写（如果是英文）
  text = text.replace(/^([a-z])/, (m, p1) => p1.toUpperCase())

  return text
}

/**
 * ASR 识别结果后处理主函数
 */
function postprocessAsrResult(text) {
  if (!text || !text.trim()) return text

  let result = text.trim()

  // 1. 去除连续重复词
  result = removeRepeatedWords(result)

  // 2. 英文大小写修正
  result = fixEnglishCase(result)

  // 3. 自动加标点
  result = addPunctuation(result)

  return result
}

// ============================================================
// ASR 服务
// ============================================================

const PYTHON = join(process.cwd(), '.venv-tts/bin/python')
const SCRIPT = join(process.cwd(), 'native/asr/asr_server.py')
// faster-whisper 使用 CTranslate2 格式模型，从 HuggingFace 自动下载
// 可选: "Systran/faster-whisper-tiny" / "Systran/faster-whisper-base" / "Systran/faster-whisper-small"
const MODEL_NAME = 'Systran/faster-whisper-base'
const DEVICE = 'cpu' // 'cpu' 或 'cuda' 或 'auto'
const COMPUTE_TYPE = 'int8' // 'int8' 或 'float16' 或 'float32'

class AsrService {
  constructor() {
    this.process = null
    this.ready = false
    this.pending = new Map()
    this.buffer = ''
    this.startPromise = null

    // 进程守护
    this.guard = new ProcessGuard({
      name: 'ASR',
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
      console.log('[ASR] 启动 faster-whisper 常驻服务...')

      const cleanEnv = { ...process.env }
      for (const key of Object.keys(cleanEnv)) {
        if (key.startsWith('DYLD_') || key.startsWith('LD_')) delete cleanEnv[key]
      }

      this.process = spawn(PYTHON, ['-u', SCRIPT, MODEL_NAME, DEVICE, COMPUTE_TYPE], {
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
              console.log('[ASR] faster-whisper 常驻服务已就绪')
              this.ready = true
              resolve()
            } else if (msg.status === 'loading_model') {
              console.log('[ASR] 正在加载模型:', msg.model)
            } else if (msg.id && this.pending.has(msg.id)) {
              const { resolve: res, reject: rej } = this.pending.get(msg.id)
              this.pending.delete(msg.id)
              if (msg.ok) res(msg)
              else rej(new Error(msg.error))
            } else if (msg.ok === false) {
              console.error('[ASR] 启动失败:', msg.error)
              reject(new Error(msg.error || 'startup failed'))
            }
          } catch (e) {}
        }
      })

      this.process.stderr.on('data', (data) => {
        const msg = data.toString()
        // 过滤已知的无害警告
        const harmless = [
          /huggingface_hub/i,
          /Using the latest/,
          /downloading/i,
          /^\s*$/,
        ]
        if (!harmless.some(p => p.test(msg))) {
          console.warn('[ASR] stderr:', msg.slice(0, 200))
        }
      })

      // 捕获 stdin 写入错误（如 EPIPE），避免未捕获异常导致崩溃
      this.process.stdin.on('error', (err) => {
        console.warn('[ASR] stdin error:', err.message)
        // 不重置状态，让 exit 事件处理进程重启
      })

      this.process.on('error', (err) => {
        console.error('[ASR] process error:', err)
        this._resetState()
        reject(err)
      })

      this.process.on('exit', (code, signal) => {
        console.warn('[ASR] 进程退出，code=', code, 'signal=', signal)
        const wasReady = this.ready
        this._resetState()
        // 通知进程守护
        if (wasReady) {
          this.guard.handleProcessExit(code, signal)
        }
      })

      setTimeout(() => { if (!this.ready) reject(new Error('ASR start timeout')) }, 120000)
    })
  }

  /**
   * 内部：重置状态
   */
  _resetState() {
    this.process = null
    this.ready = false
    this.startPromise = null
    for (const [, { reject: rej }] of this.pending) rej(new Error('ASR service reset'))
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
        console.warn('[ASR] 杀死进程时出错:', e.message)
      }
    }
    this._resetState()
  }

  async ensureStarted() {
    if (this.process && this.ready) return
    if (this.guard.isRunning) return
    await this.guard.start()
  }

  async transcribe(pcmBuffer, { language = 'zh', sampleRate = 16000, postprocess = true, retries = 2 } = {}) {
    let attempt = 0
    let lastError = null

    try {
      const result = await withRetry(
        async () => {
          attempt++
          await this.ensureStarted()
          const id = randomUUID()
          const pcmB64 = pcmBuffer.toString('base64')

          return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })

            // 写入前检查进程和 stdin 状态
            if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
              this.pending.delete(id)
              reject(new Error('ASR process stdin is not writable (process may have exited)'))
              return
            }

            const payload = JSON.stringify({
              id,
              pcm_b64: pcmB64,
              language,
              sample_rate: sampleRate,
            }) + '\n'

            // 使用回调处理写入错误，避免 EPIPE 未捕获异常
            this.process.stdin.write(payload, (err) => {
              if (err) {
                console.warn('[ASR] stdin write error:', err.message)
                this.pending.delete(id)
                reject(new Error(`ASR stdin write failed: ${err.message}`))
              }
            })
          })
        },
        {
          maxRetries: retries,
          baseDelay: 800,
          maxDelay: 3000,
          shouldRetry: (error) => isRetryableAsrError(error),
          name: 'ASR',
          onRetry: (error, attemptNum) => {
            console.warn(`[ASR] 第 ${attemptNum} 次重试，原因:`, error.message)
            // 重试前重置服务状态（如果进程异常的话）
            if (!this.process || !this.ready) {
              console.log('[ASR] 进程异常，重启服务...')
              this._resetState()
            }
          },
        }
      )

      // 应用后处理
      if (postprocess && result.text) {
        const original = result.text
        const processed = postprocessAsrResult(original)
        if (original !== processed) {
          console.log('[ASR] 后处理:', JSON.stringify(original), '→', JSON.stringify(processed))
        }
        result.text = processed
        result.original_text = original
      }

      // 记录统计
      globalRetryStats.record('ASR', true, attempt - 1)
      result.retries = attempt - 1
      return result
    } catch (error) {
      lastError = error
      console.error(`[ASR] 识别失败 (尝试 ${attempt} 次):`, error.message)
      globalRetryStats.record('ASR', false, attempt - 1, error)
      throw error
    }
  }

  stop() {
    this.guard.stop()
  }

  /**
   * 获取进程守护状态
   */
  getGuardStatus() {
    return this.guard.getStatus()
  }

  /**
   * 手动重启服务
   */
  async restart() {
    return this.guard.restart('manual')
  }
}

const service = new AsrService()

export async function startAsr() {
  return service.ensureStarted()
}

export async function transcribe(pcmBuffer, options) {
  return service.transcribe(pcmBuffer, options)
}

export function stopAsr() {
  service.stop()
}

export function isAsrAvailable() {
  return service.ready
}

export function getAsrGuardStatus() {
  return service.getGuardStatus()
}

export async function restartAsr() {
  return service.restart()
}

export function getAsrGuard() {
  return service.guard
}
