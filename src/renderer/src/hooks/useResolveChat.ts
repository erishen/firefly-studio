import { useRef, useState, useCallback } from 'react'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface UseResolveChatOptions {
  endpoint?: string
  model?: string
  systemPrompt?: string
}

/**
 * 调用 resolve-studio 的 /api/chat SSE 接口。
 * - 发送 messages，接收 SSE 流
 * - delta 事件累积为 assistant 回复
 * - done 事件结束
 */
export function useResolveChat(options: UseResolveChatOptions = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onDeltaRef = useRef<((text: string) => void) | null>(null)
  const onDoneRef = useRef<(() => void) | null>(null)

  const send = useCallback(
    async (userText: string) => {
      if (!userText.trim() || streaming) return
      setError(null)

      const userMsg: ChatMessage = { role: 'user', content: userText }
      const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
      const newMessages = [...messages, userMsg, assistantMsg]
      setMessages(newMessages)
      setStreaming(true)
      onDeltaRef.current?.('')

      const ac = new AbortController()
      abortRef.current = ac

      try {
        const resp = await fetch(`${endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, userMsg],
            model: options.model,
            systemPrompt: options.systemPrompt,
          }),
          signal: ac.signal,
        })

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`)
        }

        const reader = resp.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let accumulated = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          let event = ''
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              event = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              data = line.slice(6).trim()
            } else if (line === '' && event && data) {
              try {
                const payload = JSON.parse(data)
                if (event === 'delta') {
                  accumulated += payload.text || ''
                  setMessages((prev) => {
                    const next = [...prev]
                    next[next.length - 1] = { role: 'assistant', content: accumulated }
                    return next
                  })
                  onDeltaRef.current?.(accumulated)
                } else if (event === 'done') {
                  if (payload.answer && !accumulated) {
                    accumulated = payload.answer
                    setMessages((prev) => {
                      const next = [...prev]
                      next[next.length - 1] = { role: 'assistant', content: accumulated }
                      return next
                    })
                  }
                } else if (event === 'error') {
                  throw new Error(payload.message || 'Unknown error')
                }
              } catch (e) {
                // 忽略解析错误
              }
              event = ''
              data = ''
            }
          }
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setError(e.message || String(e))
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
        onDoneRef.current?.()
      }
    },
    [messages, streaming, endpoint, options.model, options.systemPrompt],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    setStreaming(false)
  }, [])

  return { messages, streaming, error, send, stop, clear, onDeltaRef, onDoneRef }
}
