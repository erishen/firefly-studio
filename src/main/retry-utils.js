// 通用重试工具函数
// 提供指数退避重试、错误分类、重试统计等功能

/**
 * 重试配置
 * @typedef {Object} RetryOptions
 * @property {number} maxRetries - 最大重试次数（默认 2 次，即最多执行 3 次）
 * @property {number} baseDelay - 基础延迟（毫秒，默认 500ms）
 * @property {number} maxDelay - 最大延迟（毫秒，默认 5000ms）
 * @property {Function} shouldRetry - 判断是否应该重试的函数（默认所有错误都重试）
 * @property {Function} onRetry - 重试时的回调函数（参数：error, attemptNumber）
 * @property {string} name - 操作名称（用于日志）
 */

/**
 * 带指数退避的重试函数
 * @param {Function} fn - 要执行的异步函数
 * @param {RetryOptions} options - 重试配置
 * @returns {Promise<any>} 执行结果
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 2,
    baseDelay = 500,
    maxDelay = 5000,
    shouldRetry = () => true,
    onRetry = null,
    name = 'unknown',
  } = options

  let lastError = null
  let attempt = 0

  for (attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Retry:${name}] 第 ${attempt} 次重试...`)
      }
      const result = await fn()
      if (attempt > 0) {
        console.log(`[Retry:${name}] 第 ${attempt} 次重试成功`)
      }
      return result
    } catch (error) {
      lastError = error
      const isLastAttempt = attempt >= maxRetries
      const canRetry = !isLastAttempt && shouldRetry(error, attempt)

      if (onRetry) {
        try {
          onRetry(error, attempt, canRetry)
        } catch (e) {
          console.warn(`[Retry:${name}] onRetry 回调出错:`, e.message)
        }
      }

      if (!canRetry) {
        console.warn(`[Retry:${name}] 不再重试 (attempt=${attempt}, isLastAttempt=${isLastAttempt})`)
        break
      }

      // 指数退避：baseDelay * 2^attempt，加上随机抖动
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
      const jitter = Math.random() * 0.3 * delay // 0-30% 随机抖动
      const totalDelay = Math.round(delay + jitter)

      console.log(`[Retry:${name}] 等待 ${totalDelay}ms 后重试 (attempt=${attempt}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, totalDelay))
    }
  }

  console.error(`[Retry:${name}] 所有重试都失败了 (attempts=${attempt + 1})`)
  throw lastError
}

/**
 * 判断是否是可重试的网络错误
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否可重试
 */
export function isRetryableNetworkError(error) {
  const retryableErrors = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    '500',
    '502',
    '503',
    '504',
    '429', // 限流
    'timeout',
    'network error',
    'fetch failed',
    'socket hang up',
  ]

  const errorMessage = (error?.message || '').toLowerCase()
  const errorCode = (error?.code || '').toLowerCase()
  const errorStatus = String(error?.status || error?.statusCode || '')

  return retryableErrors.some(keyword =>
    errorMessage.includes(keyword.toLowerCase()) ||
    errorCode.includes(keyword.toLowerCase()) ||
    errorStatus.includes(keyword)
  )
}

/**
 * 判断是否是 LLM 可重试的错误
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否可重试
 */
export function isRetryableLlmError(error) {
  // 网络错误可重试
  if (isRetryableNetworkError(error)) return true

  // LLM 特定的可重试错误
  const retryableMessages = [
    'rate limit',
    'too many requests',
    'server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'model overloaded',
    'context length', // 上下文长度超限（可能是临时的）
    'invalid request', // 某些临时的无效请求
  ]

  const errorMessage = (error?.message || '').toLowerCase()
  return retryableMessages.some(keyword => errorMessage.includes(keyword))
}

/**
 * 判断是否是 TTS 可重试的错误
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否可重试
 */
export function isRetryableTtsError(error) {
  // 网络错误可重试
  if (isRetryableNetworkError(error)) return true

  // TTS 特定的可重试错误
  const retryableMessages = [
    'service unavailable',
    'timeout',
    'rate limit',
    'too many requests',
    'server error',
    'connection',
    'socket',
  ]

  const errorMessage = (error?.message || '').toLowerCase()
  return retryableMessages.some(keyword => errorMessage.includes(keyword))
}

/**
 * 判断是否是 ASR 可重试的错误
 * @param {Error} error - 错误对象
 * @returns {boolean} 是否可重试
 */
export function isRetryableAsrError(error) {
  // 网络错误可重试
  if (isRetryableNetworkError(error)) return true

  // ASR 特定的可重试错误
  const retryableMessages = [
    'service unavailable',
    'timeout',
    'rate limit',
    'too many requests',
    'server error',
    'audio',
    'decode',
  ]

  const errorMessage = (error?.message || '').toLowerCase()
  return retryableMessages.some(keyword => errorMessage.includes(keyword))
}

/**
 * 重试统计器
 * 用于统计各种操作的重试次数和成功率
 */
export class RetryStats {
  constructor() {
    this.stats = new Map()
  }

  /**
   * 记录一次操作
   * @param {string} name - 操作名称
   * @param {boolean} success - 是否成功
   * @param {number} retries - 重试次数
   * @param {Error} error - 错误对象（失败时）
   */
  record(name, success, retries = 0, error = null) {
    if (!this.stats.has(name)) {
      this.stats.set(name, {
        total: 0,
        success: 0,
        failed: 0,
        totalRetries: 0,
        lastError: null,
        lastErrorTime: null,
      })
    }

    const stat = this.stats.get(name)
    stat.total++
    stat.totalRetries += retries
    if (success) {
      stat.success++
    } else {
      stat.failed++
      stat.lastError = error?.message || 'unknown'
      stat.lastErrorTime = new Date().toISOString()
    }
  }

  /**
   * 获取统计信息
   * @param {string} name - 操作名称（可选，不传返回所有）
   * @returns {Object} 统计信息
   */
  getStats(name = null) {
    if (name) {
      return this.stats.get(name) || null
    }

    const result = {}
    for (const [key, value] of this.stats.entries()) {
      result[key] = {
        ...value,
        successRate: value.total > 0 ? Math.round(value.success / value.total * 100) : 0,
        avgRetries: value.total > 0 ? (value.totalRetries / value.total).toFixed(2) : 0,
      }
    }
    return result
  }

  /**
   * 重置统计
   * @param {string} name - 操作名称（可选，不传重置所有）
   */
  reset(name = null) {
    if (name) {
      this.stats.delete(name)
    } else {
      this.stats.clear()
    }
  }
}

// 全局重试统计器
export const globalRetryStats = new RetryStats()

export default {
  withRetry,
  isRetryableNetworkError,
  isRetryableLlmError,
  isRetryableTtsError,
  isRetryableAsrError,
  RetryStats,
  globalRetryStats,
}
