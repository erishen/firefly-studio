import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// RPM 模型里可能出现的 morph 名字（不同导出配置命名不同，全部兜底尝试）。
// 注意：本地 public/avatar.glb 的 morph 名放在 mesh.extras.targetNames，
// 已由脚本复制到 primitives[].targetNames，故 morphTargetDictionary 可用。
const MOUTH = ['mouthOpen', 'viseme_aa', 'viseme_O', 'viseme_I', 'jawOpen', 'Oculus Visemes.jawOpen']
const BLINK_L = ['eyeBlinkLeft', 'ARKit.eyeBlinkLeft', 'Oculus Visemes.eyeBlinkLeft']
const BLINK_R = ['eyeBlinkRight', 'ARKit.eyeBlinkRight', 'Oculus Visemes.eyeBlinkRight']
const EYE_BONES = /leftEye|rightEye|lefteye|righteye/i
const HEAD_BONE = /head/i

// Avaturn 风格模型（model.glb / avatar-avaturn.glb）导出是 T-pose（手臂平举、手肘僵直）。
// 上臂绕【世界 Z 轴】下垂成 A-pose；前臂绕【世界 X 轴】微弯（手自然朝前），打破直棍感。
// 用世界轴而非局部轴，方向确定（不依赖模型局部坐标系朝向）。RPM(avatar.glb) 已是 A-pose，不处理。
// 三者均可调：ARM_RELAX_Z 控制上臂张收（太收→调小 / 太开→调大）；
// ARM_BEND_X 控制肘弯（手若朝后→取反为 -0.3）。
const ARM_RELAX_Z = -0.7 // 上臂绕世界 Z 轴下垂（弧度，约 40°）；用户反馈 -1.0 太不自然，收窄
const ARM_BEND_X = 0.3 // 前臂绕世界 X 轴微弯（弧度，约 17°），肘部自然弯曲、手朝前
// 按骨骼 uuid 缓存「原始世界姿态」，避免组件重挂载时重复叠加旋转
const _armBaseCache = new Map()

function findMorph(mesh, names) {
  const dict = mesh.morphTargetDictionary
  if (!dict) return -1
  for (const n of names) {
    if (n in dict) return dict[n]
  }
  return -1
}

function setMorph(mesh, names, value) {
  const idx = findMorph(mesh, names)
  if (idx >= 0) mesh.morphTargetInfluences[idx] = value
}

