import { DashboardHeader } from "./header"
import { LiveFeed } from "./live-feed"
import { AgentStatusFeed } from "./agent-status-feed"
import { VoiceAgentCalls } from "./voice-agent-calls"

export function Dashboard() {
  return (
    <div className="flex h-screen flex-col bg-background">
      <DashboardHeader />

      <main className="flex-1 overflow-auto p-4">
        <div className="mx-auto grid h-full max-w-[1600px] grid-cols-1 gap-4 lg:grid-cols-2 lg:grid-rows-[1fr_auto]">
          {/* Left: WiFi Body Mesh Live Feed - spans full height on lg */}
          <div className="lg:row-span-2 min-h-[500px]">
            <LiveFeed />
          </div>

          {/* Right top: Agent Status Feed */}
          <div className="min-h-[300px]">
            <AgentStatusFeed />
          </div>

          {/* Right bottom: Voice Agent Calls */}
          <div>
            <VoiceAgentCalls />
          </div>
        </div>
      </main>
    </div>
  )
}
