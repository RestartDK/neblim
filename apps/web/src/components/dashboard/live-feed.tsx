import { useEffect, useMemo, useState, type RefObject } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { HealthState } from "@/hooks/use-health";
import { usePose3dStream } from "@/hooks/use-pose3d-stream";
import type { PoseStreamState } from "@/hooks/use-pose-stream";
import { Pose3DViewer } from "./pose-3d-viewer";
import { PoseCanvas } from "./pose-canvas";

interface StatItem {
  label: string;
  value: string;
  color?: "green" | "default";
}

function StatBlock({ stats }: { stats: StatItem[] }) {
  return (
    <div className="space-y-1">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex items-center justify-between text-xs"
        >
          <span className="text-muted-foreground">{s.label}</span>
          <span
            className={
              s.color === "green"
                ? "font-medium text-emerald-600 dark:text-emerald-400"
                : "font-medium text-foreground"
            }
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

interface LiveFeedProps {
  poseStream: PoseStreamState;
  health: HealthState;
  meshCanvasRef: RefObject<HTMLCanvasElement | null>;
}

type ViewMode = "2d" | "3d";

const formatRelativeTime = (timestamp: string | null, now: number): string => {
  if (!timestamp) {
    return "No updates";
  }

  const deltaSeconds = Math.max(
    0,
    Math.floor((now - new Date(timestamp).getTime()) / 1000),
  );
  if (deltaSeconds < 2) return "Now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  return `${Math.floor(deltaSeconds / 60)}m ago`;
};

export function LiveFeed({ poseStream, health, meshCanvasRef }: LiveFeedProps) {
  const [now, setNow] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [isSeeding, setIsSeeding] = useState(false);
  const pose3d = usePose3dStream();

  const showPose3d = viewMode === "3d" && pose3d.isAvailable;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const bodyStats = useMemo<StatItem[]>(() => {
    const gaitIsHealthy = poseStream.stats.gait === "Normal";
    return [
      {
        label: "Posture",
        value: poseStream.stats.posture,
        color: poseStream.stats.posture === "Standing" ? "green" : "default",
      },
      {
        label: "Gait",
        value: poseStream.stats.gait,
        color: gaitIsHealthy ? "green" : "default",
      },
      {
        label: "Movement",
        value: poseStream.stats.movement,
      },
    ];
  }, [
    poseStream.stats.gait,
    poseStream.stats.movement,
    poseStream.stats.posture,
  ]);

  const signalStats = useMemo<StatItem[]>(
    () => [
      {
        label: "Signal Strength",
        value: `${poseStream.stats.signalStrength}dBm`,
      },
      {
        label: "Tracking Points",
        value: String(poseStream.stats.trackingPoints),
      },
      { label: "Latency", value: `${poseStream.stats.latency}ms` },
    ],
    [
      poseStream.stats.latency,
      poseStream.stats.signalStrength,
      poseStream.stats.trackingPoints,
    ],
  );

  const activityStats = useMemo<StatItem[]>(
    () => [
      {
        label: "Last Movement",
        value: formatRelativeTime(poseStream.lastUpdate, now),
      },
      {
        label: "Room Duration",
        value: `${poseStream.stats.roomDuration} min`,
      },
      {
        label: "Steps Today",
        value: poseStream.stats.stepsToday.toLocaleString(),
      },
    ],
    [
      now,
      poseStream.lastUpdate,
      poseStream.stats.roomDuration,
      poseStream.stats.stepsToday,
    ],
  );

  const healthLabel = health.isLoading
    ? "Checking"
    : health.status === "healthy"
      ? "Healthy"
      : health.status === "degraded"
        ? "Degraded"
        : "Unhealthy";

  const pose3dStatusLabel = pose3d.isAvailable
    ? `${pose3d.connectionState} • ${pose3d.fps} fps • ${formatRelativeTime(
        pose3d.lastUpdate,
        now,
      )}`
    : "offline";

  const seedPose3dDemo = async () => {
    setIsSeeding(true);
    try {
      await pose3d.seedDemo(3);
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          WiFi Body Mesh - Live Feed
          <Badge
            variant="outline"
            className={
              poseStream.isDemo
                ? "ml-auto border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]"
                : "ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]"
            }
          >
            {poseStream.isDemo ? "DEMO" : "LIVE"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Living Room | Floor 1 | System {healthLabel}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
            <Button
              size="sm"
              variant={viewMode === "2d" ? "secondary" : "ghost"}
              onClick={() => setViewMode("2d")}
            >
              2D
            </Button>
            <Button
              size="sm"
              variant={viewMode === "3d" ? "secondary" : "ghost"}
              onClick={() => setViewMode("3d")}
            >
              3D
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                pose3d.isAvailable
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-muted-foreground/20 bg-muted/40 text-muted-foreground"
              }
            >
              {pose3d.isAvailable ? "3D available" : "3D unavailable"}
            </Badge>

            <Button
              size="sm"
              variant="outline"
              onClick={seedPose3dDemo}
              disabled={!pose3d.isAvailable || isSeeding}
            >
              {isSeeding ? "Seeding..." : "Seed demo"}
            </Button>
          </div>
        </div>

        <div className="relative flex-1 min-h-[300px] rounded-lg border bg-background/50 overflow-hidden">
          {showPose3d ? (
            <Pose3DViewer
              persons={pose3d.persons3d}
              canvasRef={meshCanvasRef}
            />
          ) : (
            <PoseCanvas persons={poseStream.persons} />
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          3D stream: {pose3dStatusLabel}
        </p>

        {viewMode === "3d" && pose3d.error ? (
          <p className="text-xs text-muted-foreground">{pose3d.error}</p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <StatBlock stats={bodyStats} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <StatBlock stats={signalStats} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <StatBlock stats={activityStats} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
