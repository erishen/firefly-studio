import { useState, useEffect } from 'react'

/**
 * 设置面板组件
 * - TTS 提供商切换
 * - TTS 声音选择
 * - TTS 语速/音量调整
 * - ASR 模型选择
 * - ASR 后处理开关
 * - 流式 ASR 开关
 * - VAD 阈值调整
 * - 自适应阈值开关
 * - 数字人显示开关
 * - 气泡显示开关
 * - 自动播放语音开关
 * - 配置重置
 */
export function SettingsPanel({ onClose, onConfigChange, theme = 'dark', onThemeChange }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [inputDevices, setInputDevices] = useState([])
  const [outputDevices, setOutputDevices] = useState([])
  const [devicesLoading, setDevicesLoading] = useState(true)

  useEffect(() => {
    loadConfig()
    loadDevices()
  }, [])

  const loadConfig = async () => {
    try {
      const cfg = await window.electronAPI?.config?.get()
      setConfig(cfg)
    } catch (e) {
      console.error('[Settings] 加载配置失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadDevices = async () => {
    try {
      setDevicesLoading(true)
      const [inputs, outputs] = await Promise.all([
        window.electronAPI?.devices?.getInputDevices?.(),
        window.electronAPI?.devices?.getOutputDevices?.(),
      ])
      setInputDevices(inputs || [])
      setOutputDevices(outputs || [])
    } catch (e) {
      console.error('[Settings] 加载设备列表失败:', e)
    } finally {
      setDevicesLoading(false)
    }
  }

  const updateConfig = async (updates) => {
    try {
      const newConfig = await window.electronAPI?.config?.set(updates)
      setConfig(newConfig)
      onConfigChange?.(newConfig)
    } catch (e) {
      console.error('[Settings] 更新配置失败:', e)
    }
  }

  const resetConfig = async () => {
    if (!window.confirm('确定要重置所有设置吗？')) return
    try {
      const defaults = {
        ttsProvider: 'piper',
        ttsVoice: 'zh-CN-XiaoxiaoNeural',
        ttsRate: 1.0,
        ttsVolume: 1.0,
        asrModel: 'base',
        asrPostprocess: true,
        streamingAsr: true,
        vadThreshold: 0.015,
        adaptiveThreshold: true,
        showAvatar: true,
        showBubble: true,
        autoPlayVoice: true,
        voiceEnabled: true,
      }
      const newConfig = await window.electronAPI?.config?.set(defaults)
      setConfig(newConfig)
      onConfigChange?.(newConfig)
    } catch (e) {
      console.error('[Settings] 重置配置失败:', e)
    }
  }

  if (loading) {
    return <div className="settings-panel">加载中...</div>
  }

  // edge-tts 常用中文语音
  const edgeTtsVoices = [
    { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声，自然）' },
    { value: 'zh-CN-YunxiNeural', label: '云希（男声，阳光）' },
    { value: 'zh-CN-YunyangNeural', label: '云扬（男声，沉稳）' },
    { value: 'zh-CN-XiaoyiNeural', label: '晓伊（女声，温柔）' },
    { value: 'zh-CN-YunjianNeural', label: '云健（男声，刚毅）' },
  ]

  // ASR 模型选项
  const asrModels = [
    { value: 'tiny', label: 'tiny（最快，准确率低）' },
    { value: 'base', label: 'base（平衡，推荐）' },
    { value: 'small', label: 'small（较慢，准确率高）' },
    { value: 'medium', label: 'medium（最慢，准确率最高）' },
  ]

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>⚙️ 设置</h3>
        <div className="settings-header-actions">
          <button className="settings-reset" onClick={resetConfig} title="重置所有设置">↺</button>
          <button className="settings-close" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="settings-content">
        {/* TTS 提供商 */}
        <div className="settings-section">
          <label className="settings-label">TTS 提供商</label>
          <select
            className="settings-select"
            value={config?.ttsProvider || 'piper'}
            onChange={(e) => updateConfig({ ttsProvider: e.target.value })}
          >
            <option value="piper">Piper（本地离线，免费）</option>
            <option value="edge-tts">edge-tts（在线，音质更好）</option>
          </select>
          <div className="settings-hint">Piper 本地运行，edge-tts 需要网络</div>
        </div>

        {/* TTS 声音选择（仅 edge-tts 有效） */}
        {config?.ttsProvider === 'edge-tts' && (
          <div className="settings-section">
            <label className="settings-label">TTS 语音</label>
            <select
              className="settings-select"
              value={config?.ttsVoice || 'zh-CN-XiaoxiaoNeural'}
              onChange={(e) => updateConfig({ ttsVoice: e.target.value })}
            >
              {edgeTtsVoices.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* TTS 语速 */}
        <div className="settings-section">
          <label className="settings-label">
            语速: {config?.ttsRate?.toFixed(1) || '1.0'}x
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={config?.ttsRate || 1.0}
            onChange={(e) => updateConfig({ ttsRate: parseFloat(e.target.value) })}
            className="settings-slider"
          />
        </div>

        {/* TTS 音量 */}
        <div className="settings-section">
          <label className="settings-label">
            音量: {Math.round((config?.ttsVolume || 1.0) * 100)}%
          </label>
          <input
            type="range"
            min="0.0"
            max="1.0"
            step="0.1"
            value={config?.ttsVolume || 1.0}
            onChange={(e) => updateConfig({ ttsVolume: parseFloat(e.target.value) })}
            className="settings-slider"
          />
        </div>

        {/* 分隔线 */}
        <div className="settings-divider" />

        {/* ASR 模型选择 */}
        <div className="settings-section">
          <label className="settings-label">ASR 模型</label>
          <select
            className="settings-select"
            value={config?.asrModel || 'base'}
            onChange={(e) => updateConfig({ asrModel: e.target.value })}
          >
            {asrModels.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <div className="settings-hint">切换模型需要重启麦克风生效</div>
        </div>

        {/* ASR 后处理开关 */}
        <div className="settings-section settings-toggle-row">
          <label className="settings-label">ASR 后处理</label>
          <button
            className={`settings-toggle ${config?.asrPostprocess ? 'on' : 'off'}`}
            onClick={() => updateConfig({ asrPostprocess: !config?.asrPostprocess })}
          >
            {config?.asrPostprocess ? '开启' : '关闭'}
          </button>
          <div className="settings-hint">自动去除重复词、添加标点符号</div>
        </div>

        {/* 流式 ASR 开关 */}
        <div className="settings-section settings-toggle-row">
          <label className="settings-label">流式 ASR</label>
          <button
            className={`settings-toggle ${config?.streamingAsr ? 'on' : 'off'}`}
            onClick={() => updateConfig({ streamingAsr: !config?.streamingAsr })}
          >
            {config?.streamingAsr ? '开启' : '关闭'}
          </button>
          <div className="settings-hint">说话过程中实时显示识别结果</div>
        </div>

        {/* VAD 阈值 */}
        <div className="settings-section">
          <label className="settings-label">
            VAD 阈值: {config?.vadThreshold?.toFixed(4) || '0.0150'}
          </label>
          <input
            type="range"
            min="0.005"
            max="0.05"
            step="0.001"
            value={config?.vadThreshold || 0.015}
            onChange={(e) => updateConfig({ vadThreshold: parseFloat(e.target.value) })}
            className="settings-slider"
            disabled={config?.adaptiveThreshold}
          />
          <div className="settings-hint">
            {config?.adaptiveThreshold ? '自适应阈值已启用，此设置暂不生效' : '值越小越灵敏，值越大抗干扰越强'}
          </div>
        </div>

        {/* 自适应阈值开关 */}
        <div className="settings-section settings-toggle-row">
          <label className="settings-label">自适应阈值</label>
          <button
            className={`settings-toggle ${config?.adaptiveThreshold ? 'on' : 'off'}`}
            onClick={() => updateConfig({ adaptiveThreshold: !config?.adaptiveThreshold })}
          >
            {config?.adaptiveThreshold ? '开启' : '关闭'}
          </button>
          <div className="settings-hint">根据环境噪音自动调整阈值</div>
        </div>

        {/* 分隔线 */}
        <div className="settings-divider" />

        {/* 音频设备选择 */}
        <div className="settings-section">
          <label className="settings-label">输入设备（麦克风）</label>
          {devicesLoading ? (
            <div className="settings-hint">加载中...</div>
          ) : inputDevices.length > 0 ? (
            <select
              className="settings-select"
              value={config?.inputDeviceId || ''}
              onChange={(e) => updateConfig({ inputDeviceId: e.target.value })}
              disabled
            >
              {inputDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.isDefault ? '（默认）' : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="settings-hint">未检测到输入设备</div>
          )}
          <div className="settings-hint">设备切换功能开发中，当前使用系统默认设备</div>
        </div>

        <div className="settings-section">
          <label className="settings-label">输出设备（扬声器）</label>
          {devicesLoading ? (
            <div className="settings-hint">加载中...</div>
          ) : outputDevices.length > 0 ? (
            <select
              className="settings-select"
              value={config?.outputDeviceId || ''}
              onChange={(e) => updateConfig({ outputDeviceId: e.target.value })}
              disabled
            >
              {outputDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.isDefault ? '（默认）' : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="settings-hint">未检测到输出设备</div>
          )}
          <div className="settings-hint">设备切换功能开发中，当前使用系统默认设备</div>
        </div>

        {/* 分隔线 */}
        <div className="settings-divider" />

        {/* 主题切换 */}
        <div className="settings-section">
          <label className="settings-label">主题</label>
          <select
            className="settings-select"
            value={theme}
            onChange={(e) => onThemeChange?.(e.target.value)}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
            <option value="system">跟随系统</option>
          </select>
          <div className="settings-hint">切换应用主题，设置自动保存</div>
        </div>

        {/* 分隔线 */}
        <div className="settings-divider" />

        {/* 数字人显示开关 */}
        <div className="settings-section settings-toggle-row">
          <label className="settings-label">显示数字人</label>
          <button
            className={`settings-toggle ${config?.showAvatar ? 'on' : 'off'}`}
            onClick={() => updateConfig({ showAvatar: !config?.showAvatar })}
          >
            {config?.showAvatar ? '开启' : '关闭'}
          </button>
          <div className="settings-hint">关闭后只显示聊天面板</div>
        </div>

        {/* 气泡显示开关 */}
        <div className="settings-section settings-toggle-row">
          <label className="settings-label">显示气泡</label>
          <button
            className={`settings-toggle ${config?.showBubble ? 'on' : 'off'}`}
            onClick={() => updateConfig({ showBubble: !config?.showBubble })}
          >
            {config?.showBubble ? '开启' : '关闭'}
          </button>
          <div className="settings-hint">数字人头顶的文字气泡</div>
        </div>

        {/* 自动播放语音开关 */}
        <div className="settings-section settings-toggle-row">
          <label className="settings-label">自动播放语音</label>
          <button
            className={`settings-toggle ${config?.autoPlayVoice ? 'on' : 'off'}`}
            onClick={() => updateConfig({ autoPlayVoice: !config?.autoPlayVoice })}
          >
            {config?.autoPlayVoice ? '开启' : '关闭'}
          </button>
          <div className="settings-hint">AI 回复后自动语音播放</div>
        </div>
      </div>
    </div>
  )
}
