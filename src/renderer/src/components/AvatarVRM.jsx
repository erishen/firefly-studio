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

export default function AvatarVRM({ url, token, speakingRef, blinkRef, onClick }) {
  
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
      if (!baseHead.current) baseHead.current = { x: head.rotation.x, y: head.rotation.y }
      const tx = state.pointer.x * 0.35
      const ty = -state.pointer.y * 0.25
      head.rotation.y += (baseHead.current.y + tx - head.rotation.y) * 0.1
      head.rotation.x += (baseHead.current.x + ty + bob - head.rotation.x) * 0.1
    }
    eyeRefs.current.forEach((eye, i) => {
      if (!eye) return
      if (!baseEyes.current[i]) baseEyes.current[i] = { x: eye.rotation.x, y: eye.rotation.y }
      const tx = state.pointer.x * 0.3
      const ty = -state.pointer.y * 0.2
      eye.rotation.y += (baseEyes.current[i].y + tx - eye.rotation.y) * 0.15
      eye.rotation.x += (baseEyes.current[i].x + ty - eye.rotation.x) * 0.15
    })

    // 说话口型：优先 expressionManager（VRM1.0 / 规范 VRM0.0）；否则回退直接驱动 morph
    // （本模型 blendShapeMaster 为空 → expressionManager 无表情，走 mesh.morphTargetInfluences 的 あ/い/う/え/お）
    const t = state.clock.elapsedTime
    if (useExprMouthRef.current && vrm.expressionManager) {
      const mouthNames = ['aa', 'ih', 'ou', 'ee', 'oh', 'a']
      const activeIdx = speakingRef.current ? Math.floor(t * 7) % mouthNames.length : -1
      mouthNames.forEach((n, i) => {
        vrm.expressionManager.setValue(n, i === activeIdx ? 0.7 : 0)
      })
    } else if (mouthMeshRef.current) {
      const infl = mouthMeshRef.current.morphTargetInfluences
      const mi = mouthIdxRef.current
      for (const k of ['a', 'i', 'u', 'e', 'o']) if (mi[k] != null) infl[mi[k]] = 0
      if (speakingRef.current) {
        const vowels = ['a', 'i', 'u', 'e', 'o']
        const v = vowels[Math.floor(t * 7) % 5]
        if (mi[v] != null) infl[mi[v]] = 0.7
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
          <primitive object={vrm.scene} rotation-y={Math.PI} />
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
