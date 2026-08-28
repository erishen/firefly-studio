import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * 麦克风采集 hook — 通过 C++ CoreAudio 采集 + VAD。
 * - volume: 当前音量（0~1）
 * - isSpeaking: 是否检测到语音
 * - start/stop: 开始/停止采集
 *
 * 注意：当前只有音量 + VAD，没有 ASR（语音转文字）。
 * VAD 可用于检测说话开始/结束，后续接入 ASR 后可自动发送。
 */
export function useMic({ onFrame, onError } = {}) {
  const [volume, setVolume] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
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
        const { sampleRate = 16000, frameMs = 20, threshold = 0.02 } = options
        const handle = await window.electronAPI.mic.start(sampleRate, frameMs, threshold)
        handleRef.current = handle
        setActive(true)
        setError(null)

        window.electronAPI.mic.onFrame((frame) => {
          setVolume(frame.rms)
          setIsSpeaking(frame.isSpeech)
          onFrame?.(frame)
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
    [onFrame, onError],
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

  return { volume, isSpeaking, active, error, start, stop }
}
