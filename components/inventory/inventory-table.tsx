"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EditItemDialog } from "./edit-item-dialog"
import type { InventoryItem, InventoryTransaction, Category } from "@/lib/types"
import { formatTimestamp, formatExpirationDate } from "@/lib/utils"
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, Trash2, Loader2, Barcode, MessageSquareWarning, Package, History } from "lucide-react"
import { getItemStatus } from "./inventory-dashboard"
import { buildProductDisplayName } from "@/lib/product-data"
import { useToast } from "@/hooks/use-toast"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import { TransactionService } from "@/services/firebase-service"
import { FirebaseService } from "@/services/firebase-service"
import { BarcodeModal } from "./barcode-modal"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface InventoryTableProps {
  items: InventoryItem[]
  transactions?: InventoryTransaction[]
  categories: Category[]
  loading: boolean
  scrollToItemId?: string | null
  onItemScrolled?: () => void
  /** Set of item IDs that were just added — used to trigger highlight animation */
  newItemIds?: Set<string>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a Date or Firestore Timestamp to "MMM DD, YYYY" */
function formatTxnDate(d: any): string {
  if (!d) return "\u2014"
  try {
    const date = d instanceof Date ? d : d?.toDate ? d.toDate() : new Date(d)
    if (isNaN(date.getTime())) return "\u2014"
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${months[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}, ${date.getFullYear()}`
  } catch { return "\u2014" }
}

/** Format a Date to "MM/DD/YYYY" */
function formatDateFull(d: any): string {
  if (!d) return "\u2014"
  try {
    const date = d instanceof Date ? d : d?.toDate ? d.toDate() : new Date(d)
    if (isNaN(date.getTime())) return "\u2014"
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    const year = date.getFullYear()
    return `${month}/${day}/${year}`
  } catch { return "\u2014" }
}

/** Parse a date to a timestamp number for sorting */
function parseDateToMs(d: any): number {
  if (!d) return 0
  try {
    const date = d instanceof Date ? d : d?.toDate ? d.toDate() : new Date(d)
    return isNaN(date.getTime()) ? 0 : date.getTime()
  } catch { return 0 }
}

/** Derive a readable Movement Type from source */
function getMovementType(txn: any): string {
  if (txn.movement_type) return txn.movement_type
  const src = (txn.source || "").toLowerCase()
  if (src === "supplier") return "From Supplier"
  if (src === "production") return "From Production"
  if (src === "customer_return") return "Return"
  if (src === "delivery") return "Outgoing"
  if (src === "packing") return "From Packing"
  return txn.source || "-"
}

/** Movement type badge color */
function getMovementBadgeStyle(type: string): string {
  const t = type.toLowerCase()
  if (t.includes("supplier")) return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800"
  if (t.includes("production")) return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800"
  if (t.includes("packing")) return "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:border-violet-800"
  if (t.includes("outgoing")) return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800"
  if (t.includes("return")) return "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800"
  return "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
}

/** Derive the unit type for a transaction row */
function deriveUnitType(txn: any): string {
  if (txn.unit_type) return txn.unit_type.toUpperCase()
  const inUnit = (txn.incoming_unit || "").toLowerCase()
  const outUnit = (txn.outgoing_unit || "").toLowerCase()
  if (inUnit === "pack" || outUnit === "pack") return "PACK"
  return "BOX" // default
}

// ─── Grouped Product type ────────────────────────────────────────────────────
interface GroupedProduct {
  barcode: string
  productName: string
  category: string
  movementOrigin: string       // How item ENTERED system (Supplier/Production) — NOT latest action
  latestDate: any
  unitType: string
  totalIncoming: number
  totalIncomingWeight: number
  totalOutgoing: number
  totalOutgoingWeight: number
  totalGoodReturn: number
  totalDamageReturn: number
  stockLeft: number
  location: string
  transactions: any[]
  latestBadReturnDetails: any
  // Incoming context fields (from first incoming transaction)
  dateAdded: any
  expiryDate: any
  productionDate: any
  supplierName: string
}

export function InventoryTable({
  items,
  transactions = [],
  categories,
  loading,
  scrollToItemId,
  onItemScrolled,
  newItemIds,
}: InventoryTableProps) {
  const { toast } = useToast()
  const [editingItem, setEditingItem] = useState<InventoryTransaction | null>(null)
  const [cancellingItem, setCancellingItem] = useState<InventoryTransaction | null>(null)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [expandedBarcodes, setExpandedBarcodes] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [barcodeViewItem, setBarcodeViewItem] = useState<{ barcode: string; productName: string } | null>(null)
  const [badReturnDetailsView, setBadReturnDetailsView] = useState<{ productName: string; details: any; quantity: number } | null>(null)

  // ─── Scroll-aware indicators ────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showBottomIndicator, setShowBottomIndicator] = useState(false)
  const [showScrollHint, setShowScrollHint] = useState(false)
  const hasScrolledOnce = useRef(false)
  const itemRowRefs = useRef<Map<string, HTMLElement>>(new Map())

  const itemsPerPage = 50

  // ─── Group transactions by barcode ──────────────────────────────────────
  const groupedProducts: GroupedProduct[] = useMemo(() => {
    // STEP 1: Sort ALL transactions chronologically (oldest first) BEFORE grouping
    // This ensures movementOrigin detection is reliable regardless of Firestore document order
    const sortedTransactions = [...transactions].sort((a: any, b: any) => {
      return parseDateToMs(a.transaction_date) - parseDateToMs(b.transaction_date)
    })

    const groupMap = new Map<string, GroupedProduct>()

    for (const txn of sortedTransactions) {
      const bc = (txn as any).barcode || txn.id
      if (!bc) continue

      if (!groupMap.has(bc)) {
        groupMap.set(bc, {
          barcode: bc,
          productName: (txn as any).product_name || "-",
          category: (txn as any).category || "",
          movementOrigin: "",  // Will be set from the EARLIEST incoming transaction
          latestDate: (txn as any).transaction_date,
          unitType: deriveUnitType(txn),
          totalIncoming: 0,
          totalIncomingWeight: 0,
          totalOutgoing: 0,
          totalOutgoingWeight: 0,
          totalGoodReturn: 0,
          totalDamageReturn: 0,
          stockLeft: 0,
          location: (txn as any).location || "",
          transactions: [],
          latestBadReturnDetails: null,
          dateAdded: null,
          expiryDate: null,
          productionDate: null,
          supplierName: "",
        })
      }

      const group = groupMap.get(bc)!
      group.transactions.push(txn)

      // Accumulate totals
      group.totalIncoming += ((txn as any).incoming_packs ?? (txn as any).incoming_qty ?? 0)
      group.totalIncomingWeight += ((txn as any).incoming_weight ?? 0)
      group.totalOutgoing += ((txn as any).outgoing_packs ?? (txn as any).outgoing_qty ?? 0)
      group.totalOutgoingWeight += ((txn as any).outgoing_weight ?? 0)
      group.totalGoodReturn += ((txn as any).good_return ?? 0)
      group.totalDamageReturn += ((txn as any).damage_return ?? 0)

      // Track latest transaction date
      const txnDateMs = parseDateToMs((txn as any).transaction_date)
      const currentLatestMs = parseDateToMs(group.latestDate)
      if (txnDateMs > currentLatestMs) {
        group.latestDate = (txn as any).transaction_date
        group.location = (txn as any).location || group.location
        group.productName = (txn as any).product_name || group.productName
      }

      // Track bad return details
      if ((txn as any).bad_return_details) {
        group.latestBadReturnDetails = (txn as any).bad_return_details
      }
    }

    // STEP 2: For each group, determine movementOrigin from the EARLIEST incoming transaction
    // Sort each group's transactions by date (newest first for display)
    // AND compute stock from totals
    for (const group of groupMap.values()) {
      // Since we sorted oldest-first during iteration, the first incoming txn in the array
      // IS the chronologically earliest. But let's be explicit:
      const earliestIncoming = group.transactions.find((txn: any) => {
        const mt = getMovementType(txn).toLowerCase()
        return mt.includes("supplier") || mt.includes("production") || mt.includes("packing")
      })
      if (earliestIncoming) {
        group.movementOrigin = getMovementType(earliestIncoming)
        // Extract context fields from the earliest incoming transaction
        group.dateAdded = (earliestIncoming as any).transaction_date || (earliestIncoming as any).created_at || null
        group.expiryDate = (earliestIncoming as any).expiry_date || null
        group.productionDate = (earliestIncoming as any).production_date || null
        group.supplierName = (earliestIncoming as any).supplier_name || ""
        if (!group.location) group.location = (earliestIncoming as any).location || ""
      }

      // Now sort newest-first for display in the UI
      group.transactions.sort((a: any, b: any) => {
        return parseDateToMs(b.transaction_date) - parseDateToMs(a.transaction_date)
      })
      // Stock = totalIncoming - totalOutgoing + totalGoodReturn
      group.stockLeft = group.totalIncoming - group.totalOutgoing + group.totalGoodReturn
    }

    // Sort groups by latest date (newest first)
    return Array.from(groupMap.values()).sort((a, b) => {
      return parseDateToMs(b.latestDate) - parseDateToMs(a.latestDate)
    })
  }, [transactions])

  const dataLength = groupedProducts.length
  const totalPages = Math.max(1, Math.ceil(dataLength / itemsPerPage))
  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return groupedProducts.slice(start, start + itemsPerPage)
  }, [groupedProducts, currentPage])

  // ─── Expand/Collapse ───────────────────────────────────────────────────
  const toggleExpand = useCallback((barcode: string) => {
    setExpandedBarcodes(prev => {
      const next = new Set(prev)
      if (next.has(barcode)) {
        next.delete(barcode)
      } else {
        next.add(barcode)
      }
      return next
    })
  }, [])

  // ─── Scroll detection ────────────────────────────────────────────────────
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (!hasScrolledOnce.current) {
        hasScrolledOnce.current = true
        setShowScrollHint(false)
      }
    }

    const checkOverflow = () => {
      const hasOverflow = container.scrollHeight > container.clientHeight + 4
      setShowBottomIndicator(hasOverflow)
      setShowScrollHint(hasOverflow)
      hasScrolledOnce.current = false
    }
    checkOverflow()

    container.addEventListener("scroll", handleScroll, { passive: true })
    const resizeObserver = new ResizeObserver(checkOverflow)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener("scroll", handleScroll)
      resizeObserver.disconnect()
    }
  }, [paginatedGroups])

  // Reset to page 1 when data changes
  useEffect(() => {
    setCurrentPage(1)
  }, [dataLength])

  // Scroll to item
  useEffect(() => {
    if (!scrollToItemId) return
    const scrollToItem = () => {
      const rowElement = itemRowRefs.current.get(scrollToItemId)
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: "smooth", block: "center" })
        if (onItemScrolled) onItemScrolled()
        return true
      }
      return false
    }
    if (scrollToItem()) return
    const timeoutId = setTimeout(() => {
      if (scrollToItem()) return
      const fallbackElement = document.getElementById(`inventory-item-${scrollToItemId}`)
      if (fallbackElement) {
        fallbackElement.scrollIntoView({ behavior: "smooth", block: "center" })
        if (onItemScrolled) onItemScrolled()
      }
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [scrollToItemId, onItemScrolled, items])

  const formatNumber = (value: number | undefined | null): string => {
    const num = value || 0
    return Math.max(0, num).toLocaleString()
  }

  const formatWeight = (value: number | undefined | null): string => {
    const num = value || 0
    if (num === 0) return "0"
    return num.toFixed(2)
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-muted animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (dataLength === 0) {
    return (
      <div className="text-center py-16 px-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <p className="text-foreground text-lg font-semibold mb-2">No Products Found</p>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          No products match your current filters. Try adding inventory items or changing filter settings.
        </p>
      </div>
    )
  }

  // ─── Summary table columns (context-aware: incoming summary only) ────
  const SUMMARY_COLUMNS = [
    { key: "expand", label: "", align: "center" as const, width: "w-10" },
    { key: "dateAdded", label: "Date Added", align: "left" as const },
    { key: "product", label: "Product Name", align: "left" as const },
    { key: "barcode", label: "Barcode", align: "left" as const },
    { key: "movementOrigin", label: "Movement Origin", align: "left" as const },
    { key: "totalIn", label: "Total In", align: "center" as const },
    { key: "totalInWeight", label: "Total Weight (kg)", align: "center" as const },
    { key: "expiryDate", label: "Expiry Date", align: "left" as const },
    { key: "stockLeft", label: "Stock Left", align: "center" as const },
    { key: "location", label: "Location", align: "left" as const },
    { key: "actions", label: "Actions", align: "right" as const },
  ]



  return (
    <>
      <div className="space-y-4">
        {/* ─── INFO BANNER ──────────────────────────────────────────────────── */}
        <div className="text-xs text-muted-foreground px-1">
          Showing <span className="font-medium text-foreground">{dataLength}</span> products
          {" "}({transactions.length} transactions)
          {totalPages > 1 && <> · Page {currentPage} of {totalPages}</>}
        </div>

        {/* ─── DESKTOP TABLE ───────────────────────────────────────────────── */}
        <div className="hidden lg:block relative rounded-xl border border-border/50 bg-card overflow-hidden shadow-sm">
          <div
            ref={scrollContainerRef}
            className="overflow-auto max-h-[65vh]"
            style={{ scrollbarWidth: "thin" }}
          >
            <table className="w-full text-left">
              <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-muted/50 border-b border-border/60">
                <tr>
                  {SUMMARY_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`h-12 px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${
                        col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"
                      } ${col.width || ""} ${col.key === "actions" ? "bg-gray-50 dark:bg-muted/50" : ""}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedGroups.map((group, groupIndex) => {
                  const isExpanded = expandedBarcodes.has(group.barcode)

                  // Filter: only show outgoing + return in dropdown (not initial incoming)
                  const historyTransactions = group.transactions.filter((txn: any) => {
                    const mt = getMovementType(txn).toLowerCase()
                    return mt.includes("outgoing") || mt.includes("return")
                  })
                  const hasHistory = historyTransactions.length > 0
                  return (
                    <>{/* Fragment for summary + expanded rows */}
                      {/* ═══ SUMMARY ROW ═══ */}
                      <tr
                        key={group.barcode}
                        id={`inventory-item-${group.barcode}`}
                        ref={(el) => { if (el) itemRowRefs.current.set(group.barcode, el) }}
                        className={[
                          "group border-b border-border/40 transition-all duration-200",
                          hasHistory ? "cursor-pointer" : "",
                          isExpanded
                            ? "bg-blue-50/80 dark:bg-blue-950/30 shadow-sm"
                            : groupIndex % 2 === 0
                              ? "bg-white dark:bg-card"
                              : "bg-gray-50/50 dark:bg-muted/20",
                          hasHistory ? "hover:bg-blue-50/60 dark:hover:bg-blue-950/30" : "",
                        ].join(" ")}
                        onClick={() => hasHistory && toggleExpand(group.barcode)}
                        title={hasHistory ? "Click to view transaction history" : ""}      
                      >
                        {/* Expand Icon */}
                        <td className="h-14 px-2 py-2 align-middle text-center w-10">
                          {hasHistory ? (
                            <div className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-all duration-200 ${
                              isExpanded
                                ? "bg-blue-500 text-white shadow-sm"
                                : "bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600"
                            }`}>
                              {isExpanded
                                ? <ChevronUp className="h-3.5 w-3.5" />
                                : <ChevronDown className="h-3.5 w-3.5" />
                              }
                            </div>
                          ) : (
                            <div className="w-6 h-6" />
                          )}
                        </td>

                        {/* Date Added */}
                        <td className="h-14 px-3 py-3 text-sm text-foreground/70 align-middle whitespace-nowrap">
                          {formatTxnDate(group.dateAdded)}
                        </td>

                        {/* Product Name */}
                        <td className="h-14 px-3 py-3 font-medium text-sm text-foreground align-middle">
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-slate-400 shrink-0" />
                            <span className="line-clamp-1" title={group.productName}>{group.productName}</span>
                          </div>
                        </td>

                        {/* Barcode */}
                        <td className="h-14 px-3 py-3 font-mono text-sm text-foreground align-middle">
                          <div className="truncate max-w-[180px]" title={group.barcode}>{group.barcode}</div>
                        </td>

                        {/* Movement Origin */}
                        <td className="h-14 px-3 py-3 align-middle whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {group.movementOrigin ? (
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold border ${getMovementBadgeStyle(group.movementOrigin)}`}>
                                {group.movementOrigin}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">{"\u2014"}</span>
                            )}
                          </div>
                        </td>

                        {/* Total In */}
                        <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                          {group.totalIncoming > 0 ? (
                            <span className="text-green-600 dark:text-green-400 font-semibold">{formatNumber(group.totalIncoming)}</span>
                          ) : (
                            <span className="text-muted-foreground">{"\u2014"}</span>
                          )}
                        </td>

                        {/* Total Weight (incoming) */}
                        <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                          {group.totalIncomingWeight > 0 ? (
                            <span className="text-green-600 dark:text-green-400">{formatWeight(group.totalIncomingWeight)}</span>
                          ) : (
                            <span className="text-muted-foreground">{"\u2014"}</span>
                          )}
                        </td>

                        {/* Expiry Date */}
                        <td className="h-14 px-3 py-3 text-sm align-middle whitespace-nowrap">
                          {formatTxnDate(group.expiryDate) !== "\u2014" ? (
                            <span className="text-foreground/70 text-xs">{formatTxnDate(group.expiryDate)}</span>
                          ) : (
                            <span className="text-muted-foreground">{"\u2014"}</span>
                          )}
                        </td>

                        {/* Stock Left */}
                        <td className="text-center h-14 px-2 py-2 align-middle">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                            group.stockLeft <= 0
                              ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-400"
                              : group.stockLeft <= 5
                                ? "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-400"
                                : "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400"
                          }`}>
                            {formatNumber(group.stockLeft)}
                          </span>
                        </td>

                        {/* Location */}
                        <td className="h-14 px-3 py-3 text-sm align-middle whitespace-nowrap">
                          {group.location ? (
                            <div className="truncate max-w-[100px] text-foreground" title={group.location}>{group.location}</div>
                          ) : (
                            <span className="text-muted-foreground">{"\u2014"}</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="h-14 px-3 py-2 align-middle whitespace-nowrap">
                          <div className="flex items-center gap-1.5 justify-end" onClick={(e) => e.stopPropagation()}>
                            {group.barcode && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2.5 gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-950/30"
                                onClick={() => setBarcodeViewItem({ barcode: group.barcode, productName: group.productName })}
                                title="View Barcode"
                              >
                                <Barcode className="h-3.5 w-3.5" />
                                Barcode
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ═══ EXPANDED TRANSACTION HISTORY (TABLE FORMAT) ═══ */}
                      {isExpanded && hasHistory && (
                        <tr key={`${group.barcode}-expanded`}>
                          <td colSpan={SUMMARY_COLUMNS.length} className="p-0">
                            <div className="bg-slate-50/80 dark:bg-slate-900/30 border-y border-blue-200/60 dark:border-blue-800/40">
                              {/* Sub-table header */}
                              <div className="flex items-center gap-2 px-5 py-2.5 bg-blue-50/80 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900/40">
                                <History className="h-3.5 w-3.5 text-blue-500" />
                                <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                                  Transaction History
                                </span>
                                <span className="text-[10px] text-blue-500/70 ml-1">
                                  ({historyTransactions.length} {historyTransactions.length === 1 ? "record" : "records"})
                                </span>
                              </div>

                              {/* Sub-table: type-specific columns per row */}
                              <div className="overflow-x-auto">
                                {historyTransactions.map((txn: any, txnIdx: number) => {
                                  const movementType = getMovementType(txn)
                                  const mt = movementType.toLowerCase()
                                  const isOutgoing = mt.includes("outgoing")
                                  const isReturn = mt.includes("return")
                                  const outPacks = txn.outgoing_packs ?? txn.outgoing_qty ?? 0
                                  const outWeight = txn.outgoing_weight ?? 0

                                  return (
                                    <div
                                      key={txn.id}
                                      className={[
                                        "border-b border-slate-200/60 dark:border-slate-700/40",
                                        isReturn
                                          ? "bg-teal-50/40 dark:bg-teal-950/10"
                                          : "bg-red-50/20 dark:bg-red-950/5",
                                      ].join(" ")}
                                    >
                                      {/* Row header: date + type badge + actions */}
                                      <div className="flex items-center justify-between px-5 py-2">
                                        <div className="flex items-center gap-3">
                                          <span className="text-xs text-foreground/70 font-medium">{formatTxnDate(txn.transaction_date)}</span>
                                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getMovementBadgeStyle(movementType)}`}>
                                            {movementType}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 gap-1 text-[11px] font-medium text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                            onClick={(e) => { e.stopPropagation(); setEditingItem(txn as any) }}
                                            title="Edit Transaction"
                                          >
                                            <Pencil className="h-3 w-3" />
                                            Edit
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 gap-1 text-[11px] font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                            onClick={(e) => { e.stopPropagation(); setCancellingItem(txn as any) }}
                                            title="Delete Transaction"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                            Delete
                                          </Button>
                                        </div>
                                      </div>

                                      {/* Type-specific detail grid */}
                                      {isOutgoing && (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 px-5 pb-3 text-xs">
                                          <div>
                                            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Quantity</span>
                                            <span className="text-red-600 dark:text-red-400 font-semibold">-{formatNumber(outPacks)} {deriveUnitType(txn) === "PACK" ? "Packs" : "Boxes"}</span>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Weight</span>
                                            <span className="text-foreground font-medium">{outWeight > 0 ? `${formatWeight(outWeight)} kg` : "\u2014"}</span>
                                          </div>
                                          <div>
                                            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Customer</span>
                                            <span className="text-foreground truncate block max-w-[160px]" title={txn.to_location || txn.customer_name || ""}>
                                              {txn.to_location || txn.customer_name || "\u2014"}
                                            </span>
                                          </div>
                                          {txn.reference_no && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">DR / SI No.</span>
                                              <span className="text-foreground font-mono truncate block max-w-[140px]" title={txn.reference_no}>{txn.reference_no}</span>
                                            </div>
                                          )}
                                          {txn.location && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">From Location</span>
                                              <span className="text-foreground">{txn.from_location || txn.location}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {isReturn && (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2 px-5 pb-3 text-xs">
                                          {(txn.good_return ?? 0) > 0 && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Good Return</span>
                                              <span className="text-green-600 dark:text-green-400 font-semibold">+{formatNumber(txn.good_return)}</span>
                                            </div>
                                          )}
                                          {(txn.damage_return ?? 0) > 0 && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Bad Return</span>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setBadReturnDetailsView({
                                                    productName: txn.product_name || "Unknown Product",
                                                    details: txn.bad_return_details || null,
                                                    quantity: txn.damage_return ?? 0,
                                                  })
                                                }}
                                                className="text-red-600 dark:text-red-400 font-semibold underline underline-offset-2 decoration-dotted cursor-pointer"
                                              >
                                                {formatNumber(txn.damage_return)}
                                              </button>
                                            </div>
                                          )}
                                          {txn.bad_return_details?.reason && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Return Reason</span>
                                              <span className="text-red-600 dark:text-red-400 font-medium">{txn.bad_return_details.reason}</span>
                                            </div>
                                          )}
                                          <div>
                                            <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Customer</span>
                                            <span className="text-foreground">{txn.customer_name || "\u2014"}</span>
                                          </div>
                                          {txn.reference_no && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Reference No.</span>
                                              <span className="text-foreground font-mono">{txn.reference_no}</span>
                                            </div>
                                          )}
                                          {txn.location && (
                                            <div>
                                              <span className="text-muted-foreground block text-[10px] uppercase tracking-wider">Location</span>
                                              <span className="text-foreground">{txn.location}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Dynamic bottom gradient overlay */}
        {showBottomIndicator && (
          <div
            className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none rounded-b-xl transition-opacity duration-300"
            style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.5) 50%, transparent 100%)' }}
          />
        )}

        {/* "Scroll for more" hint */}
        {showScrollHint && paginatedGroups.length > 0 && (
          <div
            className={`absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-white/90 dark:bg-gray-800/90 border border-border/60 shadow-md text-xs text-muted-foreground backdrop-blur-sm z-20 transition-opacity ${!showScrollHint ? 'scroll-hint-hidden' : ''}`}
          >
            <span>Scroll for more</span>
            <ChevronDown className="h-3 w-3 scroll-hint-chevron" />
          </div>
        )}

        {/* ─── MOBILE / TABLET CARD VIEW ─────────────────────────────────── */}
        <div className="lg:hidden space-y-3">
          {paginatedGroups.map((group, index) => {
            const isExpanded = expandedBarcodes.has(group.barcode)

            // Filter: only show outgoing + return in dropdown (not initial incoming)
            const historyTransactions = group.transactions.filter((txn: any) => {
              const mt = getMovementType(txn).toLowerCase()
              return mt.includes("outgoing") || mt.includes("return")
            })
            const hasHistory = historyTransactions.length > 0

            return (
              <div
                key={group.barcode}
                className={[
                  "border rounded-xl overflow-hidden transition-all duration-200",
                  isExpanded
                    ? "border-blue-300 dark:border-blue-700 shadow-md"
                    : "border-border/50 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-sm",
                ].join(" ")}
              >
                {/* Summary Card (clickable) */}
                <div
                  className={[
                    "p-4 transition-colors",
                    hasHistory ? "cursor-pointer" : "",
                    isExpanded
                      ? "bg-blue-50/60 dark:bg-blue-950/20"
                      : "bg-white dark:bg-card",
                    hasHistory ? "hover:bg-blue-50/30" : "",
                  ].join(" ")}
                  onClick={() => hasHistory && toggleExpand(group.barcode)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm text-foreground line-clamp-1">{group.productName}</h3>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{group.barcode}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {group.movementOrigin ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getMovementBadgeStyle(group.movementOrigin)}`}>
                          {group.movementOrigin}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">{"\u2014"}</span>
                      )}
                      {hasHistory ? (
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                          isExpanded ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"
                        }`}>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/40">
                    <div className="text-center">
                      <span className="text-[10px] text-muted-foreground block">Total In</span>
                      <span className="text-xs font-semibold text-green-600">{group.totalIncoming > 0 ? formatNumber(group.totalIncoming) : "\u2014"}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] text-muted-foreground block">Weight</span>
                      <span className="text-xs font-semibold text-foreground/70">{group.totalIncomingWeight > 0 ? `${formatWeight(group.totalIncomingWeight)} kg` : "\u2014"}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-[10px] text-muted-foreground block">Stock Left</span>
                      <span className={`text-xs font-bold ${group.stockLeft <= 0 ? "text-red-600" : group.stockLeft <= 5 ? "text-orange-600" : "text-emerald-600"}`}>
                        {formatNumber(group.stockLeft)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded: Transaction history */}
                {isExpanded && hasHistory && (
                  <div className="border-t border-blue-200/60 bg-slate-50/60 dark:bg-slate-900/20">
                    <div className="flex items-center gap-2 px-4 py-2 bg-blue-50/60 border-b border-blue-100/60">
                      <History className="h-3 w-3 text-blue-500" />
                      <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">
                        History ({historyTransactions.length})
                      </span>
                    </div>
                    <div className="divide-y divide-border/40">
                      {historyTransactions.map((txn: any) => {
                        const movementType = getMovementType(txn)
                        const mt = movementType.toLowerCase()
                        const isOutgoing = mt.includes("outgoing")
                        const isReturn = mt.includes("return")
                        const outPacks = txn.outgoing_packs ?? txn.outgoing_qty ?? 0
                        const outWeight = txn.outgoing_weight ?? 0

                        const borderColor = isOutgoing ? "border-l-red-500" : "border-l-teal-500"

                        return (
                          <div
                            key={txn.id}
                            className={`px-4 py-3 border-l-[3px] ${borderColor} ${
                              isReturn ? "bg-teal-50/30" : "bg-red-50/15"
                            }`}
                          >
                            {/* Header: Date + Badge + Actions */}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] text-muted-foreground font-medium">{formatTxnDate(txn.transaction_date)}</span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border ${getMovementBadgeStyle(movementType)}`}>
                                  {movementType}
                                </span>
                                {isOutgoing && outPacks > 0 && (
                                  <span className="text-xs font-semibold text-red-600">
                                    −{formatNumber(outPacks)} {(txn.outgoing_unit || "box") === "box" ? "Box" : "Pack"}
                                    {outWeight > 0 && <span className="text-[10px] font-normal text-red-500/70 ml-0.5">({formatWeight(outWeight)} kg)</span>}
                                  </span>
                                )}
                                {isReturn && (
                                  <>
                                    {(txn.good_return ?? 0) > 0 && (
                                      <span className="text-xs font-semibold text-green-600">+{formatNumber(txn.good_return)} Good</span>
                                    )}
                                    {(txn.damage_return ?? 0) > 0 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setBadReturnDetailsView({
                                            productName: txn.product_name || "Unknown",
                                            details: txn.bad_return_details || null,
                                            quantity: txn.damage_return ?? 0,
                                          })
                                        }}
                                        className="text-xs font-semibold text-red-600 underline underline-offset-2 decoration-dotted"
                                      >
                                        +{formatNumber(txn.damage_return)} Damaged
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setEditingItem(txn as any) }}>
                                  <Pencil className="h-3 w-3 text-muted-foreground" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); setCancellingItem(txn as any) }}>
                                  <Trash2 className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </div>
                            </div>
                            {/* Contextual details */}
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[10px]">
                              {isOutgoing && (
                                <>
                                  {(txn.to_location || txn.customer_name) && <span className="text-muted-foreground">Customer: {txn.to_location || txn.customer_name}</span>}
                                  {txn.from_location && <span className="text-muted-foreground">From: {txn.from_location}</span>}
                                  {txn.reference_no && <span className="text-muted-foreground font-mono">DR/SI: {txn.reference_no}</span>}
                                  {txn.location && !txn.from_location && <span className="text-muted-foreground">📍 {txn.location}</span>}
                                </>
                              )}
                              {isReturn && (
                                <>
                                  {txn.customer_name && <span className="text-muted-foreground">Customer: {txn.customer_name}</span>}
                                  {txn.reference_no && <span className="text-muted-foreground font-mono">Ref: {txn.reference_no}</span>}
                                  {txn.bad_return_details?.reason && <span className="text-red-500">Reason: {txn.bad_return_details.reason}</span>}
                                  {txn.location && <span className="text-muted-foreground">📍 {txn.location}</span>}
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-4 border-t border-border/40 bg-gray-50/50 dark:bg-muted/20 rounded-b-xl mt-[-1px]">
            <div className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{((currentPage - 1) * itemsPerPage) + 1}</span> to{" "}
              <span className="font-medium text-foreground">{Math.min(currentPage * itemsPerPage, dataLength)}</span> of{" "}
              <span className="font-medium text-foreground">{dataLength}</span> products
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-10 px-4"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-10 px-4"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <EditItemDialog
        transaction={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      />

      <ConfirmationDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null) }}
        title="Cancel Transaction"
        description="Are you sure you want to cancel this transaction? This action cannot be undone."
        confirmLabel="Yes, Cancel Transaction"
        cancelLabel="No"
        variant="danger"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return
          setCancelLoading(true)
          try {
            await FirebaseService.deleteDocument("transactions", cancellingItem.id)
            toast({
              title: "✅ Transaction Cancelled",
              description: `Transaction for "${(cancellingItem as any).product_name || 'Unknown'}" has been removed.`,
            })
            setCancellingItem(null)
          } catch (error: any) {
            console.error("[InventoryTable] Cancel transaction error:", error)
            toast({
              title: "❌ Failed to Cancel",
              description: error?.message || "Something went wrong. Please try again.",
              variant: "destructive",
            })
          } finally {
            setCancelLoading(false)
          }
        }}
      >
        {cancellingItem && (
          <div className="rounded-lg border border-red-200 bg-red-50/60 dark:bg-red-950/20 dark:border-red-800 p-3 text-sm space-y-1.5">
            <div className="flex gap-2">
              <span className="text-muted-foreground text-xs font-semibold uppercase w-16 shrink-0">Product</span>
              <span className="font-medium text-foreground">{(cancellingItem as any).product_name || '—'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground text-xs font-semibold uppercase w-16 shrink-0">Barcode</span>
              <span className="font-mono text-xs text-foreground">{(cancellingItem as any).barcode || '—'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground text-xs font-semibold uppercase w-16 shrink-0">Type</span>
              <span className="font-medium text-foreground">{getMovementType(cancellingItem)}</span>
            </div>
          </div>
        )}
      </ConfirmationDialog>

      <BarcodeModal
        open={!!barcodeViewItem}
        onOpenChange={(open) => { if (!open) setBarcodeViewItem(null) }}
        barcode={barcodeViewItem?.barcode || ""}
        productName={barcodeViewItem?.productName || ""}
      />

      {/* Bad Return Details Modal */}
      <Dialog open={!!badReturnDetailsView} onOpenChange={(open) => { if (!open) setBadReturnDetailsView(null) }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquareWarning className="h-5 w-5 text-red-500" />
              Bad Return Details
            </DialogTitle>
          </DialogHeader>
          {badReturnDetailsView && (
            <div className="space-y-3 pt-1">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Product</span>
                  <span className="font-medium text-slate-800 text-right max-w-[200px] truncate">{badReturnDetailsView.productName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Quantity</span>
                  <span className="font-bold text-red-600">{badReturnDetailsView.quantity}</span>
                </div>
              </div>
              {badReturnDetailsView.details ? (
                <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reason</span>
                    <span className="font-semibold text-red-700 text-right max-w-[200px]">{badReturnDetailsView.details.reason || "—"}</span>
                  </div>
                  {badReturnDetailsView.details.notes && (
                    <div className="grid gap-1">
                      <span className="text-slate-500 text-xs">Notes</span>
                      <p className="text-slate-700 text-sm bg-white rounded-md border border-red-100 px-3 py-2">{badReturnDetailsView.details.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-sm text-slate-400">
                  No reason recorded for this bad return.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
