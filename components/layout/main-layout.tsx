"use client"

import type React from "react"
import { Sidebar } from "./sidebar"
import { Header } from "./header"
import { useSidebar } from "./sidebar-context"

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className={isCollapsed ? "md:ml-16" : "md:ml-64"} style={{ transition: "margin-left 200ms ease-in-out" }}>
        <Header />
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
