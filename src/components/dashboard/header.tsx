import { useEffect, useState } from "react"
import { Wifi } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"

export function DashboardHeader() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const formattedTime = time.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  return (
    <header className="flex items-center justify-between border-b bg-card px-6 py-3">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Wifi className="size-5 text-emerald-500" />
          <span className="text-lg font-bold tracking-tight">GuardianWave</span>
        </div>
        <Badge
          variant="outline"
          className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Device Online
        </Badge>
      </div>

      <div className="flex items-center gap-6">
        <span className="text-sm text-muted-foreground">
          Monitoring: <span className="text-foreground font-medium">Margaret Chen, 78</span>
        </span>
        <span className="text-lg font-semibold tabular-nums">{formattedTime}</span>
        <ThemeToggle />
      </div>
    </header>
  )
}
