/**
 * 独立启动内置后端（不启动 Electron）。
 * 用于前端调试或单独测试 /api/chat 接口。
 * 用法：node server/standalone.js
 */
import { startServer } from './index.js'

const port = parseInt(process.env.SERVER_PORT || '8787', 10)
const host = process.env.SERVER_HOST || '127.0.0.1'

const server = startServer({ port, host })

process.on('SIGINT', () => {
  console.log('\n[firefly-server] 正在关闭...')
  server.close(() => process.exit(0))
})
