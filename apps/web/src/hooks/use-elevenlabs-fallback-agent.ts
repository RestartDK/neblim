import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MeshClassificationResult } from "@/hooks/use-mesh-monitor-agent";

const DEFAULT_AGENT_ID = "agent_4001kj21va8jea6rt51z9mm5158c";
const AUTO_START_COOLDOWN_MS = 45_000;
const LOG_PREFIX = "[elevenlabs-fallback-agent]";

export interface FallbackTrigger extends MeshClassificationResult {
  triggeredAt: string;
}

interface UseElevenlabsFallbackAgentOptions {
  enabled: boolean;
  agentId?: string;
}

const formatContextualUpdate = (result: MeshClassificationResult): string =>
  [
    "Fallback voice call triggered by mesh classification.",
    `Severity: ${result.severity}`,
    `Title: ${result.title}`,
    `Description: ${result.description}`,
    `Action: ${result.action}`,
    `Confidence: ${Math.round(result.confidence * 100)}%`,
  ].join(" ");

const toErrorMessage = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "message" in value) {
    const message = value.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return String(value);
};

export function useElevenlabsFallbackAgent({
  enabled,
  agentId,
}: UseElevenlabsFallbackAgentOptions) {
  const resolvedAgentId =
    agentId ?? import.meta.env.VITE_ELEVENLABS_AGENT_ID ?? DEFAULT_AGENT_ID;
  const pendingContextRef = useRef<string | null>(null);
  const lastStartAttemptAtRef = useRef(0);

  const [lastTrigger, setLastTrigger] = useState<FallbackTrigger | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [autoStartCount, setAutoStartCount] = useState(0);

  const conversation = useConversation({
    onConnect: () => {
      console.info(`${LOG_PREFIX} Connected`);
    },
    onDisconnect: () => {
      console.info(`${LOG_PREFIX} Disconnected`);
    },
    onError: (error) => {
      const message = toErrorMessage(error);
      console.error(`${LOG_PREFIX} Session error`, { error: message });
      setLastError(message);
    },
  });

  useEffect(() => {
    if (conversation.status !== "connected") {
      return;
    }

    const pendingContext = pendingContextRef.current;
    if (!pendingContext) {
      return;
    }

    pendingContextRef.current = null;

    try {
      conversation.sendContextualUpdate(pendingContext);
    } catch (error) {
      const message = toErrorMessage(error);
      console.error(`${LOG_PREFIX} Failed to send contextual update`, {
        error: message,
      });
    }
  }, [conversation, conversation.status]);

  const triggerFallbackFromClassification = useCallback(
    async (result: MeshClassificationResult) => {
      if (!enabled || result.severity === "ok") {
        return;
      }

      const now = Date.now();
      const contextUpdate = formatContextualUpdate(result);

      setLastTrigger({
        ...result,
        triggeredAt: new Date(now).toISOString(),
      });
      setLastError(null);

      if (conversation.status === "connected") {
        try {
          conversation.sendContextualUpdate(contextUpdate);
        } catch (error) {
          const message = toErrorMessage(error);
          console.error(`${LOG_PREFIX} Failed to send live contextual update`, {
            error: message,
          });
          setLastError(message);
        }
        return;
      }

      if (conversation.status === "connecting") {
        pendingContextRef.current = contextUpdate;
        return;
      }

      if (now - lastStartAttemptAtRef.current < AUTO_START_COOLDOWN_MS) {
        return;
      }

      lastStartAttemptAtRef.current = now;
      pendingContextRef.current = contextUpdate;

      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        await conversation.startSession({
          agentId: resolvedAgentId,
          connectionType: "webrtc",
        });
        setAutoStartCount((current) => current + 1);
      } catch (error) {
        const message = toErrorMessage(error);
        console.error(`${LOG_PREFIX} Unable to start fallback session`, {
          error: message,
        });
        setLastError(message);
      }
    },
    [conversation, enabled, resolvedAgentId],
  );

  const stopFallbackSession = useCallback(() => {
    pendingContextRef.current = null;
    conversation.endSession();
  }, [conversation]);

  return {
    agentId: resolvedAgentId,
    status: conversation.status,
    isSpeaking: conversation.isSpeaking,
    lastTrigger,
    lastError,
    autoStartCount,
    triggerFallbackFromClassification,
    stopFallbackSession,
  };
}
