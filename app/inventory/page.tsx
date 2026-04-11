import { MainLayout } from "@/components/layout/main-layout"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { InventoryDashboard } from "@/components/inventory/inventory-dashboard"
import { Suspense } from "react"

export default function InventoryPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <Suspense fallback={<div>Loading Dashboard...</div>}>
          <InventoryDashboard />
        </Suspense>
      </MainLayout>
    </ProtectedRoute>
  )
}
