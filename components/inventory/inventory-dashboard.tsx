"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Package, TrendingUp, TrendingDown, AlertTriangle, Search, X, Plus, ArrowDownUp, Clock, PackageMinus, ScanLine, Tag, RotateCcw, Filter, CalendarClock, Layers } from "lucide-react"
import { TodaysMovementIcon, StockOverviewIcon, ReturnsSummaryIcon, FastMovingIcon } from "./inventory-icons"
import { Button } from "@/components/ui/button"
import { InventoryTable } from "./inventory-table"
import { AddItemDialog } from "./add-item-dialog"
import { OutgoingStockDialog } from "./outgoing-stock-dialog"
import { ReturnItemDialog } from "./return-item-dialog"
import { ScanItemDialog } from "./scan-item-dialog"
import { InventoryService, CategoryService, TransactionService } from "@/services/firebase-service"
import type { InventoryItem, InventoryTransaction, Category } from "@/lib/types"
import { CATEGORIES, TYPES, getTypesForCategory } from "@/lib/product-data"
import { calculateWeeklyChange, calculateWeeklyCountChange, formatWeeklyChange, parseFirestoreDate } from "@/lib/weekly-change-utils"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/hooks/use-auth"
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner"
import { InventoryDashboardSkeleton } from "@/components/skeletons/dashboard-skeleton"
import { ToastAction } from "@/components/ui/toast"

// ——— Recently Added filter options ———————————————————————————————————————————

const RECENTLY_ADDED_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
]

// ——— Stock Status filter options ———————————————————————————————————————————
const STOCK_STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "in-stock", label: "In Stock" },
  { value: "low-stock", label: "Low Stock" },
  { value: "out-of-stock", label: "Out of Stock" },
]

// ——— Expiration filter options ———————————————————————————————————————————
const EXPIRATION_OPTIONS = [
  { value: "all", label: "All" },
  { value: "expiring-soon", label: "Expiring Soon" },
  { value: "expired", label: "Expired" },
]

// ——— Sort options ———————————————————————————————————————————
const SORT_OPTIONS = [
  { value: "date-desc", label: "Newest First" },
  { value: "date-asc", label: "Oldest First" },
  { value: "expiry-asc", label: "Expiry: Soonest" },
  { value: "expiry-desc", label: "Expiry: Latest" },
  { value: "stock-asc", label: "Stock: Low → High" },
  { value: "stock-desc", label: "Stock: High → Low" },
]

/** Returns the cutoff Date for a given recently-added filter value. */
function getRecentlyCutoff(filter: string): Date | null {
  const now = new Date()
  switch (filter) {
    case "today": {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return start
    }
    case "week": return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case "month": return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    default: return null
  }
}

// ——— Status helpers (kept for summary cards, not for filtering) ——————————————

export type ItemStatus = "all" | "in-stock" | "low-stock" | "out-of-stock" | "expiring-soon" | "expired"

/** Derives the computed status of an inventory item from stockLeft and expirationDate. */
export function getItemStatus(item: any): Exclude<ItemStatus, "all"> {
  const incoming = item.incoming ?? item.stockIncoming ?? item.incomingStock ?? 0
  const outgoing = item.outgoing ?? item.stockOutgoing ?? item.outgoingStock ?? 0
  const goodReturn = item.goodReturnStock ?? 0
  const damageReturn = item.damageReturnStock ?? 0
  const stockLeft = Math.max(0, incoming - outgoing + goodReturn - damageReturn)

  // Check expiration first — these states take priority over stock level
  const expiryDate = item.expiryDate ?? item.expirationDate ?? null
  if (expiryDate) {
    try {
      const d = expiryDate instanceof Date ? expiryDate
        : expiryDate?.toDate ? expiryDate.toDate()
          : new Date(expiryDate)
      if (!isNaN(d.getTime())) {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const expiry = new Date(d); expiry.setHours(0, 0, 0, 0)
        if (expiry < today) return "expired"
        const sevenDays = new Date(today); sevenDays.setDate(today.getDate() + 7)
        if (expiry <= sevenDays) return "expiring-soon"
      }
    } catch { /* ignore */ }
  }

  if (stockLeft === 0) return "out-of-stock"
  if (stockLeft <= 5) return "low-stock"
  return "in-stock"
}

