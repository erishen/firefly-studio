import { useRef, useState, useCallback, useEffect } from 'react'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787'
const STORAGE_KEY = 'firefly_chat_history'
const MAX_HISTORY_MESSAGES = 100 // 最多保存 100 条消息

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number // 消息时间戳
}

export interface UseResolveChatOptions {
  endpoint?: string
  model?: string
  systemPrompt?: string
  persistHistory?: boolean // 是否持久化历史记录，默认 true
}

// 从 localStorage 加载历史消息
function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const messages = JSON.parse(raw)
    if (Array.isArray(messages)) {
      return messages.slice(-MAX_HISTORY_MESSAGES)
    }
    return []
  } catch (e) {
    console.warn('[Chat] 加载历史记录失败:', e)
    return []
  }
}

// 保存历史消息到 localStorage
function saveHistory(messages: ChatMessage[]) {
  try {
    const toSave = messages.slice(-MAX_HISTORY_MESSAGES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch (e) {
    console.warn('[Chat] 保存历史记录失败:', e)
  }
}

/**
 * 调用 resolve-studio 的 /api/chat SSE 接口。
 * - 发送 messages，接收 SSE 流
 * - delta 事件累积为 assistant 回复
 * - done 事件结束
 */
export function useResolveChat(options: UseResolveChatOptions = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT
  const persistHistory = options.persistHistory !== false // 默认开启持久化
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    // 初始化时从 localStorage 加载历史记录
    return persistHistory ? loadHistory() : []
  })
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onDeltaRef = useRef<((text: string) => void) | null>(null)
  const onDoneRef = useRef<((fullText: string) => void) | null>(null)
  const onToolCallRef = useRef<((toolName: string, toolArgs: any) => void) | null>(null)
  const onToolResultRef = useRef<((toolName: string, result: any) => void) | null>(null)

  // 消息变化时保存到 localStorage
  useEffect(() => {
    if (persistHistory && messages.length > 0) {
      saveHistory(messages)
    }
  }, [messages, persistHistory])

  const send = useCallback(
    async (userText: string) => {
      if (!userText.trim() || streaming) return
      setError(null)

      const userMsg: ChatMessage = { role: 'user', content: userText, timestamp: Date.now() }
      const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() }
      const newMessages = [...messages, userMsg, assistantMsg]
      setMessages(newMessages)
      setStreaming(true)
      onDeltaRef.current?.('')

      const ac = new AbortController()
      abortRef.current = ac
      let accumulated = ''

      try {
        let resp: Response
        const requestBody = {
          messages: [...messages, userMsg],
          model: options.model,
          systemPrompt: options.systemPrompt,
        }
        console.log('[Chat] 发送请求到:', `${endpoint}/api/chat`)
        console.log('[Chat] 请求体:', JSON.stringify(requestBody).slice(0, 200))
        try {
          resp = await fetch(`${endpoint}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: ac.signal,
          })
        } catch (e: any) {
          console.error('[Chat] fetch 失败:', e.message, e.name)
          if (e.name === 'AbortError') throw e
          throw new Error(`无法连接 resolve-studio 后端 (${endpoint})，请确认后端已启动。错误: ${e.message}`)
        }

        console.log('[Chat] 响应状态:', resp.status, resp.statusText)
        console.log('[Chat] 响应头:', Object.fromEntries(resp.headers.entries()))

        if (!resp.ok) {
          const errorText = await resp.text().catch(() => '')
          console.error('[Chat] HTTP 错误:', resp.status, errorText)
          throw new Error(`HTTP ${resp.status}: ${errorText || resp.statusText}`)
        }

        const reader = resp.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let eventCount = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('[Chat] SSE 流结束，共收到', eventCount, '个事件，累积文字长度:', accumulated.length)
            break
          }
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          let event = ''
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              data = line.slice(5).trim()
            } else if (line === '' && event && data) {
              try {
                const payload = JSON.parse(data)
                eventCount++
                // 只打印关键事件，避免日志过多
                if (event === 'delta' || event === 'done' || event === 'error') {
                  console.log(`[Chat] 收到事件: ${event}`, JSON.stringify(payload).slice(0, 100))
                }
                // 只处理数字人需要的事件：delta（文字）、done（完成）、error（错误）
                // 其他事件（step、tool-call、tool-result、reasoning、usage 等）直接忽略
                if (event === 'delta') {
                  const text = payload.text || ''
                  if (accumulated === '') {
                    accumulated = text.trimStart()
                  } else {
                    accumulated += text
                  }
                  // 合并多余的换行符：连续 2 个以上换行符合并成 1 个，避免空行
                  accumulated = accumulated.replace(/\n{2,}/g, '\n')
                  setMessages((prev) => {
                    const next = [...prev]
                    next[next.length - 1] = { role: 'assistant', content: accumulated }
                    return next
                  })
                  onDeltaRef.current?.(accumulated)
                } else if (event === 'done') {
                  console.log('[Chat] done 事件，answer:', payload.answer?.slice(0, 100), 'accumulated:', accumulated?.slice(0, 100))
                  if (payload.answer && !accumulated) {
                    accumulated = payload.answer.trimStart()
                    // 同样合并多余的换行符
                    accumulated = accumulated.replace(/\n{2,}/g, '\n')
                    setMessages((prev) => {
                      const next = [...prev]
                      next[next.length - 1] = { role: 'assistant', content: accumulated }
                      return next
                    })
                  }
                } else if (event === 'error') {
                  console.error('[Chat] error 事件:', payload.message)
                  throw new Error(payload.message || 'Unknown error')
                } else if (event === 'tool-call') {
                  // 工具调用事件：通知上层触发提示语
                  // 兼容多种格式：resolve-studio 可能发送 { payload: { call, ... } } 或 { toolName, ... }
                  const inner = payload.payload || payload
                  const toolName = inner.call?.name || inner.toolName || inner.name || 'unknown'
                  const toolArgs = inner.call?.arguments || inner.args || inner.arguments || {}
                  console.log('[Chat] 工具调用:', toolName)
                  onToolCallRef.current?.(toolName, toolArgs)
                } else if (event === 'tool-result') {
                  // 工具结果事件：通知上层触发过渡语
                  // 兼容多种格式：resolve-studio 发送 { payload: { call, result, ok, durationMs } }
                  const inner = payload.payload || payload
                  const toolName = inner.call?.name || inner.toolName || inner.name || 'unknown'
                  const result = inner.result || inner.output || {}
                  console.log('[Chat] 工具结果:', toolName, 'ok:', inner.ok)
                  onToolResultRef.current?.(toolName, result)
                }
                // 其他事件忽略
              } catch (e) {
                console.warn('[Chat] 解析事件失败:', e, 'event:', event, 'data:', data?.slice(0, 100))
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
        console.log('[Chat] finally 块，调用 onDoneRef:', {
          hasOnDone: !!onDoneRef.current,
          accumulatedLength: accumulated?.length,
          accumulatedPreview: accumulated?.slice(0, 50)
        })
        if (onDoneRef.current) {
          onDoneRef.current(accumulated)
        }
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
    // 清除 localStorage 中的历史记录
    if (persistHistory) {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch (e) {
        console.warn('[Chat] 清除历史记录失败:', e)
      }
    }
  }, [persistHistory])

  // 导出历史记录为 JSON 文件
  const exportHistory = useCallback(() => {
    if (messages.length === 0) return null
    const data = {
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `firefly-chat-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    return true
  }, [messages])

  return { messages, streaming, error, send, stop, clear, exportHistory, onDeltaRef, onDoneRef, onToolCallRef, onToolResultRef }
}
