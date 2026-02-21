import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { ActivityEvent, ActivitySeverity } from "@/hooks/use-activity-events"

const severityConfig: Record<
  ActivitySeverity,
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

interface AgentStatusFeedProps {
  events: ActivityEvent[]
}

function StatusEventCard({ event }: { event: ActivityEvent }) {
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

export function AgentStatusFeed({ events }: AgentStatusFeedProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Agent Status Feed</CardTitle>
        <CardDescription>
          AI Monitoring Updates &mdash; Sorted by Priority
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col pb-3">
        <ScrollArea className="min-h-0 flex-1 pr-2 -mr-2">
          <div className="space-y-2.5 pb-2">
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No activity events yet.
              </div>
            ) : (
              events.map((event) => (
                <StatusEventCard key={event.id} event={event} />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
