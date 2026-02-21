import { useEffect, useRef, useState } from "react";

import { useBackendDetector } from "@/hooks/use-backend-detector";
import {
  poseService,
  type PoseFrame,
  type PoseFrameStats,
  type PosePerson,
} from "@/services/pose-service";
import { type WebSocketConnectionState } from "@/services/websocket";

export interface PoseStreamState {
  persons: PosePerson[];
  connectionState: WebSocketConnectionState;
  frameCount: number;
  frameId: string | null;
  fps: number;
  lastUpdate: string | null;
  error: string | null;
  stats: PoseFrameStats;
  isDemo: boolean;
}

const DEFAULT_STATS: PoseFrameStats = {
  signalStrength: -42,
  trackingPoints: 0,
  latency: 0,
  roomDuration: 0,
  stepsToday: 0,
  posture: "Unknown",
  gait: "No signal",
  movement: "Idle",
};

export function usePoseStream(): PoseStreamState {
  const { isAvailable, isChecking } = useBackendDetector();

  const [persons, setPersons] = useState<PosePerson[]>([]);
  const [connectionState, setConnectionState] =
    useState<WebSocketConnectionState>("connecting");
  const [frameCount, setFrameCount] = useState(0);
  const [frameId, setFrameId] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PoseFrameStats>(DEFAULT_STATS);
  const [isDemo, setIsDemo] = useState(false);

  const frameTimesRef = useRef<number[]>([]);

  useEffect(() => {
    const applyFrame = (frame: PoseFrame) => {
      const now = Date.now();
      const recentFrameTimes = [...frameTimesRef.current, now].filter(
        (time) => now - time <= 1000,
      );
      frameTimesRef.current = recentFrameTimes;

      setPersons(frame.persons);
      setStats(frame.stats);
      setFrameCount((count) => count + 1);
      setFrameId(frame.frameId);
      setFps(recentFrameTimes.length);
      setLastUpdate(frame.timestamp);
      setError(null);
    };

    if (isChecking) {
      setConnectionState("connecting");
      return;
    }

    let disposed = false;
    let demoFrameId: number | null = null;

    if (!isAvailable) {
      setIsDemo(true);
      setConnectionState("disconnected");

      const renderDemoFrame = () => {
        if (disposed) {
          return;
        }

        const frame = poseService.buildDemoFrame(performance.now());
        applyFrame(frame);
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

    const unsubscribePose = poseService.subscribe((frame) => {
      applyFrame(frame);
    });

    const unsubscribeState = poseService.subscribeConnectionState((state) => {
      setConnectionState(state);
    });

    const unsubscribeError = poseService.subscribeErrors((nextError) => {
      setError(nextError);
    });

    void poseService.connect().catch(() => {
      setError("Failed to connect to pose stream");
      setConnectionState("disconnected");
    });

    return () => {
      disposed = true;
      unsubscribePose();
      unsubscribeState();
      unsubscribeError();
      poseService.disconnect();
    };
  }, [isAvailable, isChecking]);

  return {
    persons,
    connectionState,
    frameCount,
    frameId,
    fps,
    lastUpdate,
    error,
    stats,
    isDemo,
  };
}
