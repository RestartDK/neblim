import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardHeader } from "./header";
import { LiveFeed } from "./live-feed";
import { AgentStatusFeed } from "./agent-status-feed";
import { VoiceAgentCalls } from "./voice-agent-calls";
import type { DemoUser } from "./user-menu";
import { BackendProvider } from "@/hooks/use-backend-detector";
import { useHealth } from "@/hooks/use-health";
import { usePoseStream } from "@/hooks/use-pose-stream";
import { useMeshMonitorAgent } from "@/hooks/use-mesh-monitor-agent";
import { useElevenlabsFallbackAgent } from "@/hooks/use-elevenlabs-fallback-agent";

function DashboardContent() {
  const poseStream = usePoseStream();
  const health = useHealth();
  const [demoUser, setDemoUser] = useState<DemoUser | null>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasDemoIncidentTriggeredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (!poseStream.isDemo) {
      setDemoUser(null);
      return;
    }

    const loadDemoUser = async () => {
      try {
        const response = await fetch("/demo-user.json");
        if (!response.ok) {
          throw new Error("Failed to load demo user");
        }

        const user = (await response.json()) as DemoUser;

        if (!cancelled) {
          setDemoUser(user);
        }
      } catch {
        if (!cancelled) {
          setDemoUser(null);
        }
      }
    };

    void loadDemoUser();

    return () => {
      cancelled = true;
    };
  }, [poseStream.isDemo]);

  const isDeviceOnline = poseStream.connectionState === "connected";

  const fallbackAgent = useElevenlabsFallbackAgent({
    enabled: true,
  });
  const triggerFallbackFromClassification =
    fallbackAgent.triggerFallbackFromClassification;

  const triggerTestIncident = useCallback(() => {
    void triggerFallbackFromClassification({
      severity: "critical",
      title: "Bathroom fall risk detected",
      description:
        "Demo incident: the resident collapsed near the bathroom and has been motionless for over one minute.",
      action:
        "Launch urgent voice check-in and confirm if emergency services are needed",
      confidence: 0.96,
    });
  }, [triggerFallbackFromClassification]);

  const events = useMeshMonitorAgent({
    canvasRef: meshCanvasRef,
    persons: poseStream.persons,
    frameId: poseStream.frameId,
    timestamp: poseStream.lastUpdate,
    poseStats: poseStream.stats,
    isDemo: poseStream.isDemo,
    enabled: isDeviceOnline,
    onBadClassification: triggerFallbackFromClassification,
  });

  useEffect(() => {
    if (!poseStream.isDemo) {
      hasDemoIncidentTriggeredRef.current = false;
    }
  }, [poseStream.isDemo]);

  useEffect(() => {
    if (!poseStream.isDemo) {
      return;
    }

    if (hasDemoIncidentTriggeredRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (hasDemoIncidentTriggeredRef.current) {
        return;
      }

      hasDemoIncidentTriggeredRef.current = true;

      triggerTestIncident();
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [poseStream.isDemo, triggerTestIncident]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <DashboardHeader
        connectionState={poseStream.connectionState}
        isDemo={poseStream.isDemo}
        demoUser={demoUser}
      />

      <main className="flex-1 overflow-auto p-4">
        <div className="mx-auto grid h-full max-w-[1600px] grid-cols-1 gap-4 lg:grid-cols-2 lg:grid-rows-[1fr_auto]">
          <div className="lg:row-span-2 min-h-[500px]">
            <LiveFeed
              poseStream={poseStream}
              health={health}
              meshCanvasRef={meshCanvasRef}
            />
          </div>

          <div className="min-h-[300px]">
            <AgentStatusFeed events={events} />
          </div>

          <div>
            <VoiceAgentCalls
              agentName="neblim"
              agentId={fallbackAgent.agentId}
              status={fallbackAgent.status}
              isSpeaking={fallbackAgent.isSpeaking}
              autoStartCount={fallbackAgent.autoStartCount}
              lastTrigger={fallbackAgent.lastTrigger}
              lastError={fallbackAgent.lastError}
              onTriggerIncident={triggerTestIncident}
              onStop={fallbackAgent.stopFallbackSession}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export function Dashboard() {
  return (
    <BackendProvider>
      <DashboardContent />
    </BackendProvider>
  );
}
