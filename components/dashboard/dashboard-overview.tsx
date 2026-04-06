"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TrendingUp, TrendingDown, AlertCircle, X, ChevronLeft, ChevronRight, Clock, Package, AlertTriangle } from "lucide-react"
import { TotalStocksIcon, LowStockIcon, ExpiringSoonIcon } from "./dashboard-icons"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { subscribeToCollection, CustomerTransactionService } from "@/services/firebase-service"
import { TransactionService } from "@/services/firebase-service"
import { useAuth } from "@/hooks/use-auth"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { InventoryItem, InventoryTransaction } from "@/lib/types"
import { formatExpirationDate as formatExpDate } from "@/lib/utils"
import { DashboardOverviewSkeleton } from "@/components/skeletons/dashboard-skeleton"

interface DashboardStats {
  totalItems: number
  lowStockItems: number
  expiringSoon: number
}

// Mini sparkline bar chart for KPI cards
const TrendChart = ({ trend, type }: { trend: "up" | "down"; type: "total" | "low" | "expiring" }) => {
  const palettes: Record<string, { height: number; color: string }[]> = {
    total: [
      { height: 25, color: "#93C5FD" },
      { height: 45, color: "#60A5FA" },
      { height: 35, color: "#3B82F6" },
      { height: 60, color: "#2563EB" },
      { height: 75, color: "#1D4ED8" },
    ],
    low: [
      { height: 70, color: "#FCA5A5" },
      { height: 50, color: "#F87171" },
      { height: 35, color: "#EF4444" },
      { height: 25, color: "#FB923C" },
      { height: 15, color: "#FBBF24" },
    ],
    expiring: [
      { height: 20, color: "#FDE68A" },
      { height: 40, color: "#FCD34D" },
      { height: 55, color: "#FBBF24" },
      { height: 45, color: "#F59E0B" },
      { height: 70, color: "#D97706" },
    ],
  }

  const bars = palettes[type] || palettes.total

  return (
    <div className="relative h-14 w-20 flex items-end justify-center gap-[3px] opacity-50">
      {bars.map((bar, index) => (
        <div
          key={index}
          className="w-2.5 rounded-t-sm transition-all duration-500"
          style={{
            height: `${bar.height}%`,
            backgroundColor: bar.color,
            animationDelay: `${index * 80}ms`,
          }}
        />
      ))}
    </div>
  )
}

// Action badge component for stock movements
const ActionBadge = ({ action }: { action: string }) => {
  const normalized = action?.toUpperCase()?.trim() || ""

  let label = action
  let className = "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase "

  if (normalized.includes("INCOMING") || normalized === "IN" || normalized.includes("FROM")) {
    label = "IN"
    className += "bg-emerald-50 text-emerald-700 border border-emerald-200"
  } else if (normalized.includes("OUTGOING") || normalized === "OUT" || normalized === "PRODUCT_OUT") {
    label = "OUT"
    className += "bg-red-50 text-red-600 border border-red-200"
  } else if (normalized.includes("GOOD") || normalized === "GOOD_RETURN" || normalized === "GOOD RETURN") {
    label = "RETURN"
    className += "bg-blue-50 text-blue-600 border border-blue-200"
  } else if (normalized.includes("BAD") || normalized.includes("DAMAGE") || normalized === "BAD_RETURN" || normalized === "BAD RETURN") {
    label = "BAD RETURN"
    className += "bg-gray-100 text-gray-500 border border-gray-200"
  } else {
    className += "bg-gray-50 text-gray-600 border border-gray-200"
  }

  return <span className={className}>{label}</span>
}

