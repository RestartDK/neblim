import { useCallback, useEffect, useRef, useState } from "react";

import { POSE3D_ENDPOINTS, buildPose3dApiUrl } from "@/config/api";
import {
  pose3dService,
  type Pose3dFrame,
  type Pose3dPerson,
} from "@/services/pose3d-service";
import { poseService, type PosePerson } from "@/services/pose-service";
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
  isDemo: boolean;
  seedDemo: (survivors?: number) => Promise<void>;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
};

const projectPersonTo3d = (person: PosePerson, index: number): Pose3dPerson => {
  const visiblePoints = person.keypoints.filter(
    (keypoint) => keypoint.confidence > 0.2,
  );
  const centroidX = average(visiblePoints.map((point) => point.x)) || 0.5;
  const centroidY = average(visiblePoints.map((point) => point.y)) || 0.5;

  const shoulderY = average(
    [person.keypoints[5], person.keypoints[6]]
      .filter((point) => point && point.confidence > 0.2)
      .map((point) => point.y),
  );
  const ankleY = average(
    [person.keypoints[15], person.keypoints[16]]
      .filter((point) => point && point.confidence > 0.2)
      .map((point) => point.y),
  );

  const estimatedHeight = clamp(ankleY - shoulderY || 0.45, 0.2, 0.9);
  const isFloorActivity =
    person.activity === "falling" || person.activity === "on_floor";

  return {
    id: person.id || `demo-person-${index + 1}`,
    confidence: person.confidence,
    location_3d: {
      x: (centroidX - 0.5) * 6,
      y: isFloorActivity ? 0.2 : estimatedHeight * 2.2,
      z: (centroidY - 0.5) * 8,
      uncertainty_radius: clamp((1 - person.confidence) * 2 + 0.25, 0.2, 1.8),
      confidence: person.confidence,
    },
  };
};

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
  const [isDemo, setIsDemo] = useState(false);

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
    let demoFrameId: number | null = null;
    let disposed = false;

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

      setIsDemo(true);
      setConnectionState("disconnected");
      setError(null);

      const renderDemoFrame = () => {
        if (disposed) {
          return;
        }

        const frame2d = poseService.buildDemoFrame(performance.now());
        const demoFrame: Pose3dFrame = {
          timestamp: frame2d.timestamp,
          frame_id: frame2d.frameId,
          coordinate_frame: "demo_world",
          persons: frame2d.persons.map(projectPersonTo3d),
        };

        applyFrame(demoFrame);
        demoFrameId = window.requestAnimationFrame(renderDemoFrame);
      };

      demoFrameId = window.requestAnimationFrame(renderDemoFrame);

      return () => {
        disposed = true;
        if (demoFrameId !== null) {
          window.cancelAnimationFrame(demoFrameId);
        }
      };
    }

    setIsDemo(false);

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
      disposed = true;
      if (demoFrameId !== null) {
        window.cancelAnimationFrame(demoFrameId);
      }
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
    isDemo,
    seedDemo,
  };
}
