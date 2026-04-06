"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { MainLayout } from "@/components/layout/main-layout";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { useAuth } from "@/hooks/use-auth";
import { AuthLoadingSkeleton } from "@/components/skeletons/dashboard-skeleton";
import { LoggingOutOverlay } from "@/components/auth/logging-out-overlay";

export default function HomePage() {
  const { user, loading, isLoggingOut, isAdmin, isGuest, isStaff } = useAuth()
  const router = useRouter()

  // Redirect if NOT authenticated at all (but not during logout)
  useEffect(() => {
    if (!loading && !user && !isLoggingOut) {
      console.log("[HomePage] No user found, redirecting to /login")
      router.replace("/login")
    }
  }, [user, loading, isLoggingOut, router])

  // Show clean logout overlay — no dashboard flicker
  if (isLoggingOut) {
    return <LoggingOutOverlay />
  }

  // Show loading while checking auth
  if (loading) {
    return <AuthLoadingSkeleton />
  }

  // Not authenticated
  if (!user) {
    return <AuthLoadingSkeleton />
  }

  // If user is authenticated but has no permission (though current roles cover all)
  if (!isAdmin && !isGuest && !isStaff) {
     return (
       <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
         <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
         <p className="text-muted-foreground mb-4">You do not have permission to access the dashboard. Please contact an administrator.</p>
         <button 
           onClick={() => window.location.href = "/login"}
           className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
         >
           Return to Login
         </button>
       </div>
     )
  }

  // Only show dashboard if authenticated (admin, staff, or guest)
  return (
    <MainLayout>
      <DashboardOverview />
    </MainLayout>
  );
}

