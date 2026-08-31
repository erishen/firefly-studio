import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Stage from './components/Stage'
import { SettingsPanel } from './components/SettingsPanel'
import MusicPlayer from './components/MusicPlayer'
import { useResolveChat } from './hooks/useResolveChat'
import { useMic } from './hooks/useMic'
import { createAudioEffectsChain, normalizeVolume } from './utils/audioEffects'

const hasNative = typeof window !== 'undefined' && !!window.electronAPI

// 多数字人角色配置：每个角色有独立的模型、声音、性格、系统提示词
const CHARACTERS = [
  {
    key: 'firefly',
    name: '萤火女仆',
    label: '萤火女仆',
    model: 'firefly',
    voice: 'zh-CN-XiaoxiaoNeural',
    personality: '温柔、贴心、活泼的女仆，喜欢称呼主人为"主人"',
    systemPrompt: '你是萤火，一个温柔贴心的女仆助手。称呼用户为"主人"，回答简洁自然，口语化，带点俏皮。',
    avatar: '👧',
  },
  {
    key: 'assistant',
    name: '专业助手',
    label: '专业助手',
    model: 'firefly',
    voice: 'zh-CN-YunxiNeural',
    personality: '专业、高效、理性的助手，回答精准简洁',
    systemPrompt: '你是一个专业高效的AI助手。回答精准简洁，逻辑清晰，不使用语气词，直接给出答案。',
    avatar: '🤖',
  },
  {
    key: 'friend',
    name: '知心朋友',
    label: '知心朋友',
    model: 'firefly',
    voice: 'zh-CN-XiaoyiNeural',
    personality: '温暖、善解人意的朋友，喜欢倾听和共情',
    systemPrompt: '你是用户的知心朋友。温暖善解人意，喜欢倾听和共情，回答时多用"我懂你的感受"、"没关系的"等安慰性语言。',
    avatar: '🧑‍🤝‍🧑',
  },
  {
    key: 'teacher',
    name: '耐心老师',
    label: '耐心老师',
    model: 'firefly',
    voice: 'zh-CN-YunyangNeural',
    personality: '耐心、严谨、善于讲解的老师，喜欢循序渐进',
    systemPrompt: '你是一个耐心严谨的老师。善于循序渐进地讲解知识，回答时先给结论，再分点解释，最后举例子。称呼用户为"同学"。',
    avatar: '👨‍🏫',
  },
]

const MODELS = [
  { key: 'firefly', label: '萤火女仆 (VRM)' },
]

