import { API_ENDPOINTS, API_TIMEOUT_MS, buildApiUrl } from "@/config/api"

type QueryValue = string | number | boolean | null | undefined

export interface HealthComponent {
  name?: string
  status: string
  message?: string | null
  last_check?: string
  uptime_seconds?: number
  metrics?: Record<string, unknown>
}

export interface HealthResponse {
  status: string
  timestamp?: string
  components?: Record<string, HealthComponent>
  system_metrics?: Record<string, unknown>
}

export interface PoseKeypointRecord {
  name?: string
  index?: number
  x: number
  y: number
  confidence?: number
  visible?: boolean
}

export interface PosePersonRecord {
  person_id?: string | number
  track_id?: string | number
  confidence?: number
  name?: string
  activity?: string
  keypoints?: PoseKeypointRecord[]
  bounding_box?: Record<string, number>
}

export interface PoseCurrentResponse {
  timestamp?: string
  frame_id?: string
  persons?: PosePersonRecord[]
  zone_summary?: Record<string, number>
  processing_time_ms?: number
  metadata?: Record<string, unknown>
}

export interface ZonesSummaryResponse {
  timestamp?: string
  total_persons?: number
  zones?: Record<string, number>
  active_zones?: string[]
}

export interface PoseStatsResponse {
  period?: {
    start_time?: string
    end_time?: string
    hours?: number
  }
  statistics?: Record<string, unknown>
}

export type ApiInfoResponse = Record<string, unknown>

export class ApiError extends Error {
  status: number
  statusText: string
  data: unknown

  constructor(message: string, status: number, statusText: string, data: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.statusText = statusText
    this.data = data
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  query?: Record<string, QueryValue>
  body?: unknown
  timeoutMs?: number
}

const buildQueryString = (query?: Record<string, QueryValue>): string => {
  if (!query) return ""

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue
    params.set(key, String(value))
  }

  const queryString = params.toString()
  return queryString ? `?${queryString}` : ""
}

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type")
  if (contentType?.includes("application/json")) {
    return response.json()
  }

  return response.text()
}

class ApiClient {
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? API_TIMEOUT_MS
    )

    const queryString = buildQueryString(options.query)
    const url = `${buildApiUrl(path)}${queryString}`

    const headers = new Headers(options.headers)
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })

      const body = await parseResponseBody(response)

      if (!response.ok) {
        throw new ApiError(
          `Request failed with status ${response.status}`,
          response.status,
          response.statusText,
          body
        )
      }

      return body as T
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Request timed out", 408, "Request Timeout", null)
      }
      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>(API_ENDPOINTS.health)
  }

  getCurrentPose(): Promise<PoseCurrentResponse> {
    return this.request<PoseCurrentResponse>(API_ENDPOINTS.currentPose)
  }

  getZonesSummary(): Promise<ZonesSummaryResponse> {
    return this.request<ZonesSummaryResponse>(API_ENDPOINTS.zonesSummary)
  }

  getStats(hours = 24): Promise<PoseStatsResponse> {
    return this.request<PoseStatsResponse>(API_ENDPOINTS.stats, {
      query: { hours },
    })
  }

  async getApiInfo(): Promise<ApiInfoResponse> {
    try {
      return await this.request<ApiInfoResponse>(API_ENDPOINTS.apiInfo)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return this.request<ApiInfoResponse>("/health/version")
      }
      throw error
    }
  }
}

export const apiClient = new ApiClient()
