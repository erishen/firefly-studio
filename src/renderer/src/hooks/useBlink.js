import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

// 真随机眨眼调度：2.5~6.5s 随机间隔，单次 140ms
// 抽到 hook 里，让程序化角色与 RPM 模型共用同一套调度
export function useBlink(blinkRef) {
  const nextBlink = useRef(2)
  const blinkEnd = useRef(0)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (t > nextBlink.current) {
      blinkRef.current = true
      blinkEnd.current = t + 0.14
      nextBlink.current = t + 2.5 + Math.random() * 4
    }
    if (blinkRef.current && t > blinkEnd.current) blinkRef.current = false
  })
}
