import { useEffect, useRef } from "react"

import type { PosePerson } from "@/services/pose-service"

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

interface PoseCanvasProps {
  persons: PosePerson[]
}

export function PoseCanvas({ persons }: PoseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const personsRef = useRef(persons)
  const renderRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    personsRef.current = persons
    renderRef.current?.()
  }, [persons])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const parent = canvas.parentElement
    if (!parent) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const render = () => {
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const w = rect.width
      const h = rect.height
      const dark = document.documentElement.classList.contains("dark")

      ctx.clearRect(0, 0, w, h)

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

      ctx.setLineDash([6, 4])
      ctx.strokeStyle = dark ? "rgba(100,180,255,0.25)" : "rgba(60,130,200,0.2)"
      ctx.lineWidth = 1.5

      ctx.beginPath()
      ctx.moveTo(w * 0.55, 0)
      ctx.lineTo(w * 0.55, h * 0.55)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(0, h * 0.55)
      ctx.lineTo(w, h * 0.55)
      ctx.stroke()

      ctx.setLineDash([])

      ctx.font = "11px 'Inter Variable', sans-serif"
      ctx.fillStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"
      ctx.fillText("Living Room", 12, 20)
      ctx.fillText("Kitchen", w * 0.55 + 12, 20)
      ctx.fillText("Bedroom", 12, h * 0.55 + 20)
      ctx.fillText("Bathroom", w * 0.55 + 12, h * 0.55 + 20)

      if (personsRef.current.length === 0) {
        ctx.font = "600 13px 'Inter Variable', sans-serif"
        ctx.fillStyle = dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)"
        ctx.textAlign = "center"
        ctx.fillText("Awaiting pose stream...", w / 2, h / 2)
        ctx.textAlign = "start"
        return
      }

      for (const person of personsRef.current) {
        const keypoints = person.keypoints.map((keypoint) => ({
          ...keypoint,
          px: keypoint.x * w,
          py: keypoint.y * h,
        }))

        ctx.shadowColor = "rgba(34,197,94,0.35)"
        ctx.shadowBlur = 8
        ctx.strokeStyle = "rgba(34,197,94,0.82)"
        ctx.lineWidth = 2.4
        ctx.lineCap = "round"

        for (const [startIndex, endIndex] of SKELETON_CONNECTIONS) {
          const start = keypoints[startIndex]
          const end = keypoints[endIndex]
          if (!start || !end) continue
          if (start.confidence < 0.25 || end.confidence < 0.25) continue

          ctx.beginPath()
          ctx.moveTo(start.px, start.py)
          ctx.lineTo(end.px, end.py)
          ctx.stroke()
        }

        ctx.shadowBlur = 10
        for (const keypoint of keypoints) {
          if (keypoint.confidence < 0.25) continue
          ctx.beginPath()
          ctx.arc(keypoint.px, keypoint.py, 3.2, 0, Math.PI * 2)
          ctx.fillStyle = "rgba(34,197,94,1)"
          ctx.fill()
        }

        const nose = keypoints[0]
        const leftAnkle = keypoints[15]
        const rightAnkle = keypoints[16]

        if (nose && nose.confidence > 0.25) {
          ctx.beginPath()
          ctx.arc(nose.px, nose.py - 14, 14, 0, Math.PI * 2)
          ctx.strokeStyle = "rgba(34,197,94,0.8)"
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.fillStyle = "rgba(34,197,94,0.15)"
          ctx.fill()
        }

        ctx.shadowBlur = 0
        ctx.shadowColor = "transparent"

        const labelX =
          nose?.px ??
          ((leftAnkle?.px ?? w / 2) + (rightAnkle?.px ?? w / 2)) / 2
        const labelY =
          Math.max(leftAnkle?.py ?? 0, rightAnkle?.py ?? 0) ||
          (nose?.py ?? h * 0.75)

        ctx.font = "600 13px 'Inter Variable', sans-serif"
        ctx.fillStyle = "rgba(34,197,94,1)"
        ctx.textAlign = "center"
        ctx.fillText(person.name ?? person.id, labelX, labelY + 24)

        ctx.font = "11px 'Inter Variable', sans-serif"
        ctx.fillStyle = dark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)"
        ctx.fillText(
          `Confidence: ${Math.round(person.confidence * 100)}%`,
          labelX,
          labelY + 40
        )
        ctx.textAlign = "start"
      }
    }

    renderRef.current = render

    const observer = new ResizeObserver(render)
    observer.observe(parent)
    render()

    return () => {
      observer.disconnect()
      renderRef.current = null
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full"
    />
  )
}
