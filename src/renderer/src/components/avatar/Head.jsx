import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { C } from '../../theme'
import Eye from './Eye'
import Hair from './Hair'

// 头部：脸 + 腮红 + 双眼 + 眉 + 鼻 + 嘴（用 ref 缩放驱动开合）
// 头部本身也轻微跟随指针，增强「在看你」的感觉
export default function Head({ mouthRef, blinkRef, irisOptions }) {
  const group = useRef()
  const mouth = useRef()

  useFrame((state) => {
    if (group.current) {
      const tx = state.pointer.x * 0.12
      const ty = -state.pointer.y * 0.08
      group.current.rotation.y += (tx - group.current.rotation.y) * 0.1
      group.current.rotation.x += (ty - group.current.rotation.x) * 0.1
    }
    if (mouth.current) {
      // mouthRef.current 由 Avatar 在 0~1 之间平滑驱动
      const open = mouthRef.current
      mouth.current.scale.set(1, 0.35 + open * 1.5, 1)
    }
  })

  return (
    <group position={[0, 1.5, 0]} ref={group}>
      {/* 脸 */}
      <mesh castShadow>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color={C.skin} roughness={0.45} />
      </mesh>

      {/* 腮红 */}
      <mesh position={[-0.3, -0.05, 0.4]}>
        <circleGeometry args={[0.08, 24]} />
        <meshBasicMaterial color={C.blush} transparent opacity={0.4} />
      </mesh>
      <mesh position={[0.3, -0.05, 0.4]}>
        <circleGeometry args={[0.08, 24]} />
        <meshBasicMaterial color={C.blush} transparent opacity={0.4} />
      </mesh>

      {/* 双眼（真·跟随） */}
      <Eye position={[-0.19, 0.06, 0.4]} blinkRef={blinkRef} irisOptions={irisOptions} />
      <Eye position={[0.19, 0.06, 0.4]} blinkRef={blinkRef} irisOptions={irisOptions} />

      {/* 眉毛 */}
      <mesh position={[-0.2, 0.24, 0.44]} rotation={[0, 0, -0.08]}>
        <boxGeometry args={[0.16, 0.028, 0.04]} />
        <meshStandardMaterial color={C.hairLight} roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.24, 0.44]} rotation={[0, 0, 0.08]}>
        <boxGeometry args={[0.16, 0.028, 0.04]} />
        <meshStandardMaterial color={C.hairLight} roughness={0.8} />
      </mesh>

      {/* 鼻子 */}
      <mesh position={[0, -0.01, 0.47]}>
        <sphereGeometry args={[0.025, 10, 10]} />
        <meshStandardMaterial color={C.skinShadow} roughness={0.6} />
      </mesh>

      {/* 嘴巴（用 ref 缩放开合） */}
      <group position={[0, -0.18, 0.45]}>
        <mesh ref={mouth}>
          <sphereGeometry args={[0.06, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          <meshStandardMaterial color={C.mouth} roughness={0.4} />
        </mesh>
      </group>

      {/* 头发 */}
      <Hair />
    </group>
  )
}
