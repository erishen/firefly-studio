import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeIrisTexture } from '../../utils/textures'

// 一只大眼萌眼睛：
// - 外层 group 用 ref 旋转，实现真正的「眼神跟随」（读 state.pointer，零 setState）
// - 内层 group 用 ref 缩放 Y，实现眨眼（同样零 re-render）
// - 虹膜细节全部画在 Canvas 贴图上，避免外部字体/贴图依赖
export default function Eye({ position, blinkRef, irisOptions }) {
  const group = useRef() // 跟随旋转
  const eye = useRef() // 眨眼缩放
  const tex = useMemo(() => makeIrisTexture(irisOptions), [irisOptions])

  useFrame((state) => {
    if (group.current) {
      // 目标角度由鼠标归一化坐标决定，两条眼睛朝同一方向看
      const tx = state.pointer.x * 0.35
      const ty = state.pointer.y * 0.28
      group.current.rotation.y += (tx - group.current.rotation.y) * 0.18
      group.current.rotation.x += (-ty - group.current.rotation.x) * 0.18
    }
    if (eye.current) {
      const sy = blinkRef.current ? 0.12 : 1
      eye.current.scale.y += (sy - eye.current.scale.y) * 0.45
    }
  })

  return (
    <group position={position} ref={group}>
      {/* 眼球（缩放层）：眼白球 + 虹膜贴图盘 */}
      <group ref={eye}>
        <mesh scale={[1, 1.12, 1]}>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshStandardMaterial color="#ffffff" roughness={0.25} />
        </mesh>
        <mesh position={[0, 0, 0.115]}>
          <circleGeometry args={[0.14, 32]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} />
        </mesh>
      </group>

      {/* 上眼睑（肤色，半盖，不随眨眼缩放） */}
      <mesh position={[0, 0.085, 0.13]} scale={[1, 0.6, 1]}>
        <sphereGeometry args={[0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color="#f3c9a3" roughness={0.6} />
      </mesh>

      {/* 睫毛（一笔深色，增加神采） */}
      <mesh position={[0, 0.142, 0.12]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[0.21, 0.022, 0.04]} />
        <meshStandardMaterial color="#3a2a22" roughness={0.8} />
      </mesh>
    </group>
  )
}
