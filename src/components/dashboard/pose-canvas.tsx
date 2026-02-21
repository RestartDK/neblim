import { useEffect, useRef, useCallback } from "react"

// COCO 17-keypoint skeleton connections
const SKELETON_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4],       // head
  [5, 6],                                  // shoulders
  [5, 7], [7, 9],                          // left arm
  [6, 8], [8, 10],                         // right arm
  [5, 11], [6, 12],                        // torso
  [11, 12],                                // hips
  [11, 13], [13, 15],                      // left leg
  [12, 14], [14, 16],                      // right leg
]

interface Keypoint {
  x: number
  y: number
  confidence: number
}

interface Person {
  keypoints: Keypoint[]
  confidence: number
  name?: string
}

// Simulated pose data for Margaret standing in living room
function generateDemoPose(time: number): Person {
  const breathe = Math.sin(time * 0.002) * 2
  const sway = Math.sin(time * 0.001) * 1.5

  const cx = 200 + sway
  const cy = 180

  return {
    name: "Margaret",
    confidence: 0.97,
    keypoints: [
      // 0: nose
      { x: cx, y: cy - 70 + breathe * 0.3, confidence: 0.98 },
      // 1: left eye
      { x: cx - 8, y: cy - 76 + breathe * 0.3, confidence: 0.96 },
      // 2: right eye
      { x: cx + 8, y: cy - 76 + breathe * 0.3, confidence: 0.96 },
      // 3: left ear
      { x: cx - 16, y: cy - 72 + breathe * 0.3, confidence: 0.88 },
      // 4: right ear
      { x: cx + 16, y: cy - 72 + breathe * 0.3, confidence: 0.88 },
      // 5: left shoulder
      { x: cx - 30, y: cy - 40 + breathe, confidence: 0.95 },
      // 6: right shoulder
      { x: cx + 30, y: cy - 40 + breathe, confidence: 0.95 },
      // 7: left elbow
      { x: cx - 40, y: cy + breathe * 0.8, confidence: 0.92 },
      // 8: right elbow
      { x: cx + 40, y: cy + breathe * 0.8, confidence: 0.92 },
      // 9: left wrist
      { x: cx - 35, y: cy + 35 + breathe * 0.5, confidence: 0.89 },
      // 10: right wrist
      { x: cx + 35, y: cy + 35 + breathe * 0.5, confidence: 0.89 },
      // 11: left hip
      { x: cx - 18, y: cy + 50 + breathe * 0.3, confidence: 0.94 },
      // 12: right hip
      { x: cx + 18, y: cy + 50 + breathe * 0.3, confidence: 0.94 },
      // 13: left knee
      { x: cx - 20, y: cy + 110, confidence: 0.91 },
      // 14: right knee
      { x: cx + 20, y: cy + 110, confidence: 0.91 },
      // 15: left ankle
      { x: cx - 22, y: cy + 165, confidence: 0.87 },
      // 16: right ankle
      { x: cx + 22, y: cy + 165, confidence: 0.87 },
    ],
  }
}

export function PoseCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const isDark = useRef(true)

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const time = performance.now()
    const person = generateDemoPose(time)
    const dark = document.documentElement.classList.contains("dark")
    isDark.current = dark

    // clear
    ctx.clearRect(0, 0, w, h)

    // room grid background
    const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)"
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = 0; y < h; y += 30) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // room dividers (dashed)
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = dark ? "rgba(100,180,255,0.25)" : "rgba(60,130,200,0.2)"
    ctx.lineWidth = 1.5

    // vertical divider (living room | kitchen)
    ctx.beginPath()
    ctx.moveTo(w * 0.55, 0)
    ctx.lineTo(w * 0.55, h * 0.55)
    ctx.stroke()

    // horizontal divider
    ctx.beginPath()
    ctx.moveTo(0, h * 0.55)
    ctx.lineTo(w, h * 0.55)
    ctx.stroke()

    ctx.setLineDash([])

    // room labels
    ctx.font = "11px 'Inter Variable', sans-serif"
    ctx.fillStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"
    ctx.fillText("Living Room", 12, 20)
    ctx.fillText("Kitchen", w * 0.55 + 12, 20)
    ctx.fillText("Bedroom", 12, h * 0.55 + 20)
    ctx.fillText("Bathroom", w * 0.55 + 12, h * 0.55 + 20)

    // draw skeleton glow
    ctx.shadowColor = "rgba(34,197,94,0.4)"
    ctx.shadowBlur = 8

    // draw skeleton lines
    ctx.strokeStyle = "rgba(34,197,94,0.8)"
    ctx.lineWidth = 2.5
    ctx.lineCap = "round"

    for (const [i, j] of SKELETON_CONNECTIONS) {
      const a = person.keypoints[i]
      const b = person.keypoints[j]
      if (a.confidence > 0.3 && b.confidence > 0.3) {
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    // draw keypoints
    ctx.shadowBlur = 12
    for (const kp of person.keypoints) {
      if (kp.confidence < 0.3) continue
      ctx.beginPath()
      ctx.arc(kp.x, kp.y, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(34,197,94,1)"
      ctx.fill()
    }

    // head circle
    const nose = person.keypoints[0]
    ctx.beginPath()
    ctx.arc(nose.x, nose.y - 14, 14, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(34,197,94,0.8)"
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = "rgba(34,197,94,0.15)"
    ctx.fill()

    ctx.shadowBlur = 0
    ctx.shadowColor = "transparent"

    // name label
    ctx.font = "600 13px 'Inter Variable', sans-serif"
    ctx.fillStyle = "rgba(34,197,94,1)"
    ctx.textAlign = "center"
    ctx.fillText(person.name ?? "Person", nose.x, person.keypoints[15].y + 24)

    // confidence label
    ctx.font = "11px 'Inter Variable', sans-serif"
    ctx.fillStyle = dark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)"
    ctx.fillText(
      `Confidence: ${Math.round(person.confidence * 100)}%`,
      nose.x,
      person.keypoints[15].y + 40
    )
    ctx.textAlign = "start"

    animRef.current = requestAnimationFrame(() => draw(ctx, w, h))
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      ctx.scale(dpr, dpr)
    }

    resize()
    const observer = new ResizeObserver(resize)
    if (canvas.parentElement) observer.observe(canvas.parentElement)

    draw(ctx, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1))

    return () => {
      cancelAnimationFrame(animRef.current)
      observer.disconnect()
    }
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full"
    />
  )
}
