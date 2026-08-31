import { useRef, Suspense, useMemo } from 'react'
import { ContactShadows, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import Avatar from './Avatar'
import AvatarModel from './AvatarModel'
import AvatarVRM from './AvatarVRM'
import Breathing from './Breathing'
import SpeechBubble from './SpeechBubble'
import ModelErrorBoundary from './ModelErrorBoundary'
import Backdrop from './Backdrop'
import { useBlink } from '../hooks/useBlink'

// 四套本地模型（均离线可用，无需联网 CDN）：
//   RPM 女性头像  public/avatar.glb          —— 带标准 blendshape，能眨眼 + 说话
//   Avaturn 默认  public/avatar-avaturn.glb   —— 外观更干净；但无面部 blendshape，嘴不会动
//   备用头像      public/model.glb            —— Avaturn 风格静态网格，无面部 blendshape
//   VRoid 头像    public/avatar.vrm           —— 二次元风，自带完整面部 blendshape（眨眼+口型），国内可达
//   测试头像      public/test.vrm             —— 用户导入的 VRM（可能为 VRM0.0，three-vrm 会自动归一化表情名）
//   萤火女仆      /api/model（生产，firefly 服务端函数代理换限时签名 URL）—— 用户导入 VRM；
//               其 VRM 许可为 OnlyAuthor + redistribution=disallow（第三方 VRoid 创作，仅作者可商用/再分发），
//               故经配置的签名服务校验获取，主密钥在服务端、不开放匿名裸链（见 Stage 内 FIREFLY_VRM_* ）。
// 加载失败时都会自动回退到内置程序化角色，页面不会白屏。
const RPM_AVATAR_URL = '/avatar.glb'
const AVATURN_AVATAR_URL = '/avatar-avaturn.glb'
const MODEL_GLB_URL = '/model.glb'
const VRM_AVATAR_URL = '/avatar.vrm'
const TEST_VRM_URL = '/test.vrm'
// 萤火女仆：
//   开发环境直接用本地 public/ 下的模型（无需令牌、离线可用）；
//   生产环境由浏览器经 CORS 直连配置的 VRM URL 拉取模型（来源受信即放行，
//   无需经 Vercel 服务端函数中转——实测 Vercel hkg1 → 国内 VPS 的 server 出网
//   会被拦/超时，导致 /api/model 返回 504、无痕模式回退默认角色）。
//   直连 URL 稳定（不含 5 分钟签名轮换），更利于浏览器 Cache API 命中秒开。
//   该 VRM 许可 redistribution=disallow，服务端按 Origin 来源受信白名单放行，
//   请勿在其他站点嵌入或匿名公开分发裸链。
//   生产环境 URL 通过 .env 中的 FIREFLY_VRM_PROD_URL 配置，避免硬编码个人域名。
const FIREFLY_VRM_DEV_URL = '/fireflyMaid.vrm'
const FIREFLY_VRM_PROD_URL = import.meta.env.VITE_FIREFLY_VRM_PROD_URL || '/fireflyMaid.vrm'

// 场景：灯光 / 粒子 / 地面 / 交互状态
// speakingRef、bubble、onClick、modelSource 由 App 统一持有
// audioEnergy: 实时音频能量（0~1），用于口型同步
// expression: 当前表情（neutral/happy/angry/sad/surprised/relaxed）
// gesture: 当前手势（idle/wave/nod/shake/thinking/heart）
export default function Stage({ speakingRef, bubble, onClick, modelSource = 'avaturn', audioEnergy = 0, expression = 'neutral', gesture = 'idle' }) {
  const blinkRef = useRef(false)

  // 眨眼调度统一在这里跑一次（程序化角色与 RPM 模型共用 blinkRef）
  useBlink(blinkRef)

  const avatarUrl =
    modelSource === 'rpm' ? RPM_AVATAR_URL : modelSource === 'model' ? MODEL_GLB_URL : AVATURN_AVATAR_URL
  // VRM 类（VRoid / Test / Firefly）走 AvatarVRM；三者只是文件不同
  const vrmUrl =
    modelSource === 'test'
      ? TEST_VRM_URL
      : modelSource === 'firefly'
        ? (import.meta.env.DEV ? FIREFLY_VRM_DEV_URL : FIREFLY_VRM_PROD_URL)
        : VRM_AVATAR_URL

  // 地面柔光：径向渐变贴图，中心亮、边缘透明，自然融入背景（不再是一块硬边圆盘）
  const floorTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    const ctx = c.getContext('2d')
    const r = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
    r.addColorStop(0, 'rgba(36, 90, 92, 0.95)')
    r.addColorStop(0.55, 'rgba(22, 60, 66, 0.6)')
    r.addColorStop(1, 'rgba(22, 60, 66, 0)')
    ctx.fillStyle = r
    ctx.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [])

  return (
    <>
      {/* 渐变背景球 + 雾：让场景有空间纵深，地面边缘自然消散 */}
      <Backdrop />
      <fog attach="fog" args={['#0c2b3a', 8, 30]} />

      {/* 光照：主光 + 冷暖补光，营造柔和体积感 */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[4, 8, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-4, 3, -2]} intensity={0.6} color="#4fd6c9" />
      <pointLight position={[4, 2, -2]} intensity={0.5} color="#ffd27f" />
      <spotLight position={[0, 7, 4]} intensity={0.5} angle={0.5} penumbra={0.6} color="#fff4d6" />

      {/* 粒子（用 drei 自带，避免本地同名组件冲突） */}
      <Sparkles count={36} scale={[7, 5, 7]} size={3} speed={0.35} color="#9effa6" opacity={0.7} />

      <Breathing>
        <group>
          <ModelErrorBoundary fallback={<Avatar speakingRef={speakingRef} onClick={onClick} blinkRef={blinkRef} />}>
            <Suspense fallback={null}>
              {modelSource === 'vrm' || modelSource === 'test' || modelSource === 'firefly' ? (
                <AvatarVRM
                  url={vrmUrl}
                  speakingRef={speakingRef}
                  blinkRef={blinkRef}
                  onClick={onClick}
                  audioEnergy={audioEnergy}
                  expression={expression}
                  gesture={gesture}
                />
              ) : avatarUrl ? (
                <AvatarModel
                  url={avatarUrl}
                  speakingRef={speakingRef}
                  blinkRef={blinkRef}
                  onClick={onClick}
                  relaxArms={modelSource !== 'rpm'}
                />
              ) : (
                <Avatar speakingRef={speakingRef} onClick={onClick} blinkRef={blinkRef} />
              )}
            </Suspense>
          </ModelErrorBoundary>
          <SpeechBubble text={bubble.text} visible={bubble.visible} who={bubble.who} />
        </group>
      </Breathing>

      {/* 地面：径向渐变柔光地板（透明边缘），被雾晕开后与背景融为一体 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial
          map={floorTex}
          transparent
          roughness={0.85}
          metalness={0}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[1.7, 1.82, 64]} />
        <meshBasicMaterial color="#6fe0cf" transparent opacity={0.22} />
      </mesh>

      <ContactShadows position={[0, 0.01, 0]} opacity={0.45} blur={2.8} scale={12} far={4} color="#1a0f3a" />
    </>
  )
}
