import { C } from '../../theme'

// 头发：脑后饱满 + 头顶盖 + 三片刘海 + 两侧鬓发 + 蝴蝶结
// 全部以「头部 group 本地坐标」摆放（头球半径 0.5，中心在原点）
export default function Hair() {
  return (
    <group>
      {/* 后发：脑后饱满发量 */}
      <mesh position={[0, 0.02, -0.08]} scale={[1.12, 1.12, 1.05]}>
        <sphereGeometry args={[0.5, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.75]} />
        <meshStandardMaterial color={C.hair} roughness={0.85} />
      </mesh>

      {/* 头顶盖 */}
      <mesh position={[0, 0.32, 0.02]}>
        <sphereGeometry args={[0.46, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color={C.hairLight} roughness={0.8} />
      </mesh>

      {/* 刘海：三片，中间最长 */}
      <mesh position={[-0.2, 0.3, 0.34]} rotation={[0.25, 0, 0.12]}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color={C.hair} roughness={0.8} />
      </mesh>
      <mesh position={[0.0, 0.34, 0.38]} rotation={[0.32, 0, 0]}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshStandardMaterial color={C.hairLight} roughness={0.8} />
      </mesh>
      <mesh position={[0.2, 0.3, 0.34]} rotation={[0.25, 0, -0.12]}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color={C.hair} roughness={0.8} />
      </mesh>

      {/* 鬓发：两侧下垂 */}
      <mesh position={[-0.42, -0.02, 0.05]} rotation={[0, 0, 0.12]}>
        <capsuleGeometry args={[0.08, 0.45, 8, 12]} />
        <meshStandardMaterial color={C.hair} roughness={0.85} />
      </mesh>
      <mesh position={[0.42, -0.02, 0.05]} rotation={[0, 0, -0.12]}>
        <capsuleGeometry args={[0.08, 0.45, 8, 12]} />
        <meshStandardMaterial color={C.hair} roughness={0.85} />
      </mesh>

      {/* 蝴蝶结（右侧） */}
      <group position={[0.4, 0.4, 0.12]} rotation={[0, 0, 0.2]}>
        <mesh position={[0.11, 0.02, 0]} scale={[1.4, 1, 0.5]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color={C.bow} roughness={0.3} />
        </mesh>
        <mesh position={[-0.11, 0.02, 0]} scale={[1.4, 1, 0.5]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color={C.bow} roughness={0.3} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#ff6f9c" roughness={0.3} />
        </mesh>
      </group>
    </group>
  )
}
