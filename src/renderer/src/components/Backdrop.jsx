import { useMemo } from 'react'
import * as THREE from 'three'

// 场景背景：一个大号内表面球，贴一张竖向渐变贴图。
// 用球而不是平面，是因为 OrbitControls 开了自动旋转——
// 球的渐变是「上下」方向，绕 Y 轴旋转后渐变不变，背景始终是稳的。
// fog={false}：背景球不能被雾吃掉，否则会糊成一片雾色。
export default function Backdrop() {
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 256
    const ctx = c.getContext('2d')

    // 竖向渐变：顶部深夜蓝 → 中段墨青 → 下缘深青（萤火夜景）
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0.0, '#07182a')
    g.addColorStop(0.45, '#0c2b3a')
    g.addColorStop(0.78, '#103a44')
    g.addColorStop(1.0, '#0a2630')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 16, 256)

    // 底部中心加一抹暖绿金萤火微光，给角色一个「夜色聚光」感
    const r = ctx.createRadialGradient(8, 214, 0, 8, 214, 130)
    r.addColorStop(0, 'rgba(190, 255, 175, 0.28)')
    r.addColorStop(1, 'rgba(190, 255, 175, 0)')
    ctx.fillStyle = r
    ctx.fillRect(0, 0, 16, 256)

    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [])

  return (
    <mesh>
      <sphereGeometry args={[40, 32, 32]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} fog={false} depthWrite={false} />
    </mesh>
  )
}
