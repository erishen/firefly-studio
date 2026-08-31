import { useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'
import { MODEL_CACHE_NAME } from '../utils/modelCache'

// three-vrm 对 VRM0.0 的 LookAtDegreeMap 会打印一条无害警告，屏蔽它避免污染控制台
if (typeof console !== 'undefined' && console.warn) {
  const _warn = console.warn.bind(console)
  console.warn = (...a) => {
    if (a[0] && typeof a[0] === 'string' && a[0].includes('LookAtDegreeMap')) return
    _warn(...a)
  }
}

// 手臂下垂（hang-down）：VRM 默认 T-pose（手臂沿身体左右水平张开）。
// 仅旋转【上臂】绕世界 Z 轴，从水平平举转到近乎垂直贴身（约 80°，略外撇避免穿模躯干）。
// 前臂保持骨骼原生相对姿态（自然垂落），不再做摆动/比划。
// 因 VRM 经 <primitive rotation-y={Math.PI}> 面向相机，采集世界 base 时须用临时 Y=π 父节点模拟，否则 Z 翻转方向反。
const ARM_HANG_Z = -1.2 // 上臂下垂（弧度，约 69°）；太贴身调小绝对值、太外撇调大；正负由左右手 side 自动镜像

function collectArmBones(vrm) {
  const defs = [
    ['leftUpperArm', 1],
    ['rightUpperArm', -1],
  ]
  const scene = vrm.scene
  const out = []
  const tmp = new THREE.Object3D()
  tmp.rotation.y = Math.PI
  if (scene.parent) scene.parent.remove(scene)
  tmp.add(scene)
  tmp.updateMatrixWorld(true)
  for (const [name, side] of defs) {
    const node = vrm.humanoid.getNormalizedBoneNode(name)
    if (!node) continue
    const wq = new THREE.Quaternion()
    node.getWorldQuaternion(wq)
    const pwq = new THREE.Quaternion()
    if (node.parent) node.parent.getWorldQuaternion(pwq)
    out.push({ node, side, worldBase: wq, parentWorldQ: pwq })
  }
  tmp.remove(scene)
  return out
}

function applyArmPose(bones) {
  const axis = new THREE.Vector3(0, 0, 1)
  for (const b of bones) {
    const angle = ARM_HANG_Z * b.side
    const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle)
    const newWorld = delta.multiply(b.worldBase)
    const newLocal = b.parentWorldQ.clone().invert().multiply(newWorld)
    b.node.quaternion.copy(newLocal)
  }
}

// —— 模型字节缓存（Cache API）——
// 14.5MB 的 VRM 每次重新下载很慢；用浏览器 Cache API 把解析好的字节按 URL 缓存，
// 刷新/重进页面时命中缓存即可秒开。缓存 key 用请求 URL（firefly 固定为 /api/model，
// 不受 5 分钟签名 URL 轮换影响）。隐私模式等不支持 Cache API 时自动降级为每次网络下载。

async function readWithProgress(resp, onProgress) {
  const total = Number(resp.headers.get('Content-Length')) || 0
  if (!resp.body || !total) return resp.arrayBuffer()
  const reader = resp.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(Math.min(99, Math.round((received / total) * 100)))
  }
  const out = new Uint8Array(received)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out.buffer
}

async function loadModelBytes(url, headers, onProgress) {
  // 1) 本地缓存命中 → 秒开（跳过下载）
  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    const hit = await cache.match(url)
      if (hit) {
        if (onProgress) onProgress(100)
        return { buf: await hit.arrayBuffer(), fromCache: true }
      }
  } catch (_) {
    /* Cache API 不可用时跳过缓存，走网络 */
  }

  // 2) 下载（带真实进度）
  const resp = await fetch(url, headers ? { headers } : undefined)
  if (!resp.ok) throw new Error('模型下载失败：HTTP ' + resp.status)
  const buf = await readWithProgress(resp, onProgress)

  // 3) 写入缓存（arrayBuffer 只能消费一次，存副本）
  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    await cache.put(
      url,
      new Response(buf.slice(0), {
        headers: { 'Content-Type': resp.headers.get('Content-Type') || 'model/gltf-binary' },
      }),
    )
  } catch (_) {
    /* 缓存写入失败不影响加载 */
  }
  return { buf, fromCache: false }
}

