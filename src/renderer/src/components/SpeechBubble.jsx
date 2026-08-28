import { Html, Billboard } from '@react-three/drei'

// 对话框：用 drei 的 Html（DOM 覆盖层）渲染
// 好处：中文/emoji 直接走浏览器字体，零 CDN 依赖、永远清晰
//
// ⚠️ 防止「飘」：默认非 transform 模式是 2D 覆盖层，永远浮在画布最上层、
//   不随景深变化、也不被身体遮挡，文字像「贴」在屏幕前跟角色脱节。
//   这里改用 transform 模式 —— 气泡变成真正的三维物体，随场景透视、随相机
//   缩放、能被身体遮挡，不再「飘」。尺寸由 distanceFactor 控制（越大越接近
//   原生像素大小）。若觉得偏大/偏小，只调这一项即可。
//
// ⚠️ 不随视角镜像：相机绕到角色背后时，3D 气泡从背面看会反写（看不清）。
//   外层套 drei <Billboard>，让气泡始终正对相机（始终可读），同时保留三维
//   景深/遮挡感。position 放在 Billboard 上作为锚点，Html 居中渲染于该点。
//
// ⚠️ XSS 规则：text / who 一律走 React 文本插值 {text}（自动转义）。
// 禁止改用 dangerouslySetInnerHTML 渲染 AI 回复；若日后确需富文本，
// 必须先过 src/utils/sanitize.js 的 sanitizeHtml()。
export default function SpeechBubble({ text, visible, who }) {
  if (!visible || !text) return null
  return (
    <Billboard position={[0.85, 1.85, 0.3]}>
      <Html
        transform
        distanceFactor={1.8}
        center
        pointerEvents="none"
        zIndexRange={[10, 0]}
      >
        <div className={`bubble ${who || ''}`}>{text}</div>
      </Html>
    </Billboard>
  )
}

