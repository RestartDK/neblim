import { useEffect } from "react"
import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/hooks/use-theme"

export function ThemeToggle() {
  const { setTheme } = useTheme()

  useEffect(() => {
    setTheme("system")
  }, [setTheme])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme("system")}
      aria-label="Theme follows system"
      title="Theme follows system"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
