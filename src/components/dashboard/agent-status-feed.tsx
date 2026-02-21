import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Severity = "critical" | "warning" | "ok"

interface StatusEvent {
  id: string
  severity: Severity
  title: string
  description: string
  action: string
  time: string
}

const events: StatusEvent[] = [
  {
    id: "1",
    severity: "critical",
    title: "Fall Detected",
    description:
      "Sudden vertical drop in bathroom at 1:47 PM. No movement for 23s.",
    action: "Voice call initiated, family alerted, EMS on standby",
    time: "1:47 PM",
  },
  {
    id: "2",
    severity: "warning",
    title: "Erratic Gait Pattern",
    description:
      "Unsteady walking detected in hallway. Deviation +38% from baseline.",
    action: "Monitoring closely, family notified via text",
    time: "12:15 PM",
  },
  {
    id: "3",
    severity: "ok",
    title: "Morning Routine Completed",
    description:
      "Got out of bed at 7:42 AM. Moved to kitchen. Normal pattern.",
    action: "None required",
    time: "7:42 AM",
  },
  {
    id: "4",
    severity: "ok",
    title: "Medication Time Confirmed",
    description:
      "Activity near medicine cabinet at 8:15 AM. Duration consistent.",
    action: "Logged to daily report",
    time: "8:15 AM",
  },
]

const severityConfig: Record<
  Severity,
  {
    label: string
    dot: string
    border: string
    bg: string
    text: string
  }
> = {
  critical: {
    label: "CRITICAL",
    dot: "bg-red-500",
    border: "border-red-500/40 dark:border-red-500/30",
    bg: "bg-red-500/5 dark:bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
  },
  warning: {
    label: "WARNING",
    dot: "bg-amber-500",
    border: "border-amber-500/40 dark:border-amber-500/30",
    bg: "bg-amber-500/5 dark:bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
  },
  ok: {
    label: "OK",
    dot: "bg-emerald-500",
    border: "border-emerald-500/40 dark:border-emerald-500/30",
    bg: "bg-emerald-500/5 dark:bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
  },
}

function StatusEventCard({ event }: { event: StatusEvent }) {
  const cfg = severityConfig[event.severity]

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        cfg.border,
        cfg.bg
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-full", cfg.dot)} />
          <span className={cn("text-sm font-semibold", cfg.text)}>
            {cfg.label} &mdash; {event.title}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {event.time}
        </span>
      </div>
      <p className="mt-1.5 pl-[18px] text-xs text-foreground/80 leading-relaxed">
        {event.description}
      </p>
      <p className="mt-0.5 pl-[18px] text-xs text-muted-foreground">
        Action: {event.action}
      </p>
    </div>
  )
}

export function AgentStatusFeed() {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Agent Status Feed</CardTitle>
        <CardDescription>
          AI Monitoring Updates &mdash; Sorted by Priority
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pb-0">
        <ScrollArea className="flex-1 pr-2 -mr-2">
          <div className="space-y-2.5 pb-2">
            {events.map((e) => (
              <StatusEventCard key={e.id} event={e} />
            ))}
          </div>
        </ScrollArea>

        <div className="border-t py-3">
          <Button variant="ghost" className="w-full text-xs text-muted-foreground">
            View Full History
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