export function InventoryDashboard() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const { isGuest } = useAuth()

  // ——— Filter state ————————————————————————————————————————————————————————
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedType, setSelectedType] = useState<string>("all")
  const [recentlyAddedFilter, setRecentlyAddedFilter] = useState<string>("all")
  const [stockStatusFilter, setStockStatusFilter] = useState<string>("all")
  const [expirationFilter, setExpirationFilter] = useState<string>("all")
  // Search: real-time debounced
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [debouncedSearch, setDebouncedSearch] = useState<string>("")
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sort mode
  const [sortMode, setSortMode] = useState<string>("date-desc")
  // Rows per page
  const [rowsPerPage, setRowsPerPage] = useState<number>(10)
  const [loading, setLoading] = useState(true)
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false)
  const [outgoingDialogOpen, setOutgoingDialogOpen] = useState(false)
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)
  const [scanDialogOpen, setScanDialogOpen] = useState(false)
  // Scanned item passed from ScanItemDialog to outgoing/add-item dialogs
  const [scannedItem, setScannedItem] = useState<InventoryItem | null>(null)
  // Barcode captured by USB scanner — passed into ScanItemDialog as initialBarcode
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null)
  // Track newly added item IDs for animation & auto-scroll
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set())
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const previousItemsRef = useRef<Set<string>>(new Set())
  const scrollToItemIdRef = useRef<string | null>(null)
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize filters from query param
  useEffect(() => {
    const initialFilter = searchParams.get("filter")
    if (initialFilter) {
      if (initialFilter === "low-stock" || initialFilter === "out-of-stock") {
        setStockStatusFilter(initialFilter)
      } else if (initialFilter === "expiring" || initialFilter === "expiring-soon") {
        setExpirationFilter("expiring-soon")
      }
    }
  }, [searchParams])

  // Clear query param whenever a filter is removed manually
  const clearQueryParam = useCallback(() => {
    if (searchParams.toString()) {
      router.replace(window.location.pathname, { scroll: false })
    }
  }, [router, searchParams])

  // ── Global USB barcode scanner listener ────────────────────────────────
  // Disabled when any dialog is already open so it doesn't interfere with
  // barcode input fields inside dialogs.
  const anyDialogOpen = scanDialogOpen || addItemDialogOpen || outgoingDialogOpen || returnDialogOpen

  useBarcodeScanner({
    onScan: useCallback((barcode: string) => {
      console.log("[Global Scanner] Barcode detected:", barcode)
      setPendingBarcode(barcode)
      setScanDialogOpen(true)
    }, []),
    minLength: 5,
    maxKeystrokeDelay: 80,
    bufferTimeout: 400,
    enabled: !anyDialogOpen && !isGuest,
  })

  // When Category changes, reset Type
  const handleCategoryChange = useCallback((value: string) => {
    setSelectedCategory(value)
    setSelectedType("all")
  }, [])

  // Real-time debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value)
    }, 300)
  }, [])

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  // Reset all filters
  const resetAllFilters = useCallback(() => {
    setSelectedCategory("all")
    setSelectedType("all")
    setRecentlyAddedFilter("all")
    setStockStatusFilter("all")
    setExpirationFilter("all")
    setSearchQuery("")
    setDebouncedSearch("")
    setSortMode("date-desc")
    clearQueryParam()
  }, [clearQueryParam])

  // Check if any filter is active
  const hasActiveFilters = selectedCategory !== "all" || selectedType !== "all" || recentlyAddedFilter !== "all" || stockStatusFilter !== "all" || expirationFilter !== "all" || debouncedSearch !== ""

  // Available types based on selected category
  const availableTypes = useMemo(() => {
    if (selectedCategory === "all") {
      // Show all base types when no category is selected
      return [...TYPES] as string[]
    }
    return getTypesForCategory(selectedCategory)
  }, [selectedCategory])

  useEffect(() => {
    console.log("[Inventory Dashboard] Subscribing to inventory items...")
    console.log("[Inventory Dashboard] Using LIVE Firebase (not mock-firestore)")

    // Subscribe to real-time inventory updates from Firebase
    const unsubscribeItems = InventoryService.subscribeToItems(
      (updatedItems) => {
        console.log("[Inventory Dashboard] Received items from Firebase:", updatedItems.length)
        console.log("[Inventory Dashboard] Sample item (first):", updatedItems[0])

        if (updatedItems.length === 0) {
          console.warn("[Inventory Dashboard] No items received! Check Firebase connection and permissions.")
          setItems([])
          setLoading(false)
          return
        }

        // Normalize legacy field names so data from existing Firestore shows correctly
        const normalized = updatedItems.map((it: any) => {
          const incoming = it.incoming ?? it.stockIncoming ?? it.incomingStock ?? 0
          const outgoing = it.outgoing ?? it.stockOutgoing ?? it.outgoingStock ?? 0
          const stockBase =
            it.stock ?? it.stockLeft ?? it.stockQuantity ?? it.stockTotal ?? it.ongoingStock ?? 0
          const returned = it.returned ?? it.returnedStock ?? 0
          const goodReturnStock = it.goodReturnStock ?? 0
          const damageReturnStock = it.damageReturnStock ?? 0
          // Extract expiryDate - prefer expiryDate over expirationDate, preserve original Firestore Timestamp object
          const expiry = it.expiryDate ?? it.expirationDate ?? null
          // Parse createdAt - handle both Date objects and Firestore Timestamps
          const createdAt = it.createdAt
            ? (it.createdAt instanceof Date ? it.createdAt : it.createdAt.toDate ? it.createdAt.toDate() : new Date(it.createdAt))
            : new Date()

          // Preserve all Firebase fields including name, stability, qualityStatus, etc.
          return {
            ...it, // Preserve ALL original fields from Firebase
            incoming,
            outgoing,
            stock: stockBase,
            ongoingStock: stockBase, // Keep ongoingStock for display
            returned,
            goodReturnStock,
            damageReturnStock,
            // Ensure expiryDate is always set (even if null) for consistent access
            expirationDate: expiry,
            expiryDate: expiry ?? it.expiryDate, // Prefer normalized value, fallback to original
            name: it.name ?? it.itemName ?? "", // Support various name field names
            stability: it.stability ?? "", // Include stability field
            qualityStatus: it.qualityStatus ?? it.quality ?? "GOOD", // Include quality status
            updatedAt: it.updatedAt ?? it.lastUpdated ?? it.createdAt ?? new Date(), // Last updated timestamp
            createdAt, // Ensure createdAt is always a Date object
          }
        })

        // Sort by createdAt descending (newest first) — always maintain base order
        const sorted = normalized.sort((a: any, b: any) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt || 0).getTime()
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt || 0).getTime()
          return bTime - aTime // Descending order (newest first)
        })

        // Detect new items (items that weren't in previousItemsRef)
        const currentItemIds = new Set(sorted.map((item: any) => item.id))
        const newItems = sorted.filter((item: any) => !previousItemsRef.current.has(item.id))

        // Initialize previousItemsRef on first load (to avoid showing toast for existing items)
        const isFirstLoad = previousItemsRef.current.size === 0

        // Mark new items for animation and trigger auto-scroll
        if (newItems.length > 0 && !isFirstLoad) {
          const ids = new Set(newItems.map((i: any) => i.id))

          // Clear any previous animation timer
          if (animationTimerRef.current) {
            clearTimeout(animationTimerRef.current)
          }

          setNewItemIds(ids)
          // Auto-scroll to the newest item
          scrollToItemIdRef.current = newItems[0].id

          // Clear animation highlight after 4.5 s
          animationTimerRef.current = setTimeout(() => {
            setNewItemIds(new Set())
          }, 4500)

          // Show toast notification for newly added items
          const newestItem = newItems[0] // Already sorted by createdAt descending
          const itemName = newestItem.name || newestItem.category || "New item"

          toast({
            title: "✅ Item successfully added",
            description: `${itemName} has been added to inventory.`,
            action: (
              <ToastAction
                altText="View Item"
                onClick={() => {
                  // Set scroll target
                  scrollToItemIdRef.current = newestItem.id

                  // Check if we're already on inventory page
                  if (typeof window !== "undefined" && window.location.pathname === "/inventory") {
                    // Already on inventory page, trigger scroll immediately
                    setTimeout(() => {
                      const rowElement = document.getElementById(`inventory-item-${newestItem.id}`)
                      if (rowElement) {
                        rowElement.scrollIntoView({ behavior: "smooth", block: "center" })
                        scrollToItemIdRef.current = null
                      }
                    }, 300)
                  } else {
                    // Navigate to inventory page - scroll will happen via scrollToItemId prop
                    router.push("/inventory")
                  }
                }}
              >
                View Item
              </ToastAction>
            ),
          })
        }

        // Update previous items ref
        previousItemsRef.current = currentItemIds

        console.log("[Inventory Dashboard] Normalized items count:", sorted.length)
        console.log("[Inventory Dashboard] Sample normalized item:", sorted[0])
        setItems(sorted as InventoryItem[])
        setLoading(false)
      },
      (error) => {
        console.error("[Inventory Dashboard] Error subscribing to items:", error)
        setLoading(false)
        // Don't clear items on error, keep existing data
      }
    )

    // Load categories (for filtering only)
    const loadCategories = async () => {
      try {
        const categoriesData = await CategoryService.getCategories()
        setCategories(categoriesData)
      } catch (error) {
        console.error("Error loading categories:", error)
      }
    }

    loadCategories()

    // Subscribe to transactions collection for the table
    const unsubscribeTransactions = TransactionService.subscribeToTransactions(
      (txns) => {
        console.log("[Inventory Dashboard] Received transactions from Firebase:", txns.length)
        // Normalize created_at to Date objects for sorting
        const normalized = txns.map((t: any) => ({
          ...t,
          created_at: t.created_at instanceof Date ? t.created_at
            : t.created_at?.toDate ? t.created_at.toDate()
            : new Date(t.created_at || 0),
          transaction_date: t.transaction_date instanceof Date ? t.transaction_date
            : t.transaction_date?.toDate ? t.transaction_date.toDate()
            : t.transaction_date ? new Date(t.transaction_date) : new Date(),
        }))
        // Sort by created_at descending (newest first)
        normalized.sort((a: any, b: any) => {
          const aTime = a.created_at instanceof Date ? a.created_at.getTime() : 0
          const bTime = b.created_at instanceof Date ? b.created_at.getTime() : 0
          return bTime - aTime
        })

        // IMPORTANT: Pass ALL transactions to the table — do NOT dedup by barcode.
        // The inventory-table groups transactions by barcode and needs ALL records
        // (incoming, outgoing, return) to compute correct totals and Movement Origin.
        setTransactions(normalized as InventoryTransaction[])
      },
      (error) => {
        console.error("[Inventory Dashboard] Error subscribing to transactions:", error)
      }
    )

    return () => {
      unsubscribeItems()
      unsubscribeTransactions()
      if (animationTimerRef.current) clearTimeout(animationTimerRef.current)
    }
  }, [])

  // Filter items by category, type, search query, stock status, expiration, and recently added
  const filteredItems = useMemo(() => {
    const recentlyCutoff = getRecentlyCutoff(recentlyAddedFilter)

    const filtered = items.filter((item) => {
      // Category filter — match item.category against selected category
      if (selectedCategory !== "all") {
        const itemCategory = (item.category || "").trim()
        if (itemCategory.toLowerCase() !== selectedCategory.toLowerCase()) return false
      }

      // Type filter — match item.productType against selected type
      if (selectedType !== "all") {
        const itemType = ((item as any).productType || "").trim()
        if (itemType.toLowerCase() !== selectedType.toLowerCase()) return false
      }

      // Search filter - real-time debounced search by name, barcode
      if (debouncedSearch.trim()) {
        const query = debouncedSearch.toLowerCase().trim()
        const itemName = (item.name || "").toLowerCase()
        const itemBarcode = (item.barcode || "").toLowerCase()
        const itemProductName = ((item as any).productName || "").toLowerCase()
        const itemId = (item.id || "").toLowerCase()

        const matchesSearch =
          itemName.includes(query) ||
          itemBarcode.includes(query) ||
          itemProductName.includes(query) ||
          itemId.includes(query)

        if (!matchesSearch) return false
      }

      // Stock Status filter
      if (stockStatusFilter !== "all") {
        const status = getItemStatus(item)
        if (stockStatusFilter === "in-stock" && status !== "in-stock") return false
        if (stockStatusFilter === "low-stock" && status !== "low-stock") return false
        if (stockStatusFilter === "out-of-stock" && status !== "out-of-stock") return false
      }

      // Expiration filter
      if (expirationFilter !== "all") {
        const status = getItemStatus(item)
        if (expirationFilter === "expiring-soon" && status !== "expiring-soon") return false
        if (expirationFilter === "expired" && status !== "expired") return false
      }

      // Recently Added filter
      if (recentlyCutoff) {
        let createdAt: Date
        if (item.createdAt instanceof Date) {
          createdAt = item.createdAt
        } else if ((item.createdAt as any)?.toDate) {
          createdAt = (item.createdAt as any).toDate()
        } else {
          createdAt = new Date(item.createdAt as any)
        }
        if (isNaN(createdAt.getTime())) return false
        if (createdAt < recentlyCutoff) return false
      }

      return true
    })

    return filtered // Sorting is now handled by sortMode
  }, [items, selectedCategory, selectedType, debouncedSearch, stockStatusFilter, expirationFilter, recentlyAddedFilter])

  // Filter transactions for the table display (one row per transaction)
  const filteredTransactions = useMemo(() => {
    const recentlyCutoff = getRecentlyCutoff(recentlyAddedFilter)

    const filtered = transactions.filter((txn) => {
      // Category filter
      if (selectedCategory !== "all") {
        if ((txn.category || "").trim().toLowerCase() !== selectedCategory.toLowerCase()) return false
      }
      // Type filter
      if (selectedType !== "all") {
        if ((txn.type || "").trim().toLowerCase() !== selectedType.toLowerCase()) return false
      }
      // Search filter (real-time debounced)
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase().trim()
        const matches =
          (txn.product_name || "").toLowerCase().includes(q) ||
          (txn.barcode || "").toLowerCase().includes(q) ||
          (txn.reference_no || "").toLowerCase().includes(q)
        if (!matches) return false
      }
      // Recently Added filter
      if (recentlyCutoff) {
        const createdAt = txn.created_at instanceof Date ? txn.created_at : new Date(txn.created_at || 0)
        if (isNaN(createdAt.getTime()) || createdAt < recentlyCutoff) return false
      }
      return true
    })

    return filtered // Sorting handled by sortMode in the table
  }, [transactions, selectedCategory, selectedType, debouncedSearch, recentlyAddedFilter])

  console.log("[Inventory Dashboard] Total items:", items.length, "Filtered items:", filteredItems.length, "Category:", selectedCategory, "Type:", selectedType, "Search:", debouncedSearch)

  const totalItems = items.length
  // Calculate total stock using correct formula: incomingStock - outgoingStock + goodReturnStock - damageReturnStock
  const totalStock = items.reduce((sum, item) => {
    const incomingStock = (item as any).incoming ?? 0
    const outgoingStock = (item as any).outgoing ?? 0
    const goodReturnStock = (item as any).goodReturnStock ?? 0
    const damageReturnStock = (item as any).damageReturnStock ?? 0
    const stockLeft = incomingStock - outgoingStock + goodReturnStock - damageReturnStock
    return sum + Math.max(0, Number.isFinite(stockLeft) ? stockLeft : 0)
  }, 0)

  // Filter low stock items using correct formula
  const lowStockItems = items.filter((item) => {
    const incomingStock = (item as any).incoming ?? 0
    const outgoingStock = (item as any).outgoing ?? 0
    const goodReturnStock = (item as any).goodReturnStock ?? 0
    const damageReturnStock = (item as any).damageReturnStock ?? 0
    const stockLeft = incomingStock - outgoingStock + goodReturnStock - damageReturnStock
    return stockLeft < 10
  }).length

  const nearExpiryItems = items.filter((item) => {
    if (!item.expirationDate) return false
    const expiryDate = new Date(item.expirationDate)
    const today = new Date()
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiry <= 7 && daysUntilExpiry >= 0
  }).length

  // Compute today's returns from transactions
  const todayReturns = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    let goodReturns = 0
    let damagedReturns = 0
    transactions.forEach((txn) => {
      const txDate = txn.transaction_date instanceof Date
        ? txn.transaction_date
        : txn.transaction_date?.toDate ? txn.transaction_date.toDate()
        : new Date(txn.transaction_date || 0)
      if (isNaN(txDate.getTime()) || txDate < todayStart) return
      goodReturns += (txn.good_return ?? 0)
      damagedReturns += (txn.damage_return ?? 0)
    })
    return { good: goodReturns, damaged: damagedReturns, total: goodReturns + damagedReturns }
  }, [transactions])

  // Compute today's transactions (incoming, outgoing, and returns)
  const todayTransactions = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    let incoming = 0
    let outgoing = 0
    let returns = 0
    transactions.forEach((txn) => {
      const txDate = txn.transaction_date instanceof Date
        ? txn.transaction_date
        : txn.transaction_date?.toDate ? txn.transaction_date.toDate()
        : new Date(txn.transaction_date || 0)
      if (isNaN(txDate.getTime()) || txDate < todayStart) return
      incoming += (txn.incoming_qty ?? 0)
      outgoing += (txn.outgoing_qty ?? 0)
      returns += (txn.good_return ?? 0) + (txn.damage_return ?? 0)
    })
    return { incoming, outgoing, returns, total: incoming + outgoing + returns }
  }, [transactions])

  // Compute Low Stock Alert (items with stock < 10, sorted lowest to highest)
  const lowStockAlertList = useMemo(() => {
    const alerts = items.map(item => {
      const incomingStock = (item as any).incoming ?? 0
      const outgoingStock = (item as any).outgoing ?? 0
      const goodReturnStock = (item as any).goodReturnStock ?? 0
      const damageReturnStock = (item as any).damageReturnStock ?? 0
      const stockLeft = incomingStock - outgoingStock + goodReturnStock - damageReturnStock
      return { name: item.name || "Unknown", stock: stockLeft, type: (item as any).unitType === "PACK" ? "pk" : "bx" }
    })
    return alerts
      .filter(item => item.stock < 10)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 3)
  }, [items])

  // Calculate weekly changes using correct stock formula
  const totalStockWeeklyChange = useMemo(() => {
    return calculateWeeklyChange({
      items,
      getValue: (item) => {
        const incomingStock = (item as any).incoming ?? 0
        const outgoingStock = (item as any).outgoing ?? 0
        const goodReturnStock = (item as any).goodReturnStock ?? 0
        const damageReturnStock = (item as any).damageReturnStock ?? 0
        return incomingStock - outgoingStock + goodReturnStock - damageReturnStock
      },
      getDate: (item) => parseFirestoreDate((item as any).updatedAt || (item as any).createdAt),
    })
  }, [items])

  const lowStockWeeklyChange = useMemo(() => {
    return calculateWeeklyCountChange({
      items,
      getDate: (item) => parseFirestoreDate((item as any).updatedAt || (item as any).createdAt),
      currentWeekCount: lowStockItems,
      filter: (item) => {
        const incomingStock = (item as any).incoming ?? 0
        const outgoingStock = (item as any).outgoing ?? 0
        const goodReturnStock = (item as any).goodReturnStock ?? 0
        const damageReturnStock = (item as any).damageReturnStock ?? 0
        const stockLeft = incomingStock - outgoingStock + goodReturnStock - damageReturnStock
        return stockLeft < 10
      },
    })
  }, [items, lowStockItems])

  // Build active filter tags
  const activeFilterTags = useMemo(() => {
    const tags: { key: string; label: string; onRemove: () => void }[] = []
    if (selectedCategory !== "all") {
      tags.push({ key: "category", label: selectedCategory, onRemove: () => { setSelectedCategory("all"); setSelectedType("all") } })
    }
    if (selectedType !== "all") {
      tags.push({ key: "type", label: selectedType, onRemove: () => setSelectedType("all") })
    }
    if (stockStatusFilter !== "all") {
      const label = STOCK_STATUS_OPTIONS.find(o => o.value === stockStatusFilter)?.label || stockStatusFilter
      tags.push({ key: "stock", label, onRemove: () => { setStockStatusFilter("all"); clearQueryParam(); } })
    }
    if (expirationFilter !== "all") {
      const label = EXPIRATION_OPTIONS.find(o => o.value === expirationFilter)?.label || expirationFilter
      tags.push({ key: "expiry", label, onRemove: () => { setExpirationFilter("all"); clearQueryParam(); } })
    }
    if (recentlyAddedFilter !== "all") {
      const label = RECENTLY_ADDED_OPTIONS.find(o => o.value === recentlyAddedFilter)?.label || recentlyAddedFilter
      tags.push({ key: "recent", label, onRemove: () => setRecentlyAddedFilter("all") })
    }
    if (debouncedSearch) {
      tags.push({ key: "search", label: `"${debouncedSearch}"`, onRemove: () => { setSearchQuery(""); setDebouncedSearch("") } })
    }
    return tags
  }, [selectedCategory, selectedType, stockStatusFilter, expirationFilter, recentlyAddedFilter, debouncedSearch, clearQueryParam])

  if (loading) {
    return <InventoryDashboardSkeleton />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-50 to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 pb-8">
      <div className="space-y-4 sm:space-y-6 md:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-balance">Inventory Monitoring</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Monitor stock movement, expiration, and barcode management</p>
          </div>
          {!isGuest && (
            <div className="grid grid-cols-4 sm:flex sm:items-center gap-1.5 sm:gap-2 shrink-0">
              <Button onClick={() => setAddItemDialogOpen(true)} className="gap-1 sm:gap-2 h-9 sm:h-10 text-[11px] sm:text-sm px-2 sm:px-4 rounded-lg">
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate">Add Item</span>
              </Button>
              <Button
                onClick={() => setScanDialogOpen(true)}
                className="gap-1 sm:gap-2 h-9 sm:h-10 text-[11px] sm:text-sm px-2 sm:px-4 bg-violet-600 hover:bg-violet-700 text-white rounded-lg"
              >
                <ScanLine className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate">Scan</span>
              </Button>
              <Button
                onClick={() => setOutgoingDialogOpen(true)}
                className="gap-1 sm:gap-2 h-9 sm:h-10 text-[11px] sm:text-sm px-2 sm:px-4 bg-orange-500 hover:bg-orange-600 text-white rounded-lg"
              >
                <PackageMinus className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate">Out</span>
              </Button>
              <Button
                onClick={() => setReturnDialogOpen(true)}
                className="gap-1 sm:gap-2 h-9 sm:h-10 text-[11px] sm:text-sm px-2 sm:px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
              >
                <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate">Return</span>
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-2.5 sm:gap-4 md:gap-5 grid-cols-2 lg:grid-cols-4">
          {/* 1. Today's Transactions */}
          <Card
            className="shadow-sm hover:shadow-md transition-shadow duration-200 cursor-pointer rounded-xl bg-white dark:bg-card"
            onClick={() => {
              setRecentlyAddedFilter("today")
              setDebouncedSearch("")
              setSearchQuery("")
              setSelectedCategory("all")
              setSelectedType("all")
            }}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-[11px] sm:text-sm font-medium text-muted-foreground">Today&apos;s Transactions</CardTitle>
              <TodaysMovementIcon />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              {todayTransactions.total === 0 ? (
                <>
                  <div className="text-2xl sm:text-3xl font-bold text-muted-foreground/40">0</div>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">No transactions today</p>
                </>
              ) : (
                <>
                  <div className="text-2xl sm:text-3xl font-bold tracking-tight">{todayTransactions.total}</div>
                  <div className="flex flex-wrap items-center gap-1 sm:gap-2 mt-1.5 sm:mt-2">
                    <span className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">↑ {todayTransactions.incoming} In</span>
                    <span className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">↓ {todayTransactions.outgoing} Out</span>
                    <span className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">↺ {todayTransactions.returns} Rtn</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 2. Stock Overview */}
          <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 rounded-xl bg-white dark:bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-[11px] sm:text-sm font-medium text-muted-foreground">Stock Overview</CardTitle>
              <StockOverviewIcon />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <div className="text-2xl sm:text-3xl font-bold tracking-tight">{totalStock.toLocaleString()}</div>
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 mt-1.5 sm:mt-2">
                <span className="inline-flex items-center text-[10px] sm:text-xs text-muted-foreground bg-slate-50 dark:bg-slate-900/40 px-1 sm:px-1.5 py-0.5 rounded-md">{totalItems} items</span>
                {lowStockItems > 0 ? (
                  <span className="inline-flex items-center text-[10px] sm:text-xs font-semibold text-orange-600 bg-orange-50 dark:bg-orange-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">⚠ {lowStockItems} low</span>
                ) : (
                  <span className="inline-flex items-center text-[10px] sm:text-xs font-semibold text-green-600 bg-green-50 dark:bg-green-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">✓ All stocked</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 3. Returns Summary */}
          <Card
            className="shadow-sm hover:shadow-md transition-shadow duration-200 cursor-pointer rounded-xl bg-white dark:bg-card"
            onClick={() => {
              setDebouncedSearch("")
              setSearchQuery("")
              setSelectedCategory("all")
              setSelectedType("all")
              setRecentlyAddedFilter("today")
            }}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-[11px] sm:text-sm font-medium text-muted-foreground">Returns Summary</CardTitle>
              <ReturnsSummaryIcon />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              {todayReturns.total === 0 ? (
                <>
                  <div className="text-2xl sm:text-3xl font-bold text-muted-foreground/40">0</div>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">No returns today</p>
                </>
              ) : (
                <>
                  <div className="text-2xl sm:text-3xl font-bold tracking-tight">{todayReturns.total}</div>
                  <div className="flex flex-wrap items-center gap-1 sm:gap-2 mt-1.5 sm:mt-2">
                    <span className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">
                      +{todayReturns.good} Good
                    </span>
                    <span className="inline-flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-1 sm:px-1.5 py-0.5 rounded-md">
                      +{todayReturns.damaged} Bad
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 4. Low Stock Alert */}
          <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 rounded-xl bg-white dark:bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-[11px] sm:text-sm font-medium text-orange-600 dark:text-orange-400">Low Stock Alert</CardTitle>
              <FastMovingIcon />
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              {lowStockAlertList.length === 0 ? (
                <>
                  <div className="text-2xl sm:text-3xl font-bold text-muted-foreground/40">✔</div>
                  <p className="text-[10px] sm:text-xs text-green-600 mt-1">All items have sufficient stock</p>
                </>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {lowStockAlertList.map((p, i) => (
                    <div key={p.name + i} className="flex items-center justify-between gap-1.5 sm:gap-2 p-1 sm:p-1.5 rounded-lg bg-orange-50/60 dark:bg-orange-950/20">
                      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                        <span className="text-[9px] sm:text-[10px] font-bold rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center shrink-0 bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                          !
                        </span>
                        <span className="text-[10px] sm:text-xs font-medium truncate" title={p.name}>{p.name}</span>
                      </div>
                      <span className={`text-[10px] sm:text-xs font-bold shrink-0 px-1 sm:px-1.5 py-0.5 rounded ${p.stock <= 0 ? 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-950/40' : 'text-orange-700 bg-orange-100 dark:text-orange-400 dark:bg-orange-950/40'}`}>{p.stock} {p.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main Content - Inventory Section */}
        <Card className="shadow-sm rounded-xl bg-white dark:bg-card overflow-hidden">
          <CardHeader className="pb-0 px-0 pt-0">
            {/* ═══ TOP HEADER ROW — Title + Search inline ═══ */}
            <div className="flex flex-row items-center justify-between gap-3 px-3 sm:px-4 md:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4">
              <div className="min-w-0 shrink-0">
                <CardTitle className="text-sm sm:text-base md:text-lg font-semibold tracking-tight">Inventory Items</CardTitle>
                <CardDescription className="mt-0.5 text-[10px] sm:text-xs">
                  <span className="font-medium text-foreground">{filteredItems.length}</span> of {totalItems} items
                  {hasActiveFilters && <span className="text-blue-600 dark:text-blue-400 ml-1">• Filtered</span>}
                </CardDescription>
              </div>
              {/* ── Compact search bar — right-aligned, constrained width ── */}
              <div className="relative flex-1 max-w-[320px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                <Input
                  type="text"
                  placeholder="Search products or barcodes…"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 pr-9 h-9 rounded-lg border-gray-200/80 dark:border-border bg-gray-50/60 dark:bg-muted/30 hover:bg-white dark:hover:bg-muted/50 focus:bg-white focus:border-blue-300 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.08)] dark:focus:bg-card transition-all duration-200 text-xs sm:text-[13px] placeholder:text-muted-foreground/50"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                    onClick={() => { setSearchQuery(""); setDebouncedSearch("") }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {/* ═══ UNIFIED FILTER TOOLBAR ═══ */}
            <div className="bg-gray-50/70 dark:bg-muted/20 border-y border-border/40 px-2.5 sm:px-4 md:px-5 py-2 sm:py-3">
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                {/* ── Filter icon label ── */}
                <div className="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-0.5 sm:mr-1 select-none">
                  <Filter className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden sm:inline">Filters</span>
                </div>

                {/* ── Divider ── */}
                <div className="w-px h-6 bg-border/60 mx-0.5" />

                {/* Category */}
                <Select value={selectedCategory} onValueChange={handleCategoryChange}>
                  <SelectTrigger className={`h-8 sm:h-[34px] w-auto min-w-0 sm:min-w-[130px] rounded-lg border text-[11px] sm:text-[13px] font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 ${selectedCategory !== "all"
                    ? "bg-blue-50 border-blue-200 text-blue-700 shadow-[inset_0_1px_0_rgba(59,130,246,0.08)] dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-300"
                    : "bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50"
                    }`}>
                    <Package className={`h-3 w-3 shrink-0 hidden sm:block ${selectedCategory !== "all" ? "text-blue-500" : "text-gray-400"}`} />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories ({totalItems})</SelectItem>
                    {CATEGORIES.map((cat) => {
                      const count = items.filter((item) => {
                        const itemCat = (item.category || "").trim()
                        return itemCat.toLowerCase() === cat.toLowerCase()
                      }).length
                      return (
                        <SelectItem key={cat} value={cat}>
                          {cat} ({count})
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>

                {/* Type */}
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger className={`h-8 sm:h-[34px] w-auto min-w-0 sm:min-w-[110px] rounded-lg border text-[11px] sm:text-[13px] font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 ${selectedType !== "all"
                    ? "bg-amber-50 border-amber-200 text-amber-700 shadow-[inset_0_1px_0_rgba(245,158,11,0.08)] dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-300"
                    : "bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50"
                    }`}>
                    <Tag className={`h-3 w-3 shrink-0 hidden sm:block ${selectedType !== "all" ? "text-amber-500" : "text-gray-400"}`} />
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {availableTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Stock Status */}
                <Select value={stockStatusFilter} onValueChange={setStockStatusFilter}>
                  <SelectTrigger className={`h-8 sm:h-[34px] w-auto min-w-0 sm:min-w-[120px] rounded-lg border text-[11px] sm:text-[13px] font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 ${stockStatusFilter !== "all"
                    ? "bg-sky-50 border-sky-200 text-sky-700 shadow-[inset_0_1px_0_rgba(14,165,233,0.08)] dark:bg-sky-950/40 dark:border-sky-700 dark:text-sky-300"
                    : "bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50"
                    }`}>
                    <Layers className={`h-3 w-3 shrink-0 hidden sm:block ${stockStatusFilter !== "all" ? "text-sky-500" : "text-gray-400"}`} />
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STOCK_STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Expiration */}
                <Select value={expirationFilter} onValueChange={setExpirationFilter}>
                  <SelectTrigger className={`h-8 sm:h-[34px] w-auto min-w-0 sm:min-w-[110px] rounded-lg border text-[11px] sm:text-[13px] font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 ${expirationFilter !== "all"
                    ? "bg-rose-50 border-rose-200 text-rose-700 shadow-[inset_0_1px_0_rgba(244,63,94,0.08)] dark:bg-rose-950/40 dark:border-rose-700 dark:text-rose-300"
                    : "bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50"
                    }`}>
                    <CalendarClock className={`h-3 w-3 shrink-0 hidden sm:block ${expirationFilter !== "all" ? "text-rose-500" : "text-gray-400"}`} />
                    <SelectValue placeholder="Expiry" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRATION_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Date Added */}
                <Select value={recentlyAddedFilter} onValueChange={setRecentlyAddedFilter}>
                  <SelectTrigger className={`h-8 sm:h-[34px] w-auto min-w-0 sm:min-w-[110px] rounded-lg border text-[11px] sm:text-[13px] font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 ${recentlyAddedFilter !== "all"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-[inset_0_1px_0_rgba(16,185,129,0.08)] dark:bg-emerald-950/40 dark:border-emerald-700 dark:text-emerald-300"
                    : "bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50"
                    }`}>
                    <Clock className={`h-3 w-3 shrink-0 hidden sm:block ${recentlyAddedFilter !== "all" ? "text-emerald-500" : "text-gray-400"}`} />
                    <SelectValue placeholder="Date" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECENTLY_ADDED_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* ── Spacer + Divider ── */}
                <div className="hidden sm:block flex-1 min-w-[16px]" />
                <div className="basis-full sm:hidden" />
                <div className="w-px h-6 bg-border/60 mx-0.5 hidden sm:block" />

                {/* ── Sort + Rows inline ── */}
                <div className="flex items-center gap-1 sm:gap-1.5 w-full sm:w-auto">
                  <Select value={sortMode} onValueChange={setSortMode}>
                    <SelectTrigger className={`h-8 sm:h-[34px] w-auto flex-1 sm:flex-none sm:min-w-[140px] rounded-lg border text-[11px] sm:text-[13px] font-medium transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 ${sortMode !== "date-desc"
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-700 dark:text-indigo-300"
                      : "bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50"
                      }`}>
                      <ArrowDownUp className={`h-3 w-3 shrink-0 hidden sm:block ${sortMode !== "date-desc" ? "text-indigo-500" : "text-gray-400"}`} />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={String(rowsPerPage)} onValueChange={(v) => setRowsPerPage(Number(v))}>
                    <SelectTrigger className="h-8 sm:h-[34px] w-[60px] sm:w-[72px] rounded-lg border text-[11px] sm:text-[13px] font-medium bg-white dark:bg-card border-gray-200/80 dark:border-border text-gray-600 dark:text-foreground hover:border-gray-300 hover:bg-gray-50/50 transition-all duration-200 focus:ring-2 focus:ring-blue-500/15 px-1.5 sm:px-2.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 rows</SelectItem>
                      <SelectItem value="20">20 rows</SelectItem>
                      <SelectItem value="50">50 rows</SelectItem>
                      <SelectItem value="100">100 rows</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ── Reset button ── */}
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetAllFilters}
                    className="h-[34px] px-2.5 gap-1.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50/80 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-all duration-200"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                )}
              </div>

              {/* ── Active filter tags — below the toolbar ── */}
              {activeFilterTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-border/30">
                  <span className="text-[11px] text-muted-foreground/70 font-medium uppercase tracking-wider mr-0.5">Active:</span>
                  {activeFilterTags.map(tag => (
                    <span
                      key={tag.key}
                      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50/80 text-blue-700 border border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 transition-all duration-200 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                    >
                      {tag.label}
                      <button
                        onClick={tag.onRemove}
                        className="inline-flex items-center justify-center w-4 h-4 rounded hover:bg-blue-200/80 dark:hover:bg-blue-800 transition-colors ml-0.5"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <button
                    onClick={resetAllFilters}
                    className="text-[11px] font-medium text-muted-foreground/60 hover:text-red-500 transition-colors ml-1 underline decoration-dotted underline-offset-2"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:px-4 md:px-6 pb-4 sm:pb-6 pt-0">
            <InventoryTable
              items={filteredItems}
              transactions={filteredTransactions}
              categories={categories}
              loading={loading}
              scrollToItemId={scrollToItemIdRef.current}
              newItemIds={newItemIds}
              onItemScrolled={() => {
                scrollToItemIdRef.current = null
              }}
              sortMode={sortMode}
              rowsPerPage={rowsPerPage}
              searchQuery={debouncedSearch}
              highlightFilter={searchParams.get("filter") || undefined}
            />
          </CardContent>
        </Card>
      </div>

      {/* Add Item Dialog */}
      <AddItemDialog
        open={addItemDialogOpen}
        onOpenChange={(open) => {
          setAddItemDialogOpen(open)
          if (!open) setScannedItem(null)
        }}
        scannedItem={scannedItem}
      />

      {/* Scan Item Dialog */}
      <ScanItemDialog
        open={scanDialogOpen}
        onOpenChange={(open) => {
          setScanDialogOpen(open)
          // Clear pending barcode when dialog is closed manually
          if (!open) setPendingBarcode(null)
        }}
        inventoryItems={items}
        initialBarcode={pendingBarcode}
        onInitialBarcodeConsumed={() => setPendingBarcode(null)}
        onProductOut={(item) => {
          setScannedItem(item || null)
          setScanDialogOpen(false)
          setOutgoingDialogOpen(true)
        }}
        onReturnItem={(item) => {
          setScannedItem(item || null)
          setScanDialogOpen(false)
          setReturnDialogOpen(true)
        }}
        onRegisterNew={() => {
          setScannedItem(null)
          setScanDialogOpen(false)
          setAddItemDialogOpen(true)
        }}
      />

      {/* Outgoing Stock Dialog */}
      <OutgoingStockDialog
        open={outgoingDialogOpen}
        onOpenChange={(open) => {
          setOutgoingDialogOpen(open)
          if (!open) setScannedItem(null)
        }}
        inventoryItems={items}
        scannedItem={scannedItem}
      />

      {/* Return Item Dialog */}
      <ReturnItemDialog
        open={returnDialogOpen}
        onOpenChange={(open) => {
          setReturnDialogOpen(open)
          if (!open) setScannedItem(null)
        }}
        inventoryItems={items}
        scannedItem={scannedItem}
      />
    </div>
  )
}
