/**
 * 音频效果处理工具
 * 提供均衡器、混响、淡入淡出等音效处理
 */

// 10段均衡器频率（Hz）
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

// 均衡器预设
export const EQ_PRESETS = {
  flat: {
    name: '平直',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  pop: {
    name: '流行',
    gains: [-1, 1, 3, 5, 3, 0, -1, 0, 2, 3],
  },
  rock: {
    name: '摇滚',
    gains: [5, 4, 3, 1, -1, -1, 0, 2, 4, 5],
  },
  classical: {
    name: '古典',
    gains: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4],
  },
  jazz: {
    name: '爵士',
    gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  },
  vocal: {
    name: '人声增强',
    gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  },
  bass: {
    name: '低音增强',
    gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  },
  treble: {
    name: '高音增强',
    gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  },
}

/**
 * 创建均衡器节点链
 * @param {AudioContext} audioContext - 音频上下文
 * @param {number[]} gains - 10段增益值（dB）
 * @returns {Object} 包含 inputNode、outputNode、filters 的对象
 */
export function createEQ(audioContext, gains = EQ_PRESETS.flat.gains) {
  const filters = []

  for (let i = 0; i < EQ_FREQUENCIES.length; i++) {
    const filter = audioContext.createBiquadFilter()
    filter.type = i === 0 ? 'lowshelf' : i === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking'
    filter.frequency.value = EQ_FREQUENCIES[i]
    filter.Q.value = 1.0
    filter.gain.value = gains[i] || 0
    filters.push(filter)
  }

  // 串联滤波器
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1])
  }

  return {
    inputNode: filters[0],
    outputNode: filters[filters.length - 1],
    filters,
    setGains(newGains) {
      for (let i = 0; i < filters.length; i++) {
        if (newGains[i] !== undefined) {
          filters[i].gain.value = newGains[i]
        }
      }
    },
    setBand(index, gain) {
      if (filters[index]) {
        filters[index].gain.value = gain
      }
    },
  }
}

/**
 * 创建混响效果（使用卷积混响）
 * @param {AudioContext} audioContext - 音频上下文
 * @param {number} duration - 混响时长（秒）
 * @param {number} decay - 衰减系数
 * @returns {Object} 包含 inputNode、outputNode、wetGain、dryGain 的对象
 */
export function createReverb(audioContext, duration = 2, decay = 2) {
  // 生成脉冲响应
  const rate = audioContext.sampleRate
  const length = rate * duration
  const impulse = audioContext.createBuffer(2, length, rate)

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }

  const convolver = audioContext.createConvolver()
  convolver.buffer = impulse

  const wetGain = audioContext.createGain()
  const dryGain = audioContext.createGain()
  wetGain.gain.value = 0.3
  dryGain.gain.value = 0.7

  // 干信号直接输出
  // 湿信号经过混响
  const inputNode = audioContext.createGain()
  inputNode.connect(dryGain)
  inputNode.connect(convolver)
  convolver.connect(wetGain)

  const outputNode = audioContext.createGain()
  dryGain.connect(outputNode)
  wetGain.connect(outputNode)

  return {
    inputNode,
    outputNode,
    wetGain,
    dryGain,
    setWet(value) {
      wetGain.gain.value = value
    },
    setDry(value) {
      dryGain.gain.value = value
    },
  }
}

/**
 * 创建压缩器（动态范围压缩）
 * @param {AudioContext} audioContext - 音频上下文
 * @param {Object} options - 压缩器参数
 * @returns {DynamicsCompressorNode} 压缩器节点
 */
export function createCompressor(audioContext, options = {}) {
  const compressor = audioContext.createDynamicsCompressor()
  compressor.threshold.value = options.threshold ?? -24
  compressor.knee.value = options.knee ?? 30
  compressor.ratio.value = options.ratio ?? 12
  compressor.attack.value = options.attack ?? 0.003
  compressor.release.value = options.release ?? 0.25
  return compressor
}

