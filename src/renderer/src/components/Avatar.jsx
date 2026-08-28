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

  useFrame(() => {
    // 嘴巴开合
    const target = speakingRef.current ? 1 : 0
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
