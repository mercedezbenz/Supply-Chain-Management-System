"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { MainLayout } from "@/components/layout/main-layout";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { useAuth } from "@/hooks/use-auth";
import { AuthLoadingSkeleton } from "@/components/skeletons/dashboard-skeleton";

export default function HomePage() {
  const { user, loading, isAdmin, isGuest } = useAuth()
  const router = useRouter()

  // Redirect if not authenticated (allow both admin and guest)
  useEffect(() => {
    if (!loading && (!user || (!isAdmin && !isGuest))) {
      router.replace("/login")
    }
  }, [user, loading, isAdmin, isGuest, router])

  // Show loading while checking auth OR while redirecting
  if (loading || !user || (!isAdmin && !isGuest)) {
    return <AuthLoadingSkeleton />
  }

  // Only show dashboard if authenticated (admin or guest)
  return (
    <MainLayout>
      <DashboardOverview />
    </MainLayout>
  );
}
