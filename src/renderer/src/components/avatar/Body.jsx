import { useMemo } from 'react'
import * as THREE from 'three'
import { C } from '../../theme'

// 身体：脖子 + 上半身 + LatheGeometry 连衣裙 + 手臂(Capsule) + 腿(Capsule) + 鞋
// 全部以「身体 group 本地坐标」摆放（身体 group 在 y=0.66）
export default function Body() {
  // 连衣裙轮廓：下摆宽、腰部收、肩部窄，绕 Y 轴旋转成裙身
  const dress = useMemo(() => {
    const pts = [
      new THREE.Vector2(0.55, 0.0),
      new THREE.Vector2(0.52, 0.12),
      new THREE.Vector2(0.4, 0.28),
      new THREE.Vector2(0.3, 0.42),
      new THREE.Vector2(0.27, 0.55),
      new THREE.Vector2(0.26, 0.66),
    ]
    return new THREE.LatheGeometry(pts, 48)
  }, [])

  return (
    <group position={[0, 0.66, 0]}>
      {/* 脖子 */}
      <mesh position={[0, 0.46, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.16, 16]} />
        <meshStandardMaterial color={C.skin} roughness={0.5} />
      </mesh>

      {/* 上半身（内搭白） */}
      <mesh>
        <sphereGeometry args={[0.34, 24, 24]} />
        <meshStandardMaterial color={C.top} roughness={0.5} />
      </mesh>

      {/* 连衣裙（Lathe 旋转面，双面可见） */}
      <mesh geometry={dress}>
        <meshStandardMaterial color={C.dress} roughness={0.55} side={THREE.DoubleSide} />
      </mesh>

      {/* 裙摆装饰环 */}
      <mesh position={[0, 0.02, 0]}>
        <torusGeometry args={[0.54, 0.02, 8, 48]} />
        <meshStandardMaterial color={C.dressShade} roughness={0.4} />
      </mesh>

      {/* 左臂 */}
      <group position={[-0.4, 0.18, 0]} rotation={[0, 0, 0.18]}>
        <mesh>
          <capsuleGeometry args={[0.075, 0.42, 8, 16]} />
          <meshStandardMaterial color={C.skin} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.28, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color={C.skin} roughness={0.5} />
        </mesh>
      </group>

      {/* 右臂 */}
      <group position={[0.4, 0.18, 0]} rotation={[0, 0, -0.18]}>
        <mesh>
          <capsuleGeometry args={[0.075, 0.42, 8, 16]} />
          <meshStandardMaterial color={C.skin} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.28, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color={C.skin} roughness={0.5} />
        </mesh>
      </group>

      {/* 左腿 + 鞋 */}
      <group position={[-0.16, -0.42, 0]}>
        <mesh>
          <capsuleGeometry args={[0.09, 0.34, 8, 16]} />
          <meshStandardMaterial color={C.skin} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.26, 0.04]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color={C.shoe} roughness={0.5} />
        </mesh>
      </group>

      {/* 右腿 + 鞋 */}
      <group position={[0.16, -0.42, 0]}>
        <mesh>
          <capsuleGeometry args={[0.09, 0.34, 8, 16]} />
          <meshStandardMaterial color={C.skin} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.26, 0.04]}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial color={C.shoe} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}
