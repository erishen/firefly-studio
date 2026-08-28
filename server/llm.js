/**
 * 轻量 LLM 适配器 — 调用任意 OpenAI 兼容 /chat/completions 接口。
 * 支持流式输出，返回 async generator。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 从项目根 .env 读取配置（用 process.cwd() 而非 __dirname，因为 electron-vite 打包后 __dirname 会变）
function loadEnv() {
  const envPath = resolve(process.cwd(), '.env')
  try {
    const content = readFileSync(envPath, 'utf-8')
    const env = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim()
        let val = trimmed.slice(eq + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        env[key] = val
      }
    }
    return env
  } catch {
    return {}
  }
}

const env = { ...process.env, ...loadEnv() }

export const LLM_CONFIG = {
  apiKey: env.LLM_API_KEY || env.OPENAI_API_KEY || '',
  baseURL: env.LLM_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: env.LLM_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
  temperature: parseFloat(env.LLM_TEMPERATURE || '0.7'),
  maxTokens: parseInt(env.LLM_MAX_TOKENS || '2048', 10),
}

/**
 * 流式调用 LLM，返回 async generator，yield 文本增量。
 */
export async function* streamChat(messages, options = {}) {
  const {
    apiKey = LLM_CONFIG.apiKey,
    baseURL = LLM_CONFIG.baseURL,
    model = options.model || LLM_CONFIG.model,
    temperature = LLM_CONFIG.temperature,
    maxTokens = LLM_CONFIG.maxTokens,
    systemPrompt,
    signal,
  } = options

  if (!apiKey) {
    throw new Error('LLM_API_KEY 未配置，请在 .env 中设置')
  }

  const finalMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  const resp = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta
        if (!delta) continue
        // 只输出最终答案 content，忽略推理模型的思考过程 reasoning_content
        if (delta.content) yield delta.content
      } catch {
        // 忽略解析错误
      }
    }
  }
}
