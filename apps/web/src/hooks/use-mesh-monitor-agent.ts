import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { buildAiServerUrl } from "@/config/api";
import type {
  ActivityEvent,
  ActivitySeverity,
} from "@/hooks/use-activity-events";
import { captureCanvasSnapshot } from "@/lib/capture-canvas";
import type { PoseFrameStats, PosePerson } from "@/services/pose-service";

interface MeshMonitorAgentOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  persons: PosePerson[];
  frameId: string | null;
  timestamp: string | null;
  poseStats: PoseFrameStats;
  isDemo: boolean;
  enabled: boolean;
  onBadClassification?: (result: MeshClassificationResult) => void;
}

export interface MeshClassificationResult {
  severity: ActivitySeverity;
  title: string;
  description: string;
  action: string;
  confidence: number;
}

const POLL_INTERVAL_MS = 4_000;
const EVENT_DEDUPE_WINDOW_MS = 25_000;
const ERROR_EVENT_COOLDOWN_MS = 60_000;
const MAX_EVENTS = 20;
const LOG_PREFIX = "[mesh-monitor-agent]";

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

const createEvent = (
  severity: ActivitySeverity,
  title: string,
  description: string,
  action: string,
): ActivityEvent => {
  const timestamp = Date.now();

  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    title,
    description,
    action,
    time: formatTime(timestamp),
  };
};

const buildInitialEvent = (enabled: boolean): ActivityEvent =>
  enabled
    ? createEvent(
        "ok",
        "Mesh Monitor Active",
        "Screenshot classification loop initialized and waiting for the first analysis tick.",
        "Passive observation enabled",
      )
    : createEvent(
        "warning",
        "Mesh Monitor Paused",
        "AI screenshot classification stays idle while the device is offline.",
        "Waiting for device online state",
      );

const isMeshClassificationResult = (
  value: unknown,
): value is MeshClassificationResult => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const severity = payload.severity;
  const confidence = payload.confidence;

  return (
    (severity === "ok" || severity === "warning" || severity === "critical") &&
    typeof payload.title === "string" &&
    payload.title.length > 0 &&
    typeof payload.description === "string" &&
    payload.description.length > 0 &&
    typeof payload.action === "string" &&
    payload.action.length > 0 &&
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
};

export function useMeshMonitorAgent({
  canvasRef,
  persons,
  frameId,
  timestamp,
  poseStats,
  isDemo,
  enabled,
  onBadClassification,
}: MeshMonitorAgentOptions): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const personsRef = useRef(persons);
  const frameIdRef = useRef(frameId);
  const timestampRef = useRef(timestamp);
  const poseStatsRef = useRef(poseStats);
  const isDemoRef = useRef(isDemo);
  const enabledRef = useRef(enabled);
  const onBadClassificationRef = useRef(onBadClassification);

  const dedupeAtRef = useRef<Map<string, number>>(new Map());
  const lastErrorEventAt = useRef(0);

  useEffect(() => {
    personsRef.current = persons;
  }, [persons]);

  useEffect(() => {
    frameIdRef.current = frameId;
  }, [frameId]);

  useEffect(() => {
    timestampRef.current = timestamp;
  }, [timestamp]);

  useEffect(() => {
    poseStatsRef.current = poseStats;
  }, [poseStats]);

  useEffect(() => {
    isDemoRef.current = isDemo;
  }, [isDemo]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    onBadClassificationRef.current = onBadClassification;
  }, [onBadClassification]);

  useEffect(() => {
    dedupeAtRef.current.clear();
    lastErrorEventAt.current = 0;
  }, [enabled]);

  const statusEvent = useMemo(() => buildInitialEvent(enabled), [enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let inFlight = false;

    const scheduleNext = () => {
      if (cancelled) {
        return;
      }

      timeoutId = window.setTimeout(() => {
        void runTick();
      }, POLL_INTERVAL_MS);
    };

    const pushClassificationEvent = (result: MeshClassificationResult) => {
      const now = Date.now();
      const dedupeKey = `${result.severity}:${result.title.trim().toLowerCase()}`;
      const lastSeenAt = dedupeAtRef.current.get(dedupeKey) ?? 0;

      if (now - lastSeenAt < EVENT_DEDUPE_WINDOW_MS) {
        console.debug(`${LOG_PREFIX} Event deduped`, {
          severity: result.severity,
          title: result.title,
        });
        return;
      }

      dedupeAtRef.current.set(dedupeKey, now);

      const confidencePct = Math.round(result.confidence * 100);

      console.info(`${LOG_PREFIX} Classification received`, {
        severity: result.severity,
        title: result.title,
        confidence: result.confidence,
      });

      setEvents((current) =>
        [
          createEvent(
            result.severity,
            result.title,
            `${result.description} Confidence ${confidencePct}%.`,
            result.action,
          ),
          ...current,
        ].slice(0, MAX_EVENTS),
      );

      if (result.severity !== "ok") {
        onBadClassificationRef.current?.(result);
      }
    };

    const pushClassifierErrorEvent = () => {
      const now = Date.now();
      if (now - lastErrorEventAt.current < ERROR_EVENT_COOLDOWN_MS) {
        return;
      }

      console.warn(`${LOG_PREFIX} Classifier unavailable, retrying`);

      lastErrorEventAt.current = now;

      setEvents((current) =>
        [
          createEvent(
            "warning",
            "Classifier Unavailable",
            "Unable to reach the AI screenshot classifier. Monitoring will retry automatically.",
            "Retrying in background",
          ),
          ...current,
        ].slice(0, MAX_EVENTS),
      );
    };

    const runTick = async () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;

      try {
        if (!enabledRef.current) {
          return;
        }

        if (document.visibilityState !== "visible") {
          return;
        }

        const canvas = canvasRef.current;
        if (!canvas) {
          console.debug(`${LOG_PREFIX} Tick skipped, canvas unavailable`);
          return;
        }

        const screenshot = await captureCanvasSnapshot(canvas);
        if (!screenshot) {
          console.debug(
            `${LOG_PREFIX} Tick skipped, screenshot capture failed`,
          );
          return;
        }

        const primaryPerson = personsRef.current[0];
        const metaPayload = {
          timestamp: timestampRef.current ?? new Date().toISOString(),
          frameId: frameIdRef.current,
          personName: primaryPerson?.name ?? primaryPerson?.id ?? null,
          poseStats: poseStatsRef.current,
          personCount: personsRef.current.length,
          source: isDemoRef.current ? "demo" : "realtime",
        };

        const formData = new FormData();
        formData.append("image", screenshot, `mesh-${Date.now()}.jpg`);
        formData.append("meta", JSON.stringify(metaPayload));

        console.debug(`${LOG_PREFIX} Sending classification request`, {
          frameId: metaPayload.frameId,
          personCount: metaPayload.personCount,
          source: metaPayload.source,
          imageSizeBytes: screenshot.size,
        });

        const response = await fetch(buildAiServerUrl("/api/mesh-classify"), {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(
            `Classification request failed with ${response.status}`,
          );
        }

        const payload = (await response.json()) as unknown;
        if (!isMeshClassificationResult(payload)) {
          throw new Error("Classification response format is invalid");
        }

        pushClassificationEvent(payload);
      } catch (error) {
        console.error(`${LOG_PREFIX} Tick failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
        pushClassifierErrorEvent();
      } finally {
        inFlight = false;
        scheduleNext();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      void runTick();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void runTick();

    return () => {
      cancelled = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [canvasRef, enabled]);

  return [statusEvent, ...events].slice(0, MAX_EVENTS);
}
