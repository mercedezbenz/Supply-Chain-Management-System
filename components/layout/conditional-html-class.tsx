"use client"

import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect } from "react"

export function ConditionalHtmlClass() {
  const pathname = usePathname()
  const isLoginRoute = pathname === "/login" || pathname?.startsWith("/login") || pathname?.startsWith("/auth")

  // Use useLayoutEffect to run synchronously before paint
  useLayoutEffect(() => {
    const html = document.documentElement
    if (isLoginRoute) {
      // Remove dark class and any theme classes for login route
      html.classList.remove("dark")
      // Clean up any remaining dark-related classes
      const classes = html.className.split(" ").filter(cls => cls !== "dark" && !cls.includes("dark"))
      html.className = classes.join(" ")
    } else {
      // Ensure dark class is present for other routes
      if (!html.classList.contains("dark")) {
        html.classList.add("dark")
      }
    }
  }, [isLoginRoute])

  // Also run on mount to handle initial route
  useEffect(() => {
    const html = document.documentElement
    if (isLoginRoute) {
      html.classList.remove("dark")
      const classes = html.className.split(" ").filter(cls => cls !== "dark" && !cls.includes("dark"))
      html.className = classes.join(" ")
    }
  }, [])

  return null
}

