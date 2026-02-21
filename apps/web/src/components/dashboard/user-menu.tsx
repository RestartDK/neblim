import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface DemoUser {
  name: string
  email: string
  role: string
}

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "DU"
}

export function UserMenu({ user }: { user: DemoUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-9 rounded-full border border-border/70 p-0 text-xs font-semibold"
          aria-label="Open user menu"
        >
          {getInitials(user.name)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium">{user.name}</span>
          <span className="text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{user.role}</DropdownMenuItem>
        <DropdownMenuItem disabled>Demo account</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
