// 主进程入口。
// 职责：
//   1. 创建 BrowserWindow
//   2. 加载 C++ 原生模块（firefly_native.node）
//   3. 通过 IPC 把 C++ 能力桥接给渲染进程

import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ---- 禁用 Chromium 联网组件（避免大陆网络下 SSL 握手错误刷屏）----
// 这些组件（自动更新、安全浏览、组件更新）在无外网时会反复报 SSL handshake failed
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,NetworkServiceInProcess')
app.commandLine.appendSwitch('safebrowsing-disable-auto-update')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-background-networking')
// 忽略证书错误（开发期；生产环境应移除）
app.commandLine.appendSwitch('ignore-certificate-errors')

// ---- 加载 C++ 原生模块 ----
// 开发期在 native/build/Debug/firefly_native.node；electron-vite 会把主进程
// 产物输出到 out/main。这里用 createRequire 解析绝对路径。
let nativeMod = null
function loadNative() {
  if (nativeMod) return nativeMod
  // 多种定位方式兜底：
  // 1) 相对当前模块（dev 时 out/main，实际文件在源码树里）
  // 2) 相对 app 根目录
  // 3) 相对 cwd
  const baseDirs = [
    dirname(fileURLToPath(import.meta.url)), // out/main（源码树内）
    app.getAppPath(), // app 根
    process.cwd(),
  ]
  const candidates = []
  // 相对 out/main 时 native 在 ../../native；相对 app 根 / cwd 时在 native/
  candidates.push(join(baseDirs[0], '../../native/build/Release/firefly_native.node'))
  candidates.push(join(baseDirs[0], '../../native/build/Debug/firefly_native.node'))
  for (const base of baseDirs.slice(1)) {
    candidates.push(join(base, 'native/build/Release/firefly_native.node'))
    candidates.push(join(base, 'native/build/Debug/firefly_native.node'))
  }
  const errors = []
  for (const p of candidates) {
    try {
      nativeMod = require(p)
      console.log('[native] 已加载 C++ 模块 @', p)
      return nativeMod
    } catch (e) {
      errors.push(`${p}: ${e.code || e.message}`)
    }
  }
  throw new Error(
    'firefly_native.node 未找到，请先执行: npm run native:build。\n尝试过的路径:\n' +
      errors.slice(0, 4).join('\n')
  )
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Electron Avatar',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // 开发模式加载 dev server，生产加载打包产物
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

// ---- IPC：把 C++ 能力暴露给渲染进程 ----
function registerIpc() {
  // 原生模块自检
  ipcMain.handle('native:test', (_e, loops) => {
    const mod = loadNative()
    return mod.test(loops || 1000)
  })

  // 把 IPC 传来的 ArrayBuffer / Uint8Array 转成 Node Buffer（C++ 模块需要 Buffer）
  const toBuffer = (buf) => {
    if (Buffer.isBuffer(buf)) return buf
    if (buf instanceof ArrayBuffer) return Buffer.from(buf)
    if (buf?.buffer instanceof ArrayBuffer) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
    if (ArrayBuffer.isView(buf)) return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
    return buf
  }

  // 音频引擎
  ipcMain.handle('audio:create', (_e, sampleRate) => {
    return loadNative().audio.create(sampleRate || 16000)
  })
  ipcMain.handle('audio:feedRms', (_e, handle, buf) => {
    return loadNative().audio.feedRms(handle, toBuffer(buf))
  })
  ipcMain.handle('audio:isSpeech', (_e, handle, buf) => {
    return loadNative().audio.isSpeech(handle, toBuffer(buf))
  })
  ipcMain.handle('audio:setThreshold', (_e, handle, t) => {
    return loadNative().audio.setThreshold(handle, t)
  })
  ipcMain.handle('audio:destroy', (_e, handle) => {
    return loadNative().audio.destroy(handle)
  })

  // ASR 客户端
  ipcMain.handle('asr:create', (_e, address, token) => {
    return loadNative().asr.create(address || '', token || '')
  })
  ipcMain.handle('asr:start', (_e, handle, sampleRate) => {
    return loadNative().asr.start(handle, sampleRate || 16000)
  })
  ipcMain.handle('asr:feed', (_e, handle, buf) => {
    return loadNative().asr.feed(handle, toBuffer(buf))
  })
  ipcMain.handle('asr:finalize', (_e, handle) => {
    return loadNative().asr.finalize(handle)
  })
  ipcMain.handle('asr:destroy', (_e, handle) => {
    return loadNative().asr.destroy(handle)
  })
}

app.whenReady().then(() => {
  // 提前加载原生模块，启动即验证
  try {
    loadNative()
  } catch (e) {
    console.warn('[native] 启动时加载失败：', e.message)
  }
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