/**
 * 淡入
 * @param {AudioParam} gainParam - 增益参数
 * @param {number} startTime - 开始时间
 * @param {number} duration - 持续时间
 * @param {number} targetValue - 目标值
 */
export function fadeIn(gainParam, startTime, duration = 1, targetValue = 1) {
  gainParam.setValueAtTime(0, startTime)
  gainParam.linearRampToValueAtTime(targetValue, startTime + duration)
}

/**
 * 淡出
 * @param {AudioParam} gainParam - 增益参数
 * @param {number} startTime - 开始时间
 * @param {number} duration - 持续时间
 */
export function fadeOut(gainParam, startTime, duration = 1) {
  gainParam.setValueAtTime(gainParam.value, startTime)
  gainParam.linearRampToValueAtTime(0, startTime + duration)
}

/**
 * 计算音频的 RMS 能量（用于音量归一化）
 * @param {AudioBuffer} audioBuffer - 音频缓冲区
 * @returns {number} RMS 能量值
 */
export function calculateRMS(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0)
  let sum = 0
  for (let i = 0; i < channelData.length; i++) {
    sum += channelData[i] * channelData[i]
  }
  return Math.sqrt(sum / channelData.length)
}

/**
 * 音量归一化（调整增益使 RMS 达到目标值）
 * @param {AudioBuffer} audioBuffer - 音频缓冲区
 * @param {number} targetRMS - 目标 RMS 值（默认 -16dBFS ≈ 0.158）
 * @returns {number} 建议的增益值
 */
export function normalizeVolume(audioBuffer, targetRMS = 0.158) {
  const currentRMS = calculateRMS(audioBuffer)
  if (currentRMS === 0) return 1
  const gain = targetRMS / currentRMS
  // 限制最大增益，避免爆音
  return Math.min(gain, 3.0)
}

/**
 * 创建完整的音效处理链
 * @param {AudioContext} audioContext - 音频上下文
 * @param {Object} options - 音效选项
 * @returns {Object} 包含 inputNode、outputNode 和各效果节点的对象
 */
export function createAudioEffectsChain(audioContext, options = {}) {
  const {
    eqGains = EQ_PRESETS.flat.gains,
    reverbEnabled = false,
    reverbWet = 0.3,
    compressorEnabled = true,
    masterVolume = 0.8,
  } = options

  // 输入节点
  const inputNode = audioContext.createGain()

  // 均衡器
  const eq = createEQ(audioContext, eqGains)

  // 压缩器
  const compressor = compressorEnabled ? createCompressor(audioContext) : null

  // 混响
  const reverb = reverbEnabled ? createReverb(audioContext) : null
  if (reverb) {
    reverb.setWet(reverbWet)
  }

  // 主增益
  const masterGain = audioContext.createGain()
  masterGain.gain.value = masterVolume

  // 连接节点
  let currentNode = inputNode
  currentNode.connect(eq.inputNode)
  currentNode = eq.outputNode

  if (compressor) {
    currentNode.connect(compressor)
    currentNode = compressor
  }

  if (reverb) {
    currentNode.connect(reverb.inputNode)
    currentNode = reverb.outputNode
  }

  currentNode.connect(masterGain)

  return {
    inputNode,
    outputNode: masterGain,
    eq,
    compressor,
    reverb,
    masterGain,
    setEQGains(gains) {
      eq.setGains(gains)
    },
    setEQPreset(presetName) {
      const preset = EQ_PRESETS[presetName]
      if (preset) {
        eq.setGains(preset.gains)
      }
    },
    setReverbEnabled(enabled) {
      if (reverb) {
        reverb.wetGain.gain.value = enabled ? reverbWet : 0
      }
    },
    setReverbWet(value) {
      if (reverb) {
        reverb.setWet(value)
      }
    },
    setMasterVolume(value) {
      masterGain.gain.value = value
    },
    fadeIn(duration = 1) {
      fadeIn(masterGain.gain, audioContext.currentTime, duration, masterVolume)
    },
    fadeOut(duration = 1) {
      fadeOut(masterGain.gain, audioContext.currentTime, duration)
    },
  }
}