// VRoid (VRM) 模型：本地 public/avatar.vrm
// VRM 自带完整面部 blendshape（blink / aa 等 viseme），能眨眼 + 口型说话，且国内可达、衣服可自由选（夏装/清凉装都有）。
// 驱动用 @pixiv/three-vrm 的 expressionManager（思路同 RPM 的 ARKit morph，但命名是 VRM 标准）；
// 眼神跟随用 humanoid 标准骨骼（head / leftEye / rightEye），与 RPM 组件逻辑完全一致。
//
// 说明：VRM 默认面向 -Z，组件内已把 scene 旋转 180° 使其面向相机（+Z）。

export default function AvatarVRM({ url, token, speakingRef, blinkRef, onClick, audioEnergy = 0, expression = 'neutral', gesture = 'idle' }) {

  const [vrm, setVrm] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const headRef = useRef(null)
  const eyeRefs = useRef([])
  const baseHead = useRef(null)
  const baseEyes = useRef([])
  const armBonesRef = useRef([])
  // 口型/眨眼回退驱动（当 VRM 元数据 blendShapeMaster 为空、expressionManager 无表情时，直接驱动 morph）
  const mouthMeshRef = useRef(null)
  const mouthIdxRef = useRef({})
  const blinkMeshRef = useRef(null)
  const blinkIdxRef = useRef(null)
  const useExprMouthRef = useRef(false)
  const useExprBlinkRef = useRef(false)

  // —— 表情系统 ——
  // 支持的表情：neutral（中性）、happy（开心）、angry（生气）、sad（悲伤）、surprised（惊讶）、relaxed（放松）
  const expressionRef = useRef(expression)
  const targetExpressionRef = useRef(expression)
  const expressionWeightRef = useRef({
    happy: 0, angry: 0, sad: 0, surprised: 0, relaxed: 0
  })
  const supportedExpressionsRef = useRef({})

  // 同步 expression prop 到 ref
  useEffect(() => {
    targetExpressionRef.current = expression
  }, [expression])

  // —— 手势/动作系统 ——
  // 支持的手势：idle（空闲）、wave（挥手）、nod（点头）、shake（摇头）、thinking（思考）、heart（比心）
  const targetGestureRef = useRef(gesture)
  const gestureProgressRef = useRef(0) // 手势进度 0~1
  const gestureTimeRef = useRef(0) // 手势时间（用于循环动画）
  const gestureBonesRef = useRef({
    head: null,
    neck: null,
    leftUpperArm: null,
    leftLowerArm: null,
    leftHand: null,
    rightUpperArm: null,
    rightLowerArm: null,
    rightHand: null,
  })
  const baseRotationsRef = useRef({}) // 骨骼初始旋转

  // 同步 gesture prop 到 ref
  useEffect(() => {
    if (targetGestureRef.current !== gesture) {
      targetGestureRef.current = gesture
      gestureProgressRef.current = 0 // 新手势从头开始
    }
  }, [gesture])

  // 异步加载 VRM（GLTFLoader + VRMLoaderPlugin），带进度与浏览器缓存
  useEffect(() => {
    let disposed = false
    let lastReported = -1
    const t0 = performance.now() // 模型加载计时起点
    let loadFromCache = false // 本次加载是否命中浏览器缓存
    const report = (p) => {
      if (disposed || p === lastReported) return
      lastReported = p
      setProgress(p)
    }
    // 切换模型时先清空旧角色并进入加载态
    setVrm(null)
    setError(null)
    setLoading(true)
    setProgress(0)
    headRef.current = null
    eyeRefs.current = []
    baseHead.current = null
    baseEyes.current = []
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const onLoaded = (gltf, fromCache) => {
        if (disposed) return
        const v = gltf.userData.vrm
        const ms = Math.round(performance.now() - t0)
        if (!v) {
          setError(new Error('该文件不是有效的 VRM（缺少 userData.vrm）'))
          setLoading(false)
          
          return
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        // 关闭 three-vrm 自带 lookAt：我们用 humanoid bone 手动控制，与 RPM 一致、可控
        // （VRM0.0 本身无 v.lookAt，这里用可选链安全跳过）
        if (v.lookAt) v.lookAt.enabled = false
        // 记录标准骨骼
        headRef.current = v.humanoid.getNormalizedBoneNode('head')
        eyeRefs.current = [
          v.humanoid.getNormalizedBoneNode('leftEye'),
          v.humanoid.getNormalizedBoneNode('rightEye'),
        ].filter(Boolean)
        // 记录 VRM 版本，便于排查（VRM0.0 的 A/I/U/E/O 会被 three-vrm 自动归一化为 aa/ih/ou/ee/oh）
        const ver = v.meta && v.meta.metaVersion
        // 采集上臂 base 并下垂（VRM 默认 T-pose 手臂平举）
        const arm = collectArmBones(v)
        armBonesRef.current = arm

        // —— 收集手势相关骨骼 ——
        const humanoid = v.humanoid
        const gestureBones = {}
        const boneNames = ['head', 'neck', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
        boneNames.forEach((name) => {
          const node = humanoid.getNormalizedBoneNode(name)
          if (node) {
            gestureBones[name] = node
            // 记录初始旋转（世界坐标）
            const wq = new THREE.Quaternion()
            node.getWorldQuaternion(wq)
            baseRotationsRef.current[name] = wq.clone()
          }
        })
        gestureBonesRef.current = gestureBones
        console.log('[AvatarVRM] 手势骨骼:', Object.keys(gestureBones))

        // —— 口型/眨眼驱动方式探测 ——
        // 某些 VRM0.0 导出文件的 blendShapeMaster.blendShapeGroups 为空（表情组数=0），
        // three-vrm 的 expressionManager 因此没有任何表情；但 mesh 底层仍带 morph target
        // （含 あ/い/う/え/お 元音口型 与 まばたき 眨眼）。故回退：直接驱动 mesh.morphTargetInfluences。
        const hasExpr = (name) => {
          const em = v.expressionManager
          if (!em) return false
          if (typeof em.getExpression === 'function') return !!em.getExpression(name)
          return (em.expressions || []).some((e) => e.name === name)
        }
        let mouthMesh = null
        const mouthIdx = {}
        const vowelOf = { 'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o' }
        let blinkMesh = null
        let blinkIdx = null
        v.scene.traverse((o) => {
          if (!o.isMesh || !o.morphTargetDictionary) return
          const d = o.morphTargetDictionary
          const found = {}
          for (const name of Object.keys(d)) {
            const m = name.match(/[.＿]([あいうえお])$/)
            if (m && found[m[1]] === undefined) found[m[1]] = d[name]
          }
          if (!mouthMesh && Object.keys(found).length >= 5) {
            mouthMesh = o
            for (const [jp, en] of Object.entries(vowelOf)) {
              if (found[jp] !== undefined) mouthIdx[en] = found[jp]
            }
          }
          if (!blinkMesh) {
            const bk = Object.keys(d).find((n) => n.includes('まばたき'))
            if (bk) { blinkMesh = o; blinkIdx = d[bk] }
          }
        })
        mouthMeshRef.current = mouthMesh
        mouthIdxRef.current = mouthIdx
        blinkMeshRef.current = blinkMesh
        blinkIdxRef.current = blinkIdx
        useExprMouthRef.current = hasExpr('aa') || hasExpr('ih')
        useExprBlinkRef.current = hasExpr('blink')

        // —— 检测支持的表情 ——
        const exprList = ['happy', 'angry', 'sad', 'surprised', 'relaxed']
        const supported = {}
        exprList.forEach((name) => {
          supported[name] = hasExpr(name)
        })
        supportedExpressionsRef.current = supported
        console.log('[AvatarVRM] 支持的表情:', supported)

        setVrm(v)
        setLoading(false)
        
    }
    const onError = (err) => {
      if (!disposed) {
        console.error('[avatar] VRM 加载失败:', err)
        setError(err)
        setLoading(false)
        
      }
    }
    // 直接用 GLTFLoader.load，简单可靠（Electron 环境下 Cache API/fetch 字节可能有问题）
    loader.load(
      url,
      (gltf) => onLoaded(gltf, false),
      (xhr) => {
        if (xhr.total) report(Math.round((xhr.loaded / xhr.total) * 100))
      },
      onError
    )
    return () => {
      disposed = true
    }
  }, [url, token])

  useFrame((state, delta) => {
    if (!vrm) return
    // 必须每帧 update：驱动 spring bone（头发/裙子物理）与 expression 过渡
    vrm.update(delta)
    // 手臂静态下垂（每帧施加，覆盖 VRM 默认 T-pose 平举，使双手自然垂落身侧）
    if (armBonesRef.current.length) applyArmPose(armBonesRef.current)

    // 头部/眼骨朝向指针（先记录初始绑定姿态，delta 叠加，避免覆盖绑定 pose）
    const bob = speakingRef.current ? Math.sin(state.clock.elapsedTime * 6) * 0.03 : 0
    const head = headRef.current
    if (head) {
      // 记录初始旋转（包括 z 轴，防止模型头部初始 z 旋转导致头倒着）
      if (!baseHead.current) {
        let initialZ = head.rotation.z
        // 如果初始 z 旋转接近 π（180 度），说明头是倒着的，校正为 0
        if (Math.abs(Math.abs(initialZ) - Math.PI) < 0.1) {
          console.warn('[AvatarVRM] 检测到头部初始 z 旋转接近 180°，已校正为 0°')
          initialZ = 0
          head.rotation.z = 0
        }
        baseHead.current = { x: head.rotation.x, y: head.rotation.y, z: initialZ }
      }
      const tx = state.pointer.x * 0.35
      const ty = -state.pointer.y * 0.25
      head.rotation.y += (baseHead.current.y + tx - head.rotation.y) * 0.1
      head.rotation.x += (baseHead.current.x + ty + bob - head.rotation.x) * 0.1
      // 保持 z 轴旋转为初始值，防止头倒着
      head.rotation.z += (baseHead.current.z - head.rotation.z) * 0.1
    }
    eyeRefs.current.forEach((eye, i) => {
      if (!eye) return
      if (!baseEyes.current[i]) baseEyes.current[i] = { x: eye.rotation.x, y: eye.rotation.y }
      const tx = state.pointer.x * 0.3
      const ty = -state.pointer.y * 0.2
      eye.rotation.y += (baseEyes.current[i].y + tx - eye.rotation.y) * 0.15
      eye.rotation.x += (baseEyes.current[i].x + ty - eye.rotation.x) * 0.15
    })

    // 说话口型：优先使用真实音频能量（audioEnergy），回退到模拟正弦波
    // 真实音频能量来自 TTS 播放时的 PCM 能量曲线，口型与语音精确同步
    const t = state.clock.elapsedTime
    let mouthOpen = 0
    if (speakingRef.current) {
      if (audioEnergy > 0.001) {
        // 使用真实音频能量：将 RMS 能量映射到口型大小（0~0.95）
        // 音频能量通常在 0.01~0.3 之间，使用平方根映射让低能量更明显
        mouthOpen = Math.min(0.95, Math.sqrt(audioEnergy) * 2.5)
      } else {
        // 回退：多层正弦波模拟音频能量变化
        const energy = 0.5
          + 0.3 * Math.sin(t * 4.0)
          + 0.15 * Math.sin(t * 7.3 + 1.2)
          + 0.05 * Math.sin(t * 11.7 + 2.5)
        mouthOpen = Math.max(0.1, Math.min(0.95, energy))
      }
    }

    // 元音切换：根据口型大小和时间切换元音
    const vowelSpeed = 5 + mouthOpen * 6
    const vowels = ['a', 'i', 'u', 'e', 'o']
    const vowelIdx = Math.floor(t * vowelSpeed) % 5
    const activeVowel = vowels[vowelIdx]

    if (useExprMouthRef.current && vrm.expressionManager) {
      const mouthNames = ['aa', 'ih', 'ou', 'ee', 'oh']
      mouthNames.forEach((n, i) => {
        vrm.expressionManager.setValue(n, i === vowelIdx ? mouthOpen : 0)
      })
    } else if (mouthMeshRef.current) {
      const infl = mouthMeshRef.current.morphTargetInfluences
      const mi = mouthIdxRef.current
      for (const k of ['a', 'i', 'u', 'e', 'o']) if (mi[k] != null) infl[mi[k]] = 0
      if (speakingRef.current && mi[activeVowel] != null) {
        infl[mi[activeVowel]] = mouthOpen
      }
    }

    // 眨眼：优先 expressionManager；否则回退 morph（まばたき）
    const b = blinkRef.current ? 1 : 0
    if (useExprBlinkRef.current && vrm.expressionManager) {
      vrm.expressionManager.setValue('blink', b)
      vrm.expressionManager.setValue('blinkLeft', b)
      vrm.expressionManager.setValue('blinkRight', b)
    } else if (blinkMeshRef.current && blinkIdxRef.current != null) {
      blinkMeshRef.current.morphTargetInfluences[blinkIdxRef.current] = b
    }

    // —— 表情系统驱动 ——
    // 目标表情权重：neutral 时所有表情权重为 0
    const targetExpr = targetExpressionRef.current
    const targetWeights = {
      happy: targetExpr === 'happy' ? 1 : 0,
      angry: targetExpr === 'angry' ? 1 : 0,
      sad: targetExpr === 'sad' ? 1 : 0,
      surprised: targetExpr === 'surprised' ? 1 : 0,
      relaxed: targetExpr === 'relaxed' ? 1 : 0,
    }

    // 平滑过渡（每帧向目标权重靠近，速度约 5/秒）
    const exprSpeed = Math.min(1, delta * 5)
    const weights = expressionWeightRef.current
    const supported = supportedExpressionsRef.current

    Object.keys(targetWeights).forEach((name) => {
      if (!supported[name]) return  // 模型不支持的表情跳过
      const current = weights[name] || 0
      const target = targetWeights[name]
      weights[name] = current + (target - current) * exprSpeed
      // 设置表情权重
      if (vrm.expressionManager) {
        vrm.expressionManager.setValue(name, weights[name])
      }
    })

    // —— 手势/动作系统驱动 ——
    const targetGesture = targetGestureRef.current
    const bones = gestureBonesRef.current
    const baseRots = baseRotationsRef.current

    if (targetGesture !== 'idle' && bones.head) {
      // 更新手势时间（用于循环动画）
      gestureTimeRef.current += delta
      const t = gestureTimeRef.current

      // 手势进度（渐入渐出）
      const gestureSpeed = Math.min(1, delta * 3)
      gestureProgressRef.current = Math.min(1, gestureProgressRef.current + gestureSpeed)
      const p = gestureProgressRef.current

      // 辅助函数：设置骨骼旋转（相对于初始旋转的增量）
      const setBoneRot = (name, axis, angle) => {
        const node = bones[name]
        const base = baseRots[name]
        if (!node || !base) return
        const deltaQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), angle * p)
        const newWorld = deltaQ.multiply(base.clone())
        // 转换为本地旋转
        if (node.parent) {
          const parentWQ = new THREE.Quaternion()
          node.parent.getWorldQuaternion(parentWQ)
          const newLocal = parentWQ.clone().invert().multiply(newWorld)
          node.quaternion.copy(newLocal)
        }
      }

      // 根据手势类型应用骨骼旋转
      switch (targetGesture) {
        case 'wave': {
          // 挥手：右手上举，前臂左右摆动
          if (bones.rightUpperArm) {
            setBoneRot('rightUpperArm', [0, 0, 1], -2.0) // 上举
            setBoneRot('rightUpperArm', [1, 0, 0], -0.3)  // 略向前
          }
          if (bones.rightLowerArm) {
            const waveAngle = Math.sin(t * 5) * 0.5 // 左右摆动
            setBoneRot('rightLowerArm', [0, 1, 0], waveAngle)
          }
          break
        }
        case 'nod': {
          // 点头：头部上下点头
          const nodAngle = Math.sin(t * 4) * 0.25
          setBoneRot('head', [1, 0, 0], nodAngle)
          break
        }
        case 'shake': {
          // 摇头：头部左右摇头
          const shakeAngle = Math.sin(t * 4) * 0.3
          setBoneRot('head', [0, 1, 0], shakeAngle)
          break
        }
        case 'thinking': {
          // 思考：右手托下巴，头部微倾
          if (bones.rightUpperArm) {
            setBoneRot('rightUpperArm', [0, 0, 1], -1.5) // 上举
            setBoneRot('rightUpperArm', [1, 0, 0], -0.5)  // 向前
          }
          if (bones.rightLowerArm) {
            setBoneRot('rightLowerArm', [1, 0, 0], -1.2) // 弯曲
          }
          setBoneRot('head', [0, 0, 1], 0.15) // 头部微倾
          setBoneRot('head', [1, 0, 0], -0.1) // 略低头
          break
        }
        case 'heart': {
          // 比心：双手在胸前比心
          if (bones.leftUpperArm) {
            setBoneRot('leftUpperArm', [0, 0, 1], 1.2)  // 上举
            setBoneRot('leftUpperArm', [1, 0, 0], -0.8)  // 向前
          }
          if (bones.rightUpperArm) {
            setBoneRot('rightUpperArm', [0, 0, 1], -1.2) // 上举
            setBoneRot('rightUpperArm', [1, 0, 0], -0.8) // 向前
          }
          if (bones.leftLowerArm) {
            setBoneRot('leftLowerArm', [1, 0, 0], -1.5)  // 弯曲
            setBoneRot('leftLowerArm', [0, 1, 0], 0.3)   // 向内
          }
          if (bones.rightLowerArm) {
            setBoneRot('rightLowerArm', [1, 0, 0], -1.5) // 弯曲
            setBoneRot('rightLowerArm', [0, 1, 0], -0.3) // 向内
          }
          break
        }
      }
    } else if (targetGesture === 'idle' && gestureProgressRef.current > 0) {
      // 恢复空闲：手势进度渐出
      const gestureSpeed = Math.min(1, delta * 3)
      gestureProgressRef.current = Math.max(0, gestureProgressRef.current - gestureSpeed)
      // 这里可以添加恢复逻辑，但因为每帧都从基础旋转开始计算，所以不需要显式恢复
      // 当 gestureProgressRef.current 为 0 时，所有手势旋转都会被乘以 0，相当于恢复初始状态
    }
  })

  // 加载失败：抛出，由上层 ModelErrorBoundary 回退到程序化角色
  if (error) throw error

  return (
    <>
      {vrm && (
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
          {/* VRM 默认面向 -Z，旋转 180° 使其面向相机 */}
          {/* 如果模型头倒着，可以调整 rotation-x 或 rotation-z 来校正 */}
          <primitive object={vrm.scene} rotation-y={Math.PI} rotation-x={0} rotation-z={0} />
        </group>
      )}
      {loading && (
        <Html fullscreen zIndexRange={[200, 0]} style={{ pointerEvents: 'none' }}>
          <div className="vrm-loading">
            <div className="vrm-loading-spinner" />
            <div className="vrm-loading-title">加载中...</div>
            {progress > 0 && progress < 100 && (
              <div className="vrm-loading-bar">
                <span style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="vrm-loading-sub">
              {progress >= 100
                ? '加载完成'
                : progress > 0
                  ? `加载中 ${progress}%`
                  : '正在连接...'}
            </div>
          </div>
        </Html>
      )}
    </>
  )
}
