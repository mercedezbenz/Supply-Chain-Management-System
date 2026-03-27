import { MainLayout } from "@/components/layout/main-layout"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { DocumentDashboard } from "@/components/documents/document-dashboard"

export default function DocumentsPage() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <DocumentDashboard />
      </MainLayout>
    </ProtectedRoute>
  )
}
