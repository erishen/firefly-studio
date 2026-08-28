import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

// 呼吸/微浮动：用 ref 操作 group，不触发 React 重渲染
export default function Breathing({ children }) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime
    ref.current.position.y = Math.sin(t * 1.1) * 0.02
    ref.current.rotation.z = Math.sin(t * 0.5) * 0.006
  })
  return <group ref={ref}>{children}</group>
}
