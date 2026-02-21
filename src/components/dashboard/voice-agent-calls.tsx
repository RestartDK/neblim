import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Phone, PhoneOff, Clock } from "lucide-react"
import { useEffect, useState } from "react"

type CallStatus = "active" | "queued" | "completed"

interface Call {
  id: string
  status: CallStatus
  name: string
  relation?: string
  purpose: string
  time?: string
  response?: string
  elapsed?: number // seconds for active calls
}

const calls: Call[] = [
  {
    id: "1",
    status: "active",
    name: "Margaret Chen",
    purpose: 'Fall check-in: "Are you okay?"',
    elapsed: 42,
  },
  {
    id: "2",
    status: "queued",
    name: "Sarah Chen (Daughter)",
    purpose: "Alert: Mother fall detected, awaiting response",
  },
]

const completedCalls: Call[] = [
  {
    id: "3",
    status: "completed",
    name: "Margaret",
    purpose: "Daily check-in",
    time: "11:30 AM",
    response: "Responded OK",
  },
  {
    id: "4",
    status: "completed",
    name: "Margaret",
    purpose: "Good morning",
    time: "8:00 AM",
    response: "Responded OK",
  },
]

const statusConfig: Record<
  CallStatus,
  { label: string; border: string; bg: string; badgeBg: string; badgeText: string }
> = {
  active: {
    label: "ACTIVE CALL",
    border: "border-red-500/40 dark:border-red-500/30",
    bg: "bg-red-500/5 dark:bg-red-500/10",
    badgeBg: "bg-red-600 dark:bg-red-500",
    badgeText: "text-white",
  },
  queued: {
    label: "QUEUED",
    border: "border-blue-500/40 dark:border-blue-500/30",
    bg: "bg-blue-500/5 dark:bg-blue-500/10",
    badgeBg: "bg-blue-600 dark:bg-blue-500",
    badgeText: "text-white",
  },
  completed: {
    label: "COMPLETED",
    border: "border-border",
    bg: "bg-muted/30",
    badgeBg: "bg-muted",
    badgeText: "text-muted-foreground",
  },
}

function ActiveCallTimer({ initial }: { initial: number }) {
  const [seconds, setSeconds] = useState(initial)

  useEffect(() => {
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const min = Math.floor(seconds / 60)
  const sec = seconds % 60

  return (
    <span className="text-lg font-semibold tabular-nums text-red-600 dark:text-red-400">
      {min}:{sec.toString().padStart(2, "0")}
    </span>
  )
}

function ActiveCallCard({ call }: { call: Call }) {
  const cfg = statusConfig[call.status]

  return (
    <div className={cn("rounded-lg border p-3 space-y-1.5", cfg.border, cfg.bg)}>
      <div className="flex items-center justify-between">
        <Badge className={cn("text-[10px] font-bold border-0", cfg.badgeBg, cfg.badgeText)}>
          {cfg.label}
        </Badge>
        {call.status === "active" && call.elapsed != null && (
          <ActiveCallTimer initial={call.elapsed} />
        )}
      </div>
      <div className="flex items-center gap-2">
        {call.status === "active" ? (
          <Phone className="size-3.5 text-red-500" />
        ) : (
          <Clock className="size-3.5 text-blue-500" />
        )}
        <span className="text-sm font-semibold">
          {call.name}
          {call.relation && (
            <span className="font-normal text-muted-foreground"> ({call.relation})</span>
          )}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{call.purpose}</p>
    </div>
  )
}

function CompletedCallRow({ call }: { call: Call }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <PhoneOff className="size-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground tabular-nums">{call.time}</span>
        <span className="text-xs text-foreground">
          {call.name} &mdash; {call.purpose}
        </span>
      </div>
      {call.response && (
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {call.response}
        </span>
      )}
    </div>
  )
}

export function VoiceAgentCalls() {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Voice Agent Calls</CardTitle>
        <CardDescription>
          Automated check-in calls and emergency contacts
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Active / queued calls */}
        <div className="grid grid-cols-2 gap-2.5">
          {calls.map((c) => (
            <ActiveCallCard key={c.id} call={c} />
          ))}
        </div>

        {/* Completed calls */}
        <div className="space-y-1.5">
          {completedCalls.map((c) => (
            <CompletedCallRow key={c.id} call={c} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
