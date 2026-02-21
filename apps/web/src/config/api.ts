const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const DEFAULT_API_BASE_URL = "http://localhost:8000";
const DEFAULT_WS_BASE_URL = "ws://localhost:8000";
const DEFAULT_POSE3D_API_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_POSE3D_WS_BASE_URL = "ws://127.0.0.1:8787";
const DEFAULT_AI_SERVER_BASE_URL = "http://localhost:8001";

export const BASE_URL = stripTrailingSlash(
  import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL,
);

export const WS_URL = stripTrailingSlash(
  import.meta.env.VITE_WS_BASE_URL ?? DEFAULT_WS_BASE_URL,
);

export const POSE3D_BASE_URL = stripTrailingSlash(
  import.meta.env.VITE_POSE3D_API_BASE_URL ?? DEFAULT_POSE3D_API_BASE_URL,
);

export const POSE3D_WS_URL = stripTrailingSlash(
  import.meta.env.VITE_POSE3D_WS_BASE_URL ?? DEFAULT_POSE3D_WS_BASE_URL,
);

export const AI_SERVER_BASE_URL = stripTrailingSlash(
  import.meta.env.VITE_AI_SERVER_BASE_URL ?? DEFAULT_AI_SERVER_BASE_URL,
);

export const API_ENDPOINTS = {
  health: "/health/health",
  healthLive: "/health/live",
  currentPose: "/pose/current",
  zonesSummary: "/pose/zones/summary",
  stats: "/pose/stats",
  apiInfo: "/info",
  wsPoseStream: "/api/v1/stream/pose",
} as const;

export const POSE3D_ENDPOINTS = {
  healthz: "/healthz",
  current: "/api/v1/pose/current",
  stream: "/ws/pose/stream",
  seed: "/api/v1/pose/demo/seed",
} as const;

export const API_TIMEOUT_MS = 10_000;
export const BACKEND_DETECT_TIMEOUT_MS = 3_000;
export const HEALTH_POLL_INTERVAL_MS = 10_000;

export const WS_RECONNECT_CONFIG = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
} as const;

export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

export const buildApiUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

export const buildWsUrl = (path: string): string => {
  if (path.startsWith("ws://") || path.startsWith("wss://")) {
    return path;
  }

  return `${WS_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

export const buildPose3dApiUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${POSE3D_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

export const buildPose3dWsUrl = (path: string): string => {
  if (path.startsWith("ws://") || path.startsWith("wss://")) {
    return path;
  }

  return `${POSE3D_WS_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

export const buildAiServerUrl = (path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${AI_SERVER_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};
