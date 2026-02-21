import { useEffect, useRef, useState } from "react"

import type { PosePerson } from "@/services/pose-service"

export type ActivitySeverity = "critical" | "warning" | "ok"

export interface ActivityEvent {
  id: string
  severity: ActivitySeverity
  title: string
  description: string
  action: string
  time: string
}

interface UseActivityEventsOptions {
  persons: PosePerson[]
  healthStatus: string
  isDemo: boolean
}

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

const createEvent = (
  severity: ActivitySeverity,
  title: string,
  description: string,
  action: string
): ActivityEvent => {
  const timestamp = Date.now()

  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    title,
    description,
    action,
    time: formatTime(timestamp),
  }
}

const initialEvents: ActivityEvent[] = [
  createEvent(
    "ok",
    "Monitoring Active",
    "WiFi body mesh stream initialized and awaiting pose confidence updates.",
    "Passive observation enabled"
  ),
]

export function useActivityEvents({
  persons,
  healthStatus,
  isDemo,
}: UseActivityEventsOptions): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents)

  const lastCriticalAt = useRef(0)
  const lastWarningAt = useRef(0)
  const lastOkAt = useRef(0)
  const previousHealthStatus = useRef<string | null>(null)

  useEffect(() => {
    if (previousHealthStatus.current === healthStatus) {
      return
    }

    previousHealthStatus.current = healthStatus

    if (healthStatus === "unhealthy") {
      setEvents((current) => [
        createEvent(
          "critical",
          "Backend Health Degraded",
          "Health endpoint reported an unhealthy state for one or more system components.",
          "Escalated for immediate inspection"
        ),
        ...current,
      ].slice(0, 20))
      return
    }

    if (healthStatus === "degraded") {
      setEvents((current) => [
        createEvent(
          "warning",
          "System Degraded",
          "One or more backend services are reporting degraded performance.",
          "Tracking trend for further anomalies"
        ),
        ...current,
      ].slice(0, 20))
    }
  }, [healthStatus])

  useEffect(() => {
    if (persons.length === 0) {
      if (!isDemo) {
        const now = Date.now()
        if (now - lastWarningAt.current >= 25_000) {
          lastWarningAt.current = now
          setEvents((current) => [
            createEvent(
              "warning",
              "Pose Signal Drop",
              "No tracked persons in the latest stream interval.",
              "Watching for stream recovery"
            ),
            ...current,
          ].slice(0, 20))
        }
      }
      return
    }

    const now = Date.now()
    const primary = persons[0]

    if (primary.gaitPattern === "unsteady" && primary.movementDelta > 0.05) {
      if (now - lastCriticalAt.current >= 30_000) {
        lastCriticalAt.current = now
        setEvents((current) => [
          createEvent(
            "critical",
            "Fall Risk Spike",
            "Sudden movement delta detected with unstable gait confidence.",
            "Voice check-in should be prioritized"
          ),
          ...current,
        ].slice(0, 20))
      }
      return
    }

    if (primary.gaitPattern === "unsteady") {
      if (now - lastWarningAt.current >= 20_000) {
        lastWarningAt.current = now
        setEvents((current) => [
          createEvent(
            "warning",
            "Erratic Gait Pattern",
            "Stride symmetry drifted outside the baseline corridor.",
            "Family alert queued for review"
          ),
          ...current,
        ].slice(0, 20))
      }
      return
    }

    if (now - lastOkAt.current >= 45_000) {
      lastOkAt.current = now
      setEvents((current) => [
        createEvent(
          "ok",
          "Routine Movement Confirmed",
          "Current gait and posture metrics are within baseline thresholds.",
          "Logged to daily activity summary"
        ),
        ...current,
      ].slice(0, 20))
    }
  }, [isDemo, persons])

  return events
}
