/**
 * 内置 HTTP 服务器 — 提供 /api/chat SSE 接口，兼容 resolve-studio 前端。
 * 跑在 Electron 主进程里，不需要外部后端。
 */
import { createServer } from 'node:http'
import { streamChat, LLM_CONFIG } from './llm.js'

const DEFAULT_PORT = 8788
const DEFAULT_HOST = '127.0.0.1'

export function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
  const server = createServer(async (req, res) => {
    // CORS（Electron 渲染进程访问本地服务器）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, `http://${req.headers.host}`)

    // GET /api/models — 返回可用模型
    if (url.pathname === '/api/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: [{ id: LLM_CONFIG.model, name: LLM_CONFIG.model }] }))
      return
    }

    // GET /api/pse — PSE 开关状态（占位，始终返回关闭）
    if (url.pathname === '/api/pse' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ enabled: false }))
      return
    }

    // POST /api/chat — SSE 流式聊天
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        let parsed
        try {
          parsed = JSON.parse(body || '{}')
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid JSON body' }))
          return
        }

        const messages = parsed.messages
        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'messages must be a non-empty array' }))
          return
        }

        const ac = new AbortController()
        // SSE 长连接用 res.on('close') 检测客户端断开
        // req.on('close') 会在请求完成时立即触发，导致过早 abort
        res.on('close', () => ac.abort())

        // SSE handshake
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        res.write('retry: 2000\n\n')

        const send = (event, data) => {
          res.write(`event: ${event}\n`)
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        try {
          let answer = ''
          let deltaCount = 0
          for await (const delta of streamChat(messages, {
            model: parsed.model,
            systemPrompt: parsed.systemPrompt,
            signal: ac.signal,
          })) {
            answer += delta
            deltaCount++
            send('delta', { text: delta })
          }
          console.log('[SSE] stream finished, deltaCount:', deltaCount, 'answer length:', answer.length)
          send('done', { answer })
          console.log('[SSE] done event sent')
        } catch (err) {
          console.error('[SSE] stream error:', err.message)
          if (err.name !== 'AbortError') {
            send('error', { message: err.message || String(err) })
          }
        } finally {
          console.log('[SSE] finally, ending response, writableEnded:', res.writableEnded)
          if (!res.writableEnded) res.end()
          console.log('[SSE] response ended')
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })

  server.listen(port, host, () => {
    console.log(`[firefly-server] 内置后端运行在 http://${host}:${port}`)
    console.log(`[firefly-server] LLM: ${LLM_CONFIG.model} @ ${LLM_CONFIG.baseURL}`)
  })

  return server
}