// Ready Player Me 真实绑定模型
// - 眼神跟随：旋转头部骨骼（及眼骨）朝指针
// - 说话：驱动 jawOpen 类 morph
// - 眨眼：驱动 eyeBlink 类 morph（由 blinkRef 控制）
export default function AvatarModel({ url, speakingRef, blinkRef, onClick, hiddenMeshes = [], relaxArms = false }) {
  const { scene } = useGLTF(url)
  const headRef = useRef()
  const eyeRefs = useRef([])
  const mouthMeshes = useRef([])
  const blinkMeshes = useRef([])
  const baseHead = useRef(null)
  const baseEyes = useRef([])
  const hiddenSet = useMemo(() => new Set(hiddenMeshes), [hiddenMeshes])

  useEffect(() => {
    mouthMeshes.current = []
    blinkMeshes.current = []
    eyeRefs.current = []
    scene.traverse((o) => {
      if (o.isMesh) {
        o.visible = !hiddenSet.has(o.name)
        o.castShadow = true
        o.receiveShadow = true
        if (o.morphTargetDictionary) {
          if (findMorph(o, MOUTH) >= 0) mouthMeshes.current.push(o)
          if (findMorph(o, BLINK_L) >= 0 || findMorph(o, BLINK_R) >= 0) blinkMeshes.current.push(o)
        }
      }
      if (o.isBone) {
        if (HEAD_BONE.test(o.name) && !headRef.current) headRef.current = o
        if (EYE_BONES.test(o.name)) eyeRefs.current.push(o)
      }
    })
    // 手臂下垂 + 肘弯修正：仅 Avaturn 风格（relaxArms=true）。
    // 上臂绕【世界 Z 轴】下垂成 A-pose；前臂绕【世界 X 轴】微弯，打破僵直直棍感。
    // 用世界轴方向确定；先只读一遍收集「干净世界姿态」缓存（避免父骨修改污染子骨），再统一施加。
    if (relaxArms) {
      scene.updateMatrixWorld(true)
      const targets = []
      scene.traverse((o) => {
        if (!o.isBone) return
        let kind = null
        let side = 0
        if (/^LeftArm$/i.test(o.name)) { kind = 'arm'; side = 1 }
        else if (/^RightArm$/i.test(o.name)) { kind = 'arm'; side = -1 }
        else if (/^LeftForeArm$/i.test(o.name)) { kind = 'fore'; side = 1 }
        else if (/^RightForeArm$/i.test(o.name)) { kind = 'fore'; side = -1 }
        if (!kind) return
        if (!_armBaseCache.has(o.uuid)) {
          const wq = new THREE.Quaternion()
          o.getWorldQuaternion(wq)
          const pwq = new THREE.Quaternion()
          if (o.parent) o.parent.getWorldQuaternion(pwq)
          _armBaseCache.set(o.uuid, { worldBase: wq, parentWorldQ: pwq, kind, side })
        }
        targets.push(o)
      })
      targets.forEach((o) => {
        const c = _armBaseCache.get(o.uuid)
        const axis = c.kind === 'arm' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
        const angle = c.kind === 'arm' ? ARM_RELAX_Z * c.side : ARM_BEND_X
        const deltaWorld = new THREE.Quaternion().setFromAxisAngle(axis, angle)
        const newWorld = deltaWorld.multiply(c.worldBase)
        const newLocal = c.parentWorldQ.clone().invert().multiply(newWorld)
        o.quaternion.copy(newLocal)
      })
    }
  }, [scene, hiddenSet, relaxArms])

  useFrame((state) => {
    // 头部/眼骨朝向指针（先记录初始姿态，delta 叠加，避免覆盖绑定 pose）
    const bob = speakingRef.current ? Math.sin(state.clock.elapsedTime * 6) * 0.03 : 0
    if (headRef.current) {
      if (!baseHead.current) {
        baseHead.current = { x: headRef.current.rotation.x, y: headRef.current.rotation.y }
      }
      const tx = state.pointer.x * 0.35
      const ty = -state.pointer.y * 0.25
      headRef.current.rotation.y += (baseHead.current.y + tx - headRef.current.rotation.y) * 0.1
      headRef.current.rotation.x += (baseHead.current.x + ty + bob - headRef.current.rotation.x) * 0.1
    }
    eyeRefs.current.forEach((eye, i) => {
      if (!baseEyes.current[i]) {
        baseEyes.current[i] = { x: eye.rotation.x, y: eye.rotation.y }
      }
      const tx = state.pointer.x * 0.3
      const ty = -state.pointer.y * 0.2
      eye.rotation.y += (baseEyes.current[i].y + tx - eye.rotation.y) * 0.15
      eye.rotation.x += (baseEyes.current[i].x + ty - eye.rotation.x) * 0.15
    })

    // 说话：驱动 mouthOpen 类 morph。带轻微正弦起伏，像在讲话而非干张嘴
    const t = state.clock.elapsedTime
    const mTarget = speakingRef.current ? 0.4 + 0.35 * Math.abs(Math.sin(t * 9)) : 0
    mouthMeshes.current.forEach((m) => {
      const idx = findMorph(m, MOUTH)
      if (idx >= 0) {
        const cur = m.morphTargetInfluences[idx]
        m.morphTargetInfluences[idx] = cur + (mTarget - cur) * 0.3
      }
    })

    // 眨眼
    const b = blinkRef.current ? 1 : 0
    blinkMeshes.current.forEach((m) => {
      setMorph(m, BLINK_L, b)
      setMorph(m, BLINK_R, b)
    })
  })

  return (
    <group
      onClick={(e) => {
        e.stopPropagation()
        onClick && onClick()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default'
      }}
    >
      <primitive object={scene} />
    </group>
  )
}

// 提示：把模型预取到浏览器缓存（可选）
// useGLTF.preload('https://models.readyplayer.me/...glb')
