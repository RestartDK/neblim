import { AlertTriangle, Bot, Mic, PhoneOff, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FallbackTrigger } from "@/hooks/use-elevenlabs-fallback-agent";
import { cn } from "@/lib/utils";

interface VoiceAgentCallsProps {
  agentName: string;
  agentId: string;
  status: string;
  isSpeaking: boolean;
  autoStartCount: number;
  lastTrigger: FallbackTrigger | null;
  lastError: string | null;
  onTriggerIncident: () => void;
  onStop: () => void;
}

const statusConfig: Record<string, { label: string; badgeClassName: string }> =
  {
    connected: {
      label: "CONNECTED",
      badgeClassName: "bg-emerald-600 text-white",
    },
    connecting: {
      label: "CONNECTING",
      badgeClassName: "bg-amber-500 text-black",
    },
    disconnected: {
      label: "IDLE",
      badgeClassName: "bg-muted text-muted-foreground",
    },
  };

const severityConfig: Record<FallbackTrigger["severity"], string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  warning:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const formatTriggerTime = (value: string): string =>
  new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

export function VoiceAgentCalls({
  agentName,
  agentId,
  status,
  isSpeaking,
  autoStartCount,
  lastTrigger,
  lastError,
  onTriggerIncident,
  onStop,
}: VoiceAgentCallsProps) {
  const statusEntry = statusConfig[status] ?? {
    label: status.toUpperCase(),
    badgeClassName: "bg-muted text-muted-foreground",
  };

  const canStop = status === "connected" || status === "connecting";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Voice Agent Calls</CardTitle>
        <CardDescription>
          ElevenLabs fallback escalation when mesh classification is warning or
          critical. Use Trigger incident to test the flow manually.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="size-4 text-muted-foreground" />
              {agentName}
            </div>
            <Badge
              className={cn(
                "border-0 text-[10px] font-bold",
                statusEntry.badgeClassName,
              )}
            >
              {statusEntry.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Agent ID: {agentId}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mode:{" "}
            {status === "connected"
              ? isSpeaking
                ? "speaking"
                : "listening"
              : "standby"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-started sessions:{" "}
            <span className="font-semibold text-foreground">
              {autoStartCount}
            </span>
          </p>
        </div>

        {lastTrigger ? (
          <div
            className={cn(
              "rounded-lg border p-3",
              severityConfig[lastTrigger.severity],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                <ShieldAlert className="size-3.5" />
                {lastTrigger.severity}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatTriggerTime(lastTrigger.triggeredAt)}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {lastTrigger.title}
            </p>
            <p className="mt-1 text-xs text-foreground/80">
              {lastTrigger.description}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Confidence {Math.round(lastTrigger.confidence * 100)}% •{" "}
              {lastTrigger.action}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            No fallback calls yet. Voice escalation starts automatically on bad
            classifier responses.
          </div>
        )}

        {lastError && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
              <AlertTriangle className="size-3.5" />
              Session Error
            </div>
            <p className="mt-1 normal-case">{lastError}</p>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mic className="size-3.5" />
            WebRTC connection
          </div>
          <div className="flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={onTriggerIncident}>
              <ShieldAlert className="size-3.5" />
              Trigger incident
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onStop}
              disabled={!canStop}
            >
              <PhoneOff className="size-3.5" />
              Stop session
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
