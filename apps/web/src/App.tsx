import { ThemeProvider } from "@/hooks/use-theme"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Dashboard } from "@/components/dashboard"

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <Dashboard />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
