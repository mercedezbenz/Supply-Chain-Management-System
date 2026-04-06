"use client"

import type React from "react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/use-auth"
import { AuthLoadingSkeleton } from "@/components/skeletons/dashboard-skeleton"
import { LoggingOutOverlay } from "@/components/auth/logging-out-overlay"

interface ProtectedRouteProps {
  children: React.ReactNode
  adminOnly?: boolean
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isLoggingOut, isAdmin, isGuest, isStaff } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // ONLY redirect to /login if NOT authenticated (and not during logout)
    if (!loading && !user && !isLoggingOut) {
      console.log("[ProtectedRoute] No user found, redirecting to /login")
      router.push("/login")
    }
  }, [user, loading, isLoggingOut, router])

  // Show clean logout overlay — no dashboard flicker
  if (isLoggingOut) {
    return <LoggingOutOverlay />
  }

  // Show loading spinner while auth is initializing
  if (loading) {
    return <AuthLoadingSkeleton />
  }

  // Not authenticated
  if (!user) {
    return <AuthLoadingSkeleton />
  }

  // Admin-only page and user is guest or staff (if they are not admin)
  if (adminOnly && !isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Admin Only Page</h1>
        <p className="text-muted-foreground mb-4">This section is restricted to administrators.</p>
        <button 
          onClick={() => window.location.href = "/"}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  // Check for any authorized role (admin, staff, guest)
  if (!isAdmin && !isGuest && !isStaff) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-muted-foreground mb-4">You do not have permission to access this section.</p>
        <button 
           onClick={() => window.location.href = "/login"}
           className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          Return to Login
        </button>
      </div>
    )
  }

  return <>{children}</>
}

