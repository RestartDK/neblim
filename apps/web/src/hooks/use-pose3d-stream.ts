import { useCallback, useEffect, useRef, useState } from "react";

import { POSE3D_ENDPOINTS, buildPose3dApiUrl } from "@/config/api";
import {
  pose3dService,
  type Pose3dFrame,
  type Pose3dPerson,
} from "@/services/pose3d-service";
import { type WebSocketConnectionState } from "@/services/websocket";

const POSE3D_PROBE_TIMEOUT_MS = 2_500;
const POSE3D_PROBE_INTERVAL_MS = 10_000;

export interface Pose3dStreamState {
  persons3d: Pose3dPerson[];
  connectionState: WebSocketConnectionState;
  fps: number;
  lastUpdate: string | null;
  error: string | null;
  isAvailable: boolean;
  seedDemo: (survivors?: number) => Promise<void>;
}

const probePose3dAvailability = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    POSE3D_PROBE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(buildPose3dApiUrl(POSE3D_ENDPOINTS.healthz), {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    return body.trim().toLowerCase() === "ok";
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export function usePose3dStream(): Pose3dStreamState {
  const [persons3d, setPersons3d] = useState<Pose3dPerson[]>([]);
  const [connectionState, setConnectionState] =
    useState<WebSocketConnectionState>("disconnected");
  const [fps, setFps] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);

  const frameTimesRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    const runProbe = async () => {
      const available = await probePose3dAvailability();
      if (cancelled) {
        return;
      }

      setIsAvailable(available);
      if (!available) {
        setConnectionState("disconnected");
      }
    };

    void runProbe();

    const interval = window.setInterval(() => {
      void runProbe();
    }, POSE3D_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const applyFrame = (frame: Pose3dFrame) => {
      const now = Date.now();
      const recentFrameTimes = [...frameTimesRef.current, now].filter(
        (time) => now - time <= 1000,
      );
      frameTimesRef.current = recentFrameTimes;

      setPersons3d(frame.persons);
      setFps(recentFrameTimes.length);
      setLastUpdate(frame.timestamp);
      setError(null);
    };

    if (!isAvailable) {
      pose3dService.disconnect();
      return;
    }

    const unsubscribePose = pose3dService.subscribe((frame) => {
      applyFrame(frame);
    });

    const unsubscribeState = pose3dService.subscribeConnectionState((state) => {
      setConnectionState(state);
    });

    const unsubscribeError = pose3dService.subscribeErrors((nextError) => {
      setError(nextError);
    });

    void pose3dService.connect().catch(() => {
      setError("Failed to connect to 3D pose stream");
      setConnectionState("disconnected");
    });

    return () => {
      unsubscribePose();
      unsubscribeState();
      unsubscribeError();
      pose3dService.disconnect();
    };
  }, [isAvailable]);

  const seedDemo = useCallback(async (survivors = 3) => {
    try {
      await pose3dService.seedDemo(survivors);
      setError(null);
    } catch {
      setError("Failed to seed 3D demo stream");
    }
  }, []);

  return {
    persons3d,
    connectionState,
    fps,
    lastUpdate,
    error,
    isAvailable,
    seedDemo,
  };
}
