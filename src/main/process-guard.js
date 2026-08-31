// Python 服务进程守护模块
// 提供统一的进程监控、自动重启、健康检查功能
import { EventEmitter } from 'events'

/**
 * 进程守护配置
 * @typedef {Object} ProcessGuardOptions
 * @property {string} name - 服务名称（用于日志和事件）
 * @property {number} maxRestarts - 最大重启次数（默认 3 次）
 * @property {number} restartDelay - 重启延迟（毫秒，默认 2000ms）
 * @property {number} healthCheckInterval - 健康检查间隔（毫秒，默认 10000ms）
 * @property {Function} startFn - 启动进程的函数，返回 Promise
 * @property {Function} stopFn - 停止进程的函数
 * @property {Function} isHealthyFn - 健康检查函数，返回 boolean
 */

export class ProcessGuard extends EventEmitter {
  /**
   * @param {ProcessGuardOptions} options
   */
  constructor(options) {
    super()
    this.name = options.name || 'unknown'
    this.maxRestarts = options.maxRestarts || 3
    this.restartDelay = options.restartDelay || 2000
    this.healthCheckInterval = options.healthCheckInterval || 10000
    this.startFn = options.startFn
    this.stopFn = options.stopFn
    this.isHealthyFn = options.isHealthyFn

    this.restartCount = 0
    this.isRunning = false
    this.isRestarting = false
    this.isStopping = false
    this.healthCheckTimer = null
    this.restartTimer = null
    this.consecutiveFailures = 0
  }

  /**
   * 启动服务
   */
  async start() {
    if (this.isRunning) {
      console.log(`[Guard:${this.name}] 服务已在运行中`)
      return true
    }

    this.isStopping = false
    try {
      console.log(`[Guard:${this.name}] 正在启动服务...`)
      await this.startFn()
      this.isRunning = true
      this.consecutiveFailures = 0
      this.restartCount = 0
      console.log(`[Guard:${this.name}] 服务启动成功`)
      this.emit('started')
      this.startHealthCheck()
      return true
    } catch (err) {
      console.error(`[Guard:${this.name}] 服务启动失败:`, err.message)
      this.consecutiveFailures++
      this.emit('startFailed', err)
      return false
    }
  }

  /**
   * 停止服务
   */
  async stop() {
    if (!this.isRunning && !this.isRestarting) {
      return
    }

    this.isStopping = true
    this.stopHealthCheck()
    this.clearRestartTimer()

    try {
      console.log(`[Guard:${this.name}] 正在停止服务...`)
      if (this.stopFn) {
        await this.stopFn()
      }
      console.log(`[Guard:${this.name}] 服务已停止`)
    } catch (err) {
      console.warn(`[Guard:${this.name}] 停止服务时出错:`, err.message)
    } finally {
      this.isRunning = false
      this.isRestarting = false
      this.isStopping = false
      this.emit('stopped')
    }
  }

  /**
   * 重启服务
   */
  async restart(reason = 'manual') {
    if (this.isRestarting) {
      console.log(`[Guard:${this.name}] 已在重启中，跳过重复请求`)
      return false
    }

    if (this.restartCount >= this.maxRestarts) {
      console.error(`[Guard:${this.name}] 已达到最大重启次数 (${this.maxRestarts})，停止重启`)
      this.emit('maxRestartsReached')
      return false
    }

    this.isRestarting = true
    this.restartCount++
    console.log(`[Guard:${this.name}] 正在重启服务 (第 ${this.restartCount}/${this.maxRestarts} 次)，原因: ${reason}`)
    this.emit('restarting', this.restartCount, reason)

    try {
      // 先停止当前服务
      this.stopHealthCheck()
      if (this.stopFn) {
        try {
          await this.stopFn()
        } catch (e) {
          console.warn(`[Guard:${this.name}] 停止旧进程时出错:`, e.message)
        }
      }
      this.isRunning = false

      // 等待一段时间再重启
      await new Promise(resolve => setTimeout(resolve, this.restartDelay))

      // 检查是否在等待期间被停止
      if (this.isStopping) {
        console.log(`[Guard:${this.name}] 重启等待期间收到停止指令，取消重启`)
        this.isRestarting = false
        return false
      }

      // 启动新服务
      const success = await this.start()
      this.isRestarting = false

      if (success) {
        console.log(`[Guard:${this.name}] 服务重启成功`)
        this.emit('restarted', this.restartCount)
        return true
      } else {
        console.error(`[Guard:${this.name}] 服务重启失败`)
        this.emit('restartFailed', this.restartCount)
        return false
      }
    } catch (err) {
      console.error(`[Guard:${this.name}] 重启服务时出错:`, err.message)
      this.isRestarting = false
      this.emit('restartFailed', this.restartCount, err)
      return false
    }
  }

  /**
   * 进程退出时的处理（由外部调用）
   */
  handleProcessExit(code, signal) {
    if (this.isStopping) {
      console.log(`[Guard:${this.name}] 进程正常退出 (code=${code}, signal=${signal})`)
      return
    }

    console.warn(`[Guard:${this.name}] 进程异常退出 (code=${code}, signal=${signal})`)
    this.isRunning = false
    this.consecutiveFailures++
    this.emit('processExited', code, signal)

    // 延迟自动重启
    this.scheduleRestart(`进程异常退出 (code=${code})`)
  }

  /**
   * 调度自动重启
   */
  scheduleRestart(reason) {
    if (this.isRestarting || this.isStopping) {
      return
    }

    if (this.restartCount >= this.maxRestarts) {
      console.error(`[Guard:${this.name}] 已达到最大重启次数，不再自动重启`)
      this.emit('maxRestartsReached')
      return
    }

    console.log(`[Guard:${this.name}] ${this.restartDelay}ms 后自动重启...`)
    this.clearRestartTimer()
    this.restartTimer = setTimeout(() => {
      this.restart(reason)
    }, this.restartDelay)
  }

  /**
   * 启动健康检查
   */
  startHealthCheck() {
    if (!this.isHealthyFn || this.healthCheckTimer) {
      return
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, this.healthCheckInterval)
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * 执行健康检查
   */
  performHealthCheck() {
    if (!this.isRunning || this.isRestarting) {
      return
    }

    try {
      const healthy = this.isHealthyFn()
      if (!healthy) {
        console.warn(`[Guard:${this.name}] 健康检查失败，准备重启...`)
        this.consecutiveFailures++
        this.emit('healthCheckFailed')
        if (this.consecutiveFailures >= 3) {
          this.scheduleRestart('连续健康检查失败')
        }
      } else {
        if (this.consecutiveFailures > 0) {
          console.log(`[Guard:${this.name}] 健康检查恢复正常`)
          this.consecutiveFailures = 0
        }
      }
    } catch (err) {
      console.warn(`[Guard:${this.name}] 健康检查出错:`, err.message)
    }
  }

  /**
   * 清除重启定时器
   */
  clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  /**
   * 获取状态信息
   */
  getStatus() {
    return {
      name: this.name,
      isRunning: this.isRunning,
      isRestarting: this.isRestarting,
      restartCount: this.restartCount,
      maxRestarts: this.maxRestarts,
      consecutiveFailures: this.consecutiveFailures,
    }
  }

  /**
   * 重置重启计数（手动恢复时调用）
   */
  resetRestartCount() {
    this.restartCount = 0
    this.consecutiveFailures = 0
    console.log(`[Guard:${this.name}] 重启计数已重置`)
  }
}

export default ProcessGuard
