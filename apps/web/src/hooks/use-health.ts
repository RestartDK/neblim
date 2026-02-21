import { useEffect, useState } from "react"

import { HEALTH_POLL_INTERVAL_MS } from "@/config/api"
import { apiClient, type HealthResponse } from "@/services/api"
import { useBackendDetector } from "@/hooks/use-backend-detector"

export interface HealthState {
  status: string
  components: Record<string, string>
  metrics: Record<string, unknown>
  isLoading: boolean
}

const DEMO_HEALTH_STATE: Omit<HealthState, "isLoading"> = {
  status: "healthy",
  components: {
    hardware: "healthy",
    pose: "healthy",
    stream: "healthy",
  },
  metrics: {
    mode: "demo",
  },
}

const normalizeComponents = (
  components: HealthResponse["components"]
): Record<string, string> => {
  if (!components) {
    return {}
  }

  return Object.entries(components).reduce<Record<string, string>>(
    (accumulator, [name, details]) => {
      accumulator[name] = details.status
      return accumulator
    },
    {}
  )
}

export function useHealth(): HealthState {
  const { isAvailable, isChecking } = useBackendDetector()

  const [state, setState] = useState<HealthState>({
    status: "unknown",
    components: {},
    metrics: {},
    isLoading: true,
  })

  useEffect(() => {
    if (isChecking) {
      setState((current) => ({
        ...current,
        isLoading: true,
      }))
      return
    }

    if (!isAvailable) {
      setState({
        ...DEMO_HEALTH_STATE,
        isLoading: false,
      })
      return
    }

    let isDisposed = false

    const loadHealth = async () => {
      try {
        const health = await apiClient.getHealth()
        if (isDisposed) {
          return
        }

        setState({
          status: health.status,
          components: normalizeComponents(health.components),
          metrics: health.system_metrics ?? {},
          isLoading: false,
        })
      } catch {
        if (isDisposed) {
          return
        }

        setState({
          status: "unhealthy",
          components: {
            backend: "unreachable",
          },
          metrics: {},
          isLoading: false,
        })
      }
    }

    void loadHealth()
    const interval = window.setInterval(() => {
      void loadHealth()
    }, HEALTH_POLL_INTERVAL_MS)

    return () => {
      isDisposed = true
      window.clearInterval(interval)
    }
  }, [isAvailable, isChecking])

  return state
}
