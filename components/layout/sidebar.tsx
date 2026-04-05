"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BarChart3, Package, Truck, Users, Menu, X, ChevronLeft, ChevronRight } from "lucide-react"
import Image from "next/image"
import { useSidebar } from "./sidebar-context"
import { useAuth } from "@/hooks/use-auth"

const navigation = [
  { name: "Overview", href: "/", icon: BarChart3 },
  { name: "Inventory", href: "/inventory", icon: Package },
]

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const { isCollapsed, toggleSidebar } = useSidebar()
  const { isGuest } = useAuth()

  // Navigation is explicitly static with removed unused models
  const filteredNavigation = navigation

  return (
    <>
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="sm"
        className="fixed top-4 left-4 z-50 md:hidden"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 bg-white dark:bg-sidebar border-r border-gray-200 dark:border-sidebar-border transform transition-all duration-200 ease-in-out md:translate-x-0 shadow-lg",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "md:w-16" : "md:w-64",
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={cn(
            "flex items-center border-b border-gray-200 dark:border-sidebar-border transition-all duration-200",
            isCollapsed ? "px-2 py-4 justify-center" : "px-6 py-6"
          )}>
            {isCollapsed ? (
              <div className="relative">
                <Image
                  src="/logo.png"
                  alt="DPE Logo"
                  width={40}
                  height={40}
                  className="object-contain"
                />
              </div>
            ) : (
              <div className="flex items-center">
                <div className="mr-3 relative">
                  <Image
                    src="/logo.png"
                    alt="DPE Logo"
                    width={60}
                    height={60}
                    className="object-contain"
                  />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-gray-800 dark:text-sidebar-foreground">
                    Deckta<span className="text-sky-500">GO</span>
                  </h1>
                  <p className="text-xs text-gray-500 dark:text-muted-foreground">Pacific Equities</p>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className={cn(
            "flex-1 py-6 space-y-2 transition-all duration-200",
            isCollapsed ? "px-2" : "px-4"
          )}>
            {filteredNavigation.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href)
              return (

                <Link
                  key={item.name}
                  href={item.href}
                  title={isCollapsed ? item.name : undefined}
                  className={cn(
                    "flex items-center text-sm font-medium rounded-lg transition-all duration-200",
                    isCollapsed ? "px-2 py-3 justify-center" : "px-4 py-3",
                    isActive
                      ? "bg-sky-500 text-white shadow-md"
                      : "text-gray-600 dark:text-sidebar-foreground hover:bg-gray-100 dark:hover:bg-sidebar-accent/10 hover:text-gray-800 dark:hover:text-sidebar-accent",
                  )}
                  onClick={() => setIsOpen(false)}
                >
                  <item.icon className={cn("h-5 w-5", !isCollapsed && "mr-3")} />
                  {!isCollapsed && <span>{item.name}</span>}
                </Link>
              )
            })}
          </nav>

          {/* Collapse Toggle Button (Desktop only) */}
          <div className="hidden md:block border-t border-gray-200 dark:border-sidebar-border p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSidebar}
              className="w-full justify-center"
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black bg-opacity-50 md:hidden" onClick={() => setIsOpen(false)} />
      )}
    </>
  )
}