export function DashboardOverview() {
  const { user, firebaseError, isGuest } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    totalItems: 0,
    lowStockItems: 0,
    expiringSoon: 0,
  })
  const [stockAlerts, setStockAlerts] = useState<InventoryItem[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<InventoryItem[]>([])
  const [recentMovements, setRecentMovements] = useState<InventoryTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [hasPermissionError, setHasPermissionError] = useState(false)
  const [showNotificationBanner, setShowNotificationBanner] = useState(false)

  // Pagination state for Stock Alert & Updates table
  const [stockCurrentPage, setStockCurrentPage] = useState(1)
  const STOCK_ITEMS_PER_PAGE = 6

  // Pagination state for Recent Stock Movements
  const [movementCurrentPage, setMovementCurrentPage] = useState(1)
  const MOVEMENT_ITEMS_PER_PAGE = 6

  // Helper function to calculate paginated stock items
  const getPaginatedStockItems = () => {
    const allStockItems = [...recentlyAdded, ...stockAlerts]
    // Remove duplicates by id
    const unique = allStockItems.filter((item, index, self) =>
      index === self.findIndex((t) => t.id === item.id)
    )
    const totalItems = unique.length
    const totalPages = Math.max(1, Math.ceil(totalItems / STOCK_ITEMS_PER_PAGE))
    const startIndex = (stockCurrentPage - 1) * STOCK_ITEMS_PER_PAGE
    const endIndex = Math.min(startIndex + STOCK_ITEMS_PER_PAGE, totalItems)

    return {
      items: unique.slice(startIndex, endIndex),
      totalPages,
      totalItems,
      startIndex,
      endIndex,
    }
  }

  // Helper function to calculate paginated movement items
  const getPaginatedMovements = () => {
    const totalItems = recentMovements.length
    const totalPages = Math.max(1, Math.ceil(totalItems / MOVEMENT_ITEMS_PER_PAGE))
    const startIndex = (movementCurrentPage - 1) * MOVEMENT_ITEMS_PER_PAGE
    const endIndex = Math.min(startIndex + MOVEMENT_ITEMS_PER_PAGE, totalItems)

    return {
      items: recentMovements.slice(startIndex, endIndex),
      totalPages,
      totalItems,
      startIndex,
      endIndex,
    }
  }

  // Reset to page 1 when data changes
  useEffect(() => {
    setStockCurrentPage(1)
  }, [recentlyAdded.length, stockAlerts.length])

  useEffect(() => {
    setMovementCurrentPage(1)
  }, [recentMovements.length])

  useEffect(() => {
    if (!user || firebaseError) {
      setLoading(false)
      if (firebaseError?.includes("permission")) {
        setHasPermissionError(true)
      }
      return
    }

    let unsubscribeInventory: (() => void) | undefined
    let unsubscribeTransactions: (() => void) | undefined

    // Helper function to parse dates
    const parseDate = (d: any) => {
      if (!d) return null
      if (typeof d === "string") return new Date(d)
      if (d instanceof Date) return d
      if (d && typeof d.toDate === "function") return d.toDate()
      if (d && d.seconds) return new Date(d.seconds * 1000)
      return null
    }

    try {
      // Subscribe to inventory collection
      unsubscribeInventory = subscribeToCollection("inventory", (items: InventoryItem[]) => {
        const normalizedItems = items.map((it: any) => {
          const incomingStock = it.incoming ?? it.stockIncoming ?? it.incomingStock ?? 0
          const outgoingStock = it.outgoing ?? it.stockOutgoing ?? it.outgoingStock ?? 0
          const goodReturnStock = it.goodReturnStock ?? 0
          const damageReturnStock = it.damageReturnStock ?? 0
          const stockLeft = Math.max(0, incomingStock - outgoingStock + goodReturnStock - damageReturnStock)

          let updatedAt = it.updatedAt || it.lastUpdated || it.createdAt
          if (!updatedAt) {
            updatedAt = new Date()
          }

          return {
            ...it,
            incoming: incomingStock,
            outgoing: outgoingStock,
            goodReturnStock,
            damageReturnStock,
            stockLeft,
            updatedAt,
          }
        })

        // Filter low stock items
        const lowStockItems = normalizedItems.filter((item) => {
          const incomingStock = (item as any).incoming ?? 0
          const outgoingStock = (item as any).outgoing ?? 0
          const goodReturnStock = (item as any).goodReturnStock ?? 0
          const damageReturnStock = (item as any).damageReturnStock ?? 0
          const stockLeft = Math.max(0, incomingStock - outgoingStock + goodReturnStock - damageReturnStock)
          return stockLeft < 10
        })
        setStockAlerts(lowStockItems.slice(0, 10))

        // Filter expiring soon (within 30 days)
        const now = new Date()
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        const expiringItems = normalizedItems.filter((item) => {
          const expDate = parseDate((item as any).expiryDate ?? (item as any).expirationDate)
          if (!expDate) return false
          return expDate > now && expDate <= thirtyDaysFromNow
        })

        // Recently added: top 10 by createdAt desc
        const recent = [...normalizedItems]
          .sort((a, b) => {
            const ad = parseDate((a as any).createdAt)?.getTime() || 0
            const bd = parseDate((b as any).createdAt)?.getTime() || 0
            return bd - ad
          })
          .slice(0, 10)
        setRecentlyAdded(recent)

        const lowStock = lowStockItems.length
        setStats((prev) => ({
          ...prev,
          totalItems: items.length,
          lowStockItems: lowStock,
          expiringSoon: expiringItems.length,
        }))

        setShowNotificationBanner(lowStock > 0)
        setLoading(false)
      })

      // Subscribe to transactions for Recent Stock Movements
      try {
        unsubscribeTransactions = TransactionService.subscribeToTransactions(
          (txns: InventoryTransaction[]) => {
            // Sort by most recent first
            const sorted = [...txns].sort((a, b) => {
              const ad = parseDate(a.transaction_date || a.created_at)?.getTime() || 0
              const bd = parseDate(b.transaction_date || b.created_at)?.getTime() || 0
              return bd - ad
            })
            setRecentMovements(sorted.slice(0, 50)) // Keep last 50 movements
          },
          () => {
            console.log("[Dashboard] Transactions subscription not accessible, skipping...")
            setRecentMovements([])
          }
        )
      } catch (error) {
        console.log("[Dashboard] Transactions subscription error, skipping...")
      }
    } catch (error) {
      console.error("[Dashboard] Subscription error:", error)
      setHasPermissionError(true)
      setLoading(false)
    }

    return () => {
      unsubscribeInventory?.()
      unsubscribeTransactions?.()
    }
  }, [user, firebaseError])

  const handleNotificationClick = () => {
    router.push("/inventory")
    setShowNotificationBanner(false)
  }

  const formatTimeAgo = (date: Date | string | any) => {
    let dateObj: Date

    if (date && typeof date === "object" && date.toDate) {
      dateObj = date.toDate()
    } else if (date && typeof date === "object" && date.seconds) {
      dateObj = new Date(date.seconds * 1000)
    } else if (typeof date === "string") {
      dateObj = new Date(date)
    } else if (date instanceof Date) {
      dateObj = date
    } else {
      return "N/A"
    }

    if (isNaN(dateObj.getTime())) {
      return "N/A"
    }

    const now = new Date()
    const diffInMs = now.getTime() - dateObj.getTime()
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60))
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60))
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInMinutes < 1) return "Just now"
    if (diffInMinutes < 60) return `${diffInMinutes} min ago`
    if (diffInHours === 1) return "1 hour ago"
    if (diffInHours < 24) return `${diffInHours} hours ago`
    if (diffInDays === 1) return "1 day ago"
    if (diffInDays < 7) return `${diffInDays} days ago`

    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const formatMovementDateTime = (date: Date | string | any) => {
    let dateObj: Date

    if (date && typeof date === "object" && date.toDate) {
      dateObj = date.toDate()
    } else if (date && typeof date === "object" && date.seconds) {
      dateObj = new Date(date.seconds * 1000)
    } else if (typeof date === "string") {
      dateObj = new Date(date)
    } else if (date instanceof Date) {
      dateObj = date
    } else {
      return { date: "N/A", time: "" }
    }

    if (isNaN(dateObj.getTime())) {
      return { date: "N/A", time: "" }
    }

    return {
      date: dateObj.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      time: dateObj.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    }
  }

  // Determine movement type label from transaction data
  const getMovementAction = (txn: InventoryTransaction) => {
    const mt = (txn.movement_type || txn.source || "").toUpperCase()
    if (mt.includes("RETURN") && mt.includes("DAMAGE")) return "BAD RETURN"
    if (mt.includes("GOOD") || (mt.includes("RETURN") && !mt.includes("DAMAGE"))) return "GOOD RETURN"
    if (mt.includes("OUTGOING") || mt.includes("OUT")) return "OUT"
    if (mt.includes("INCOMING") || mt.includes("SUPPLIER") || mt.includes("PRODUCTION") || mt.includes("FROM")) return "IN"
    // Fallback: check quantities
    if ((txn.outgoing_qty || 0) > 0) return "OUT"
    if ((txn.incoming_qty || 0) > 0) return "IN"
    if ((txn.good_return || 0) > 0) return "GOOD RETURN"
    if ((txn.damage_return || 0) > 0) return "BAD RETURN"
    return mt || "IN"
  }

  // Get the relevant quantity for a movement
  const getMovementQuantity = (txn: InventoryTransaction) => {
    const action = getMovementAction(txn)
    if (action === "OUT") return txn.outgoing_qty || txn.incoming_qty || 0
    if (action === "IN") return txn.incoming_qty || txn.outgoing_qty || 0
    if (action === "GOOD RETURN") return txn.good_return || 0
    if (action === "BAD RETURN") return txn.damage_return || 0
    return txn.incoming_qty || txn.outgoing_qty || 0
  }

  const getMovementUnit = (txn: InventoryTransaction) => {
    return txn.unit_type?.toLowerCase() || "pack"
  }

  if (hasPermissionError || firebaseError) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Firebase Setup Required:</strong> Please configure your Firebase project to access dashboard
            features.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (loading) {
    return <DashboardOverviewSkeleton />
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Alert Banner */}
      {showNotificationBanner && (
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-orange-950/40 dark:to-amber-950/40 border border-amber-200/60 dark:border-orange-800 px-5 py-3.5 shadow-sm animate-in slide-in-from-top-2 duration-300">
          <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-white dark:bg-orange-900 flex items-center justify-center shadow-sm">
            <AlertCircle className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
          </div>
          <span className="text-sm text-gray-800 dark:text-orange-200">
            <strong className="font-semibold">Low Stock Alert:</strong>{" "}
            {stats.lowStockItems} items require immediate attention.
          </span>
          <div className="flex-1"></div>
          <Button
            size="sm"
            onClick={handleNotificationClick}
            className="px-4 py-2 rounded-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-all hover:scale-[1.02] hover:shadow-md flex-shrink-0"
          >
            View Items
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowNotificationBanner(false)}
            className="h-8 w-8 p-0 rounded-full text-gray-400 hover:text-gray-600 hover:bg-orange-100 dark:hover:bg-orange-900 flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Page Header */}
      <div>
        <h1 className="text-[28px] font-bold text-gray-900 dark:text-foreground leading-tight tracking-[-0.01em]">
          Main Dashboard
        </h1>
        <p className="text-gray-400 dark:text-muted-foreground text-[13px] mt-1 tracking-wide">
          Monitor inventory flow and stock status in real time
        </p>
      </div>

      {/* ─── KPI Summary Cards ─── */}
      <div className="grid gap-5 md:grid-cols-3">
        {/* Total Stocks */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300 group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-gray-500 dark:text-muted-foreground uppercase tracking-wide">
              Total Stocks
            </CardTitle>
            <TotalStocksIcon />
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-foreground leading-none mb-2">
                  {stats.totalItems.toLocaleString()}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30">
                    <TrendingUp className="h-3 w-3 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">+5</span>
                  </div>
                  <span className="text-xs text-gray-400">this week</span>
                </div>
              </div>
              <TrendChart trend="up" type="total" />
            </div>
          </CardContent>
        </Card>

        {/* Low Stock */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300 group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-gray-500 dark:text-muted-foreground uppercase tracking-wide">
              Low Stock
            </CardTitle>
            <LowStockIcon />
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold text-red-500 leading-none mb-2">
                  {stats.lowStockItems}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30">
                    <TrendingDown className="h-3 w-3 text-red-500" />
                    <span className="text-xs font-semibold text-red-500 dark:text-red-400">-1</span>
                  </div>
                  <span className="text-xs text-gray-400">this week</span>
                </div>
              </div>
              <TrendChart trend="down" type="low" />
            </div>
          </CardContent>
        </Card>

        {/* Expiring Soon */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300 group">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-5 pt-5">
            <CardTitle className="text-sm font-semibold text-gray-500 dark:text-muted-foreground uppercase tracking-wide">
              Expiring Soon
            </CardTitle>
            <ExpiringSoonIcon />
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-3xl font-bold text-amber-500 leading-none mb-2">
                  {stats.expiringSoon}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/30">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">30d</span>
                  </div>
                  <span className="text-xs text-gray-400">window</span>
                </div>
              </div>
              <TrendChart trend="up" type="expiring" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Main Content: Two-Panel Layout ─── */}
      <div className="grid gap-5 lg:grid-cols-2">

        {/* ──────── LEFT: Stock Alert & Updates ──────── */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-0 px-6 pt-6">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg font-bold text-gray-900 dark:text-foreground mb-0.5">
                Stock Alert & Updates
              </CardTitle>
              <CardDescription className="text-sm text-gray-400 dark:text-muted-foreground">
                Items requiring immediate attention
              </CardDescription>
            </div>
            {!isGuest && (
              <Button
                asChild
                className="h-9 px-5 rounded-full bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm flex-shrink-0 transition-all hover:scale-[1.02] hover:shadow-md"
              >
                <Link href="/inventory">Manage Stock</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-6 pb-5 pt-4">

            {/* ── Summary Bar ── */}
            {(() => {
              const allItems = [...recentlyAdded, ...stockAlerts].filter((item, index, self) =>
                index === self.findIndex((t) => t.id === item.id)
              )
              const outOfStockCount = allItems.filter(i => ((i as any).stockLeft ?? 0) <= 0).length
              const lowStockCount = allItems.filter(i => {
                const s = (i as any).stockLeft ?? 0
                return s > 0 && s <= 5
              }).length
              const now = new Date()
              const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
              const expiringCount = allItems.filter(i => {
                const expDate = (i as any).expiryDate ?? (i as any).expirationDate
                if (!expDate) return false
                const d = expDate instanceof Date ? expDate : expDate?.toDate ? expDate.toDate() : new Date(expDate)
                return !isNaN(d.getTime()) && d > now && d <= sevenDays
              }).length

              if (outOfStockCount > 0 || lowStockCount > 0 || expiringCount > 0) {
                return (
                  <div className="flex items-center gap-2 flex-wrap mb-4">
                    {outOfStockCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                        {outOfStockCount} Out of Stock
                      </span>
                    )}
                    {lowStockCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {lowStockCount} Low Stock
                      </span>
                    )}
                    {expiringCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-50 text-orange-600 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800">
                        <Clock className="h-3 w-3" />
                        {expiringCount} Expiring Soon
                      </span>
                    )}
                  </div>
                )
              }
              return null
            })()}

            {/* Table Header */}
            <div className="grid grid-cols-[2fr_1.4fr_1.2fr_0.9fr] gap-3 text-[11px] font-semibold text-gray-400 dark:text-muted-foreground uppercase tracking-wider pb-3 border-b border-gray-100 dark:border-border">
              <div>Product Name</div>
              <div className="text-center">Expiration</div>
              <div className="text-center">Stock Status</div>
              <div className="text-right">Last Update</div>
            </div>

            {/* Table Rows */}
            <div className="divide-y divide-gray-50 dark:divide-border/50">
              {(() => {
                const { items, totalPages, totalItems } = getPaginatedStockItems()

                if (items.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12">
                      <div className="h-12 w-12 rounded-full bg-gray-50 dark:bg-secondary/50 flex items-center justify-center mb-3">
                        <AlertCircle className="h-5 w-5 text-gray-300" />
                      </div>
                      <p className="text-sm text-gray-400">No stock items to display</p>
                    </div>
                  )
                }

                return (
                  <>
                    {items.map((item, index) => {
                      const stockLeft = (item as any).stockLeft ?? 0
                      const maxStock = Math.max(stockLeft, (item as any).incoming ?? 10, 10)
                      const stockPercent = Math.min(100, Math.round((stockLeft / maxStock) * 100))

                      // Status badge logic
                      let statusLabel = "In Stock"
                      let statusColor = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
                      let barColor = "bg-emerald-500"
                      let borderColor = "border-l-emerald-400"
                      if (stockLeft <= 0) {
                        statusLabel = "Out of Stock"
                        statusColor = "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
                        barColor = "bg-red-500"
                        borderColor = "border-l-red-400"
                      } else if (stockLeft <= 5) {
                        statusLabel = "Low Stock"
                        statusColor = "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
                        barColor = "bg-amber-500"
                        borderColor = "border-l-amber-400"
                      }

                      // Expiry logic
                      const rawExp = (item as any).expiryDate ?? (item as any).expirationDate
                      let expiryDisplay = "—"
                      let expiryIcon: React.ReactNode = null
                      let expiryStyle = "text-gray-400"
                      if (rawExp) {
                        const expDate = rawExp instanceof Date ? rawExp : rawExp?.toDate ? rawExp.toDate() : new Date(rawExp)
                        if (!isNaN(expDate.getTime())) {
                          const now = new Date()
                          const diffMs = expDate.getTime() - now.getTime()
                          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
                          if (diffDays < 0) {
                            expiryDisplay = "Expired"
                            expiryIcon = <AlertTriangle className="h-3 w-3 text-red-500" />
                            expiryStyle = "text-red-600 font-semibold dark:text-red-400"
                          } else if (diffDays <= 3) {
                            expiryDisplay = `${diffDays}d left`
                            expiryIcon = <AlertTriangle className="h-3 w-3 text-red-500" />
                            expiryStyle = "text-red-600 font-semibold dark:text-red-400"
                          } else if (diffDays <= 7) {
                            expiryDisplay = `${diffDays}d left`
                            expiryIcon = <Clock className="h-3 w-3 text-amber-500" />
                            expiryStyle = "text-amber-600 font-medium dark:text-amber-400"
                          } else if (diffDays <= 30) {
                            expiryDisplay = `${diffDays}d left`
                            expiryIcon = <Clock className="h-3 w-3 text-gray-400" />
                            expiryStyle = "text-gray-500"
                          } else {
                            expiryDisplay = formatExpDate(rawExp)
                            expiryStyle = "text-gray-500"
                          }
                        }
                      }

                      return (
                        <div
                          key={`stock-${item.id}-${index}`}
                          className={`grid grid-cols-[2fr_1.4fr_1.2fr_0.9fr] gap-3 py-3 items-center transition-all duration-200 hover:bg-blue-50/40 dark:hover:bg-secondary/30 hover:shadow-[0_1px_4px_rgba(0,0,0,0.04)] group border-l-[3px] ${borderColor} rounded-r-md -ml-px pl-3`}
                        >
                          {/* Product Name */}
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-gray-800 dark:text-foreground truncate leading-snug">
                              {(item as any).name ?? (item as any).itemName ?? item.category ?? "General"}
                            </p>
                            {item.subcategory && item.subcategory !== "N/A" && (
                              <p className="text-[11px] text-gray-400 dark:text-muted-foreground mt-0.5 truncate">
                                {item.subcategory}
                              </p>
                            )}
                          </div>

                          {/* Expiration — relative time with icon */}
                          <div className="flex items-center justify-center gap-1.5">
                            {expiryIcon}
                            <span className={`text-[13px] ${expiryStyle}`}>
                              {expiryDisplay}
                            </span>
                          </div>

                          {/* Stock Status — badge + progress bar */}
                          <div className="flex flex-col items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${statusColor}`}>
                              {stockLeft > 0 && <span className="font-bold text-[11px]">{stockLeft}</span>}
                              {statusLabel}
                            </span>
                            {/* Progress bar */}
                            <div className="w-full max-w-[80px] h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                style={{ width: `${Math.max(stockLeft <= 0 ? 0 : 4, stockPercent)}%` }}
                              />
                            </div>
                          </div>

                          {/* Last Update */}
                          <div className="text-right text-[13px] text-gray-400 dark:text-muted-foreground">
                            {formatTimeAgo((item as any).updatedAt)}
                          </div>
                        </div>
                      )
                    })}

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 mt-1">
                        <div className="text-xs text-gray-400 dark:text-muted-foreground">
                          Showing {items.length} of {totalItems}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStockCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={stockCurrentPage === 1}
                            className="h-8 px-3 text-xs font-medium rounded-lg border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-secondary/50 disabled:opacity-40 transition-all"
                          >
                            <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                            Previous
                          </Button>
                          <div className="flex items-center gap-0.5 px-2.5 py-1 bg-gray-50 dark:bg-secondary/40 rounded-lg">
                            <span className="text-xs font-bold text-gray-700 dark:text-foreground">{stockCurrentPage}</span>
                            <span className="text-xs text-gray-300">/</span>
                            <span className="text-xs text-gray-400">{totalPages}</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setStockCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={stockCurrentPage === totalPages}
                            className="h-8 px-3 text-xs font-medium rounded-lg border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-secondary/50 disabled:opacity-40 transition-all"
                          >
                            Next
                            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </CardContent>
        </Card>

        {/* ──────── RIGHT: Recent Stock Movements ──────── */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-0 px-6 pt-6">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-lg font-bold text-gray-900 dark:text-foreground mb-0.5">
                Recent Stock Movements
              </CardTitle>
              <CardDescription className="text-sm text-gray-400 dark:text-muted-foreground">
                Inventory transactions log
              </CardDescription>
            </div>
            {!isGuest && (
              <Button
                asChild
                className="h-9 px-5 rounded-full bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm flex-shrink-0 transition-all hover:scale-[1.02] hover:shadow-md"
              >
                <Link href="/stock-logs">Track All</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-6 pb-5 pt-4">
            {/* Table Header */}
            <div className="grid grid-cols-[1.4fr_1.2fr_1.2fr_0.8fr_0.6fr] gap-2 text-[11px] font-semibold text-gray-400 dark:text-muted-foreground uppercase tracking-wider pb-3 border-b border-gray-100 dark:border-border">
              <div>Date & Time</div>
              <div>Product Name</div>
              <div>Batch Number</div>
              <div className="text-center">Action</div>
              <div className="text-right">Quantity</div>
            </div>

            {/* Movement Rows */}
            <div className="divide-y divide-gray-50 dark:divide-border/50">
              {(() => {
                const { items, totalPages, totalItems } = getPaginatedMovements()

                if (items.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12">
                      <div className="h-12 w-12 rounded-full bg-gray-50 dark:bg-secondary/50 flex items-center justify-center mb-3">
                        <AlertCircle className="h-5 w-5 text-gray-300" />
                      </div>
                      <p className="text-sm text-gray-400">No recent stock movements</p>
                    </div>
                  )
                }

                return (
                  <>
                    {items.map((txn, index) => {
                      const dt = formatMovementDateTime(txn.transaction_date || txn.created_at)
                      const action = getMovementAction(txn)
                      const qty = getMovementQuantity(txn)
                      const unit = getMovementUnit(txn)

                      return (
                        <div
                          key={`mvmt-${txn.id}-${index}`}
                          className="grid grid-cols-[1.4fr_1.2fr_1.2fr_0.8fr_0.6fr] gap-2 py-3.5 items-center transition-colors hover:bg-gray-50/50 dark:hover:bg-secondary/20"
                        >
                          {/* Date & Time */}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-700 dark:text-foreground leading-snug truncate">
                              {dt.time && `${dt.time}`}
                            </p>
                            <p className="text-[11px] text-gray-400 dark:text-muted-foreground mt-0.5 truncate">
                              {dt.date}
                            </p>
                          </div>

                          {/* Product Name */}
                          <div className="min-w-0">
                            <p className="text-sm text-gray-700 dark:text-foreground truncate leading-snug">
                              {txn.product_name || "N/A"}
                            </p>
                          </div>

                          {/* Batch Number / Barcode */}
                          <div className="min-w-0">
                            <p className="text-[12px] text-gray-400 dark:text-muted-foreground font-mono truncate leading-snug">
                              {txn.barcode || txn.reference_no || "—"}
                            </p>
                          </div>

                          {/* Action Badge */}
                          <div className="flex justify-center">
                            <ActionBadge action={action} />
                          </div>

                          {/* Quantity */}
                          <div className="text-right">
                            <span className="text-sm font-bold text-gray-800 dark:text-foreground">
                              {qty}
                            </span>
                            <span className="text-[11px] text-gray-400 ml-1">
                              {unit}
                            </span>
                          </div>
                        </div>
                      )
                    })}

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 mt-1">
                        <div className="text-xs text-gray-400 dark:text-muted-foreground">
                          Showing {items.length} of {totalItems}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMovementCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={movementCurrentPage === 1}
                            className="h-8 px-3 text-xs font-medium rounded-lg border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-secondary/50 disabled:opacity-40 transition-all"
                          >
                            <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                            Previous
                          </Button>
                          <div className="flex items-center gap-0.5 px-2.5 py-1 bg-gray-50 dark:bg-secondary/40 rounded-lg">
                            <span className="text-xs font-bold text-gray-700 dark:text-foreground">{movementCurrentPage}</span>
                            <span className="text-xs text-gray-300">/</span>
                            <span className="text-xs text-gray-400">{totalPages}</span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMovementCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={movementCurrentPage === totalPages}
                            className="h-8 px-3 text-xs font-medium rounded-lg border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-secondary/50 disabled:opacity-40 transition-all"
                          >
                            Next
                            <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
