import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  API_ENDPOINTS,
  BACKEND_DETECT_TIMEOUT_MS,
  buildApiUrl,
} from "@/config/api";

export interface BackendDetectorState {
  isAvailable: boolean;
  isChecking: boolean;
  refresh: () => Promise<void>;
}

const BackendDetectorContext = createContext<BackendDetectorState | null>(null);

const probeBackendAvailability = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    BACKEND_DETECT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(buildApiUrl(API_ENDPOINTS.healthLive), {
      method: "GET",
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const useBackendProbe = (enabled: boolean): BackendDetectorState => {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setIsChecking(true);
    const available = await probeBackendAvailability();
    setIsAvailable(available);
    setIsChecking(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsChecking(false);
      return;
    }

    void refresh();
  }, [enabled, refresh]);

  return {
    isAvailable,
    isChecking,
    refresh,
  };
};

export function BackendProvider({ children }: { children: ReactNode }) {
  const state = useBackendProbe(true);
  const value = useMemo(() => state, [state]);

  return (
    <BackendDetectorContext.Provider value={value}>
      {children}
    </BackendDetectorContext.Provider>
  );
}

export function useBackendDetector(): BackendDetectorState {
  const context = useContext(BackendDetectorContext);
  const fallbackState = useBackendProbe(context === null);

  if (context) {
    return context;
  }

  return fallbackState;
}
