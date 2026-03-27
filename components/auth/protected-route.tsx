"use client"

import type React from "react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/use-auth"
import { AuthLoadingSkeleton } from "@/components/skeletons/dashboard-skeleton"

interface ProtectedRouteProps {
  children: React.ReactNode
  adminOnly?: boolean
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAdmin, isGuest } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // WAIT until loading is complete before making any redirect decisions
    if (loading) {
      console.log("[ProtectedRoute] Still loading, waiting...")
      return
    }

    console.log("[ProtectedRoute] Auth loaded. user:", user?.role, "isAdmin:", isAdmin, "isGuest:", isGuest, "adminOnly:", adminOnly)

    // Not authenticated at all → login
    if (!user) {
      console.log("[ProtectedRoute] No user, redirecting to /login")
      router.push("/login")
      return
    }

    // Admin-only page and user is guest → redirect to home
    if (adminOnly && isGuest) {
      console.log("[ProtectedRoute] Guest tried to access admin-only page, redirecting to /")
      router.push("/")
      return
    }

    // Non-guest, non-admin users → login
    if (!isAdmin && !isGuest) {
      console.log("[ProtectedRoute] User is neither admin nor guest, redirecting to /login")
      router.push("/login")
    }
  }, [user, loading, isAdmin, isGuest, adminOnly, router])

  // Show loading spinner while auth is initializing
  if (loading) {
    return <AuthLoadingSkeleton />
  }

  // Not authenticated
  if (!user) {
    return <AuthLoadingSkeleton />
  }

  // Admin-only page but user is guest
  if (adminOnly && isGuest) {
    return null
  }

  // Must be admin or guest to view
  if (!isAdmin && !isGuest) {
    return null
  }

  return <>{children}</>
}
