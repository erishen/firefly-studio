import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  createAudioEffectsChain,
  EQ_PRESETS,
  EQ_FREQUENCIES,
  normalizeVolume,
} from '../utils/audioEffects'

/**
 * 音乐播放器组件
 * 功能：播放列表、切歌、均衡器、音量控制、播放模式
 */
export default function MusicPlayer({
  isSinging,
  currentSong,
  onStartSinging,
  onStopSinging,
  audioContextRef,
  onSongEndedRef,
  effectsChainRef, // 从 App.jsx 传递进来的实际音效处理链
}) {
  // 播放列表（从 localStorage 加载持久化的歌曲）
  const [playlist, setPlaylist] = useState(() => {
    try {
      const saved = localStorage.getItem('firefly-playlist')
      if (saved) {
        const songs = JSON.parse(saved)
        console.log('[音乐播放器] 从 localStorage 加载了', songs.length, '首歌曲')
        return songs
      }
    } catch (e) {
      console.warn('[音乐播放器] 加载播放列表失败:', e)
    }
    return [{ name: '示例歌曲', url: '/audio/sample-song.mp3', type: 'url' }]
  })
  const [currentIndex, setCurrentIndex] = useState(0)

  // 持久化播放列表到 localStorage（只保存可序列化的信息，不保存 File 对象）
  useEffect(() => {
    try {
      const serializable = playlist.map((song) => ({
        name: song.name,
        type: song.type,
        url: song.url || null,
        // 优先使用显式保存的 filePath，其次使用 File 对象的 path 属性
        filePath: song.filePath || song.file?.path || null,
      }))
      localStorage.setItem('firefly-playlist', JSON.stringify(serializable))
      console.log('[音乐播放器] 播放列表已保存:', serializable.length, '首歌曲')
      serializable.forEach((s, i) => {
        console.log(`  [${i}] ${s.name} | url: ${s.url} | filePath: ${s.filePath}`)
      })
    } catch (e) {
      console.warn('[音乐播放器] 保存播放列表失败:', e)
    }
  }, [playlist])

  // 播放模式：'sequence' | 'random' | 'loop' | 'single'
  const [playMode, setPlayMode] = useState('sequence')

  // 音效设置
  const [eqPreset, setEqPreset] = useState('flat')
  const [eqGains, setEqGains] = useState(EQ_PRESETS.flat.gains)
  const [reverbEnabled, setReverbEnabled] = useState(false)
  const [reverbWet, setReverbWet] = useState(0.3)
  const [masterVolume, setMasterVolume] = useState(0.8)
  const [normalizeEnabled, setNormalizeEnabled] = useState(true)

  // 面板显示
  const [showPlaylist, setShowPlaylist] = useState(false)
  const [showEQ, setShowEQ] = useState(false)

  // 当新歌曲开始播放时，应用当前的均衡器设置
  // 因为 startSinging 会创建新的音效处理链，默认是平直均衡器
  useEffect(() => {
    if (isSinging && effectsChainRef?.current) {
      console.log('[音乐播放器] 新歌曲开始播放，应用当前音效设置')
      // 应用均衡器设置
      effectsChainRef.current.setEQGains(eqGains)
      // 应用混响设置
      effectsChainRef.current.setReverbEnabled(reverbEnabled)
      effectsChainRef.current.setReverbWet(reverbWet)
      // 应用主音量
      effectsChainRef.current.setMasterVolume(masterVolume)
    }
  }, [isSinging]) // 只在 isSinging 变化时触发

  // 获取歌曲的可播放源（URL 或 File 对象或本地文件路径）
  const getSongSource = useCallback((song) => {
    if (!song) {
      console.warn('[音乐播放器] 歌曲为空')
      return null
    }
    if (song.url) {
      console.log('[音乐播放器] 使用 URL:', song.url)
      return song.url
    }
    if (song.file) {
      console.log('[音乐播放器] 使用 File 对象:', song.file.name)
      return song.file
    }
    // 从 localStorage 加载的歌曲只有文件路径，直接返回路径（startSinging 会通过 IPC 读取）
    if (song.filePath) {
      console.log('[音乐播放器] 使用本地文件路径:', song.filePath)
      return song.filePath
    }
    console.warn('[音乐播放器] 歌曲没有可播放的源:', song)
    return null
  }, [])

  // 播放下一首
  const playNext = useCallback(() => {
    if (playlist.length === 0) return

    let nextIndex
    if (playMode === 'single') {
      // 单曲循环：重播当前
      nextIndex = currentIndex
    } else if (playMode === 'random') {
      // 随机播放
      nextIndex = Math.floor(Math.random() * playlist.length)
    } else {
      // 顺序播放 / 列表循环
      nextIndex = (currentIndex + 1) % playlist.length
    }

    setCurrentIndex(nextIndex)
    const song = playlist[nextIndex]
    const source = getSongSource(song)
    if (source) {
      onStartSinging(source)
    }
  }, [playlist, currentIndex, playMode, onStartSinging, getSongSource])

  // 播放上一首
  const playPrev = useCallback(() => {
    if (playlist.length === 0) return

    let prevIndex
    if (playMode === 'random') {
      prevIndex = Math.floor(Math.random() * playlist.length)
    } else {
      prevIndex = (currentIndex - 1 + playlist.length) % playlist.length
    }

    setCurrentIndex(prevIndex)
    const song = playlist[prevIndex]
    const source = getSongSource(song)
    if (source) {
      onStartSinging(source)
    }
  }, [playlist, currentIndex, playMode, onStartSinging, getSongSource])

  // 设置播放结束回调，用于自动切歌
  useEffect(() => {
    if (onSongEndedRef) {
      onSongEndedRef.current = () => {
        console.log('[音乐播放器] 播放结束，自动切歌')
        // 延迟一点，确保 stopSinging 完成
        setTimeout(() => {
          playNext()
        }, 300)
      }
    }
    return () => {
      if (onSongEndedRef) {
        onSongEndedRef.current = null
      }
    }
  }, [onSongEndedRef, playNext])

  // 播放指定歌曲
  const playSong = useCallback((index) => {
    if (index < 0 || index >= playlist.length) return
    setCurrentIndex(index)
    const song = playlist[index]
    const source = getSongSource(song)
    if (source) {
      onStartSinging(source)
    }
  }, [playlist, onStartSinging, getSongSource])

  // 切换播放模式
  const togglePlayMode = useCallback(() => {
    const modes = ['sequence', 'loop', 'single', 'random']
    const modeNames = {
      sequence: '顺序播放',
      loop: '列表循环',
      single: '单曲循环',
      random: '随机播放',
    }
    const currentModeIndex = modes.indexOf(playMode)
    const nextMode = modes[(currentModeIndex + 1) % modes.length]
    setPlayMode(nextMode)
    console.log('[音乐播放器] 播放模式:', modeNames[nextMode])
  }, [playMode])

  // 应用均衡器预设
  const applyEQPreset = useCallback((presetName) => {
    const preset = EQ_PRESETS[presetName]
    if (preset) {
      setEqPreset(presetName)
      setEqGains([...preset.gains])
      if (effectsChainRef.current) {
        effectsChainRef.current.setEQGains(preset.gains)
      }
    }
  }, [])

  // 调整单个频段
  const adjustEQBand = useCallback((index, gain) => {
    const newGains = [...eqGains]
    newGains[index] = gain
    setEqGains(newGains)
    setEqPreset('custom')
    if (effectsChainRef.current) {
      effectsChainRef.current.eq.setBand(index, gain)
    }
  }, [eqGains])

  // 添加本地歌曲文件（支持 File 对象数组或文件路径数组）
  const addLocalSongs = useCallback((filesOrPaths) => {
    if (!filesOrPaths || filesOrPaths.length === 0) return

    // 从文件路径中提取文件名（不依赖 path 模块）
    const getFileNameFromPath = (filePath) => {
      const parts = filePath.split(/[/\\]/)
      const fileName = parts[parts.length - 1]
      return fileName.replace(/\.[^/.]+$/, '')
    }

    const newSongs = Array.from(filesOrPaths).map((item) => {
      // 判断是 File 对象还是文件路径字符串
      if (typeof item === 'string') {
        // 文件路径字符串（从对话框获取，最可靠）
        const name = getFileNameFromPath(item)
        console.log('[音乐播放器] 添加歌曲（路径）:', name, '路径:', item)
        return {
          name: name,
          file: null,
          filePath: item,
          type: 'file',
        }
      } else {
        // File 对象（从 input 获取，path 属性可能不可靠）
        const filePath = item.path || item.filePath || null
        const name = item.name.replace(/\.[^/.]+$/, '')
        console.log('[音乐播放器] 添加歌曲（File）:', name, '路径:', filePath)
        return {
          name: name,
          file: item,
          filePath: filePath,
          type: 'file',
        }
      }
    })
    setPlaylist((prev) => [...prev, ...newSongs])
    console.log('[音乐播放器] 添加了', newSongs.length, '首歌曲')
  }, [])

  // 通过系统文件选择对话框添加歌曲（最可靠，直接获取文件路径）
  const addSongsViaDialog = useCallback(async () => {
    try {
      if (!window.electronAPI?.dialog?.openFiles) {
        console.warn('[音乐播放器] window.electronAPI.dialog.openFiles 不可用，回退到 input 方式')
        // 回退：触发隐藏的 input
        document.getElementById('music-file-input')?.click()
        return
      }
      const result = await window.electronAPI.dialog.openFiles({
        title: '选择音乐文件',
        filters: [
          { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'] },
          { name: '所有文件', extensions: ['*'] },
        ],
        properties: ['openFile', 'multiSelections'],
      })
      if (result.ok && !result.canceled && result.files.length > 0) {
        addLocalSongs(result.files)
      }
    } catch (e) {
      console.error('[音乐播放器] 打开文件对话框失败:', e)
    }
  }, [addLocalSongs])

  // 从播放列表移除歌曲
  const removeSong = useCallback((index) => {
    setPlaylist((prev) => prev.filter((_, i) => i !== index))
    if (index === currentIndex) {
      onStopSinging()
    } else if (index < currentIndex) {
      setCurrentIndex((prev) => prev - 1)
    }
  }, [currentIndex, onStopSinging])

  // 播放模式图标
  const playModeIcon = {
    sequence: '🔢',
    loop: '🔁',
    single: '🔂',
    random: '🔀',
  }

  const playModeName = {
    sequence: '顺序',
    loop: '列表循环',
    single: '单曲',
    random: '随机',
  }

  return (
    <div className="music-player">
      {/* 播放控制栏 */}
      <div className="music-controls">
        {/* 上一首 */}
        <button
          className="music-btn"
          onClick={playPrev}
          title="上一首"
          disabled={playlist.length === 0}
        >
          ⏮️
        </button>

        {/* 播放/暂停 */}
        <button
          className={`music-btn play-btn ${isSinging ? 'playing' : ''}`}
          onClick={() => {
            if (isSinging) {
              onStopSinging()
            } else if (playlist.length > 0) {
              playSong(currentIndex)
            }
          }}
          title={isSinging ? '停止' : '播放'}
        >
          {isSinging ? '⏹️' : '▶️'}
        </button>

        {/* 下一首 */}
        <button
          className="music-btn"
          onClick={playNext}
          title="下一首"
          disabled={playlist.length === 0}
        >
          ⏭️
        </button>

        {/* 播放模式 */}
        <button
          className="music-btn mode-btn"
          onClick={togglePlayMode}
          title={`播放模式: ${playModeName[playMode]}`}
        >
          {playModeIcon[playMode]}
        </button>

        {/* 当前歌曲信息 */}
        <div className="current-song-info">
          {currentSong ? (
            <span className="song-name">🎵 {currentSong.name}</span>
          ) : (
            <span className="song-name placeholder">未播放</span>
          )}
        </div>

        {/* 播放列表按钮 */}
        <button
          className={`music-btn ${showPlaylist ? 'active' : ''}`}
          onClick={() => setShowPlaylist(!showPlaylist)}
          title="播放列表"
        >
          📋
        </button>

        {/* 均衡器按钮 */}
        <button
          className={`music-btn ${showEQ ? 'active' : ''}`}
          onClick={() => setShowEQ(!showEQ)}
          title="均衡器"
        >
          🎚️
        </button>
      </div>

      {/* 播放列表面板 */}
      {showPlaylist && (
        <div className="playlist-panel">
          <div className="panel-header">
            <span>播放列表 ({playlist.length} 首)</span>
            <button
              className="add-songs-btn"
              onClick={addSongsViaDialog}
              title="选择音乐文件添加到播放列表"
            >
              ➕ 添加歌曲
            </button>
            {/* 隐藏的 input 作为回退方案（当 dialog API 不可用时） */}
            <input
              id="music-file-input"
              type="file"
              accept="audio/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length) {
                  addLocalSongs(e.target.files)
                }
                e.target.value = ''
              }}
            />
          </div>
          <div className="playlist-items">
            {playlist.map((song, index) => (
              <div
                key={index}
                className={`playlist-item ${index === currentIndex && isSinging ? 'playing' : ''}`}
                onClick={() => playSong(index)}
              >
                <span className="item-index">{index + 1}</span>
                <span className="item-name">{song.name}</span>
                <button
                  className="item-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeSong(index)
                  }}
                  title="移除"
                >
                  ✕
                </button>
              </div>
            ))}
            {playlist.length === 0 && (
              <div className="playlist-empty">播放列表为空，点击上方按钮添加歌曲</div>
            )}
          </div>
        </div>
      )}

      {/* 均衡器面板 */}
      {showEQ && (
        <div className="eq-panel">
          <div className="panel-header">
            <span>均衡器</span>
            <div className="eq-options">
              <label className="eq-toggle">
                <input
                  type="checkbox"
                  checked={normalizeEnabled}
                  onChange={(e) => setNormalizeEnabled(e.target.checked)}
                />
                音量归一化
              </label>
              <label className="eq-toggle">
                <input
                  type="checkbox"
                  checked={reverbEnabled}
                  onChange={(e) => {
                    setReverbEnabled(e.target.checked)
                    if (effectsChainRef.current) {
                      effectsChainRef.current.setReverbEnabled(e.target.checked)
                    }
                  }}
                />
                混响
              </label>
            </div>
          </div>

          {/* 预设选择 */}
          <div className="eq-presets">
            {Object.entries(EQ_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                className={`eq-preset-btn ${eqPreset === key ? 'active' : ''}`}
                onClick={() => applyEQPreset(key)}
              >
                {preset.name}
              </button>
            ))}
          </div>

          {/* 10段均衡器滑块 */}
          <div className="eq-sliders">
            {EQ_FREQUENCIES.map((freq, index) => (
              <div key={freq} className="eq-slider-item">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={eqGains[index] || 0}
                  onChange={(e) => adjustEQBand(index, parseFloat(e.target.value))}
                  className="eq-slider"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                />
                <span className="eq-freq-label">
                  {freq >= 1000 ? `${freq / 1000}k` : freq}
                </span>
                <span className="eq-gain-label">{eqGains[index] || 0}dB</span>
              </div>
            ))}
          </div>

          {/* 混响强度 */}
          {reverbEnabled && (
            <div className="reverb-control">
              <span>混响强度</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={reverbWet}
                onChange={(e) => {
                  const value = parseFloat(e.target.value)
                  setReverbWet(value)
                  if (effectsChainRef.current) {
                    effectsChainRef.current.setReverbWet(value)
                  }
                }}
              />
              <span>{(reverbWet * 100).toFixed(0)}%</span>
            </div>
          )}

          {/* 主音量 */}
          <div className="master-volume">
            <span>主音量</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={masterVolume}
              onChange={(e) => {
                const value = parseFloat(e.target.value)
                setMasterVolume(value)
                if (effectsChainRef.current) {
                  effectsChainRef.current.setMasterVolume(value)
                }
              }}
            />
            <span>{(masterVolume * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

// 导出音效链创建函数，供 App.jsx 使用
export { createAudioEffectsChain, normalizeVolume }
