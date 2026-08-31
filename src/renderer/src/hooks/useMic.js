import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * 麦克风采集 hook — C++ CoreAudio 采集 + VAD + Whisper 本地 ASR。
 * - volume: 当前音量（0~1）
 * - isSpeaking: 是否检测到语音
 * - transcript: ASR 识别结果（说话结束后自动填充）
 * - currentThreshold: 当前 VAD 阈值（自适应时动态变化）
 * - noiseFloor: 环境噪音基线
 * - start/stop: 开始/停止采集
 */
export function useMic({ modelPath, onFrame, onAsr, onAsrPartial, onError, adaptiveThreshold = true } = {}) {
  const [volume, setVolume] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [partialTranscript, setPartialTranscript] = useState('') // 中间识别结果（流式 ASR）
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(false) // 麦克风启动中（首次使用时加载 ASR 模型）
  const [error, setError] = useState(null)
  const [currentThreshold, setCurrentThreshold] = useState(0.02)
  const [noiseFloor, setNoiseFloor] = useState(0.01)
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(adaptiveThreshold)
  const handleRef = useRef(null)
  const statusTimerRef = useRef(null)

  // 定期获取麦克风状态（阈值、噪音基线）
  const pollStatus = useCallback(async () => {
    if (handleRef.current === null) return
    try {
      const status = await window.electronAPI?.mic.getStatus(handleRef.current)
      if (status) {
        setCurrentThreshold(status.currentThreshold)
        setNoiseFloor(status.noiseFloor)
        setAdaptiveEnabled(status.adaptiveEnabled)
      }
    } catch {}
  }, [])

  const start = useCallback(
    async (options = {}) => {
      if (!window.electronAPI?.mic) {
        setError('electronAPI.mic 不可用')
        return false
      }
      try {
        const {
          sampleRate = 16000,
          frameMs = 20,
          threshold = 0.02,
          silenceMs = 700,
          minSpeechMs = 300,
        } = options
        console.log('[useMic] starting mic...')
        setLoading(true) // 首次使用时加载 ASR 模型，显示加载提示
        const handle = await window.electronAPI.mic.start(
          sampleRate,
          frameMs,
          modelPath || '',
          { threshold, silenceMs, minSpeechMs }
        )
        console.log('[useMic] mic started, handle:', handle)
        handleRef.current = handle
        setActive(true)
        setLoading(false)
        setError(null)
        setTranscript('')
        setPartialTranscript('')

        // 启用自适应阈值
        if (adaptiveThreshold) {
          await window.electronAPI.mic.setAdaptiveThreshold(handle, true)
          console.log('[useMic] 自适应阈值已启用')
        }

        // 定期获取状态
        statusTimerRef.current = setInterval(pollStatus, 1000)

        window.electronAPI.mic.onFrame((frame) => {
          setVolume(frame.rms)
          setIsSpeaking(frame.isSpeech)
          onFrame?.(frame)
        })
        window.electronAPI.mic.onAsr((text) => {
          console.log('[useMic] asr:', text)
          setTranscript(text)
          setPartialTranscript('') // 最终结果出来后清空中间结果
          onAsr?.(text)
        })
        window.electronAPI.mic.onAsrPartial((text) => {
          console.log('[useMic] asr partial:', text)
          setPartialTranscript(text)
          onAsrPartial?.(text)
        })
        window.electronAPI.mic.onError((msg) => {
          console.warn('[useMic] error:', msg)
          setError(msg)
          onError?.(msg)
        })
        return true
      } catch (e) {
        setError(e.message || String(e))
        return false
      }
    },
    [modelPath, onFrame, onAsr, onError, adaptiveThreshold, pollStatus],
  )

  const stop = useCallback(async () => {
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current)
      statusTimerRef.current = null
    }
    if (handleRef.current !== null) {
      try {
        await window.electronAPI?.mic.stop(handleRef.current)
        await window.electronAPI?.mic.destroy(handleRef.current)
      } catch {}
      handleRef.current = null
    }
    window.electronAPI?.mic.removeListeners?.()
    setActive(false)
    setVolume(0)
    setIsSpeaking(false)
  }, [])

  // 切换自适应阈值
  const setAdaptive = useCallback(async (enabled) => {
    if (handleRef.current !== null) {
      try {
        await window.electronAPI?.mic.setAdaptiveThreshold(handleRef.current, enabled)
        setAdaptiveEnabled(enabled)
      } catch {}
    }
  }, [])

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return {
    volume,
    isSpeaking,
    transcript,
    partialTranscript, // 中间识别结果（流式 ASR）
    active,
    loading, // 麦克风启动中（首次使用时加载 ASR 模型）
    error,
    currentThreshold,
    noiseFloor,
    adaptiveEnabled,
    start,
    stop,
    setAdaptive,
  }
}
