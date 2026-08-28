import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * 麦克风采集 hook — C++ CoreAudio 采集 + VAD + Whisper 本地 ASR。
 * - volume: 当前音量（0~1）
 * - isSpeaking: 是否检测到语音
 * - transcript: ASR 识别结果（说话结束后自动填充）
 * - start/stop: 开始/停止采集
 */
export function useMic({ modelPath, onFrame, onAsr, onError } = {}) {
  const [volume, setVolume] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [active, setActive] = useState(false)
  const [error, setError] = useState(null)
  const handleRef = useRef(null)

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
        const handle = await window.electronAPI.mic.start(
          sampleRate,
          frameMs,
          modelPath || '',
          { threshold, silenceMs, minSpeechMs }
        )
        handleRef.current = handle
        setActive(true)
        setError(null)
        setTranscript('')

        window.electronAPI.mic.onFrame((frame) => {
          setVolume(frame.rms)
          setIsSpeaking(frame.isSpeech)
          onFrame?.(frame)
        })
        window.electronAPI.mic.onAsr((text) => {
          setTranscript(text)
          onAsr?.(text)
        })
        window.electronAPI.mic.onError((msg) => {
          setError(msg)
          onError?.(msg)
        })
        return true
      } catch (e) {
        setError(e.message || String(e))
        return false
      }
    },
    [modelPath, onFrame, onAsr, onError],
  )

  const stop = useCallback(async () => {
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

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return { volume, isSpeaking, transcript, active, error, start, stop }
}
