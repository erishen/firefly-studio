import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { C } from '../theme'
import { useBlink } from '../hooks/useBlink'
import Head from './avatar/Head'
import Body from './avatar/Body'

// 角色装配 + 动画调度中枢（全部用 ref，零每帧 setState）
// - blinkRef：随机眨眼开关（调度在 Stage 里用 useBlink 统一跑，这里只消费）
// - mouthRef：嘴巴开合 0~1，平滑逼近「是否在说话」
export default function Avatar({ speakingRef, onClick, blinkRef }) {
  const mouthRef = useRef(0)

  // 稳定引用，避免每次渲染重建虹膜贴图
  const irisOptions = useMemo(
    () => ({ iris: C.iris, irisLight: C.irisLight, irisDark: C.irisDark }),
    [],
  )

  useFrame((state) => {
    // 嘴巴开合：多层正弦波模拟音频能量变化，让口型更自然
    const t = state.clock.elapsedTime
    let target = 0
    if (speakingRef.current) {
      // 模拟音频能量：多层正弦波叠加
      const energy = 0.5
        + 0.3 * Math.sin(t * 4.0)          // 基频，模拟音节节奏
        + 0.15 * Math.sin(t * 7.3 + 1.2)  // 谐波，模拟音高变化
        + 0.05 * Math.sin(t * 11.7 + 2.5) // 高频扰动
      target = Math.max(0.05, Math.min(0.95, energy))
    }
    mouthRef.current += (target - mouthRef.current) * 0.3
  })

  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        onClick && onClick()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default'
      }}
    >
      <Head mouthRef={mouthRef} blinkRef={blinkRef} irisOptions={irisOptions} />
      <Body />
    </group>
  )
}
