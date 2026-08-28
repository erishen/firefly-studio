import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Stage from './components/Stage'
import { useResolveChat } from './hooks/useResolveChat'
import { useMic } from './hooks/useMic'

const hasNative = typeof window !== 'undefined' && !!window.electronAPI

const MODELS = [
  { key: 'firefly', label: '萤火女仆 (VRM)' },
  { key: 'vrm', label: 'VRoid (VRM)' },
  { key: 'avaturn', label: 'Avaturn (GLB)' },
  { key: 'rpm', label: 'RPM (GLB)' },
]

export default function App() {
  const [nativeLoaded] = useState(hasNative)
  const [audioHandle, setAudioHandle] = useState(null)
  const [asrHandle, setAsrHandle] = useState(null)
  const [threshold, setThreshold] = useState(0.05)
  const [log, setLog] = useState([])
  const [modelSource, setModelSource] = useState('firefly')
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeTab, setActiveTab] = useState('chat') // 'chat' | 'native'
  const [input, setInput] = useState('')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const speakingRef = useRef(false)
  const [bubble, setBubble] = useState({ text: '', visible: false, who: 'ai' })

  // 麦克风采集（C++ CoreAudio + VAD）
  const mic = useMic()

  const chat = useResolveChat({
    endpoint: 'http://127.0.0.1:8787',
    systemPrompt: '你是 Firefly，一个友好的数字人助手。回答简洁自然，口语化。',
  })

  // 聊天回复联动数字人：说话时 speakingRef=true，显示气泡
  chat.onDeltaRef.current = (text) => {
    if (text) {
      speakingRef.current = true
      setBubble({ text, visible: true, who: 'ai' })
    }
  }
  chat.onDoneRef.current = () => {
    // 如果开启了语音，朗读最终回复
    if (voiceEnabled && chat.messages.length > 0) {
      const lastMsg = chat.messages[chat.messages.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        speak(lastMsg.content)
      } else {
        speakingRef.current = false
      }
    } else {
      speakingRef.current = false
    }
  }

  // TTS 语音合成
  const speak = useCallback((text) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1.0
    utterance.pitch = 1.0
    // 优先选中文语音
    const voices = window.speechSynthesis.getVoices()
    const zhVoice = voices.find((v) => v.lang.startsWith('zh'))
    if (zhVoice) utterance.voice = zhVoice
    utterance.onstart = () => { speakingRef.current = true }
    utterance.onend = () => { speakingRef.current = false }
    utterance.onerror = () => { speakingRef.current = false }
    window.speechSynthesis.speak(utterance)
  }, [])

  const pushLog = useCallback((msg) => {
    setLog((prev) => [...prev.slice(-50), `${new Date().toLocaleTimeString()}  ${msg}`])
  }, [])

  const handleSend = useCallback(() => {
    if (!input.trim() || chat.streaming) return
    const text = input.trim()
    setInput('')
    chat.send(text)
  }, [input, chat])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // 点击数字人：触发说话动画 + 气泡
  const handleAvatarClick = useCallback(() => {
    if (chat.streaming) return
    speakingRef.current = true
    setBubble({ text: '你好！在下方输入框和我聊天吧～', visible: true, who: 'ai' })
    setTimeout(() => {
      speakingRef.current = false
      setBubble({ text: '', visible: false, who: 'ai' })
    }, 3000)
  }, [chat.streaming])

  // C++ 原生自检
  const runNativeTest = useCallback(async () => {
    if (!window.electronAPI) {
      pushLog('❌ 渲染进程拿不到 electronAPI（preload 未注入）')
      return
    }
    try {
      const r = await window.electronAPI.nativeTest(5000)
      pushLog(`✅ C++ 原生模块自检通过：${r.elapsedMs}ms，avgRms=${r.avgRms.toFixed(4)}`)
    } catch (e) {
      pushLog(`❌ 原生自检失败：${e.message}`)
    }
  }, [pushLog])

  // 音频引擎测试
  const runAudioTest = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const handle = await window.electronAPI.audio.create(16000)
      setAudioHandle(handle)
      pushLog(`✅ 创建 AudioEngine handle=${handle}`)
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

  const applyThreshold = useCallback(async () => {
    if (!audioHandle || !window.electronAPI) return
    await window.electronAPI.audio.setThreshold(audioHandle, threshold)
    pushLog(`🎚️ 已设置 speech threshold=${threshold}`)
  }, [audioHandle, threshold, pushLog])

  // ASR 测试
  const runAsrTest = useCallback(async () => {
    if (!window.electronAPI) return
    try {
      const handle = await window.electronAPI.asr.create('wss://example.com/asr', 'demo-token')
      setAsrHandle(handle)
      await window.electronAPI.asr.start(handle, 16000)
      pushLog('🎤 ASR 客户端已启动（占位实现）')
      const frame = new Int16Array(1600).fill(4000)
      for (let i = 0; i < 10; i++) {
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
      {/* 3D 数字人主视图 */}
      <div className="avatar-canvas">
        <Canvas
          camera={{ position: [0, 1.5, 4.5], fov: 40 }}
          shadows
          gl={{ antialias: true, alpha: true }}
        >
          <Stage
            speakingRef={speakingRef}
            bubble={bubble}
            onClick={handleAvatarClick}
            modelSource={modelSource}
          />
          <OrbitControls
            enablePan={false}
            minDistance={2.5}
            maxDistance={8}
            target={[0, 1.2, 0]}
          />
        </Canvas>

        {/* 模型切换器 */}
        <div className="model-switcher">
          {MODELS.map((m) => (
            <button
              key={m.key}
              className={modelSource === m.key ? 'active' : ''}
              onClick={() => setModelSource(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* 状态条 */}
        <div className="status-bar">
          <span className={nativeLoaded ? 'ok' : 'err'}>
            {nativeLoaded ? '● C++ 原生模块已注入' : '○ 未检测到 electronAPI'}
          </span>
          <span className={chat.streaming ? 'ok' : 'dim'} style={{ marginLeft: 12 }}>
            {chat.streaming ? '● 回复中...' : '○ 空闲'}
          </span>
        </div>
      </div>

      {/* 右侧面板 */}
      <div className={`side-panel ${panelOpen ? 'open' : 'closed'}`}>
        <button className="panel-toggle" onClick={() => setPanelOpen(!panelOpen)}>
          {panelOpen ? '›' : '‹'}
        </button>

        {panelOpen && (
          <div className="panel-content">
            <h2>Firefly Studio</h2>
            <p className="subtitle">数字人 + resolve-studio agent loop</p>

            {/* Tab 切换 */}
            <div className="tabs">
              <button
                className={activeTab === 'chat' ? 'active' : ''}
                onClick={() => setActiveTab('chat')}
              >
                聊天
              </button>
              <button
                className={activeTab === 'native' ? 'active' : ''}
                onClick={() => setActiveTab('native')}
              >
                C++ 测试
              </button>
            </div>

            {activeTab === 'chat' && (
              <div className="chat-panel">
                <div className="chat-messages">
                  {chat.messages.length === 0 && (
                    <span className="dim">和数字人聊聊吧～（需先启动 resolve-studio 后端 :8787）</span>
                  )}
                  {chat.messages.map((m, i) => (
                    <div key={i} className={`chat-msg ${m.role}`}>
                      <div className="chat-role">{m.role === 'user' ? '你' : 'Firefly'}</div>
                      <div className="chat-content">{m.content || (chat.streaming && i === chat.messages.length - 1 ? '...' : '')}</div>
                    </div>
                  ))}
                </div>
                {chat.error && <div className="chat-error">❌ {chat.error}</div>}
                <div className="chat-input-row">
                  <textarea
                    className="chat-input"
                    placeholder="输入消息，Enter 发送..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    disabled={chat.streaming}
                  />
                  {chat.streaming ? (
                    <button className="chat-stop" onClick={() => { chat.stop(); window.speechSynthesis?.cancel() }}>停止</button>
                  ) : (
                    <button className="chat-send" onClick={handleSend} disabled={!input.trim()}>发送</button>
                  )}
                  <button
                    className={`mic-btn ${mic.active ? 'active' : ''}`}
                    onClick={() => mic.active ? mic.stop() : mic.start({ threshold: 0.02 })}
                    title={mic.active ? '停止麦克风' : '开启麦克风'}
                  >
                    {mic.active ? '🎙️' : '🎤'}
                  </button>
                </div>
                {/* 麦克风音量 + VAD 状态 */}
                {mic.active && (
                  <div className="mic-status">
                    <div className="mic-volume-bar">
                      <div
                        className="mic-volume-fill"
                        style={{ width: `${Math.min(100, mic.volume * 500)}%` }}
                      />
                    </div>
                    <span className={`mic-vad ${mic.isSpeaking ? 'speaking' : ''}`}>
                      {mic.isSpeaking ? '● 说话中' : '○ 静音'}
                    </span>
                  </div>
                )}
                {mic.error && <div className="chat-error">🎤 {mic.error}</div>}
                <div className="chat-actions">
                  <button className="chat-clear" onClick={() => { chat.clear(); window.speechSynthesis?.cancel() }}>清空对话</button>
                  <button
                    className={`chat-voice ${voiceEnabled ? 'on' : 'off'}`}
                    onClick={() => {
                      setVoiceEnabled(!voiceEnabled)
                      if (voiceEnabled) window.speechSynthesis?.cancel()
                    }}
                  >
                    {voiceEnabled ? '🔊 语音开' : '🔇 语音关'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'native' && (
              <>
                <section className="panel">
                  <h3>1. C++ 原生自检</h3>
                  <p>调用 firefly_native.node 跑 5000 次能量计算。</p>
                  <button onClick={runNativeTest}>运行自检</button>
                </section>

                <section className="panel">
                  <h3>2. 音频引擎</h3>
                  <p>创建 AudioEngine，喂合成 PCM，计算 RMS + VAD。</p>
                  <div className="row">
                    <button onClick={runAudioTest}>创建并测试</button>
                  </div>
                  <div className="row">
                    <label>
                      阈值：
                      <input
                        type="range" min="0" max="0.5" step="0.01"
                        value={threshold}
                        onChange={(e) => setThreshold(parseFloat(e.target.value))}
                      />
                      <span>{threshold.toFixed(2)}</span>
                    </label>
                    <button onClick={applyThreshold} disabled={!audioHandle}>应用</button>
                  </div>
                </section>

                <section className="panel">
                  <h3>3. ASR 客户端</h3>
                  <p>创建 AsrClient，模拟流式喂 PCM（占位实现）。</p>
                  <button onClick={runAsrTest}>运行 ASR 模拟</button>
                </section>

                <section className="panel log-panel">
                  <h3>运行日志</h3>
                  <div className="log">
                    {log.length === 0 ? (
                      <span className="dim">（空）点击按钮开始</span>
                    ) : (
                      log.map((l, i) => <div key={i} className="log-line">{l}</div>)
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
