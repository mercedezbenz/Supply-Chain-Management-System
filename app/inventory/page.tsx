import { MainLayout } from "@/components/layout/main-layout"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { InventoryDashboard } from "@/components/inventory/inventory-dashboard"

export default function InventoryPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <InventoryDashboard />
      </MainLayout>
    </ProtectedRoute>
  )
}
