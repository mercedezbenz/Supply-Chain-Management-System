"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, AlertCircle, X, ChevronLeft, ChevronRight, Package, Calendar, FileText, Truck, MapPin, User } from "lucide-react"
import { TotalStocksIcon, LowStockIcon, DeliveryTodayIcon } from "./dashboard-icons"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { subscribeToCollection, CustomerTransactionService } from "@/services/firebase-service"
import { useAuth } from "@/hooks/use-auth"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { InventoryItem, Delivery, CustomerTransaction } from "@/lib/types"
import { formatExpirationDate as formatExpDate } from "@/lib/utils"
import { DashboardOverviewSkeleton } from "@/components/skeletons/dashboard-skeleton"

interface DashboardStats {
  totalItems: number
  lowStockItems: number
  deliveryToday: number
}

const TrendChart = ({ trend, type }: { trend: "up" | "down"; type: "total" | "low" }) => {
  const bars =
    type === "total"
      ? [
        { height: 20, color: "#FDE047" }, // yellow
        { height: 35, color: "#FB923C" }, // orange
        { height: 50, color: "#4ADE80" }, // green
        { height: 65, color: "#60A5FA" }, // blue
      ]
      : [
        { height: 65, color: "#F87171" }, // red
        { height: 45, color: "#FB923C" }, // orange
        { height: 30, color: "#A78BFA" }, // purple
        { height: 20, color: "#34D399" }, // green
      ]

  return (
    <div className="relative h-16 w-20 flex items-end justify-center gap-1 opacity-60">
      {bars.map((bar, index) => (
        <div
          key={index}
          className="w-3 rounded-t-sm"
          style={{
            height: `${bar.height}%`,
            backgroundColor: bar.color,
          }}
        />
      ))}
      {/* Trend Arrow */}
      <div className="absolute -top-2 -right-2 opacity-50">
        {trend === "up" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M7 17L17 7M17 7H7M17 7V17"
              stroke="#EF4444"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M17 7L7 17M7 17H17M7 17V7"
              stroke="#3B82F6"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  )
}

export function DashboardOverview() {
  const { user, firebaseError, isGuest } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats>({
    totalItems: 0,
    lowStockItems: 0,
    deliveryToday: 0,
  })
  const [stockAlerts, setStockAlerts] = useState<InventoryItem[]>([])
  const [recentlyAdded, setRecentlyAdded] = useState<InventoryItem[]>([])
  const [recentDeliveries, setRecentDeliveries] = useState<Delivery[]>([])
  const [recentlyAddedDeliveries, setRecentlyAddedDeliveries] = useState<(Delivery | CustomerTransaction)[]>([])
  const [activeTransactions, setActiveTransactions] = useState<CustomerTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [hasPermissionError, setHasPermissionError] = useState(false)
  const [showNotificationBanner, setShowNotificationBanner] = useState(false)

  // Delivery status tab
  const [deliveryTab, setDeliveryTab] = useState<"ALL" | "PRODUCT_OUT" | "IN_PROGRESS" | "DELIVERED">("ALL")

  // Pagination state for Stock Alert & Updates table
  const [stockCurrentPage, setStockCurrentPage] = useState(1)
  const FIRST_PAGE_ITEMS = 7
  const OTHER_PAGE_ITEMS = 5

  // Helper function to calculate paginated items
  const getPaginatedStockItems = () => {
    // Combine recentlyAdded and stockAlerts for pagination
    const allStockItems = [...recentlyAdded, ...stockAlerts]
    const totalItems = allStockItems.length

    // Calculate pagination
    let startIndex = 0
    let endIndex = 0

    if (stockCurrentPage === 1) {
      startIndex = 0
      endIndex = Math.min(FIRST_PAGE_ITEMS, totalItems)
    } else {
      // First page has FIRST_PAGE_ITEMS, subsequent pages have OTHER_PAGE_ITEMS each
      startIndex = FIRST_PAGE_ITEMS + (stockCurrentPage - 2) * OTHER_PAGE_ITEMS
      endIndex = Math.min(startIndex + OTHER_PAGE_ITEMS, totalItems)
    }

    // Calculate total pages
    let totalPages = 1
    if (totalItems > FIRST_PAGE_ITEMS) {
      totalPages = 1 + Math.ceil((totalItems - FIRST_PAGE_ITEMS) / OTHER_PAGE_ITEMS)
    }

    return {
      items: allStockItems.slice(startIndex, endIndex),
      totalPages,
      totalItems,
      startIndex,
      endIndex
    }
  }

  // Reset to page 1 when data changes
  useEffect(() => {
    setStockCurrentPage(1)
  }, [recentlyAdded.length, stockAlerts.length])

  useEffect(() => {
    if (!user || firebaseError) {
      setLoading(false)
      if (firebaseError?.includes("permission")) {
        setHasPermissionError(true)
      }
      return
    }

    let unsubscribeInventory: (() => void) | undefined
    let unsubscribeDeliveries: (() => void) | undefined
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

    // Function to calculate deliveryToday from both collections
    // "Delivery Today" means deliveries currently in progress (on delivery)
    const calculateDeliveryToday = (
      deliveries: Delivery[],
      transactions: CustomerTransaction[]
    ) => {
      const today = new Date().toDateString()

      // Count from deliveries collection (status = "on_delivery" and updated today)
      const deliveriesToday = deliveries.filter((d) => {
        if (d.status !== "on_delivery") return false
        const deliveryDate = parseDate(d.updatedAt)
        if (!deliveryDate) return false
        return deliveryDate.toDateString() === today
      }).length

      // Count from customer_transactions with IN_PROGRESS status (currently on delivery)
      // Count all IN_PROGRESS transactions as they are currently being delivered
      const transactionsToday = transactions.filter((tx) => {
        return tx.transactionType === "IN_PROGRESS"
      }).length

      return deliveriesToday + transactionsToday
    }

    try {
      // Fetch ONLY from "inventory" collection - 1 row per 1 Firestore document (no aggregation)
      unsubscribeInventory = subscribeToCollection("inventory", (items: InventoryItem[]) => {
        // Each item in items array represents a single Firestore document from "inventory" collection
        // Normalize items to ensure proper field mapping - no grouping or aggregation by category
        const normalizedItems = items.map((it: any) => {
          // Normalize field names (same as inventory dashboard)
          const incomingStock = it.incoming ?? it.stockIncoming ?? it.incomingStock ?? 0
          const outgoingStock = it.outgoing ?? it.stockOutgoing ?? it.outgoingStock ?? 0
          const goodReturnStock = it.goodReturnStock ?? 0
          const damageReturnStock = it.damageReturnStock ?? 0

          // Correct stock calculation: incomingStock - outgoingStock + goodReturnStock - damageReturnStock
          // Each document shows its own computed totalStock (no aggregation)
          // Use Math.max(0, ...) to ensure no negative values are displayed
          const stockLeft = Math.max(0, incomingStock - outgoingStock + goodReturnStock - damageReturnStock)

          // Get updatedAt with proper fallbacks, ensuring it's never null/undefined
          let updatedAt = it.updatedAt || it.lastUpdated || it.createdAt
          if (!updatedAt) {
            updatedAt = new Date()
          }

          // Preserve all original fields including name, expiryDate, etc.
          return {
            ...it, // Preserve ALL original fields from Firestore
            incoming: incomingStock,
            outgoing: outgoingStock,
            goodReturnStock,
            damageReturnStock,
            stockLeft, // Add calculated stockLeft using correct formula
            updatedAt,
          }
        })

        // Filter low stock items using correct stock calculation (no aggregation)
        const lowStockItems = normalizedItems.filter((item) => {
          const incomingStock = (item as any).incoming ?? 0
          const outgoingStock = (item as any).outgoing ?? 0
          const goodReturnStock = (item as any).goodReturnStock ?? 0
          const damageReturnStock = (item as any).damageReturnStock ?? 0
          const stockLeft = Math.max(0, incomingStock - outgoingStock + goodReturnStock - damageReturnStock)
          return stockLeft < 10
        })
        setStockAlerts(lowStockItems.slice(0, 5))

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
        }))

        setShowNotificationBanner(lowStock > 0)
        setLoading(false)
      })

      // Track deliveries and transactions separately
      let currentDeliveries: Delivery[] = []
      let currentTransactions: CustomerTransaction[] = []

      const updateDeliveryToday = () => {
        const count = calculateDeliveryToday(currentDeliveries, currentTransactions)
        setStats((prev) => ({ ...prev, deliveryToday: count }))
      }

      try {
        unsubscribeDeliveries = subscribeToCollection("deliveries", (deliveries: Delivery[]) => {
          currentDeliveries = deliveries || []
          // Only get deliveries that are in transit (on_delivery status)
          const active = currentDeliveries.filter(
            (d) => d.status === "on_delivery",
          )
          setRecentDeliveries(active.slice(0, 5))

          // Combine with transactions for recently added - only in transit/on delivery items
          const inTransitDeliveries = currentDeliveries.filter((d) => d.status === "on_delivery")
          const inTransitTransactions = currentTransactions.filter((tx) => tx.transactionType === "IN_PROGRESS")

          // Remove duplicates by id
          const seenIds = new Set<string>()
          const allRecent = [...inTransitDeliveries, ...inTransitTransactions]
            .filter((item) => {
              if (seenIds.has(item.id)) {
                return false
              }
              seenIds.add(item.id)
              return true
            })
            .sort((a, b) => {
              const ad = parseDate((a as any).createdAt)?.getTime() || 0
              const bd = parseDate((b as any).createdAt)?.getTime() || 0
              return bd - ad
            })
            .slice(0, 10)
          setRecentlyAddedDeliveries(allRecent)

          updateDeliveryToday()
        })
      } catch (error) {
        console.log("[Dashboard] Deliveries collection not accessible, skipping...")
      }

      try {
        unsubscribeTransactions = CustomerTransactionService.subscribeToAllTransactions(
          (transactions: CustomerTransaction[]) => {
            currentTransactions = transactions || []
            updateDeliveryToday()

            // Set active transactions (IN_PROGRESS) for Delivery Status card
            const inProgress = transactions.filter((tx) => tx.transactionType === "IN_PROGRESS")
            setActiveTransactions(inProgress.slice(0, 5)) // Show top 5

            // Update recently added with transactions - only in transit/on delivery items
            const inTransitDeliveries = currentDeliveries.filter((d) => d.status === "on_delivery")
            const inTransitTransactions = transactions.filter((tx) => tx.transactionType === "IN_PROGRESS")

            // Remove duplicates by id
            const seenIds = new Set<string>()
            const allRecent = [...inTransitDeliveries, ...inTransitTransactions]
              .filter((item) => {
                if (seenIds.has(item.id)) {
                  return false
                }
                seenIds.add(item.id)
                return true
              })
              .sort((a, b) => {
                const ad = parseDate((a as any).createdAt)?.getTime() || 0
                const bd = parseDate((b as any).createdAt)?.getTime() || 0
                return bd - ad
              })
              .slice(0, 10)
            setRecentlyAddedDeliveries(allRecent)
          }
        )
      } catch (error) {
        console.log("[Dashboard] Customer transactions collection not accessible, skipping...")
      }
    } catch (error) {
      console.error("[v0] Dashboard subscription error:", error)
      setHasPermissionError(true)
      setLoading(false)
    }

    return () => {
      unsubscribeInventory?.()
      unsubscribeDeliveries?.()
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
    if (diffInHours < 1) return "Just now"
    if (diffInHours === 1) return "1 hour ago"
    if (diffInHours < 24) return `${diffInHours} hours ago`
    if (diffInDays === 1) return "1 day ago"
    if (diffInDays < 7) return `${diffInDays} days ago`

    // For older dates, show actual date
    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const formatTransactionDate = (date: Date | string | any) => {
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

    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
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
    <div className="space-y-8 pb-8">
      {/* Alert Banner */}
      {showNotificationBanner && (
        <div className="flex items-center gap-4 rounded-2xl bg-[#FFF7ED] dark:bg-orange-950 border border-[#FED7AA] dark:border-orange-800 px-6 py-3 shadow-sm">
          <div className="flex-shrink-0 h-8 w-8 rounded-full bg-white dark:bg-orange-900 flex items-center justify-center">
            <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          </div>
          <span className="text-sm text-[#111827] dark:text-orange-200 whitespace-nowrap">
            <strong className="font-semibold">Low Stock Alert:</strong> {stats.lowStockItems} items require immediate attention.
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
            className="h-8 w-8 p-0 rounded-full text-[#9CA3AF] hover:text-[#6B7280] hover:bg-orange-100 dark:hover:bg-orange-900 flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Page Header */}
      <div>
        <h1 className="text-[30px] font-bold text-[#111827] dark:text-foreground leading-[1.4] mb-2">{isGuest ? "Guest Dashboard" : "Admin Dashboard"}</h1>
        <p className="text-[#9CA3AF] dark:text-muted-foreground text-sm leading-[1.5]">Track stocks flow and delivery status</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="rounded-2xl border border-[#E5E7EB] dark:border-border shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4 md:px-5 md:pt-5">
            <CardTitle className="text-[15px] font-semibold text-[#111827] dark:text-foreground leading-[1.4]">Total Stocks</CardTitle>
            <TotalStocksIcon />
          </CardHeader>
          <CardContent className="px-4 pb-4 md:px-5 md:pb-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[28px] font-bold text-[#111827] dark:text-foreground leading-[1.4] mb-1.5">{stats.totalItems}</div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3 text-green-500" />
                  <p className="text-xs text-[#9CA3AF] dark:text-muted-foreground leading-[1.5]">+5 increase this week</p>
                </div>
              </div>
              <TrendChart trend="up" type="total" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-[#E5E7EB] dark:border-border shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4 md:px-5 md:pt-5">
            <CardTitle className="text-[15px] font-semibold text-[#111827] dark:text-foreground leading-[1.4]">Low Stock</CardTitle>
            <LowStockIcon />
          </CardHeader>
          <CardContent className="px-4 pb-4 md:px-5 md:pb-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[28px] font-bold text-destructive leading-[1.4] mb-1.5">{stats.lowStockItems}</div>
                <div className="flex items-center gap-1.5">
                  <TrendingDown className="h-3 w-3 text-destructive" />
                  <p className="text-xs text-[#9CA3AF] dark:text-muted-foreground leading-[1.5]">-1 Decrease this week</p>
                </div>
              </div>
              <TrendChart trend="down" type="low" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-[#E5E7EB] dark:border-border shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-4 pt-4 md:px-5 md:pt-5">
            <CardTitle className="text-[15px] font-semibold text-[#111827] dark:text-foreground leading-[1.4]">Delivery Today</CardTitle>
            <DeliveryTodayIcon />
          </CardHeader>
          <CardContent className="px-4 pb-4 md:px-5 md:pb-5">
            <div className="text-[28px] font-bold text-[#111827] dark:text-foreground leading-[1.4] mb-1.5">{stats.deliveryToday}</div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <p className="text-xs text-[#9CA3AF] dark:text-muted-foreground leading-[1.5]">On schedule</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Cards */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* Stock Alert & Updates */}
        <Card className="rounded-2xl border border-[#E5E7EB] dark:border-border shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4 px-6 pt-6">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-[19px] font-semibold text-[#111827] dark:text-foreground leading-[1.4] mb-1.5">Stock Alert & Updates</CardTitle>
              <CardDescription className="text-sm text-[#9CA3AF] dark:text-muted-foreground leading-[1.5]">Items requiring immediate attention</CardDescription>
            </div>
            {!isGuest && (
              <Button asChild className="h-9 px-4 rounded-full bg-sky-500 hover:bg-sky-600 text-white font-medium text-sm flex-shrink-0 transition-all hover:scale-[1.02] hover:shadow-md">
                <Link href="/inventory">Manage Stock</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="space-y-0">
              {/* Table Header */}
              <div className="grid grid-cols-[2.5fr_1.3fr_0.7fr_1fr] gap-4 text-xs font-semibold text-[#4B5563] dark:text-muted-foreground bg-[#F3F4F6] dark:bg-secondary/50 border-b border-[#E5E7EB] dark:border-border py-3 px-0 mb-0 uppercase tracking-wide">
                <div className="flex items-center justify-start">Product Name</div>
                <div className="flex items-center justify-center">Expiration Date</div>
                <div className="flex items-center justify-center">Stock Left</div>
                <div className="flex items-center justify-end pr-2">Last Update</div>
              </div>

              {/* Paginated Stock Items */}
              <div className="space-y-0">
                {(() => {
                  const { items, totalPages, totalItems } = getPaginatedStockItems()

                  if (items.length === 0) {
                    return (
                      <p className="text-sm text-[#9CA3AF] dark:text-muted-foreground py-4">No stock items to display</p>
                    )
                  }

                  return (
                    <>
                      {items.map((item, index) => (
                        <div
                          key={`stock-${item.id}-${index}`}
                          className={`grid grid-cols-[2.5fr_1.3fr_0.7fr_1fr] gap-4 text-sm py-3 px-0 border-b border-[#E5E7EB] dark:border-border last:border-0 transition-colors hover:bg-[#F9FAFB] dark:hover:bg-secondary/30 ${index % 2 === 1 ? 'bg-[#F9FAFB] dark:bg-secondary/20' : ''}`}
                        >
                          <div className="flex flex-col justify-center items-start">
                            <p className="font-medium text-sm text-[#111827] dark:text-foreground leading-[1.5] whitespace-normal break-words">
                              {(item as any).name ?? (item as any).itemName ?? item.category ?? "General"}
                            </p>
                            {item.subcategory && item.subcategory !== "N/A" && (
                              <p className="text-xs text-[#9CA3AF] dark:text-muted-foreground leading-[1.5] mt-0.5">({item.subcategory})</p>
                            )}
                          </div>
                          <div className="flex items-center justify-center text-sm text-[#4B5563] dark:text-foreground leading-[1.5]">
                            {formatExpDate((item as any).expiryDate ?? (item as any).expirationDate)}
                          </div>
                          <div className="flex items-center justify-center text-sm font-semibold text-[#111827] dark:text-foreground leading-[1.5]">
                            {(item as any).stockLeft ?? 0}
                          </div>
                          <div className="flex items-center justify-end pr-2 text-sm text-[#9CA3AF] dark:text-muted-foreground leading-[1.5]">{formatTimeAgo((item as any).updatedAt)}</div>
                        </div>
                      ))}

                      {/* Pagination Controls */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#E5E7EB] dark:border-border">
                          <div className="text-xs text-[#9CA3AF] dark:text-muted-foreground">
                            Showing {items.length} of {totalItems} items
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setStockCurrentPage(prev => Math.max(1, prev - 1))}
                              disabled={stockCurrentPage === 1}
                              className="h-8 px-3 text-sm font-medium rounded-lg border-[#E5E7EB] dark:border-border hover:bg-[#F3F4F6] dark:hover:bg-secondary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                              <ChevronLeft className="h-4 w-4 mr-1" />
                              Previous
                            </Button>
                            <div className="flex items-center gap-1 px-3 py-1.5 bg-[#F3F4F6] dark:bg-secondary/50 rounded-lg">
                              <span className="text-sm font-semibold text-[#111827] dark:text-foreground">{stockCurrentPage}</span>
                              <span className="text-sm text-[#9CA3AF] dark:text-muted-foreground">/</span>
                              <span className="text-sm text-[#9CA3AF] dark:text-muted-foreground">{totalPages}</span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setStockCurrentPage(prev => Math.min(totalPages, prev + 1))}
                              disabled={stockCurrentPage === totalPages}
                              className="h-8 px-3 text-sm font-medium rounded-lg border-[#E5E7EB] dark:border-border hover:bg-[#F3F4F6] dark:hover:bg-secondary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                              Next
                              <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
          </CardContent>
        </Card >

        {/* Delivery Status — Card-Based Layout with Tabs */}
        <Card className="rounded-2xl border border-[#E5E7EB] dark:border-border shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3 px-6 pt-6">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-[19px] font-semibold text-[#111827] dark:text-foreground leading-[1.4] mb-1.5">Delivery Status</CardTitle>
              <CardDescription className="text-sm text-[#9CA3AF] dark:text-muted-foreground leading-[1.5]">Active deliveries and transactions</CardDescription>
            </div>
            {!isGuest && (
              <Button asChild className="h-9 px-4 rounded-full bg-sky-500 hover:bg-sky-600 text-white font-medium text-sm flex-shrink-0 transition-all hover:scale-[1.02] hover:shadow-md">
                <Link href="/deliveries">Track All</Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {(() => {
              // Combine all deliveries into a single flat list
              const allCards: CustomerTransaction[] = []

              // Add recently added deliveries (only CustomerTransaction type)
              recentlyAddedDeliveries.forEach((item) => {
                if ('transactionType' in item) {
                  allCards.push(item as CustomerTransaction)
                }
              })

              // Add active transactions not already in recently added
              const recentIds = new Set(allCards.map(c => c.id))
              activeTransactions.forEach((tx) => {
                if (!recentIds.has(tx.id)) {
                  allCards.push(tx)
                }
              })

              // Count per status
              const counts = {
                ALL: allCards.length,
                PRODUCT_OUT: allCards.filter(c => c.transactionType === "PRODUCT_OUT").length,
                IN_PROGRESS: allCards.filter(c => c.transactionType === "IN_PROGRESS").length,
                DELIVERED: allCards.filter(c => c.transactionType === "DELIVERED").length,
              }

              // Filter by selected tab
              const filteredCards = deliveryTab === "ALL"
                ? allCards
                : allCards.filter(c => c.transactionType === deliveryTab)

              // Tab definitions
              const tabs: { key: typeof deliveryTab; label: string }[] = [
                { key: "ALL", label: "All" },
                { key: "PRODUCT_OUT", label: "Pending" },
                { key: "IN_PROGRESS", label: "On Delivery" },
                { key: "DELIVERED", label: "Completed" },
              ]

              // Helper: get status config
              const getStatusConfig = (type: string) => {
                switch (type) {
                  case "PRODUCT_OUT":
                    return { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800", border: "border-l-amber-400" }
                  case "IN_PROGRESS":
                    return { label: "On Delivery", color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800", border: "border-l-blue-500" }
                  case "DELIVERED":
                    return { label: "Completed", color: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800", border: "border-l-emerald-500" }
                  default:
                    return { label: type, color: "bg-gray-50 text-gray-700 border-gray-200", border: "border-l-gray-400" }
                }
              }

              // Helper: format delivery date and check if today/tomorrow
              const getDateBadge = (date: any) => {
                if (!date) return null
                let dateObj: Date
                if (date && typeof date === "object" && date.toDate) dateObj = date.toDate()
                else if (date && typeof date === "object" && date.seconds) dateObj = new Date(date.seconds * 1000)
                else if (typeof date === "string") dateObj = new Date(date)
                else if (date instanceof Date) dateObj = date
                else return null

                if (isNaN(dateObj.getTime())) return null

                const today = new Date(); today.setHours(0, 0, 0, 0)
                const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
                const dateOnly = new Date(dateObj); dateOnly.setHours(0, 0, 0, 0)

                const formatted = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

                if (dateOnly.getTime() === today.getTime()) {
                  return { text: formatted, badge: "Today", badgeColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" }
                }
                if (dateOnly.getTime() === tomorrow.getTime()) {
                  return { text: formatted, badge: "Tomorrow", badgeColor: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400" }
                }
                return { text: formatted, badge: null, badgeColor: "" }
              }

              // Tab empty-state labels
              const emptyLabels: Record<string, string> = {
                ALL: "No active deliveries",
                PRODUCT_OUT: "No pending deliveries",
                IN_PROGRESS: "No deliveries in transit",
                DELIVERED: "No completed deliveries",
              }

              return (
                <div className="space-y-4">
                  {/* ── Horizontal Tabs ── */}
                  <div className="flex items-center gap-1 p-1 bg-[#F3F4F6] dark:bg-secondary/40 rounded-lg">
                    {tabs.map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setDeliveryTab(tab.key)}
                        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                          deliveryTab === tab.key
                            ? "bg-sky-500 text-white shadow-sm"
                            : "text-[#6B7280] dark:text-muted-foreground hover:text-[#111827] dark:hover:text-foreground hover:bg-white/60 dark:hover:bg-secondary/60"
                        }`}
                      >
                        {tab.label}
                        {counts[tab.key] > 0 && (
                          <span className={`ml-0.5 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ${
                            deliveryTab === tab.key
                              ? "bg-white/25 text-white"
                              : "bg-[#E5E7EB] dark:bg-secondary text-[#6B7280] dark:text-muted-foreground"
                          }`}>
                            {counts[tab.key]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* ── Card Grid or Empty State ── */}
                  {filteredCards.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <div className="h-14 w-14 rounded-full bg-[#F3F4F6] dark:bg-secondary/50 flex items-center justify-center mb-3">
                        <Truck className="h-7 w-7 text-[#9CA3AF] dark:text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-[#6B7280] dark:text-muted-foreground">{emptyLabels[deliveryTab] || "No deliveries in this status"}</p>
                      <p className="text-xs text-[#9CA3AF] dark:text-muted-foreground mt-1">Deliveries will appear here when dispatched</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 transition-all duration-200">
                      {filteredCards.map((tx) => {
                        const status = getStatusConfig(tx.transactionType)
                        const dateInfo = getDateBadge(tx.transactionDate)
                        const drNo = (tx as any).deliveryReceiptNo
                        const siNo = (tx as any).salesInvoiceNo
                        const tsNo = (tx as any).transferSlipNo
                        const unit = (tx as any).unit || ""
                        const hasDocuments = drNo || siNo || tsNo

                        return (
                          <Link
                            key={tx.id}
                            href="/deliveries"
                            className={`group relative rounded-xl border border-[#E5E7EB] dark:border-border bg-white dark:bg-card shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 ${status.border} overflow-hidden`}
                          >
                            <div className="p-4 space-y-3">
                              {/* TOP: Status + Customer */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-[14px] text-[#111827] dark:text-foreground leading-snug truncate group-hover:text-sky-600 transition-colors">
                                    {tx.customerName || "N/A"}
                                  </p>
                                  <div className="flex items-center gap-1 mt-1">
                                    <MapPin className="h-3 w-3 text-[#9CA3AF] shrink-0" />
                                    <p className="text-xs text-[#6B7280] dark:text-muted-foreground truncate leading-normal">
                                      {tx.customerAddress || "No address"}
                                    </p>
                                  </div>
                                </div>
                                <Badge className={`${status.color} text-[10px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0`}>
                                  {status.label}
                                </Badge>
                              </div>

                              {/* MIDDLE: Product / Quantity / Date pills */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#F3F4F6] dark:bg-secondary/50 text-[11px] font-medium text-[#374151] dark:text-foreground">
                                  <Package className="h-3 w-3 text-[#6B7280]" />
                                  {tx.productName || "N/A"}
                                </span>
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-950/30 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                                  {tx.quantity || 0}{unit ? ` ${unit}` : ""}
                                </span>
                                {dateInfo && (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#F3F4F6] dark:bg-secondary/50 text-[11px] text-[#4B5563] dark:text-muted-foreground">
                                    <Calendar className="h-3 w-3 text-[#9CA3AF]" />
                                    {dateInfo.text}
                                  </span>
                                )}
                                {dateInfo?.badge && (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${dateInfo.badgeColor}`}>
                                    {dateInfo.badge}
                                  </span>
                                )}
                              </div>

                              {/* DOCUMENTS: DR / SI / TS tags */}
                              {hasDocuments && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <FileText className="h-3 w-3 text-[#9CA3AF] shrink-0" />
                                  {drNo && (
                                    <span className="px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/30 text-[10px] font-medium text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                                      DR: {drNo}
                                    </span>
                                  )}
                                  {siNo && (
                                    <span className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/30 text-[10px] font-medium text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                                      SI: {siNo}
                                    </span>
                                  )}
                                  {tsNo && (
                                    <span className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/30 text-[10px] font-medium text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                                      TS: {tsNo}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* BOTTOM: Driver */}
                              <div className="flex items-center justify-between pt-2 border-t border-[#F3F4F6] dark:border-border/50">
                                <div className="flex items-center gap-1.5">
                                  <div className="h-5 w-5 rounded-full bg-[#F3F4F6] dark:bg-secondary/50 flex items-center justify-center">
                                    <User className="h-3 w-3 text-[#6B7280] dark:text-muted-foreground" />
                                  </div>
                                  {tx.assignedDriverName ? (
                                    <span className="text-xs font-medium text-[#374151] dark:text-foreground">{tx.assignedDriverName}</span>
                                  ) : (
                                    <span className="text-xs text-[#9CA3AF] dark:text-muted-foreground italic bg-[#F9FAFB] dark:bg-secondary/30 px-2 py-0.5 rounded-full">Unassigned</span>
                                  )}
                                </div>
                                <span className="text-[10px] text-[#9CA3AF] dark:text-muted-foreground group-hover:text-sky-500 transition-colors">
                                  View details →
                                </span>
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div >
    </div >
  )
}
