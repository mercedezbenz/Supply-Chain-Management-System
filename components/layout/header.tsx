"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { LogOut, Moon, Sun, Menu } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { ExpiryNotifications } from "@/components/notifications/expiry-notifications"
import { useTheme } from "next-themes"
import { useSidebar } from "./sidebar-context"

export function Header() {
  const { user, logout } = useAuth()
  const { setTheme, theme } = useTheme()
  const { toggleSidebar } = useSidebar()

  const handleLogout = async () => {
    try {
      console.log("[Header] Logging out user...")
      await logout()
      // Logout function handles redirect internally
    } catch (error) {
      console.error("[Header] Logout error:", error)
      // Logout function will still redirect even on error
    }
  }

  const getUserInitials = (email: string) => {
    return email
      .split("@")[0]
      .split(".")
      .map((part) => part.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2)
  }

  return (
    <header className="bg-card border-b border-border px-6 py-4 relative z-10">
      <div className="flex items-center justify-between">
        {/* Left side - Sidebar toggle (Desktop) */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="hidden md:flex h-8 w-8"
          title="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Right side */}
        <div className="flex items-center space-x-4">
          <ExpiryNotifications />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="h-8 w-8"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>

          {/* User menu */}
          <div className="relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex items-center justify-center rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 p-0"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{user?.email ? getUserInitials(user.email) : "AD"}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {(user as any)?.name || (user as any)?.displayName || user?.role === "admin" ? "Admin User" : user?.role === "guest" ? "Guest User" : user?.role || "User"}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">{user?.email || "No email"}</p>
                  {user?.role && (
                    <p className="text-xs leading-none text-muted-foreground capitalize">Role: {user.role}</p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleLogout} 
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}
