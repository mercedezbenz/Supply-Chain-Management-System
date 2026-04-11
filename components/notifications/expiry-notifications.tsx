"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Bell, AlertTriangle, Clock, TrendingDown, Filter } from "lucide-react"
import { InventoryService } from "@/services/firebase-service"
import type { InventoryItem } from "@/lib/types"

interface ExpiryNotification {
  item: InventoryItem
  daysUntilExpiry: number
  status: "expired" | "expiring-today" | "expiring-soon"
}

interface LowStockNotification {
  item: InventoryItem
  stockLevel: number
}

type NotificationFilter = "all" | "low-stock" | "expired" | "expiring"

export function ExpiryNotifications() {
  const [expiryNotifications, setExpiryNotifications] = useState<ExpiryNotification[]>([])
  const [lowStockNotifications, setLowStockNotifications] = useState<LowStockNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<NotificationFilter>("all")

  useEffect(() => {
    console.log("[Notifications] Subscribing to inventory items...")
    console.log("[Notifications] Using Firebase:", process.env.NEXT_PUBLIC_USE_FIREBASE === "1")

    const unsubscribe = InventoryService.subscribeToItems(
      (items) => {
        console.log("[Notifications] Received items:", items.length)
        if (items.length === 0) {
          console.warn("[Notifications] No items received from Firebase. Check Firebase connection and permissions.")
        }

        // Normalize field names first (same as inventory dashboard)
        const normalizedItems = items.map((it: any) => {
          const incoming = it.incoming ?? it.stockIncoming ?? it.incomingStock ?? 0
          const outgoing = it.outgoing ?? it.stockOutgoing ?? it.outgoingStock ?? 0
          const stockBase =
            it.stock ?? it.stockLeft ?? it.stockQuantity ?? it.stockTotal ?? it.ongoingStock ?? 0
          const returned = it.returned ?? it.returnedStock ?? 0
          const expiry = it.expiryDate ?? it.expirationDate ?? null

          return {
            ...it,
            incoming,
            outgoing,
            stock: stockBase,
            returned,
            expirationDate: expiry,
            expiryDate: expiry,
          }
        })

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const expiredItems: ExpiryNotification[] = []
        const expiringTodayItems: ExpiryNotification[] = []
        const expiringSoonItems: ExpiryNotification[] = []
        const lowStockItems: LowStockNotification[] = []

        normalizedItems.forEach((item: any) => {
          try {
            // Use normalized fields for calculations
            const stockBase = Number(item.stock) || 0
            const incoming = Number(item.incoming) || 0
            const outgoing = Number(item.outgoing) || 0
            const returned = Number(item.returned) || 0

            // Calculate total available stock: base stock + incoming - outgoing + returned
            const totalStock = stockBase + incoming - outgoing + returned

            // Debug logging for low stock
            if (totalStock < 20) {
              console.log("[Notifications] Low stock item found:", {
                id: item.id,
                barcode: item.barcode,
                category: item.category,
                stock: stockBase,
                incoming,
                outgoing,
                returned,
                totalStock
              })
            }

            // Check if stock is low (below 20 units)
            if (totalStock < 20 && totalStock >= 0) {
              lowStockItems.push({
                item,
                stockLevel: totalStock,
              })
            }

            // Check for expiry notifications - use normalized expiry field
            const expiryDate = item.expiryDate || item.expirationDate
            if (!expiryDate) {
              // Skip items without expiry date (continue to next item)
              return
            }

            // Handle Firebase Timestamp and various date formats
            let expiry: Date | null = null
            try {
              if (expiryDate && typeof expiryDate.toDate === "function") {
                // Firebase Timestamp object
                expiry = expiryDate.toDate()
              } else if (expiryDate && expiryDate.seconds) {
                // Firebase Timestamp with seconds property
                expiry = new Date(expiryDate.seconds * 1000)
              } else if (expiryDate && expiryDate._seconds) {
                // Firebase Timestamp with _seconds property
                expiry = new Date(expiryDate._seconds * 1000)
              } else if (expiryDate instanceof Date) {
                expiry = expiryDate
              } else if (typeof expiryDate === "string") {
                // Try parsing string date (handles ISO strings and other formats)
                expiry = new Date(expiryDate)
                // If parsing failed, try to extract date from string
                if (isNaN(expiry.getTime())) {
                  // Try to parse common date formats like "November 16, 2025"
                  const dateMatch = expiryDate.match(/(\w+)\s+(\d+),\s+(\d+)/)
                  if (dateMatch) {
                    expiry = new Date(expiryDate)
                  } else {
                    // Try parsing as ISO string or timestamp
                    const timestamp = Date.parse(expiryDate)
                    if (!isNaN(timestamp)) {
                      expiry = new Date(timestamp)
                    }
                  }
                }
              } else if (typeof expiryDate === "number") {
                // Handle timestamp (milliseconds or seconds)
                expiry = expiryDate > 1000000000000
                  ? new Date(expiryDate)
                  : new Date(expiryDate * 1000)
              }

              // Validate date
              if (!expiry || isNaN(expiry.getTime())) {
                console.warn("[Notifications] Invalid expiry date for item:", item.id, "Raw value:", expiryDate)
                return
              }

              expiry.setHours(0, 0, 0, 0)
              const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

              // Debug logging for expiry
              if (daysUntilExpiry <= 30 || daysUntilExpiry < 0) {
                console.log("[Notifications] Expiry item found:", {
                  id: item.id,
                  barcode: item.barcode,
                  category: item.category,
                  daysUntilExpiry,
                  expiryDate: expiry.toISOString()
                })
              }

              if (daysUntilExpiry <= 30 || daysUntilExpiry < 0) {
                if (daysUntilExpiry < 0) {
                  expiredItems.push({ item, daysUntilExpiry, status: "expired" as const })
                } else if (daysUntilExpiry === 0) {
                  expiringTodayItems.push({ item, daysUntilExpiry, status: "expiring-today" as const })
                } else {
                  expiringSoonItems.push({ item, daysUntilExpiry, status: "expiring-soon" as const })
                }
              }
            } catch (dateError) {
              console.warn("[Notifications] Error parsing expiry date:", dateError, "for item:", item.id, "Raw value:", expiryDate)
              // Continue processing other items even if this one fails
            }
          } catch (error) {
            console.warn("[Notifications] Error processing item:", item.id, error)
          }
        })

        // Sort each category
        expiredItems.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
        expiringTodayItems.sort((a, b) => {
          const nameA = (a.item as any).name || a.item.category || ""
          const nameB = (b.item as any).name || b.item.category || ""
          return nameA.localeCompare(nameB)
        })
        expiringSoonItems.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
        lowStockItems.sort((a, b) => a.stockLevel - b.stockLevel)

        // Combine all expiry notifications
        setExpiryNotifications([...expiredItems, ...expiringTodayItems, ...expiringSoonItems])
        setLowStockNotifications(lowStockItems)
        setLoading(false)

        const totalExpiry = expiredItems.length + expiringTodayItems.length + expiringSoonItems.length
        const totalLowStock = lowStockItems.length
        const grandTotal = totalExpiry + totalLowStock

        console.log("[Notifications] Summary:", {
          totalItems: normalizedItems.length,
          lowStockCount: totalLowStock,
          expiredCount: expiredItems.length,
          expiringTodayCount: expiringTodayItems.length,
          expiringSoonCount: expiringSoonItems.length,
          totalExpiryCount: totalExpiry,
          grandTotal: grandTotal
        })

        if (grandTotal === 0 && normalizedItems.length > 0) {
          console.log("[Notifications] No notifications found. Sample item:", normalizedItems[0])
          // Debug: Show why items don't match criteria
          if (normalizedItems.length > 0) {
            const sample = normalizedItems[0]
            const stockBase = Number(sample.stock) || 0
            const incoming = Number(sample.incoming) || 0
            const outgoing = Number(sample.outgoing) || 0
            const returned = Number(sample.returned) || 0
            const total = stockBase + incoming - outgoing + returned
            const expiry = sample.expiryDate || sample.expirationDate
            console.log("[Notifications] Sample item analysis:", {
              barcode: sample.barcode,
              category: sample.category,
              stock: stockBase,
              incoming,
              outgoing,
              returned,
              totalStock: total,
              isLowStock: total < 20,
              hasExpiryDate: !!expiry,
              expiryDate: expiry
            })
          }
        }
      },
      (error) => {
        console.error("[Notifications] Error subscribing to items:", error)
        setLoading(false)
        // Still allow the component to render even if there's an error
      }
    )

    return () => {
      console.log("[Notifications] Unsubscribing from inventory items")
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const getFilteredNotifications = () => {
    const expiredCount = expiryNotifications.filter((n) => n.status === "expired").length
    const expiringCount = expiryNotifications.filter(
      (n) => n.status === "expiring-today" || n.status === "expiring-soon",
    ).length

    switch (filter) {
      case "low-stock":
        return {
          showLowStock: true,
          showExpired: false,
          showExpiring: false,
          filteredExpired: [],
          filteredExpiring: [],
          totalCount: lowStockNotifications.length,
        }
      case "expired":
        return {
          showLowStock: false,
          showExpired: true,
          showExpiring: false,
          filteredExpired: expiryNotifications.filter((n) => n.status === "expired"),
          filteredExpiring: [],
          totalCount: expiredCount,
        }
      case "expiring":
        return {
          showLowStock: false,
          showExpired: false,
          showExpiring: true,
          filteredExpired: [],
          filteredExpiring: expiryNotifications.filter(
            (n) => n.status === "expiring-today" || n.status === "expiring-soon",
          ),
          totalCount: expiringCount,
        }
      default:
        return {
          showLowStock: true,
          showExpired: true,
          showExpiring: true,
          filteredExpired: expiryNotifications.filter((n) => n.status === "expired"),
          filteredExpiring: expiryNotifications.filter(
            (n) => n.status === "expiring-today" || n.status === "expiring-soon",
          ),
          totalCount: lowStockNotifications.length + expiredCount + expiringCount,
        }
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "expired":
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      case "expiring-today":
        return <Clock className="h-4 w-4 text-orange-500" />
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />
    }
  }

  const getStatusText = (notification: ExpiryNotification) => {
    switch (notification.status) {
      case "expired":
        return `Expired ${Math.abs(notification.daysUntilExpiry)} day${Math.abs(notification.daysUntilExpiry) !== 1 ? "s" : ""} ago`
      case "expiring-today":
        return "Expires today"
      default:
        return `Expires in ${notification.daysUntilExpiry} day${notification.daysUntilExpiry !== 1 ? "s" : ""}`
    }
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "expired":
        return "destructive" as const
      case "expiring-today":
        return "secondary" as const
      default:
        return "outline" as const
    }
  }

  const totalNotifications = expiryNotifications.length + lowStockNotifications.length
  const filteredData = getFilteredNotifications()

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 p-0"
          >
            <Bell className="h-5 w-5" />
            {totalNotifications > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs pointer-events-none"
              >
                {totalNotifications > 99 ? "99+" : totalNotifications}
              </Badge>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            {totalNotifications > 0 && (
              <Badge variant="outline" className="ml-2">
                {filter === "all" ? totalNotifications : filteredData.totalCount}
              </Badge>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="p-2">
            <div className="flex items-center gap-1 mb-2">
              <Filter className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Filter:</span>
            </div>
            <div className="flex gap-1">
              <Button
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setFilter("all")}
              >
                All
              </Button>
              <Button
                variant={filter === "low-stock" ? "default" : "outline"}
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setFilter("low-stock")}
              >
                Low Stock
              </Button>
              <Button
                variant={filter === "expired" ? "default" : "outline"}
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setFilter("expired")}
              >
                Expired
              </Button>
              <Button
                variant={filter === "expiring" ? "default" : "outline"}
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setFilter("expiring")}
              >
                Expiring
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading notifications...</div>
          ) : filteredData.totalCount === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {filter === "all" ? "No notifications" : `No ${filter.replace("-", " ")} notifications`}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {filteredData.showLowStock && lowStockNotifications.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs font-medium text-red-600 flex items-center gap-2">
                    <TrendingDown className="h-3 w-3" />
                    Low Stock ({lowStockNotifications.length})
                  </DropdownMenuLabel>
                  {lowStockNotifications.map((notification) => {
                    const categoryDisplay = notification.item.subcategory
                      ? `${notification.item.category} - ${notification.item.subcategory}`
                      : notification.item.category

                    return (
                      <DropdownMenuItem key={`low-stock-${notification.item.id}`} className="flex items-start gap-3 p-3 cursor-pointer">
                        <div className="flex-shrink-0 mt-0.5">
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{categoryDisplay}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            Barcode: {notification.item.barcode}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="destructive" className="text-xs">
                              {notification.stockLevel} units left
                            </Badge>

                          </div>
                        </div>
                      </DropdownMenuItem>
                    )
                  })}
                  {(filteredData.showExpired || filteredData.showExpiring) && <DropdownMenuSeparator />}
                </>
              )}

              {filteredData.showExpired && filteredData.filteredExpired.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs font-medium text-red-600 flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3" />
                    Expired ({filteredData.filteredExpired.length})
                  </DropdownMenuLabel>
                  {filteredData.filteredExpired.map((notification) => {
                    const categoryDisplay = notification.item.subcategory
                      ? `${notification.item.category} - ${notification.item.subcategory}`
                      : notification.item.category

                    return (
                      <DropdownMenuItem key={`expired-${notification.item.id}`} className="flex items-start gap-3 p-3 cursor-pointer">
                        <div className="flex-shrink-0 mt-0.5">{getStatusIcon(notification.status)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{categoryDisplay}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            Barcode: {notification.item.barcode}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={getStatusVariant(notification.status)} className="text-xs">
                              {getStatusText(notification)}
                            </Badge>

                          </div>
                        </div>
                      </DropdownMenuItem>
                    )
                  })}
                  {filteredData.showExpiring && <DropdownMenuSeparator />}
                </>
              )}

              {filteredData.showExpiring && filteredData.filteredExpiring.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs font-medium text-orange-600 flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    Expiring ({filteredData.filteredExpiring.length})
                  </DropdownMenuLabel>
                  {filteredData.filteredExpiring.map((notification) => {
                    const categoryDisplay = notification.item.subcategory
                      ? `${notification.item.category} - ${notification.item.subcategory}`
                      : notification.item.category

                    return (
                      <DropdownMenuItem key={`expiring-${notification.item.id}`} className="flex items-start gap-3 p-3 cursor-pointer">
                        <div className="flex-shrink-0 mt-0.5">{getStatusIcon(notification.status)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{categoryDisplay}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            Barcode: {notification.item.barcode}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={getStatusVariant(notification.status)} className="text-xs">
                              {getStatusText(notification)}
                            </Badge>

                          </div>
                        </div>
                      </DropdownMenuItem>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
