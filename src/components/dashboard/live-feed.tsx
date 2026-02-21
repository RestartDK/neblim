import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PoseCanvas } from "./pose-canvas"

interface StatItem {
  label: string
  value: string
  color?: "green" | "default"
}

const bodyStats: StatItem[] = [
  { label: "Posture", value: "Standing", color: "green" },
  { label: "Gait", value: "Normal", color: "green" },
  { label: "Movement", value: "Active" },
]

const signalStats: StatItem[] = [
  { label: "Signal Strength", value: "-42dBm" },
  { label: "Tracking Points", value: "18" },
  { label: "Latency", value: "12ms" },
]

const activityStats: StatItem[] = [
  { label: "Last Movement", value: "2s ago" },
  { label: "Room Duration", value: "34 min" },
  { label: "Steps Today", value: "2,847" },
]

function StatBlock({ stats }: { stats: StatItem[] }) {
  return (
    <div className="space-y-1">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center justify-between text-xs">
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
  )
}

export function LiveFeed() {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          WiFi Body Mesh - Live Feed
          <Badge
            variant="outline"
            className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]"
          >
            LIVE
          </Badge>
        </CardTitle>
        <CardDescription>
          Living Room | Floor 1
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pb-4">
        {/* Canvas area */}
        <div className="relative flex-1 min-h-[300px] rounded-lg border bg-background/50 overflow-hidden">
          <PoseCanvas />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
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
  )
}
