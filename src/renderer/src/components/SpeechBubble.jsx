import { Html, Billboard } from '@react-three/drei'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
// ⚠️ XSS 安全：使用 react-markdown 渲染（自动转义，不使用 dangerouslySetInnerHTML）
//
// ⚠️ 内容截断：只靠 CSS -webkit-line-clamp: 3 截断，最多显示 3 行，
//   超出部分自动显示省略号，完整内容请查看右侧对话列表

// ⚠️ 内容截断：JavaScript 截断纯文本到 35 字符，确保气泡只显示一行
//   CSS white-space: nowrap + text-overflow: ellipsis 作为备用，完整内容请查看右侧对话列表
const MAX_BUBBLE_CHARS = 35

export default function SpeechBubble({ text, visible, who }) {
  if (!visible || !text) return null

  // JavaScript 截断：超过 60 字符截断，加省略号
  // 这样确保气泡高度稳定，不依赖 CSS line-clamp 对多块级元素的计算
  let displayText = text
  if (text.length > MAX_BUBBLE_CHARS) {
    displayText = text.slice(0, MAX_BUBBLE_CHARS).trimEnd() + '...'
  }

  return (
    <Billboard position={[0, 2.2, 0]}>
      <Html
        transform
        distanceFactor={2.5}
        center
        pointerEvents="none"
        zIndexRange={[1000, 0]}
      >
        <div className={`bubble ${who || ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
        </div>
      </Html>
    </Billboard>
  )
}