export default function App() {
  const [nativeLoaded] = useState(hasNative)
  const [modelSource, setModelSource] = useState('firefly')
  const [currentCharacter, setCurrentCharacter] = useState(CHARACTERS[0])
  const [panelOpen, setPanelOpen] = useState(true)
  const [leftPanelWidth, setLeftPanelWidth] = useState(280)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(360)
  const isDraggingRef = useRef(false)
  const dragSideRef = useRef(null) // 'left' or 'right'
  const [input, setInput] = useState('')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [debugInfo, setDebugInfo] = useState('等待消息...')
  const [showAssistantReply, setShowAssistantReply] = useState(true) // 是否展示 LLM 回复（等语音准备好了再展示）
  const speakingRef = useRef(false)
  const [bubble, setBubble] = useState({ text: '', visible: false, who: 'ai' })
  const [audioEnergy, setAudioEnergy] = useState(0) // 实时音频能量，用于口型同步
  const inputRef = useRef(null)
  const chatMessagesRef = useRef(null) // 聊天消息列表 ref，用于自动滚动
  const pttActiveRef = useRef(false) // PTT（按住空格说话）状态
  const currentEnergyIntervalRef = useRef(null) // 当前能量定时器引用
  const toolCallSpokenRef = useRef(false) // 工具调用提示语是否已说过（避免重复）
  const toolResultSpokenRef = useRef(false) // 工具结果过渡语是否已说过（避免重复）
  const pendingAsrMessageRef = useRef(null) // 待发送的 ASR 消息（AI 正在输出时暂存）
  // —— 流式 TTS 相关 ——
  const ttsQueueRef = useRef([]) // 待播放的句子队列
  const ttsPlayingRef = useRef(false) // 是否正在播放 TTS
  const ttsStreamStartedRef = useRef(false) // 流式 TTS 是否已开始
  const ttsLastSentenceEndRef = useRef(0) // 上一个句子结束的位置
  const ttsFullTextRef = useRef('') // LLM 输出的完整文本（用于最后补全）
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appConfig, setAppConfig] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1)
  const [expression, setExpression] = useState('neutral') // 数字人表情：neutral/happy/angry/sad/surprised/relaxed
  const [gesture, setGesture] = useState('idle') // 数字人手势：idle/wave/nod/shake/thinking/heart
  const gestureTimerRef = useRef(null) // 手势自动恢复定时器
  const [theme, setTheme] = useState('dark') // 主题：dark/light/system
  // —— 唱歌功能相关 ——
  const [isSinging, setIsSinging] = useState(false) // 是否正在唱歌
  const [currentSong, setCurrentSong] = useState(null) // 当前播放的歌曲
  const audioContextRef = useRef(null) // Web Audio API 的 AudioContext
  const audioSourceRef = useRef(null) // 音频源节点
  const analyserRef = useRef(null) // 分析器节点（用于获取实时能量）
  const gainNodeRef = useRef(null) // 增益节点
  const singingEnergyIntervalRef = useRef(null) // 唱歌时的能量定时器
  const effectsChainRef = useRef(null) // 音效处理链（均衡器、混响、压缩器等）
  const onSongEndedRef = useRef(null) // 播放结束回调（用于自动切歌）
  const isStartingSongRef = useRef(false) // 播放锁，防止重复启动导致多首同时播放
  const songOriginalVolumeRef = useRef(0.8) // 歌曲原始音量（用于闪避后恢复）
  const isDuckingRef = useRef(false) // 是否正在闪避（TTS 播放时降低歌曲音量）
  const duckingTimeoutRef = useRef(null) // 闪避恢复的定时器

  // —— 主题切换：应用启动时从 localStorage 加载，变化时保存并应用 ——
  useEffect(() => {
    const savedTheme = localStorage.getItem('firefly-theme')
    if (savedTheme) {
      setTheme(savedTheme)
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      setTheme('system')
    }
  }, [])

  useEffect(() => {
    let effectiveTheme = theme
    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    localStorage.setItem('firefly-theme', theme)
  }, [theme])

  // —— 窗口状态记忆：从 localStorage 加载保存的状态 ——
  const [stateLoaded, setStateLoaded] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('firefly-studio-state')
      if (saved) {
        const state = JSON.parse(saved)
        if (state.panelOpen !== undefined) setPanelOpen(state.panelOpen)
        if (state.leftPanelWidth !== undefined) setLeftPanelWidth(state.leftPanelWidth)
        if (state.rightPanelOpen !== undefined) setRightPanelOpen(state.rightPanelOpen)
        if (state.rightPanelWidth !== undefined) setRightPanelWidth(state.rightPanelWidth)
        if (state.voiceEnabled !== undefined) setVoiceEnabled(state.voiceEnabled)
        if (state.modelSource !== undefined) setModelSource(state.modelSource)
        if (state.currentCharacterKey !== undefined) {
          const char = CHARACTERS.find(c => c.key === state.currentCharacterKey)
          if (char) setCurrentCharacter(char)
        }
        console.log('[状态记忆] 已恢复上次状态')
      }
    } catch (e) {
      console.warn('[状态记忆] 恢复状态失败:', e)
    }
    setStateLoaded(true)
  }, [])

  // —— 窗口状态记忆：状态变化时保存到 localStorage ——
  useEffect(() => {
    if (!stateLoaded) return
    try {
      const state = {
        panelOpen,
        leftPanelWidth,
        rightPanelOpen,
        rightPanelWidth,
        voiceEnabled,
        modelSource,
        currentCharacterKey: currentCharacter.key,
      }
      localStorage.setItem('firefly-studio-state', JSON.stringify(state))
    } catch (e) {
      console.warn('[状态记忆] 保存状态失败:', e)
    }
  }, [stateLoaded, panelOpen, leftPanelWidth, rightPanelOpen, rightPanelWidth, voiceEnabled, modelSource, currentCharacter])

  const chat = useResolveChat({
    endpoint: 'http://127.0.0.1:8787',
    model: 'agnes-2.0-flash',
    systemPrompt: currentCharacter.systemPrompt,
  })

  // 麦克风采集（C++ CoreAudio + VAD + Python faster-whisper ASR）
  // modelPath 非空即触发 ASR 线程（实际模型由 Python 服务加载）
  const mic = useMic({
    modelPath: 'native/models/ggml-base.bin',
    onAsr: (text) => {
      console.log('[App] ASR 识别结果:', text, 'streaming:', chat.streaming)
      if (text && text.trim()) {
        const trimmed = text.trim()
        // 如果不在流式输出中，直接发送
        if (!chat.streaming) {
          console.log('[App] 自动发送 ASR 结果')
          chat.send(trimmed)
          setInput('')
          pendingAsrMessageRef.current = null
        } else {
          // AI 正在输出，暂存消息，等输出结束后自动发送
          console.log('[App] AI 正在输出，ASR 结果已暂存，等输出结束后自动发送')
          pendingAsrMessageRef.current = trimmed
          setInput(trimmed)
        }
      }
    },
    onAsrPartial: (text) => {
      // 中间识别结果：实时显示在输入框中，让用户看到识别进度
      console.log('[App] ASR 中间识别结果:', text)
      if (text && text.trim()) {
        setInput(text.trim())
      }
    },
    onError: (err) => {
      console.warn('[App] 麦克风错误:', err)
    },
  })

  // —— 内存占用优化：定期监控内存使用，空闲时清理资源 ——
  useEffect(() => {
    // 内存监控：每 60 秒输出一次内存使用情况
    const memoryInterval = setInterval(() => {
      if (window.performance && window.performance.memory) {
        const mem = window.performance.memory
        const usedMB = Math.round(mem.usedJSHeapSize / 1024 / 1024)
        const totalMB = Math.round(mem.totalJSHeapSize / 1024 / 1024)
        const limitMB = Math.round(mem.jsHeapSizeLimit / 1024 / 1024)
        console.log(`[内存监控] 已用: ${usedMB}MB / 总计: ${totalMB}MB / 限制: ${limitMB}MB`)

        // 内存使用超过 80% 时，自动清理聊天历史（保留最近 50 条）
        if (usedMB / limitMB > 0.8 && chat.messages.length > 50) {
          console.warn('[内存优化] 内存使用过高，自动清理聊天历史')
          // 这里可以调用 chat.clear() 或其他清理方法
        }
      }
    }, 60000)

    // 空闲检测：5 分钟没有用户操作时，停止 ASR 服务（如果麦克风没有在使用）
    let idleTimer = null
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (mic.active) {
          console.log('[内存优化] 检测到长时间空闲，但麦克风仍在使用，不停止 ASR')
        } else {
          console.log('[内存优化] 检测到长时间空闲，ASR 模型已卸载（懒加载模式下自动卸载）')
        }
      }, 5 * 60 * 1000) // 5 分钟
    }

    // 监听用户活动事件
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart']
    activityEvents.forEach(event => {
      window.addEventListener(event, resetIdleTimer)
    })
    resetIdleTimer()

    return () => {
      clearInterval(memoryInterval)
      if (idleTimer) clearTimeout(idleTimer)
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetIdleTimer)
      })
    }
  }, [mic.active, chat.messages.length])

  // 自动滚动聊天消息到底部
  useEffect(() => {
    if (chatMessagesRef.current && !searchOpen) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }, [chat.messages, searchOpen])

  // 搜索历史消息
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setCurrentSearchIndex(-1)
      return
    }

    const query = searchQuery.toLowerCase()
    const results = []
    chat.messages.forEach((msg, index) => {
      if (msg.content && msg.content.toLowerCase().includes(query)) {
        results.push(index)
      }
    })
    setSearchResults(results)
    if (results.length > 0) {
      setCurrentSearchIndex(0)
    } else {
      setCurrentSearchIndex(-1)
    }
  }, [searchQuery, chat.messages])

  // 跳转到指定的搜索结果
  const jumpToSearchResult = useCallback((index) => {
    if (index < 0 || index >= searchResults.length) return
    setCurrentSearchIndex(index)
    const msgIndex = searchResults[index]
    const msgElement = chatMessagesRef.current?.querySelector(`[data-msg-index="${msgIndex}"]`)
    if (msgElement) {
      msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [searchResults])

  // 监听流式输出结束，自动发送暂存的 ASR 消息
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !chat.streaming) {
      // 流式输出刚结束
      const pending = pendingAsrMessageRef.current
      if (pending && pending.trim()) {
        console.log('[App] 流式输出结束，自动发送暂存的 ASR 结果:', pending)
        // 延迟一小段时间，确保状态完全更新
        setTimeout(() => {
          chat.send(pending.trim())
          setInput('')
          pendingAsrMessageRef.current = null
        }, 300)
      }
    }
    wasStreamingRef.current = chat.streaming
  }, [chat.streaming])

  // —— 表情自动切换：根据 AI 回复内容判断情绪 ——
  useEffect(() => {
    if (!chat.messages || chat.messages.length === 0) return
    const lastMsg = chat.messages[chat.messages.length - 1]
    if (lastMsg.role !== 'assistant' || !lastMsg.content) return

    const text = lastMsg.content.toLowerCase()

    // 情绪关键词映射
    const emotionRules = [
      { expr: 'happy', keywords: ['哈哈', '开心', '高兴', '太好了', '棒', '赞', '喜欢', '爱', '😊', '😄', '🎉', '✨'] },
      { expr: 'sad', keywords: ['抱歉', '遗憾', '可惜', '难过', '伤心', '对不起', '😢', '😔', '💔'] },
      { expr: 'surprised', keywords: ['哇', '天哪', '竟然', '居然', '真的吗', '不可思议', '😮', '😲', '❗'] },
      { expr: 'angry', keywords: ['生气', '愤怒', '讨厌', '烦', '糟糕', '😠', '😡', '💢'] },
      { expr: 'relaxed', keywords: ['好的', '没问题', '当然', '可以', '嗯', '哦', '😊', '🙂'] },
    ]

    // 匹配情绪（优先级按顺序）
    let newExpr = 'neutral'
    for (const rule of emotionRules) {
      if (rule.keywords.some((kw) => text.includes(kw))) {
        newExpr = rule.expr
        break
      }
    }

    // 只有表情变化时才更新（避免频繁重渲染）
    setExpression((prev) => (prev === newExpr ? prev : newExpr))

    // —— 手势自动触发（已禁用：用户反馈动作怪怪的，先不要了）——
    // const gestureRules = [
    //   { gesture: 'wave', keywords: ['你好', '嗨', '哈喽', '欢迎', '再见', '拜拜', '👋', 'hello', 'hi'] },
    //   { gesture: 'nod', keywords: ['好的', '没问题', '当然', '可以', '嗯', '对', '是的', '👍', 'ok'] },
    //   { gesture: 'shake', keywords: ['不', '不是', '不行', '不要', '错了', '❌', 'no'] },
    //   { gesture: 'thinking', keywords: ['让我想想', '思考一下', '嗯...', '🤔', '让我看看'] },
    //   { gesture: 'heart', keywords: ['爱你', '喜欢', '❤', '💕', '比心', '❤️'] },
    // ]
    //
    // let newGesture = null
    // for (const rule of gestureRules) {
    //   if (rule.keywords.some((kw) => text.includes(kw))) {
    //     newGesture = rule.gesture
    //     break
    //   }
    // }
    //
    // if (newGesture) {
    //   setGesture(newGesture)
    //   // 手势持续 2 秒后自动恢复 idle
    //   if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current)
    //   gestureTimerRef.current = setTimeout(() => {
    //     setGesture('idle')
    //   }, 2000)
    // }

    // 确保手势始终为 idle（不做任何动作）
    setGesture('idle')
  }, [chat.messages])

  // 面板拖拽调整宽度
  const handleResizeStart = useCallback((side) => (e) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragSideRef.current = side
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleResizeMove = (e) => {
      if (!isDraggingRef.current) return
      if (dragSideRef.current === 'right') {
        const newWidth = window.innerWidth - e.clientX
        // 确保数字人区域至少有 320px 宽度（左侧面板最小 260px + 数字人 320px + 边距）
        const maxRightWidth = window.innerWidth - 260 - 320 - 20
        setRightPanelWidth(Math.max(280, Math.min(Math.max(520, maxRightWidth), newWidth)))
      } else if (dragSideRef.current === 'left') {
        const newWidth = e.clientX
        // 确保数字人区域至少有 320px 宽度
        const maxLeftWidth = window.innerWidth - 320 - 280 - 20
        setLeftPanelWidth(Math.max(260, Math.min(Math.max(320, maxLeftWidth), newWidth)))
      }
    }

    const handleResizeEnd = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        dragSideRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    window.addEventListener('mousemove', handleResizeMove)
    window.addEventListener('mouseup', handleResizeEnd)
    return () => {
      window.removeEventListener('mousemove', handleResizeMove)
      window.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [])

  // TTS 语音合成（优先本地 TTS，回退系统语音）
  const audioRef = useRef(null)
  const ttsStopRef = useRef(false)
  const currentPlayerHandleRef = useRef(null) // CoreAudio 播放器句柄（共享，防止并发播放）
  const speakIdRef = useRef(0) // 每次 speak 调用的唯一 ID，用于取消旧的调用
  const [ttsAvailable, setTtsAvailable] = useState(false)

  useEffect(() => {
    if (window.electronAPI?.tts) {
      window.electronAPI.tts.available().then((v) => {
        console.log('[TTS] available:', v)
        setTtsAvailable(v)
      })
    } else {
      console.log('[TTS] electronAPI.tts not found')
    }
  }, [])

  // 全局快捷键支持
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd+K 聚焦输入框
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }

      // Cmd+B 折叠/展开左侧面板
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setPanelOpen(prev => !prev)
        console.log('[快捷键] 切换左侧面板:', !panelOpen)
        return
      }

      // Cmd+J 折叠/展开右侧面板
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setRightPanelOpen(prev => !prev)
        console.log('[快捷键] 切换右侧面板:', !rightPanelOpen)
        return
      }

      // Cmd+L 切换语音开关
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault()
        setVoiceEnabled(prev => {
          const next = !prev
          console.log('[快捷键] 切换语音:', next ? '开启' : '关闭')
          if (!next) {
            // 关闭语音时停止当前播放
            ttsStopRef.current = true
            if (window.speechSynthesis) window.speechSynthesis.cancel()
          }
          return next
        })
        return
      }

      // Cmd+Shift+D 清空对话
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        if (window.confirm('确定要清空对话记录吗？')) {
          chat.clear()
          console.log('[快捷键] 清空对话')
        }
        return
      }

      // Cmd+, 打开设置
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(prev => !prev)
        console.log('[快捷键] 切换设置面板')
        return
      }

      // Cmd+/ 快捷键帮助
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        const helpText = `
Firefly Studio 快捷键：

⌘K - 聚焦输入框
⌘B - 折叠/展开左侧面板
⌘J - 折叠/展开右侧面板
⌘L - 切换语音开关
⌘⇧D - 清空对话
⌘, - 打开设置
⌘/ - 显示快捷键帮助
空格 - 按住说话（PTT）
Esc - 停止语音播放
        `.trim()
        alert(helpText)
        return
      }

      // Esc 停止 TTS 播放
      if (e.key === 'Escape') {
        ttsStopRef.current = true
        if (audioRef.current) {
          audioRef.current.pause()
          audioRef.current = null
        }
        if (window.speechSynthesis) window.speechSynthesis.cancel()
        window.electronAPI?.tts?.stop?.()
        // 【音频闪避】TTS 被手动停止，恢复歌曲音量
        stopDucking(300)
        return
      }

      // 空格键 PTT（按住说话）- 只在输入框未聚焦时触发
      if (e.code === 'Space' && !e.repeat && document.activeElement !== inputRef.current) {
        e.preventDefault()
        if (!mic.active && !pttActiveRef.current) {
          pttActiveRef.current = true
          console.log('[PTT] 空格按下，启动麦克风')
          mic.start({ threshold: 0.015, silenceMs: 500, minSpeechMs: 300 })
        }
      }
    }

    const handleKeyUp = (e) => {
      // 空格键松开 - 停止麦克风并自动发送识别结果
      if (e.code === 'Space' && pttActiveRef.current) {
        e.preventDefault()
        pttActiveRef.current = false
        console.log('[PTT] 空格松开，停止麦克风')
        const textToSend = input.trim()
        // 延迟一点停止，让 ASR 有时间处理最后一帧
        setTimeout(() => {
          mic.stop()
          // 如果输入框中有内容（中间识别结果），自动发送
          if (textToSend && !chat.streaming) {
            console.log('[PTT] 自动发送识别结果:', textToSend)
            setTimeout(() => {
              setInput('')
              setBubble({ text: '正在思考...', visible: true, who: 'ai' })
              chat.send(textToSend)
            }, 300)
          }
        }, 300)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [mic, panelOpen, rightPanelOpen, chat])

  // 文本分段：按标点符号将长文本分成短句，用于流式播放
  // 优化：降低每段最大字数，降低首字延迟；长文本强制分段走流式播放
  const splitText = useCallback((text) => {
    if (!text || !text.trim()) return []
    const segments = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) || [text]
    const result = []
    let current = ''
    // 每段最大字数（降低到 30，减少单段合成时间，降低首字延迟）
    const MAX_SEGMENT_LENGTH = 30
    for (const seg of segments) {
      const trimmed = seg.trim()
      if (!trimmed) continue
      if (current.length + trimmed.length < MAX_SEGMENT_LENGTH) {
        current += trimmed
      } else {
        if (current) result.push(current)
        // 如果单段超过最大长度，再按逗号细分
        if (trimmed.length > MAX_SEGMENT_LENGTH) {
          const subSegs = trimmed.match(/[^，,]+[，,]?/g) || [trimmed]
          let subCurrent = ''
          for (const sub of subSegs) {
            const subTrimmed = sub.trim()
            if (!subTrimmed) continue
            if (subCurrent.length + subTrimmed.length < MAX_SEGMENT_LENGTH) {
              subCurrent += subTrimmed
            } else {
              if (subCurrent) result.push(subCurrent)
              subCurrent = subTrimmed
            }
          }
          current = subCurrent
        } else {
          current = trimmed
        }
      }
    }
    if (current) result.push(current)

    // 如果只有一段但文本较长（超过 20 字），强制分成两段，走流式播放逻辑
    if (result.length === 1 && result[0].length > 20) {
      const text = result[0]
      const mid = Math.floor(text.length / 2)
      // 尽量在标点处分割
      let splitPos = mid
      for (let i = mid; i < text.length && i < mid + 10; i++) {
        if ('，,。！？!?；;'.includes(text[i])) {
          splitPos = i + 1
          break
        }
      }
      return [text.slice(0, splitPos), text.slice(splitPos)]
    }

    return result.length > 0 ? result : [text]
  }, [])

  // 计算 PCM 音频的能量曲线（按 segmentMs 分段，返回每段的 RMS 能量）
  const computeEnergyCurve = useCallback((pcm, sampleRate, segmentMs = 50) => {
    const samplesPerSegment = Math.floor(sampleRate * segmentMs / 1000)
    // 兼容不同类型的 PCM 数据：Buffer、Array、ArrayBuffer、Uint8Array
    const getSample = (index) => {
      if (typeof pcm.readInt16LE === 'function') {
        // Node.js Buffer
        return pcm.readInt16LE(index * 2) / 32768
      } else if (pcm instanceof ArrayBuffer || ArrayBuffer.isView(pcm)) {
        // ArrayBuffer 或 TypedArray
        const view = pcm instanceof ArrayBuffer ? new DataView(pcm) : new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
        return view.getInt16(index * 2, true) / 32768
      } else if (Array.isArray(pcm)) {
        // 普通数组（假设已经是归一化的浮点值，或者是 16 位整数值）
        const val = pcm[index]
        return val > 1 ? val / 32768 : val
      } else if (pcm && pcm.data && Array.isArray(pcm.data)) {
        // Buffer 被序列化后的对象 { type: 'Buffer', data: [...] }
        const val = pcm.data[index * 2] | (pcm.data[index * 2 + 1] << 8)
        return (val > 32767 ? val - 65536 : val) / 32768
      }
      return 0
    }
    const byteLength = pcm?.length || pcm?.byteLength || pcm?.data?.length || 0
    const totalSamples = byteLength / 2
    const totalSegments = Math.ceil(totalSamples / samplesPerSegment)
    const curve = []
    for (let i = 0; i < totalSegments; i++) {
      const startSample = i * samplesPerSegment
      const endSample = Math.min(startSample + samplesPerSegment, totalSamples)
      let sum = 0
      let count = 0
      for (let j = startSample; j < endSample; j++) {
        const sample = getSample(j)
        sum += sample * sample
        count++
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0
      curve.push(rms)
    }
    return curve
  }, [])

  // 播放 PCM 音频，并实时更新音频能量（用于口型同步）
  const playPcmWithEnergy = useCallback(async (pcm, sampleRate, channels, onEnergy) => {
    console.log('[TTS] playPcmWithEnergy:', {
      pcmType: typeof pcm,
      pcmConstructor: pcm?.constructor?.name,
      pcmLength: pcm?.length,
      pcmByteLength: pcm?.byteLength,
      pcmIsBuffer: typeof pcm?.readInt16LE === 'function',
      pcmIsArray: Array.isArray(pcm),
      pcmIsArrayBuffer: pcm instanceof ArrayBuffer,
      sampleRate,
      channels
    })
    const playerHandle = await window.electronAPI.player.create(sampleRate, channels)
    console.log('[TTS] player created:', playerHandle)
    await window.electronAPI.player.play(playerHandle, pcm)
    console.log('[TTS] player.play called')
    // 兼容不同类型的 PCM 数据，计算字节长度
    const byteLength = pcm?.length || pcm?.byteLength || pcm?.data?.length || 0
    const durationMs = (byteLength / 2) / sampleRate * 1000
    console.log('[TTS] durationMs:', durationMs, 'byteLength:', byteLength)

    // 计算能量曲线（每 50ms 一段）
    const energyCurve = computeEnergyCurve(pcm, sampleRate, 50)
    const segmentCount = energyCurve.length
    const segmentDuration = durationMs / segmentCount

    // 定时更新音频能量
    let currentSegment = 0
    const energyInterval = setInterval(() => {
      if (currentSegment < segmentCount) {
        const energy = energyCurve[currentSegment]
        onEnergy?.(energy)
        currentSegment++
      } else {
        clearInterval(energyInterval)
      }
    }, segmentDuration)

    return { playerHandle, durationMs, energyInterval }
  }, [computeEnergyCurve])

  // —— 唱歌功能：使用 Web Audio API 播放歌曲并实时获取能量用于口型同步 ——

  // 停止唱歌
  const stopSinging = useCallback(() => {
    console.log('[唱歌] 停止唱歌', {
      isSinging: isSinging,
      hasAudioSource: !!audioSourceRef.current,
      hasEffectsChain: !!effectsChainRef.current,
      hasEnergyInterval: !!singingEnergyIntervalRef.current,
    })
    setIsSinging(false)
    setCurrentSong(null)
    // 停止能量定时器
    if (singingEnergyIntervalRef.current) {
      console.log('[唱歌] 清除能量定时器')
      clearInterval(singingEnergyIntervalRef.current)
      singingEnergyIntervalRef.current = null
    }
    // 停止音频源（先清除 onended 回调，防止触发自动切歌）
    if (audioSourceRef.current) {
      try {
        console.log('[唱歌] 停止音频源')
        audioSourceRef.current.onended = null
        audioSourceRef.current.stop()
        console.log('[唱歌] 音频源已停止')
      } catch (e) {
        console.error('[唱歌] 停止音频源失败:', e)
      }
      audioSourceRef.current = null
    } else {
      console.log('[唱歌] 没有音频源需要停止')
    }
    // 清理音效处理链
    if (effectsChainRef.current) {
      try {
        console.log('[唱歌] 清理音效处理链')
        effectsChainRef.current.inputNode.disconnect()
        effectsChainRef.current.outputNode.disconnect()
      } catch (e) {
        console.error('[唱歌] 清理音效处理链失败:', e)
      }
      effectsChainRef.current = null
    }
    // 重置播放锁（防止停止后无法再次播放）
    isStartingSongRef.current = false
    console.log('[唱歌] 播放锁已重置')
    // 重置音频能量和口型
    setAudioEnergy(0)
    speakingRef.current = false
    // 恢复数字人表情和动作
    setExpression('neutral')
    setGesture('idle')
    // 隐藏气泡
    setBubble({ text: '', visible: false, who: 'ai' })
    // 重置闪避状态（歌曲停止了，不需要闪避了）
    isDuckingRef.current = false
    if (duckingTimeoutRef.current) {
      clearTimeout(duckingTimeoutRef.current)
      duckingTimeoutRef.current = null
    }
    console.log('[唱歌] 停止唱歌完成')
  }, [isSinging])

  // —— 音频闪避（Ducking）：TTS 播放时降低歌曲音量，播放结束后恢复 ——

  // 开始闪避：降低歌曲音量作为背景
  const startDucking = useCallback((duckVolume = 0.15) => {
    if (!isSinging || !effectsChainRef.current) return

    // 清除之前的恢复定时器（如果有新的 TTS 要播放，不要恢复音量）
    if (duckingTimeoutRef.current) {
      clearTimeout(duckingTimeoutRef.current)
      duckingTimeoutRef.current = null
    }

    // 如果已经在闪避中，不需要重复降低音量
    if (isDuckingRef.current) return

    console.log('[闪避] 开始闪避，降低歌曲音量')
    isDuckingRef.current = true

    // 保存当前歌曲音量
    const currentVolume = effectsChainRef.current.masterGain.gain.value
    songOriginalVolumeRef.current = currentVolume

    // 平滑降低音量（300ms 淡入到闪避音量）
    const audioContext = audioContextRef.current
    if (audioContext) {
      const now = audioContext.currentTime
      effectsChainRef.current.masterGain.gain.cancelScheduledValues(now)
      effectsChainRef.current.masterGain.gain.setValueAtTime(currentVolume, now)
      effectsChainRef.current.masterGain.gain.linearRampToValueAtTime(duckVolume, now + 0.3)
    } else {
      effectsChainRef.current.setMasterVolume(duckVolume)
    }
  }, [isSinging])

  // 停止闪避：恢复歌曲音量
  const stopDucking = useCallback((delay = 500) => {
    if (!isDuckingRef.current) return

    console.log('[闪避] stopDucking 被调用，', delay > 0 ? `${delay}ms 后恢复歌曲音量` : '立即恢复歌曲音量')

    // 清除之前的恢复定时器（多次调用时只有最后一次生效）
    if (duckingTimeoutRef.current) {
      clearTimeout(duckingTimeoutRef.current)
      duckingTimeoutRef.current = null
    }

    const restoreVolume = () => {
      if (!isDuckingRef.current || !effectsChainRef.current) {
        isDuckingRef.current = false
        return
      }

      const targetVolume = songOriginalVolumeRef.current
      console.log('[闪避] 恢复歌曲音量:', targetVolume.toFixed(2))

      // 平滑恢复音量（500ms 淡出恢复）
      const audioContext = audioContextRef.current
      if (audioContext) {
        const now = audioContext.currentTime
        const currentVolume = effectsChainRef.current.masterGain.gain.value
        effectsChainRef.current.masterGain.gain.cancelScheduledValues(now)
        effectsChainRef.current.masterGain.gain.setValueAtTime(currentVolume, now)
        effectsChainRef.current.masterGain.gain.linearRampToValueAtTime(targetVolume, now + 0.5)
      } else {
        effectsChainRef.current.setMasterVolume(targetVolume)
      }

      isDuckingRef.current = false
      duckingTimeoutRef.current = null
    }

    if (delay > 0) {
      duckingTimeoutRef.current = setTimeout(restoreVolume, delay)
    } else {
      restoreVolume()
    }
  }, [])

  // 开始唱歌（播放音频文件或 URL）
  const startSinging = useCallback(async (fileOrUrl) => {
    if (!fileOrUrl) {
      console.error('[唱歌] 没有选择文件或 URL')
      return
    }

    // 播放锁：防止重复启动导致多首同时播放
    if (isStartingSongRef.current) {
      console.log('[唱歌] 已有歌曲正在启动，忽略本次请求')
      return
    }
    isStartingSongRef.current = true

    // 判断是 File 对象还是 URL 字符串
    const isUrl = typeof fileOrUrl === 'string'
    const songName = isUrl ? fileOrUrl.split('/').pop() || '示例歌曲' : fileOrUrl.name

    console.log('[唱歌] 开始唱歌:', songName, isUrl ? '(URL)' : '(文件)')

    // 【重要】先完全停止旧歌曲，再开始新歌曲
    // 停止能量定时器
    if (singingEnergyIntervalRef.current) {
      clearInterval(singingEnergyIntervalRef.current)
      singingEnergyIntervalRef.current = null
    }
    // 停止音频源
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.onended = null // 清除旧的 onended 回调，防止触发自动切歌
        audioSourceRef.current.stop()
      } catch (e) {}
      audioSourceRef.current = null
    }
    // 清理音效处理链
    if (effectsChainRef.current) {
      try {
        effectsChainRef.current.inputNode.disconnect()
        effectsChainRef.current.outputNode.disconnect()
      } catch (e) {}
      effectsChainRef.current = null
    }

    // 停止可能正在播放的 TTS
    if (currentPlayerHandleRef.current !== null) {
      window.electronAPI?.player?.destroy(currentPlayerHandleRef.current).catch(() => {})
      currentPlayerHandleRef.current = null
    }
    if (currentEnergyIntervalRef.current) {
      clearInterval(currentEnergyIntervalRef.current)
      currentEnergyIntervalRef.current = null
    }
    ttsStopRef.current = true

    // 重置状态
    setIsSinging(false)
    setAudioEnergy(0)
    speakingRef.current = false

    // 等待一小段时间，确保旧歌曲完全停止
    await new Promise(resolve => setTimeout(resolve, 50))

    // 【重要】在用户手势的同步回调中创建和恢复 AudioContext
    // 浏览器自动播放策略要求：AudioContext.resume() 必须在用户手势的同步回调中调用
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      console.log('[唱歌] 创建新的 AudioContext')
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const audioContext = audioContextRef.current
    console.log('[唱歌] AudioContext 状态（恢复前）:', audioContext.state)

    // 同步调用 resume()，确保在用户手势回调中执行
    if (audioContext.state === 'suspended') {
      try {
        audioContext.resume()
        console.log('[唱歌] AudioContext resume() 已调用')
      } catch (e) {
        console.error('[唱歌] AudioContext resume() 失败:', e)
      }
    }

    try {
      // 等待一小段时间，确保 AudioContext 恢复
      await new Promise(resolve => setTimeout(resolve, 50))
      console.log('[唱歌] AudioContext 状态（恢复后）:', audioContext.state)

      // 读取音频数据并解码
      let arrayBuffer
      if (isUrl) {
        // 判断是本地文件路径还是网络 URL
        const isLocalFile = fileOrUrl.startsWith('/') || fileOrUrl.startsWith('file://')
        const isBlobUrl = fileOrUrl.startsWith('blob:')
        const isHttpUrl = fileOrUrl.startsWith('http://') || fileOrUrl.startsWith('https://')

        if (isLocalFile && !isBlobUrl) {
          // 本地文件路径：通过 IPC 在主进程中读取（绕过 file:// 协议的安全限制）
          let filePath = fileOrUrl
          if (filePath.startsWith('file://')) {
            filePath = decodeURI(filePath.substring(7))
          }
          console.log('[唱歌] 通过 IPC 读取本地文件:', filePath)

          if (window.electronAPI?.file?.read) {
            const result = await window.electronAPI.file.read(filePath)
            if (result.ok) {
              // 转换 Uint8Array 为 ArrayBuffer
              arrayBuffer = result.data.buffer.slice(
                result.data.byteOffset,
                result.data.byteOffset + result.data.byteLength
              )
              console.log('[唱歌] 本地文件读取完成，大小:', arrayBuffer.byteLength, '字节')
            } else {
              throw new Error(`本地文件读取失败: ${result.error}`)
            }
          } else {
            throw new Error('window.electronAPI.file.read 不可用')
          }
        } else if (isHttpUrl || isBlobUrl) {
          // 网络 URL 或 Blob URL：用 XMLHttpRequest 下载
          console.log('[唱歌] 正在下载音频:', fileOrUrl)
          arrayBuffer = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', fileOrUrl, true)
            xhr.responseType = 'arraybuffer'
            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 0) {
                console.log('[唱歌] 音频下载完成，大小:', xhr.response.byteLength, '字节')
                resolve(xhr.response)
              } else {
                reject(new Error(`音频下载失败: HTTP ${xhr.status}`))
              }
            }
            xhr.onerror = () => {
              reject(new Error('音频下载失败: 网络错误'))
            }
            xhr.send()
          })
        } else {
          // 其他情况：尝试用 XMLHttpRequest
          console.log('[唱歌] 尝试下载音频（未知协议）:', fileOrUrl)
          arrayBuffer = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', fileOrUrl, true)
            xhr.responseType = 'arraybuffer'
            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 0) {
                console.log('[唱歌] 音频下载完成，大小:', xhr.response.byteLength, '字节')
                resolve(xhr.response)
              } else {
                reject(new Error(`音频下载失败: HTTP ${xhr.status}`))
              }
            }
            xhr.onerror = () => {
              reject(new Error('音频下载失败: 网络错误'))
            }
            xhr.send()
          })
        }
      } else {
        // File 对象：直接读取
        arrayBuffer = await fileOrUrl.arrayBuffer()
      }

      console.log('[唱歌] 开始解码音频...')
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      console.log('[唱歌] 音频解码完成:', {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
      })

      // 创建音频源
      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      audioSourceRef.current = source

      // 创建分析器节点（用于获取实时能量）
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser

      // 创建音效处理链（均衡器、混响、压缩器等）
      const effectsChain = createAudioEffectsChain(audioContext, {
        eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 默认平直
        reverbEnabled: false,
        compressorEnabled: true,
        masterVolume: 0.8,
      })
      effectsChainRef.current = effectsChain

      // 音量归一化（自动调整增益，避免不同歌曲音量差异大）
      const normalizeGain = normalizeVolume(audioBuffer, 0.158)
      console.log('[唱歌] 音量归一化增益:', normalizeGain.toFixed(2))
      effectsChain.setMasterVolume(Math.min(0.8 * normalizeGain, 1.0))

      // 连接节点：source -> effectsChain -> analyser -> destination
      source.connect(effectsChain.inputNode)
      effectsChain.outputNode.connect(analyser)
      analyser.connect(audioContext.destination)

      // 淡入效果（避免突然播放造成的爆音）
      effectsChain.fadeIn(0.5)

      // 播放结束时的回调
      source.onended = () => {
        // 检查是否是用户主动停止的（如果 audioSourceRef 不是当前 source，说明是被新歌曲替换了）
        if (audioSourceRef.current !== source) {
          console.log('[唱歌] 旧歌曲被新歌曲替换，不触发自动切歌')
          return
        }
        console.log('[唱歌] 播放结束，准备自动切歌')
        // 先停止当前歌曲
        stopSinging()
        // 通知外部播放结束（用于自动切歌），延迟一点确保 stopSinging 完成
        if (onSongEndedRef.current) {
          setTimeout(() => {
            onSongEndedRef.current()
          }, 100)
        }
      }

      // 开始播放
      source.start(0)
      console.log('[唱歌] 播放已开始:', {
        audioContextState: audioContext.state,
        masterVolume: effectsChain.masterGain.gain.value,
        bufferDuration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
      })

      // 释放播放锁
      isStartingSongRef.current = false

      // 更新状态
      setIsSinging(true)
      setCurrentSong({ name: songName, duration: audioBuffer.duration })

      // 设置数字人唱歌时的表情和动作
      // 唱歌时用 happy 表情 + idle 手势（自然下垂），不要一直挥手
      setExpression('happy')
      setGesture('idle')

      // 显示气泡
      setBubble({ text: `🎵 正在演唱：${songName}`, visible: true, who: 'ai' })

      // 定时获取实时音频能量，用于口型同步
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let energyLogCount = 0
      singingEnergyIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray)
        // 计算平均能量（0-1）
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avgEnergy = sum / dataArray.length / 255
        // 放大能量，让口型更明显
        const amplifiedEnergy = Math.min(1, avgEnergy * 2.5)
        setAudioEnergy(amplifiedEnergy)
        // 说话状态（有声音时动嘴）
        speakingRef.current = amplifiedEnergy > 0.05
        // 调试日志：每 20 次打印一次，避免刷屏
        energyLogCount++
        if (energyLogCount % 20 === 0) {
          console.log('[唱歌] 实时能量:', {
            avgEnergy: avgEnergy.toFixed(4),
            amplifiedEnergy: amplifiedEnergy.toFixed(4),
            maxValue: Math.max(...dataArray),
            audioContextState: audioContext.state,
          })
        }
      }, 50)

      console.log('[唱歌] 播放开始')
    } catch (e) {
      console.error('[唱歌] 播放失败:', e)
      // 释放播放锁
      isStartingSongRef.current = false
      setBubble({ text: '唱歌失败了，换首歌试试吧～', visible: true, who: 'ai' })
      setTimeout(() => {
        setBubble({ text: '', visible: false, who: 'ai' })
      }, 3000)
      stopSinging()
    }
  }, [stopSinging])

  // 选择歌曲文件并开始唱歌
  const selectSongAndSing = useCallback(() => {
    // 创建隐藏的 file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*' // 只接受音频文件
    input.onchange = (e) => {
      const file = e.target.files?.[0]
      if (file) {
        startSinging(file)
      }
    }
    input.click()
  }, [startSinging])

  // 播放预设的示例歌曲
  const playSampleSong = useCallback(() => {
    // 示例歌曲路径（public/audio/sample-song.mp3），使用绝对路径
    const sampleSongUrl = '/audio/sample-song.mp3'
    console.log('[唱歌] 播放示例歌曲:', sampleSongUrl)
    startSinging(sampleSongUrl)
  }, [startSinging])

  // 数字转中文读法：避免 TTS 用英文发音读数字
  const normalizeNumbersForTTS = useCallback((text) => {
    if (!text) return text
    let result = text

    // 0. 数学符号替换（在数字处理之前）
    result = result
      .replace(/×/g, ' 乘以 ')
      .replace(/÷/g, ' 除以 ')
      .replace(/=/g, ' 等于 ')
      .replace(/\+/g, ' 加 ')
      .replace(/−/g, ' 减 ')
      .replace(/±/g, ' 正负 ')
      .replace(/√/g, ' 根号 ')
      .replace(/π/g, ' 派 ')
      .replace(/∞/g, ' 无穷大 ')

    // 0.1 Markdown 格式符号清理（不朗读格式符号）
    result = result
      .replace(/^#{1,6}\s+/gm, '')  // 标题 #
      .replace(/\*\*(.+?)\*\*/g, '$1')  // 粗体 **
      .replace(/\*(.+?)\*/g, '$1')  // 斜体 *
      .replace(/`(.+?)`/g, '$1')  // 行内代码 `
      .replace(/^>\s+/gm, '')  // 引用 >
      .replace(/^[-*+]\s+/gm, '')  // 无序列表 - * +
      .replace(/\n{3,}/g, '\n\n')  // 多余空行

    // 0.2 列表编号处理：1. 2. 读成"第一""第二"（1-10），超过10直接读数字
    result = result.replace(/^(\d+)\.\s+/gm, (match, num) => {
      const n = parseInt(num, 10)
      if (n >= 1 && n <= 10) {
        const ordinal = ['', '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十']
        return ordinal[n] + '，'
      }
      return num + '，'
    })

    // 0.3 常见符号中文读法
    result = result
      .replace(/@/g, ' at ')
      .replace(/&/g, ' 和 ')
      .replace(/\//g, ' 斜杠 ')
      .replace(/\\/g, ' 反斜杠 ')
      .replace(/\^/g, ' 的次方 ')
      .replace(/\|/g, ' 竖线 ')
      .replace(/\(/g, '（')
      .replace(/\)/g, '）')
      .replace(/\[/g, '【')
      .replace(/\]/g, '】')
      .replace(/\{/g, '｛')
      .replace(/\}/g, '｝')
      .replace(/<[^>]+>/g, '')  // HTML标签
      .replace(/https?:\/\/\S+/g, ' 链接 ')  // URL简读
      .replace(/\.(com|cn|net|org|io|ai)\b/gi, ' 点$1 ')  // 域名后缀
      // 波浪号、省略号等语气符号不朗读，直接移除
      .replace(/[~～]/g, '')
      .replace(/…+/g, '')

    // 0.4 英文单词保留（TTS自己读英文），但清理多余空格
    result = result.replace(/[ \t]{2,}/g, ' ').trim()

    // 中文数字映射
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
    const units = ['', '十', '百', '千']
    const bigUnits = ['', '万', '亿', '万亿']

    // 整数转中文读法（支持到万亿）
    const intToChinese = (numStr) => {
      let num = parseInt(numStr, 10)
      if (num === 0) return '零'
      if (num < 0) return '负' + intToChinese(String(-num))

      let result = ''
      let unitPos = 0
      let zeroFlag = false

      while (num > 0) {
        const section = num % 10000
        if (section === 0) {
          if (zeroFlag) result = '零' + result
          zeroFlag = true
        } else {
          let sectionStr = ''
          let sectionNum = section
          let sectionUnitPos = 0
          let sectionZeroFlag = false

          while (sectionNum > 0) {
            const digit = sectionNum % 10
            if (digit === 0) {
              // 只有当已经有非零数字时，才标记 zeroFlag（避免末尾的零被读出来）
              // 例如：40 → 四十（不读"四十零"），401 → 四百零一（读中间的零）
              if (sectionStr.length > 0) {
                sectionZeroFlag = true
              }
            } else {
              if (sectionZeroFlag) sectionStr = '零' + sectionStr
              sectionStr = digits[digit] + units[sectionUnitPos] + sectionStr
              sectionZeroFlag = false
            }
            sectionNum = Math.floor(sectionNum / 10)
            sectionUnitPos++
          }

          // 处理"十"开头的情况（10-19 → 十~十九，不是一十~一十九）
          if (section >= 10 && section < 20 && sectionStr.startsWith('一十')) {
            sectionStr = sectionStr.slice(1)
          }

          result = sectionStr + bigUnits[unitPos] + result
          zeroFlag = false
        }
        num = Math.floor(num / 10000)
        unitPos++
      }
      return result
    }

    // 逐字读数字（用于年份、电话号码等）
    const digitsToChinese = (numStr) => {
      return numStr.split('').map((ch) => {
        if (ch >= '0' && ch <= '9') return digits[parseInt(ch, 10)]
        return ch
      }).join('')
    }

    // 0.5 温度单位：30°C → 三十摄氏度，30℃ → 三十摄氏度，86°F → 八十六华氏度，30度 → 三十度
    // 必须在普通数字处理之前处理，避免 °C 中的特殊字符影响数字匹配
    result = result.replace(/(\d+(?:\.\d+)?)\s*(°C|℃|°F|度)/g, (match, num, unit) => {
      let unitStr
      if (unit === '°C' || unit === '℃') unitStr = '摄氏度'
      else if (unit === '°F') unitStr = '华氏度'
      else unitStr = '度'

      if (num.includes('.')) {
        const [intPart, decPart] = num.split('.')
        return intToChinese(intPart) + '点' + digitsToChinese(decPart) + unitStr
      }
      return intToChinese(num) + unitStr
    })

    // 1. 百分比：50% → 百分之五十
    result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
      if (num.includes('.')) {
        const [intPart, decPart] = num.split('.')
        return '百分之' + intToChinese(intPart) + '点' + digitsToChinese(decPart)
      }
      return '百分之' + intToChinese(num)
    })

    // 2. 小数（带单位）：2.39亿 → 二点三九亿，3.14 → 三点一四
    // 先处理带单位的小数（亿、万、千等），确保"点"被正确读出
    result = result.replace(/(\d+)\.(\d+)(亿|万|千|百|十|元|块|米|公里|千克|吨|%|％)?/g, (match, intPart, decPart, unit) => {
      const unitStr = unit || ''
      return intToChinese(intPart) + '点' + digitsToChinese(decPart) + unitStr
    })

    // 兼容旧的小数正则（不带单位的情况已经被上面覆盖，这里作为兜底）
    // result = result.replace(/(\d+)\.(\d+)/g, (match, intPart, decPart) => {
    //   return intToChinese(intPart) + '点' + digitsToChinese(decPart)
    // })

    // 3. 年份（4位数字，通常是年份）：2024 → 二零二四
    result = result.replace(/\b(19|20)\d{2}\b/g, (match) => {
      return digitsToChinese(match)
    })

    // 4. 长数字（>5位，电话号码、编号等）：逐字读
    result = result.replace(/\b\d{6,}\b/g, (match) => {
      return digitsToChinese(match)
    })

    // 5. 普通整数：123 → 一百二十三
    result = result.replace(/\b\d+\b/g, (match) => {
      return intToChinese(match)
    })

    // 6. 清理不应该被读出来的标点符号
    // 斜杠 / → 去掉（或替换为"或"，这里直接去掉，避免读"斜杠"）
    result = result.replace(/\s*\/\s*/g, ' ')
    // 反斜杠 \ → 去掉
    result = result.replace(/\\/g, '')
    // 星号 * → 去掉（Markdown 加粗/斜体标记）
    result = result.replace(/\*+/g, '')
    // 下划线 _ → 去掉（Markdown 斜体标记）
    result = result.replace(/_+/g, '')
    // 井号 # → 去掉（Markdown 标题标记）
    result = result.replace(/#+\s*/g, '')
    // 波浪号 ~ → 去掉
    result = result.replace(/~+/g, '')
    // 反引号 ` → 去掉（代码标记）
    result = result.replace(/`+/g, '')
    // 竖线 | → 替换为"或"
    result = result.replace(/\s*\|\s*/g, ' 或 ')
    // 尖括号 <> → 去掉（HTML 标签）
    result = result.replace(/<[^>]*>/g, '')
    // 方括号 [] → 去掉（链接标记）
    result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [文字](链接) → 文字
    result = result.replace(/\[[^\]]*\]/g, '') // 剩余的 [文字] → 去掉
    // 省略号 ... → 替换为停顿（逗号）
    result = result.replace(/\.{3,}/g, '，')
    // 多个连续的标点符号合并成一个
    result = result.replace(/([，。！？；：])\1+/g, '$1')
    // 去掉行首和行尾的标点符号
    result = result.replace(/^[，。！？；：\s]+/, '')
    result = result.replace(/[，。！？；：\s]+$/, '')
    // 多个空格合并成一个
    result = result.replace(/\s+/g, ' ')

    return result
  }, [])

  const speak = useCallback(async (text) => {
    // 分配唯一 ID，用于取消旧的调用（防止并发播放导致两个声音）
    const myId = ++speakIdRef.current
    console.log('[TTS] speak called:', { id: myId, text: text?.slice(0, 50), length: text?.length, ttsAvailable })
    if (!text || !text.trim()) return

    // 数字转中文读法，避免 TTS 用英文发音
    const normalizedText = normalizeNumbersForTTS(text)
    if (normalizedText !== text) {
      console.log('[TTS] 数字归一化:', { original: text?.slice(0, 50), normalized: normalizedText?.slice(0, 50) })
    }

    // 停止当前播放
    ttsStopRef.current = true
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    // 停止 CoreAudio 播放器（防止并发播放导致两个声音）
    if (currentPlayerHandleRef.current !== null) {
      window.electronAPI?.player?.destroy(currentPlayerHandleRef.current).catch(() => {})
      currentPlayerHandleRef.current = null
    }
    // 清除能量定时器
    if (currentEnergyIntervalRef.current) {
      clearInterval(currentEnergyIntervalRef.current)
      currentEnergyIntervalRef.current = null
    }
    setAudioEnergy(0)
    // 先隐藏气泡和口型，等语音就绪再同步显示
    speakingRef.current = false
    setBubble({ text: '', visible: false, who: 'ai' })
    // 短暂延迟，确保旧的播放完全停止
    await new Promise((r) => setTimeout(r, 50))
    ttsStopRef.current = false

    // 检查是否已被新的调用取代
    if (speakIdRef.current !== myId) {
      console.log('[TTS] 调用已被取消:', myId)
      return
    }

    // 【音频闪避】如果正在播放歌曲，降低歌曲音量作为背景
    startDucking(0.15)

    // 优先本地 TTS（macOS say / Piper）
    if (ttsAvailable && window.electronAPI?.tts) {
      try {
        console.log('[TTS] synthesizing...')
        setTtsLoading(true)

        // 分段流式播放（使用归一化后的文本，确保数字用中文读）
        const segments = splitText(normalizedText)
        console.log('[TTS] 分段:', segments.length, '段')

        if (segments.length > 1) {
          // 多段：流式播放，生成第一段后立即播放，同时生成下一段
          // 优化：先合成第一段语音，合成完成后再显示文案+开始嘴部动画，避免"嘴动了但没声音"

          // 提前开始生成第一段
          const firstPcmPromise = window.electronAPI.tts.synthesize(segments[0], { rate: 1.0, returnPcm: true })
          let nextPcmPromise = null
          let firstSegmentReady = false

          for (let i = 0; i < segments.length; i++) {
            if (ttsStopRef.current) break
            if (speakIdRef.current !== myId) {
              console.log('[TTS] 多段播放调用已被取消:', myId, '当前:', speakIdRef.current)
              break
            }
            const segment = segments[i]
            console.log(`[TTS] 段 ${i + 1}/${segments.length}:`, segment.slice(0, 30))

            // 生成当前段音频（如果没有预生成）
            let result
            if (i === 0) {
              result = await firstPcmPromise
              // 第一段合成完成：显示文案+开始嘴部动画，同时展示聊天列表中的 LLM 回复
              if (!firstSegmentReady && result.ok && result.pcm && !ttsStopRef.current && speakIdRef.current === myId) {
                firstSegmentReady = true
                console.log('[TTS] 第一段语音合成完成，开始显示文案+嘴部动画，并展示聊天列表')
                speakingRef.current = true
                setBubble({ text, visible: true, who: 'ai' })
                setShowAssistantReply(true) // 语音准备好了，展示 LLM 回复
              }
            } else if (nextPcmPromise) {
              result = await nextPcmPromise
            } else {
              result = await window.electronAPI.tts.synthesize(segment, { rate: 1.0, returnPcm: true })
            }

            // 检查是否已被新的调用取代
            if (speakIdRef.current !== myId) {
              console.log('[TTS] 段合成完成后调用已被取消:', myId)
              break
            }

            // 预生成下一段（并行）- 优化：在当前段播放前就开始预生成
            if (i + 1 < segments.length && !ttsStopRef.current && speakIdRef.current === myId) {
              nextPcmPromise = window.electronAPI.tts.synthesize(segments[i + 1], { rate: 1.0, returnPcm: true })
            } else {
              nextPcmPromise = null
            }

            if (i === 0) setTtsLoading(false)

            if (result.ok && result.pcm && !ttsStopRef.current && speakIdRef.current === myId) {
              try {
                if (currentPlayerHandleRef.current !== null) {
                  window.electronAPI.player.destroy(currentPlayerHandleRef.current).catch(() => {})
                  currentPlayerHandleRef.current = null
                }
                // 使用带能量同步的播放
                const { playerHandle, durationMs, energyInterval } = await playPcmWithEnergy(
                  result.pcm,
                  result.sampleRate || 22050,
                  result.channels || 1,
                  (energy) => {
                    // 实时更新音频能量，用于口型同步
                    setAudioEnergy(energy)
                  }
                )
                currentPlayerHandleRef.current = playerHandle
                currentEnergyIntervalRef.current = energyInterval
                console.log(`[TTS] 段 ${i + 1} 播放中, duration ~`, Math.round(durationMs), 'ms')
                await new Promise((resolve) => setTimeout(resolve, durationMs + 300))
              } catch (e) {
                console.warn(`[TTS] 段 ${i + 1} 播放失败:`, e)
              }
            }
          }

          if (currentPlayerHandleRef.current !== null) {
            window.electronAPI.player.destroy(currentPlayerHandleRef.current).catch(() => {})
            currentPlayerHandleRef.current = null
          }
          // 清除能量定时器
          if (currentEnergyIntervalRef.current) {
            clearInterval(currentEnergyIntervalRef.current)
            currentEnergyIntervalRef.current = null
          }
          setAudioEnergy(0)
          if (!ttsStopRef.current) {
            speakingRef.current = false
            setTimeout(() => {
              setBubble((b) => b.text === text ? { text: '', visible: false, who: 'ai' } : b)
            }, 2000)
          }
          // 【音频闪避】TTS 播放结束，恢复歌曲音量
          stopDucking(500)
          return
        }

        // 单段：原逻辑，生成完整音频再播放（使用归一化后的文本，确保数字用中文读）
        const result = await window.electronAPI.tts.synthesize(normalizedText, { rate: 1.0, returnPcm: true })

        // 检查是否已被新的调用取代
        if (speakIdRef.current !== myId) {
          console.log('[TTS] 单段合成完成后调用已被取消:', myId)
          return
        }

        setTtsLoading(false)
        console.log('[TTS] result:', { ok: result.ok, provider: result.provider, pcmLen: result.pcm?.length, error: result.error })

        if (result.ok && result.pcm && !ttsStopRef.current && speakIdRef.current === myId) {
          // 语音就绪：同步显示气泡+口型+播放，同时展示聊天列表中的 LLM 回复
          speakingRef.current = true
          setBubble({ text, visible: true, who: 'ai' })
          setShowAssistantReply(true) // 语音准备好了，展示 LLM 回复

          try {
            // 使用带能量同步的播放
            const { playerHandle, durationMs, energyInterval } = await playPcmWithEnergy(
              result.pcm,
              result.sampleRate || 22050,
              result.channels || 1,
              (energy) => {
                setAudioEnergy(energy)
              }
            )
            // 再次检查 ID（playPcmWithEnergy 是异步的）
            if (speakIdRef.current !== myId) {
              console.log('[TTS] 播放前调用已被取消:', myId)
              window.electronAPI.player.destroy(playerHandle).catch(() => {})
              // 【音频闪避】调用被取消，恢复歌曲音量
              stopDucking(300)
              return
            }
            currentPlayerHandleRef.current = playerHandle
            currentEnergyIntervalRef.current = energyInterval
            console.log('[TTS] CoreAudio playing, duration ~', Math.round(durationMs), 'ms')

            // 播放结束后清理
            setTimeout(() => {
              // 检查是否还是当前调用
              if (speakIdRef.current !== myId) {
                console.log('[TTS] 播放结束回调中调用已被取消:', myId)
                return
              }
              speakingRef.current = false
              setAudioEnergy(0)
              if (currentEnergyIntervalRef.current) {
                clearInterval(currentEnergyIntervalRef.current)
                currentEnergyIntervalRef.current = null
              }
              if (currentPlayerHandleRef.current === playerHandle) {
                window.electronAPI.player.destroy(playerHandle).catch(() => {})
                currentPlayerHandleRef.current = null
              }
              // 语音结束后气泡保留 2 秒再消失
              setTimeout(() => {
                setBubble((b) => b.text === text ? { text: '', visible: false, who: 'ai' } : b)
              }, 2000)
              // 【音频闪避】TTS 播放结束，恢复歌曲音量
              stopDucking(500)
            }, durationMs + 500)
            return
          } catch (e) {
            console.warn('[TTS] CoreAudio play failed, fallback to HTML5 Audio:', e)
            // 回退到 HTML5 Audio
          }
        }

        // 回退：用 base64 音频播放（如果有）
        if (result.ok && result.wavBase64 && !ttsStopRef.current && speakIdRef.current === myId) {
          speakingRef.current = true
          setBubble({ text, visible: true, who: 'ai' })
          const mime = result.provider === 'edge-tts' ? 'audio/mp3' : 'audio/wav'
          const audio = new Audio(`data:${mime};base64,${result.wavBase64}`)
          audioRef.current = audio
          audio.onended = () => {
            if (speakIdRef.current !== myId) return
            speakingRef.current = false
            audioRef.current = null
            setTimeout(() => {
              setBubble((b) => b.text === text ? { text: '', visible: false, who: 'ai' } : b)
            }, 2000)
            // 【音频闪避】TTS 播放结束，恢复歌曲音量
            stopDucking(500)
          }
          audio.onerror = (e) => {
            console.warn('[TTS] play error:', e)
            speakingRef.current = false
            audioRef.current = null
            // 【音频闪避】TTS 播放出错，恢复歌曲音量
            stopDucking(300)
          }
          await audio.play()
          return
        }

        // 合成失败：仍显示文字气泡和口型（无声音），并展示聊天列表中的 LLM 回复
        if (speakIdRef.current === myId) {
          speakingRef.current = true
          setBubble({ text, visible: true, who: 'ai' })
          setShowAssistantReply(true) // 合成失败，也展示 LLM 回复
          setTimeout(() => {
            if (speakIdRef.current !== myId) return
            speakingRef.current = false
            setBubble((b) => b.text === text ? { text: '', visible: false, who: 'ai' } : b)
          }, Math.min(8000, text.length * 200))
        }
      } catch (e) {
        console.warn('[TTS] 失败，回退系统语音:', e)
        setTtsLoading(false)
        setShowAssistantReply(true) // TTS 失败，也展示 LLM 回复
        // 停止可能还在播放的 CoreAudio 播放器，防止两个声音同时出现
        if (currentPlayerHandleRef.current !== null) {
          window.electronAPI?.player?.destroy(currentPlayerHandleRef.current).catch(() => {})
          currentPlayerHandleRef.current = null
        }
        if (currentEnergyIntervalRef.current) {
          clearInterval(currentEnergyIntervalRef.current)
          currentEnergyIntervalRef.current = null
        }
        setAudioEnergy(0)
      }
    }

    // 回退：系统 Web Speech API（只有当 CoreAudio 播放器没有在播放时才使用）
    if (window.speechSynthesis && !ttsStopRef.current && speakIdRef.current === myId && currentPlayerHandleRef.current === null) {
      console.log('[TTS] 使用系统语音播放:', {
        id: myId,
        ttsAvailable,
        currentPlayerHandle: currentPlayerHandleRef.current,
        text: text?.slice(0, 50),
        stack: new Error().stack?.split('\n').slice(0, 5).join('\n')
      })
      const utterance = new SpeechSynthesisUtterance(normalizedText)
      utterance.lang = 'zh-CN'
      utterance.rate = 1.0
      utterance.pitch = 1.0
      const voices = window.speechSynthesis.getVoices()
      const zhVoice = voices.find((v) => v.lang.startsWith('zh'))
      if (zhVoice) utterance.voice = zhVoice
      utterance.onstart = () => {
        if (speakIdRef.current !== myId) {
          window.speechSynthesis.cancel()
          return
        }
        // 系统语音开始时同步显示气泡+口型，并展示聊天列表中的 LLM 回复
        speakingRef.current = true
        setBubble({ text, visible: true, who: 'ai' })
        setShowAssistantReply(true) // 语音准备好了，展示 LLM 回复
      }
      utterance.onend = () => {
        if (speakIdRef.current !== myId) return
        speakingRef.current = false
        setTimeout(() => {
          setBubble((b) => b.text === text ? { text: '', visible: false, who: 'ai' } : b)
        }, 2000)
        // 【音频闪避】TTS 播放结束，恢复歌曲音量
        stopDucking(500)
      }
      utterance.onerror = () => {
        speakingRef.current = false
        // 【音频闪避】TTS 播放出错，恢复歌曲音量
        stopDucking(300)
      }
      window.speechSynthesis.speak(utterance)
    } else {
      // 【音频闪避】没有任何 TTS 播放成功（本地 TTS 失败且没有系统语音），恢复歌曲音量
      if (currentPlayerHandleRef.current === null) {
        console.log('[TTS] 没有可用的 TTS 播放方式，恢复歌曲音量')
        stopDucking(300)
      }
    }
  }, [ttsAvailable, startDucking, stopDucking])

  // 聊天回复联动数字人：暂时禁用流式 TTS，等 LLM 回复完成后统一播放完整文本
  // 流式 TTS 的剩余部分播放逻辑有 bug，容易导致后半段没说，先禁用确保完整性
  chat.onDeltaRef.current = (text) => {
    if (!voiceEnabled || !text || !text.trim()) return
    // 保存完整文本（用于最后补全）
    ttsFullTextRef.current = text
    // 暂时禁用流式 TTS，不提前播放
    // if (ttsStreamStartedRef.current) return
    // ...
  }

  // 工具调用事件：不立即说话，只显示提示，避免数字人一思考就触发音频闪避
  chat.onToolCallRef.current = (toolName, toolArgs) => {
    console.log('[App] onToolCallRef 被调用:', { toolName, toolCallSpoken: toolCallSpokenRef.current })
    if (!voiceEnabled || toolCallSpokenRef.current) return
    toolCallSpokenRef.current = true
    // 工具调用时不立即说话，只在数字人头顶显示提示
    const prompts = {
      'code-review': '正在审查代码...',
      'post-comment': '正在发布评论...',
      'rust-review': '正在审查 Rust 代码...',
      'weekly-investment': '正在生成投资周报...',
      'article-write': '正在写文章...',
      'article-validate': '正在检查文章...',
      'article-discover': '正在寻找项目...',
      'juejin-draft': '正在创建掘金草稿...',
      'wechat-draft': '正在创建公众号草稿...',
      'sf-pw-publish': '正在发布到思否...',
    }
    const text = prompts[toolName] || `正在处理 ${toolName}...`
    // 只显示气泡，不调用 speak，避免触发音频闪避
    setBubble({ text, visible: true, who: 'ai' })
  }

  // 工具结果事件：不立即说话，等 LLM 最终回复时再统一播放
  chat.onToolResultRef.current = (toolName, result) => {
    console.log('[App] onToolResultRef 被调用:', { toolName, toolResultSpoken: toolResultSpokenRef.current })
    if (!voiceEnabled || toolResultSpokenRef.current) return
    toolResultSpokenRef.current = true
    // 工具结果返回时不立即说话，等 LLM 最终回复时再统一播放
    // 只更新气泡提示
    setBubble({ text: '处理完成，正在整理结果...', visible: true, who: 'ai' })
  }

  chat.onDoneRef.current = (fullText) => {
    console.log('[App] onDoneRef 被调用:', {
      voiceEnabled,
      fullTextLength: fullText?.length,
      fullTextPreview: fullText?.slice(0, 50),
      streamStarted: ttsStreamStartedRef.current,
      lastSentenceEnd: ttsLastSentenceEndRef.current,
    })
    // 重置工具调用状态
    toolCallSpokenRef.current = false
    toolResultSpokenRef.current = false

    if (!voiceEnabled || !fullText || !fullText.trim()) {
      // 无语音时也显示气泡和口型，并展示聊天列表中的 LLM 回复
      if (fullText && fullText.trim()) {
        console.log('[App] voiceEnabled 为 false，只显示气泡和口型，并展示聊天列表')
        speakingRef.current = true
        setBubble({ text: fullText, visible: true, who: 'ai' })
        setShowAssistantReply(true) // 语音不可用，直接展示 LLM 回复
        setTimeout(() => {
          speakingRef.current = false
          setBubble({ text: '', visible: false, who: 'ai' })
        }, Math.min(8000, fullText.length * 200))
      }
      // 重置流式 TTS 状态
      ttsStreamStartedRef.current = false
      ttsLastSentenceEndRef.current = 0
      ttsFullTextRef.current = ''
      return
    }

    if (ttsStreamStartedRef.current) {
      // 流式 TTS 已开始：检查是否有剩余文本需要播放
      const remainingText = fullText.slice(ttsLastSentenceEndRef.current).trim()
      console.log('[流式TTS] LLM 完成，检查剩余文本:', {
        remainingLength: remainingText.length,
        remainingPreview: remainingText.slice(0, 50),
        isPlaying: speakingRef.current,
      })

      if (remainingText && remainingText.length > 5) {
        // 有剩余文本：等当前播放完成后再播放剩余部分（最多等待 30 秒）
        let waitCount = 0
        const maxWait = 60 // 60 * 500ms = 30秒
        const playRemaining = () => {
          if (waitCount >= maxWait) {
            console.log('[流式TTS] 等待超时，不播放剩余部分')
            return
          }
          waitCount++
          if (ttsStopRef.current) {
            console.log('[流式TTS] 已被停止，不播放剩余部分')
            return
          }
          if (speakingRef.current) {
            // 还在播放，等 500ms 后再检查
            setTimeout(playRemaining, 500)
          } else {
            // 播放完成，播放剩余部分
            console.log('[流式TTS] 第一部分播放完成，开始播放剩余部分:', remainingText.slice(0, 50))
            speak(remainingText)
          }
        }
        playRemaining()
      } else {
        console.log('[流式TTS] 没有剩余文本，流式 TTS 完成')
      }
    } else {
      // 未开始流式 TTS（文本较短，未达到阈值）：正常播放全文
      console.log('[App] 未开始流式 TTS，正常播放全文')
      speak(fullText)
    }

    // 超时保护：如果 10 秒内还没有展示 LLM 回复，强制展示（防止边界情况导致一直不展示）
    setTimeout(() => {
      setShowAssistantReply((prev) => {
        if (!prev) {
          console.log('[App] 超时保护：强制展示 LLM 回复')
        }
        return true
      })
    }, 10000)

    // 重置流式 TTS 状态（延迟重置，避免影响剩余文本播放）
    setTimeout(() => {
      ttsStreamStartedRef.current = false
      ttsLastSentenceEndRef.current = 0
      ttsFullTextRef.current = ''
    }, 1000)
  }

  const handleSend = useCallback(() => {
    if (!input.trim() || chat.streaming) return
    const text = input.trim()
    setInput('')
    // 不停止唱歌，通过音频闪避功能在数字人说话时降低歌曲音量
    // 发送后隐藏 LLM 回复（等语音准备好了再展示）
    setShowAssistantReply(false)
    // 发送后显示"正在思考..."气泡，但不动嘴（思考时没有语音）
    setBubble({ text: '正在思考...', visible: true, who: 'ai' })
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

  // 输入框自动调整高度（多行支持）
  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    // 重置高度，然后根据内容调整
    textarea.style.height = 'auto'
    // 最大高度 120px（约 5 行），超出显示滚动条
    const maxHeight = 120
    const newHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${newHeight}px`
  }, [input])

  // 组件卸载时清理唱歌相关资源
  // 注意：不关闭 AudioContext，因为 React 开发模式下组件会频繁卸载重挂
  // 关闭后会导致下次使用时 AudioContext 状态为 closed
  // AudioContext 会在页面关闭时自动清理
  useEffect(() => {
    return () => {
      // 停止唱歌
      if (singingEnergyIntervalRef.current) {
        clearInterval(singingEnergyIntervalRef.current)
      }
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop()
        } catch (e) {
          // 忽略
        }
      }
      // 不关闭 AudioContext，保持复用
    }
  }, [])

  // 点击数字人：随机说一句问候语，并合成语音
  const handleAvatarClick = useCallback(() => {
    if (chat.streaming) return
    const greetings = [
      '你好呀主人～有什么可以帮你的吗？',
      '嗨！今天过得怎么样呀？',
      '主人你来啦～萤火好想你！',
      '嘿嘿，戳人家干嘛呀～有什么事吗？',
      '你好你好！要和萤火聊聊天吗？',
    ]
    const text = greetings[Math.floor(Math.random() * greetings.length)]
    if (voiceEnabled) {
      speak(text)
    } else {
      speakingRef.current = true
      setBubble({ text, visible: true, who: 'ai' })
      setTimeout(() => {
        speakingRef.current = false
        setBubble({ text: '', visible: false, who: 'ai' })
      }, Math.min(8000, text.length * 200))
    }
  }, [chat.streaming, voiceEnabled, speak])

  return (
    <div className="app">
      {/* 左侧面板：角色选择 + 状态 + 设置（可折叠 + 可拖拽调整宽度） */}
      <div
        className={`left-panel ${panelOpen ? 'open' : 'closed'}`}
        style={{ width: panelOpen ? leftPanelWidth : 0 }}
      >
        {/* 拖拽手柄 */}
        {panelOpen && (
          <div className="resize-handle right" onMouseDown={handleResizeStart('left')} title="拖拽调整宽度" />
        )}
        {panelOpen && (
          <div className="panel-content">
            <div className="panel-title-row">
              <h2>Firefly Studio</h2>
              <div className="panel-title-actions">
                <button className={`settings-btn ${settingsOpen ? 'active' : ''}`} onClick={() => setSettingsOpen(!settingsOpen)} title="设置">⚙️</button>
                <button className="panel-collapse-btn" onClick={() => setPanelOpen(false)} title="折叠面板">‹</button>
              </div>
            </div>
            <p className="subtitle">数字人 + resolve-studio agent loop</p>

            {/* 角色切换（垂直排列） */}
            <div className="character-selector">
              <span className="character-label">角色：</span>
              <div className="character-buttons vertical">
                {CHARACTERS.map((char) => (
                  <button key={char.key} className={`character-btn ${currentCharacter.key === char.key ? 'active' : ''}`} onClick={() => { setCurrentCharacter(char); chat.clear() }} title={char.personality}>
                    <span className="character-avatar">{char.avatar}</span>
                    <span className="character-name">{char.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 状态信息 */}
            <div className="status-panel">
              <div className="status-item"><span className="status-label">对话状态</span><span className={chat.streaming ? 'status-ok' : 'status-dim'}>{chat.streaming ? '● 回复中' : '○ 空闲'}</span></div>
              <div className="status-item"><span className="status-label">TTS 语音</span><span className={voiceEnabled ? 'status-ok' : 'status-dim'}>{voiceEnabled ? '● 开启' : '○ 关闭'}</span></div>
              {ttsLoading && <div className="status-item"><span className="status-label">语音合成</span><span className="status-loading"><span className="tts-spinner"></span> 合成中...</span></div>}
            </div>

            {/* 语音控制 */}
            <div className="voice-controls">
              <button className={`voice-toggle ${voiceEnabled ? 'on' : 'off'}`} onClick={() => { setVoiceEnabled(!voiceEnabled); if (voiceEnabled) window.speechSynthesis?.cancel() }}>{voiceEnabled ? '🔊 语音开启' : '🔇 语音关闭'}</button>
              <button className="voice-test" onClick={() => speak('你好，欢迎使用 Firefly Studio。中英文混合发音测试，Hello World。')}>🔊 测试语音</button>
            </div>

            {/* 设置面板 */}
            {settingsOpen && (
              <SettingsPanel
                onClose={() => setSettingsOpen(false)}
                onConfigChange={(cfg) => { setAppConfig(cfg); if (mic.active && !cfg.adaptiveThreshold) window.electronAPI?.mic?.setThreshold(mic.handle, cfg.vadThreshold) }}
                theme={theme}
                onThemeChange={setTheme}
              />
            )}

            {/* 借物说明 */}
            <details className="credit-details">
              <summary><span className="credit-model">模型：<b>Firefly Maid</b></span></summary>
              <div className="credit-content">
                <p>模型：<b>Firefly Maid</b> · 作者：<b>Geffol</b>（AplayBox）</p>
                <p>来源：<a href="https://www.aplaybox.com/details/model/zeMtLrCcHBSJ" target="_blank" rel="noreferrer">AplayBox</a> · <a href="https://www.aplaybox.com/u/774182361" target="_blank" rel="noreferrer">作者主页</a></p>
                <p className="credit-lic-line"><b>许可：</b>可商用 / 二次配布 / 修改 · 须附完整借物表</p>
              </div>
            </details>

            {/* 快捷键提示 */}
            <div className="shortcut-hints">
              <span className="shortcut-key">⌘K</span> 聚焦输入
              <span className="shortcut-divider">·</span>
              <span className="shortcut-key">空格</span> 按住说话
              <span className="shortcut-divider">·</span>
              <span className="shortcut-key">Esc</span> 停止
            </div>
          </div>
        )}
      </div>

      {/* 中间：3D 数字人主视图 */}
      <div className="avatar-canvas">
        {/* 左侧面板展开按钮（折叠时显示） */}
        {!panelOpen && (
          <button className="panel-expand-btn left" onClick={() => setPanelOpen(true)} title="展开左侧面板">
            ›
          </button>
        )}
        {/* 右侧面板展开按钮（折叠时显示） */}
        {!rightPanelOpen && (
          <button className="panel-expand-btn right" onClick={() => setRightPanelOpen(true)} title="展开右侧面板">
            ‹
          </button>
        )}
        <Canvas camera={{ position: [0, 1.5, 4.5], fov: 40 }} shadows gl={{ antialias: true, alpha: true }}>
          <Stage
            speakingRef={speakingRef}
            bubble={bubble}
            onClick={handleAvatarClick}
            modelSource={modelSource}
            audioEnergy={audioEnergy}
            expression={expression}
            gesture={gesture}
          />
          <OrbitControls enablePan={false} minDistance={2.5} maxDistance={8} target={[0, 1.2, 0]} />
        </Canvas>
      </div>

      {/* 右侧面板：聊天对话（可折叠 + 可拖拽调整宽度） */}
      <div
        className={`right-panel ${rightPanelOpen ? 'open' : 'closed'}`}
        style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
      >
        {/* 拖拽手柄 */}
        {rightPanelOpen && (
          <div className="resize-handle left" onMouseDown={handleResizeStart('right')} title="拖拽调整宽度" />
        )}

        {rightPanelOpen && (
          <div className="panel-content chat-only">
            {/* 聊天头部 */}
            <div className="chat-header">
              <div className="chat-header-info">
                <span className="chat-header-avatar">{currentCharacter.avatar}</span>
                <div className="chat-header-text">
                  <span className="chat-header-name">{currentCharacter.name}</span>
                  <span className={`chat-header-status ${chat.streaming ? 'speaking' : ''}`}>
                    {chat.streaming ? '● 正在回复...' : '○ 在线'}
                  </span>
                </div>
              </div>
              <div className="chat-header-actions">
                <button className={`chat-header-btn ${searchOpen ? 'active' : ''}`} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) { setSearchQuery(''); } }} title="搜索对话">🔍</button>
                <button className="chat-header-btn" onClick={() => { chat.clear(); window.speechSynthesis?.cancel() }} title="清空对话">🗑️</button>
                <button className={`chat-header-btn ${voiceEnabled ? 'active' : ''}`} onClick={() => { setVoiceEnabled(!voiceEnabled); if (voiceEnabled) window.speechSynthesis?.cancel() }} title={voiceEnabled ? '关闭语音' : '开启语音'}>{voiceEnabled ? '🔊' : '🔇'}</button>
                <button className="chat-header-btn" onClick={() => setRightPanelOpen(false)} title="折叠面板">›</button>
              </div>
            </div>

            {/* 搜索框 */}
            {searchOpen && (
              <div className="chat-search-bar">
                <input
                  type="text"
                  className="chat-search-input"
                  placeholder="搜索对话内容..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchResults.length > 0 && (
                  <div className="chat-search-nav">
                    <span className="chat-search-count">{currentSearchIndex + 1}/{searchResults.length}</span>
                    <button className="chat-search-btn" onClick={() => jumpToSearchResult(currentSearchIndex - 1)} disabled={currentSearchIndex <= 0}>↑</button>
                    <button className="chat-search-btn" onClick={() => jumpToSearchResult(currentSearchIndex + 1)} disabled={currentSearchIndex >= searchResults.length - 1}>↓</button>
                  </div>
                )}
                {searchQuery && searchResults.length === 0 && (
                  <span className="chat-search-no-result">无结果</span>
                )}
              </div>
            )}

            <div className="chat-panel">
              <div className="chat-messages" ref={chatMessagesRef}>
                {chat.messages.length === 0 && <span className="dim">和数字人聊聊吧～</span>}
                {chat.messages.map((m, i) => {
                  const isSearchResult = searchResults.includes(i)
                  const isCurrentSearch = currentSearchIndex >= 0 && searchResults[currentSearchIndex] === i
                  // 是否隐藏最后一条 assistant 消息（等语音准备好了再展示）
                  // 注意：不依赖 chat.streaming，因为 LLM 输出完成后 streaming 会变 false，但语音可能还没准备好
                  const isLastAssistant = m.role === 'assistant' && i === chat.messages.length - 1
                  const hideAssistantContent = isLastAssistant && !showAssistantReply
                  return (
                    <div key={i} className={`chat-msg ${m.role} ${isSearchResult ? 'search-result' : ''} ${isCurrentSearch ? 'search-current' : ''}`} data-msg-index={i}>
                      <div className="chat-role">{m.role === 'user' ? '你' : 'Firefly'}</div>
                      <div className="chat-content">
                        {hideAssistantContent ? (
                          <span className="dim">正在思考...</span>
                        ) : m.content ? (
                          m.role === 'assistant' ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                              }}
                            >
                              {m.content}
                            </ReactMarkdown>
                          ) : m.content
                        ) : (chat.streaming && i === chat.messages.length - 1 ? '...' : '')}
                      </div>
                    </div>
                  )
                })}
              </div>
              {chat.error && <div className="chat-error">❌ {chat.error}</div>}

              {/* 流式 ASR 中间识别结果 */}
              {mic.active && mic.partialTranscript && (
                <div className="asr-partial">
                  <span className="asr-partial-label">识别中...</span>
                  <span className="asr-partial-text">{mic.partialTranscript}</span>
                </div>
              )}

              <div className="chat-input-row">
                <textarea ref={inputRef} className="chat-input" placeholder="输入消息，Enter 发送，Shift+Enter 换行 (⌘K 聚焦)" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} rows={1} disabled={chat.streaming} />
                {chat.streaming ? (
                  <button className="chat-stop" onClick={() => { chat.stop(); window.speechSynthesis?.cancel() }}>停止</button>
                ) : (
                  <button className="chat-send" onClick={handleSend} disabled={!input.trim()}>发送</button>
                )}
                <button className={`mic-btn ${mic.active ? 'active' : ''} ${mic.loading ? 'loading' : ''}`} onClick={() => {
                  if (mic.active) {
                    // 停止麦克风时，如果输入框中有内容（中间识别结果），自动发送
                    const textToSend = input.trim()
                    mic.stop()
                    if (textToSend && !chat.streaming) {
                      console.log('[App] 麦克风停止，自动发送识别结果:', textToSend)
                      setTimeout(() => {
                        setInput('')
                        setBubble({ text: '正在思考...', visible: true, who: 'ai' })
                        chat.send(textToSend)
                      }, 300) // 延迟一点，等待最终识别结果返回
                    }
                  } else {
                    mic.start({ threshold: 0.01, silenceMs: 300, minSpeechMs: 200 })
                  }
                }} title={mic.loading ? '加载中...' : mic.active ? '停止麦克风（自动发送）' : '开启麦克风'} disabled={mic.loading}>{mic.loading ? '⏳' : mic.active ? '🎙️' : '🎤'}</button>
              </div>

              {/* 音乐播放器：播放列表、切歌、均衡器 */}
              <MusicPlayer
                isSinging={isSinging}
                currentSong={currentSong}
                onStartSinging={(fileOrUrl) => {
                  startSinging(fileOrUrl)
                }}
                onStopSinging={stopSinging}
                audioContextRef={audioContextRef}
                onSongEndedRef={onSongEndedRef}
                effectsChainRef={effectsChainRef}
              />

              {/* 麦克风状态 */}
              {mic.active && (
                <div className="mic-status">
                  <div className="mic-volume-bar"><div className="mic-volume-fill" style={{ width: `${Math.min(100, mic.volume * 500)}%` }} /></div>
                  <span className={`mic-vad ${mic.isSpeaking ? 'speaking' : ''}`}>{mic.isSpeaking ? '● 说话中' : '○ 静音'}</span>
                  <span className="mic-threshold" title={`噪音基线: ${mic.noiseFloor.toFixed(4)}`}>{mic.adaptiveEnabled ? `🎯 ${mic.currentThreshold.toFixed(4)}` : `${mic.currentThreshold.toFixed(4)}`}</span>
                </div>
              )}
              {mic.error && <div className="chat-error">🎤 {mic.error}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
