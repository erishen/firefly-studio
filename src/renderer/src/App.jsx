import React, { useEffect, useState, useCallback } from 'react'

// 判断渲染进程是否能访问 preload 暴露的 API
const hasNative = typeof window !== 'undefined' && !!window.electronAPI

export default function App() {
  const [nativeLoaded, setNativeLoaded] = useState(hasNative)
  const [testResult, setTestResult] = useState(null)
  const [audioHandle, setAudioHandle] = useState(null)
  const [asrHandle, setAsrHandle] = useState(null)
  const [threshold, setThreshold] = useState(0.05)
  const [log, setLog] = useState([])

  const pushLog = useCallback((msg) => {
    setLog((prev) => [...prev.slice(-50), `${new Date().toLocaleTimeString()}  ${msg}`])
  }, [])

  // 原生自检
  const runNativeTest = useCallback(async () => {
    if (!window.electronAPI) {
      pushLog('❌ 渲染进程拿不到 electronAPI（preload 未注入）')
      return
    }
    try {
      const r = await window.electronAPI.nativeTest(5000)
      pushLog(`✅ C++ 原生模块自检通过：${r.elapsedMs}ms，avgRms=${r.avgRms.toFixed(4)}`)
      setTestResult(r)
    } catch (e) {
      pushLog(`❌ 原生自检失败：${e.message}`)
    }
  }, [pushLog])

  // 音频引擎：创建 + 喂一段合成 PCM + 计算能量
  const runAudioTest = useCallback(async () => {
    if (!window.electronAPI) {
      pushLog('❌ 无 electronAPI')
      return
    }
    try {
      const handle = await window.electronAPI.audio.create(16000)
      setAudioHandle(handle)
      pushLog(`✅ 创建 AudioEngine handle=${handle}`)

      // 合成 100ms 的 PCM：一半静音，一半有声音，观察 RMS 差异
      const silent = new Int16Array(800)
      const loud = new Int16Array(800).fill(8000)
      const rmsSilent = await window.electronAPI.audio.feedRms(handle, silent.buffer)
      const speech = await window.electronAPI.audio.isSpeech(handle, loud.buffer)
      const rmsLoud = await window.electronAPI.audio.feedRms(handle, loud.buffer)
      pushLog(`🔇 静音帧 RMS=${rmsSilent.toFixed(4)}`)
      pushLog(`🔊 有声帧 RMS=${rmsLoud.toFixed(4)}，isSpeech=${speech}`)
    } catch (e) {
      pushLog(`❌ 音频测试失败：${e.message}`)
    }
  }, [pushLog])

  // 调阈值
  const applyThreshold = useCallback(async () => {
    if (!audioHandle || !window.electronAPI) return
    await window.electronAPI.audio.setThreshold(audioHandle, threshold)
    pushLog(`🎚️ 已设置 speech threshold=${threshold}`)
  }, [audioHandle, threshold, pushLog])

  // ASR 客户端：模拟喂入 PCM，观察流式"识别"
  const runAsrTest = useCallback(async () => {
    if (!window.electronAPI) {
      pushLog('❌ 无 electronAPI')
      return
    }
    try {
      const handle = await window.electronAPI.asr.create('wss://example.com/asr', 'demo-token')
      setAsrHandle(handle)
      await window.electronAPI.asr.start(handle, 16000)
      pushLog('🎤 ASR 客户端已启动（占位实现）')

      // 喂 3 秒 PCM（每 100ms 一帧）
      const frame = new Int16Array(1600).fill(4000)
      for (let i = 0; i < 30; i++) {
        const text = await window.electronAPI.asr.feed(handle, frame.buffer)
        if (text) pushLog(`📝 流式: ${text}`)
      }
      const final = await window.electronAPI.asr.finalize(handle)
      pushLog(`✅ ASR finalize: ${final}`)
    } catch (e) {
      pushLog(`❌ ASR 测试失败：${e.message}`)
    }
  }, [pushLog])

  return (
    <div className="app">
      <header className="header">
        <h1>Firefly Studio <span className="badge">骨架 v0.1</span></h1>
        <p>Electron + React + three.js + C++ 原生模块（node-addon-api，可调试）</p>
      </header>

      <div className="status-bar">
        <span className={nativeLoaded ? 'ok' : 'err'}>
          {nativeLoaded ? '● C++ 原生模块已注入' : '○ 未检测到 electronAPI'}
        </span>
      </div>

      <main className="main">
        <section className="panel">
          <h2>1. C++ 原生自检</h2>
          <p>在主进程调用 firefly_native.node，跑 5000 次能量计算，验证链路通。</p>
          <button onClick={runNativeTest}>运行自检</button>
        </section>

        <section className="panel">
          <h2>2. 音频引擎（AudioEngine）</h2>
          <p>创建 C++ AudioEngine，喂合成 PCM，计算 RMS 能量 + VAD 判断。</p>
          <div className="row">
            <button onClick={runAudioTest}>创建并测试</button>
            <label>
              阈值：
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
              />
              <span>{threshold.toFixed(2)}</span>
            </label>
            <button onClick={applyThreshold} disabled={!audioHandle}>应用阈值</button>
          </div>
        </section>

        <section className="panel">
          <h2>3. ASR 客户端骨架</h2>
          <p>创建 C++ AsrClient，模拟流式喂 PCM，观察"识别"输出（占位实现）。</p>
          <button onClick={runAsrTest}>运行 ASR 模拟</button>
        </section>

        <section className="panel log-panel">
          <h2>运行日志</h2>
          <div className="log">
            {log.length === 0 ? (
              <span className="dim">（空）点击上方按钮开始</span>
            ) : (
              log.map((l, i) => <div key={i} className="log-line">{l}</div>)
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
