import { useEffect, useRef, useState } from "react";
import { DashboardHeader } from "./header";
import { LiveFeed } from "./live-feed";
import { AgentStatusFeed } from "./agent-status-feed";
import { VoiceAgentCalls } from "./voice-agent-calls";
import type { DemoUser } from "./user-menu";
import { BackendProvider } from "@/hooks/use-backend-detector";
import { useHealth } from "@/hooks/use-health";
import { usePoseStream } from "@/hooks/use-pose-stream";
import { useMeshMonitorAgent } from "@/hooks/use-mesh-monitor-agent";

function DashboardContent() {
  const poseStream = usePoseStream();
  const health = useHealth();
  const [demoUser, setDemoUser] = useState<DemoUser | null>(null);
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

  const events = useMeshMonitorAgent({
    canvasRef: meshCanvasRef,
    persons: poseStream.persons,
    frameId: poseStream.frameId,
    timestamp: poseStream.lastUpdate,
    poseStats: poseStream.stats,
    isDemo: poseStream.isDemo,
    enabled: isDeviceOnline,
  });

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
            <VoiceAgentCalls />
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
