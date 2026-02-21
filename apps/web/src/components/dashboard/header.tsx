import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import type { WebSocketConnectionState } from "@/services/websocket"
import { UserMenu, type DemoUser } from "./user-menu"

interface DashboardHeaderProps {
  connectionState: WebSocketConnectionState
  isDemo: boolean
  demoUser: DemoUser | null
}

const connectionStateStyles: Record<
  WebSocketConnectionState,
  {
    label: string
    className: string
    dotClassName: string
  }
> = {
  connected: {
    label: "Device Online",
    className:
      "gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dotClassName: "size-1.5 rounded-full bg-emerald-500 animate-pulse",
  },
  reconnecting: {
    label: "Reconnecting",
    className:
      "gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dotClassName: "size-1.5 rounded-full bg-amber-500 animate-pulse",
  },
  connecting: {
    label: "Connecting",
    className:
      "gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dotClassName: "size-1.5 rounded-full bg-amber-500 animate-pulse",
  },
  disconnected: {
    label: "Device Offline",
    className:
      "gap-1.5 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    dotClassName: "size-1.5 rounded-full bg-red-500",
  },
}

export function DashboardHeader({
  connectionState,
  isDemo,
  demoUser,
}: DashboardHeaderProps) {
  const stateConfig = connectionStateStyles[connectionState]

  return (
    <header className="flex items-center justify-between border-b bg-card px-6 py-3">
      <Badge variant="outline" className={stateConfig.className}>
        <span className={stateConfig.dotClassName} />
        {stateConfig.label}
      </Badge>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        {isDemo && demoUser ? <UserMenu user={demoUser} /> : null}
      </div>
    </header>
  )
}
