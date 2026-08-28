import * as THREE from 'three'

// 用 Canvas 生成一张「大眼萌」虹膜贴图：眼白 + 渐变虹膜 + 瞳孔 + 双高光 + 放射纹
// 放在眼睛前方的圆盘上，既好看又零外部字体/贴图依赖
export function makeIrisTexture({
  iris = '#5b8def',
  irisLight = '#bcd4ff',
  irisDark = '#2b4f9e',
  pupil = '#0a0a16',
} = {}) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2
  const cy = size / 2

  // 眼白底（圆形，铺满圆盘）
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2)
  ctx.fill()

  // 虹膜（径向渐变，制造通透感）
  const irisR = size * 0.3
  const grad = ctx.createRadialGradient(cx, cy, irisR * 0.15, cx, cy, irisR)
  grad.addColorStop(0, irisLight)
  grad.addColorStop(0.65, iris)
  grad.addColorStop(1, irisDark)
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, irisR, 0, Math.PI * 2)
  ctx.fill()

  // 虹膜放射纹
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1.4
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * irisR * 0.5, cy + Math.sin(a) * irisR * 0.5)
    ctx.lineTo(cx + Math.cos(a) * irisR, cy + Math.sin(a) * irisR)
    ctx.stroke()
  }

  // 瞳孔
  ctx.fillStyle = pupil
  ctx.beginPath()
  ctx.arc(cx, cy, irisR * 0.46, 0, Math.PI * 2)
  ctx.fill()

  // 高光（一大一小，动漫眼灵魂）
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.arc(cx - irisR * 0.34, cy - irisR * 0.38, irisR * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath()
  ctx.arc(cx + irisR * 0.32, cy + irisR * 0.26, irisR * 0.13, 0, Math.PI * 2)
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}
