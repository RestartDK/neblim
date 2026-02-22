import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildAiServerUrl } from "@/config/api";
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

const formatUserMessage = (result: MeshClassificationResult): string =>
  [
    "System escalation.",
    `A ${result.severity} monitoring event was detected: ${result.title}.`,
    "Call the resident now and perform an urgent safety check-in.",
    "Start speaking immediately.",
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
  const pendingTriggerRef = useRef<MeshClassificationResult | null>(null);
  const lastStartAttemptAtRef = useRef(0);

  const [lastTrigger, setLastTrigger] = useState<FallbackTrigger | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [autoStartCount, setAutoStartCount] = useState(0);

  const fetchConversationToken = useCallback(async (): Promise<string> => {
    const endpoint = buildAiServerUrl(
      `/api/elevenlabs/conversation-token?agentId=${encodeURIComponent(resolvedAgentId)}`,
    );

    const response = await fetch(endpoint, {
      method: "GET",
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Unable to fetch ElevenLabs conversation token (${response.status}): ${details}`,
      );
    }

    const payload = (await response.json()) as { token?: unknown };
    if (typeof payload.token !== "string" || payload.token.length === 0) {
      throw new Error("Token response missing token value");
    }

    return payload.token;
  }, [resolvedAgentId]);

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

    const pendingTrigger = pendingTriggerRef.current;
    if (!pendingTrigger) {
      return;
    }

    pendingTriggerRef.current = null;

    const contextualUpdate = formatContextualUpdate(pendingTrigger);
    const userMessage = formatUserMessage(pendingTrigger);

    try {
      conversation.sendContextualUpdate(contextualUpdate);
      conversation.sendUserMessage(userMessage);
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
      const userMessage = formatUserMessage(result);

      setLastTrigger({
        ...result,
        triggeredAt: new Date(now).toISOString(),
      });
      setLastError(null);

      if (conversation.status === "connected") {
        try {
          conversation.sendContextualUpdate(contextUpdate);
          conversation.sendUserMessage(userMessage);
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
        pendingTriggerRef.current = result;
        return;
      }

      if (now - lastStartAttemptAtRef.current < AUTO_START_COOLDOWN_MS) {
        return;
      }

      lastStartAttemptAtRef.current = now;
      pendingTriggerRef.current = result;

      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const conversationToken = await fetchConversationToken();
        await conversation.startSession({
          conversationToken,
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
    [conversation, enabled, fetchConversationToken],
  );

  const stopFallbackSession = useCallback(() => {
    pendingTriggerRef.current = null;
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
