"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EditItemDialog } from "./edit-item-dialog"
import type { InventoryItem, InventoryTransaction, Category } from "@/lib/types"
import { formatTimestamp, formatExpirationDate } from "@/lib/utils"
import { ChevronLeft, ChevronRight, ChevronDown, Pencil, Trash2, Loader2, Barcode } from "lucide-react"
import { getItemStatus } from "./inventory-dashboard"
import { buildProductDisplayName } from "@/lib/product-data"
import { useToast } from "@/hooks/use-toast"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import { TransactionService } from "@/services/firebase-service"
import { FirebaseService } from "@/services/firebase-service"
import { BarcodeModal } from "./barcode-modal"

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

// ─── NEW badge threshold: 10 minutes ─────────────────────────────────────────
const NEW_BADGE_THRESHOLD_MS = 10 * 60 * 1000

/** Returns true if this item was added within the last 10 minutes */
function isRecentlyAdded(item: any): boolean {
  if (!item.createdAt) return false
  try {
    const createdAt =
      item.createdAt instanceof Date
        ? item.createdAt
        : item.createdAt?.toDate
          ? item.createdAt.toDate()
          : new Date(item.createdAt)
    return Date.now() - createdAt.getTime() < NEW_BADGE_THRESHOLD_MS
  } catch {
    return false
  }
}

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
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [recentItemIds, setRecentItemIds] = useState<Set<string>>(new Set())
  const [barcodeViewItem, setBarcodeViewItem] = useState<{ barcode: string; productName: string } | null>(null)

  // ─── Scroll-aware indicators ────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showBottomIndicator, setShowBottomIndicator] = useState(false)
  const [showScrollHint, setShowScrollHint] = useState(false)
  const hasScrolledOnce = useRef(false)
  const itemRowRefs = useRef<Map<string, HTMLElement>>(new Map())

  const itemsPerPage = 50

  // Sort transactions by date (newest first)
  const sortedTransactions = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const dateA = a.transaction_date instanceof Date ? a.transaction_date : a.transaction_date?.toDate ? a.transaction_date.toDate() : new Date(a.transaction_date || 0)
      const dateB = b.transaction_date instanceof Date ? b.transaction_date : b.transaction_date?.toDate ? b.transaction_date.toDate() : new Date(b.transaction_date || 0)
      return dateB.getTime() - dateA.getTime()
    })
  }, [transactions])

  const dataLength = sortedTransactions.length
  const totalPages = Math.max(1, Math.ceil(dataLength / itemsPerPage))
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return sortedTransactions.slice(start, start + itemsPerPage)
  }, [sortedTransactions, currentPage])

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
  }, [paginatedTransactions])

  // Reset to page 1 when items change
  useEffect(() => {
    setCurrentPage(1)
  }, [dataLength])

  // Re-evaluate the NEW badge set every 60 s
  useEffect(() => {
    const evaluate = () => {
      const ids = new Set(items.filter(isRecentlyAdded).map(i => i.id))
      setRecentItemIds(ids)
    }
    evaluate()
    const interval = setInterval(evaluate, 60_000)
    return () => clearInterval(interval)
  }, [items])

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

  const getProductDisplayName = (item: any): string => {
    return buildProductDisplayName(item)
  }

  // Compute average weight per pack and validity status
  const getAvgWeight = (txn: any): { value: number; valid: boolean } => {
    const inPacks = txn.incoming_packs ?? txn.incoming_qty ?? 0
    const inWeight = txn.incoming_weight ?? 0
    const outPacks = txn.outgoing_packs ?? txn.outgoing_qty ?? 0
    const outWeight = txn.outgoing_weight ?? 0
    const packs = inPacks > 0 ? inPacks : outPacks
    const weight = inWeight > 0 ? inWeight : outWeight
    if (packs > 0 && weight > 0) {
      const avg = weight / packs
      return { value: avg, valid: isFinite(avg) && avg > 0 }
    }
    return { value: 0, valid: false }
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
        <p className="text-foreground text-lg font-semibold mb-2">No Transactions Found</p>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          No transactions match your current filters. Try adding inventory items or changing filter settings.
        </p>
      </div>
    )
  }

  // ─── Column definitions ─────────────────────────────────────────────────────
  const COLUMNS = [
    { key: "date", label: "Date", align: "left" as const },
    { key: "movement", label: "Movement Type", align: "left" as const },
    { key: "product", label: "Product Name", align: "left" as const },
    { key: "barcode", label: "Barcode", align: "left" as const },
    { key: "inPacks", label: "Incoming", align: "center" as const },
    { key: "inWeight", label: "Incoming Weight (kg)", align: "center" as const },
    { key: "outPacks", label: "Outgoing", align: "center" as const },
    { key: "outWeight", label: "Outgoing Weight (kg)", align: "center" as const },
    { key: "unitType", label: "Unit Type", align: "center" as const },
    { key: "goodReturn", label: "Good Return", align: "center" as const },
    { key: "damageReturn", label: "Damage Return", align: "center" as const },
    { key: "avg", label: "Avg Weight (kg/pack)", align: "center" as const },
    { key: "status", label: "Status", align: "center" as const },
    { key: "from", label: "From", align: "left" as const },
    { key: "to", label: "To", align: "left" as const },
    { key: "location", label: "Location", align: "left" as const },
    { key: "refNo", label: "Reference No.", align: "left" as const },
    { key: "prodDate", label: "Production Date", align: "left" as const },
    { key: "procDate", label: "Process Date", align: "left" as const },
    { key: "expiry", label: "Expiry Date", align: "left" as const },
    { key: "actions", label: "Actions", align: "right" as const },
  ]

  return (
    <>
      <div className="space-y-4">
        {/* ─── INFO BANNER ──────────────────────────────────────────────────── */}
        <div className="text-xs text-muted-foreground px-1">
          Showing <span className="font-medium text-foreground">{dataLength}</span> transactions
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
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`h-12 px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${
                        col.align === "center" ? "text-center" : "text-left"
                      } ${col.key === "actions" ? "text-right bg-gray-50 dark:bg-muted/50" : ""}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedTransactions.map((txn: any, index: number) => {
                  const isHovered = hoveredRowId === txn.id
                  const movementType = getMovementType(txn)
                  const avgData = getAvgWeight(txn)
                  const inPacks = txn.incoming_packs ?? txn.incoming_qty ?? 0
                  const inWeight = txn.incoming_weight ?? 0
                  const outPacks = txn.outgoing_packs ?? txn.outgoing_qty ?? 0
                  const outWeight = txn.outgoing_weight ?? 0

                  return (
                    <tr
                      key={txn.id}
                      id={`inventory-item-${txn.id}`}
                      className={[
                        "group border-b border-border/40 transition-colors duration-200",
                        isHovered
                          ? "bg-blue-50 dark:bg-blue-950/40 shadow-sm"
                          : index % 2 === 0
                            ? "bg-white dark:bg-card"
                            : "bg-gray-50/50 dark:bg-muted/20",
                        "hover:bg-blue-50/60 dark:hover:bg-blue-950/30",
                      ].join(" ")}
                      onMouseEnter={() => setHoveredRowId(txn.id)}
                      onMouseLeave={() => setHoveredRowId(null)}
                    >
                      {/* Date */}
                      <td className="h-14 px-3 py-3 text-sm text-foreground/70 font-medium align-middle whitespace-nowrap">
                        {formatTxnDate(txn.transaction_date)}
                      </td>

                      {/* Movement Type */}
                      <td className="h-14 px-3 py-3 align-middle whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold border ${getMovementBadgeStyle(movementType)}`}>
                          {movementType}
                        </span>
                      </td>

                      {/* Product Name */}
                      <td className="h-14 px-3 py-3 font-medium text-sm text-foreground align-middle">
                        <span className="line-clamp-1" title={txn.product_name || "\u2014"}>{txn.product_name || <span className="text-muted-foreground">{"\u2014"}</span>}</span>
                      </td>

                      {/* Barcode */}
                      <td className="h-14 px-3 py-3 font-mono text-sm text-foreground align-middle">
                        <div className="truncate" title={txn.barcode || "\u2014"}>{txn.barcode || <span className="text-muted-foreground">{"\u2014"}</span>}</div>
                      </td>

                      {/* Incoming */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {inPacks > 0 ? (
                          <span className="text-green-600 dark:text-green-400">
                            {formatNumber(inPacks)} <span className="text-[11px] font-normal opacity-70">{(txn.incoming_unit || "box") === "box" ? (inPacks === 1 ? "Box" : "Boxes") : (inPacks === 1 ? "Pack" : "Packs")}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Incoming Weight */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {inWeight > 0 ? (
                          <span className="text-green-600 dark:text-green-400">{formatWeight(inWeight)}</span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Outgoing */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {outPacks > 0 ? (
                          <span className="text-red-600 dark:text-red-400">
                            {formatNumber(outPacks)} <span className="text-[11px] font-normal opacity-70">{(txn.outgoing_unit || "pack") === "box" ? (outPacks === 1 ? "Box" : "Boxes") : (outPacks === 1 ? "Pack" : "Packs")}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Outgoing Weight */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {outWeight > 0 ? (
                          <span className="text-red-600 dark:text-red-400">{formatWeight(outWeight)}</span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Unit Type */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {(() => {
                          const ut = deriveUnitType(txn)
                          return ut === "PACK" ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800">
                              PACK
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-800">
                              BOX
                            </span>
                          )
                        })()}
                      </td>

                      {/* Good Return */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {(txn.good_return ?? 0) > 0 ? (
                          <span className="text-green-600 dark:text-green-400">{formatNumber(txn.good_return)}</span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Damage Return */}
                      <td className="text-center h-14 px-2 py-2 font-medium text-sm align-middle">
                        {(txn.damage_return ?? 0) > 0 ? (
                          <span className="text-orange-600 dark:text-orange-400">{formatNumber(txn.damage_return)}</span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Average Weight */}
                      <td className="text-center h-14 px-3 py-3 font-medium text-sm align-middle">
                        {avgData.value > 0 ? (
                          <span className="text-foreground">{avgData.value.toFixed(2)}</span>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="text-center h-14 px-3 py-3 align-middle">
                        {avgData.value > 0 ? (
                          avgData.valid ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800">
                              <span className="w-2 h-2 rounded-full bg-green-500 dark:bg-green-400"></span>
                              Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-800">
                              <span className="w-2 h-2 rounded-full bg-red-500 dark:bg-red-400"></span>
                              Invalid
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground text-xs">{"\u2014"}</span>
                        )}
                      </td>

                      {/* From Location */}
                      <td className="h-14 px-3 py-3 text-sm align-middle whitespace-nowrap">
                        {txn.from_location ? (
                          <div className="truncate max-w-[120px] text-foreground" title={txn.from_location}>{txn.from_location}</div>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* To Location */}
                      <td className="h-14 px-3 py-3 text-sm align-middle whitespace-nowrap">
                        {txn.to_location ? (
                          <div className="truncate max-w-[120px] text-foreground" title={txn.to_location}>{txn.to_location}</div>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="h-14 px-2 py-2 font-medium text-sm align-middle whitespace-nowrap">
                        {txn.location ? (
                          <div className="truncate max-w-[120px] text-foreground" title={txn.location}>{txn.location}</div>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Reference No. */}
                      <td className="h-14 px-2 py-2 font-mono text-xs align-middle whitespace-nowrap">
                        {txn.reference_no ? (
                          <div className="truncate max-w-[140px] text-foreground" title={txn.reference_no}>{txn.reference_no}</div>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>

                      {/* Production Date */}
                      <td className="h-14 px-2 py-2 text-sm align-middle whitespace-nowrap">
                        {(() => {
                          const v = formatDateFull(txn.production_date)
                          return v === "\u2014" ? <span className="text-muted-foreground">{"\u2014"}</span> : <span className="text-foreground">{v}</span>
                        })()}
                      </td>

                      {/* Process Date */}
                      <td className="h-14 px-2 py-2 text-sm align-middle whitespace-nowrap">
                        {(() => {
                          const v = formatDateFull(txn.process_date)
                          return v === "\u2014" ? <span className="text-muted-foreground">{"\u2014"}</span> : <span className="text-foreground">{v}</span>
                        })()}
                      </td>

                      {/* Expiry Date */}
                      <td className="h-14 px-2 py-2 text-sm align-middle whitespace-nowrap">
                        {(() => {
                          const expiryDate = txn.expiry_date
                          if (!expiryDate) {
                            return <span className="text-muted-foreground">{"\u2014"}</span>
                          }
                          try {
                            const date = expiryDate instanceof Date ? expiryDate
                              : expiryDate?.toDate ? expiryDate.toDate()
                              : new Date(expiryDate)
                            if (isNaN(date.getTime())) return <span className="text-muted-foreground">{"\u2014"}</span>
                            const formatted = formatDateFull(date)
                            const today = new Date(); today.setHours(0, 0, 0, 0)
                            const expiry = new Date(date); expiry.setHours(0, 0, 0, 0)
                            if (expiry < today) return <span className="text-red-600 dark:text-red-400 font-medium">{formatted}</span>
                            return <span className="text-foreground">{formatted}</span>
                          } catch {
                            return <span className="text-muted-foreground">{"\u2014"}</span>
                          }
                        })()}
                      </td>

                      {/* Actions — Always visible inline buttons */}
                      <td className="h-14 px-3 py-2 align-middle whitespace-nowrap">
                        <div className="flex items-center gap-1.5 justify-end">
                          {txn.barcode && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2.5 gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-950/30"
                              onClick={() => setBarcodeViewItem({ barcode: txn.barcode, productName: txn.product_name || "Unknown Product" })}
                              title="View Barcode"
                            >
                              <Barcode className="h-3.5 w-3.5" />
                              Barcode
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 gap-1.5 text-xs font-medium text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            onClick={() => setEditingItem(txn as any)}
                            title="Edit Transaction"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 gap-1.5 text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => setCancellingItem(txn as any)}
                            title="Delete Transaction"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
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

        {/* "Scroll for more" hint — auto-hides after first scroll */}
        {showScrollHint && paginatedTransactions.length > 0 && (
          <div
            className={`absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-white/90 dark:bg-gray-800/90 border border-border/60 shadow-md text-xs text-muted-foreground backdrop-blur-sm z-20 transition-opacity ${!showScrollHint ? 'scroll-hint-hidden' : ''}`}
          >
            <span>Scroll for more</span>
            <ChevronDown className="h-3 w-3 scroll-hint-chevron" />
          </div>
        )}

        {/* ─── MOBILE / TABLET CARD VIEW ─────────────────────────────────── */}
        <div className="lg:hidden space-y-4">
          {paginatedTransactions.map((txn: any, index: number) => {
            const movementType = getMovementType(txn)
            const avgData = getAvgWeight(txn)
            const inPacks = txn.incoming_packs ?? txn.incoming_qty ?? 0
            const inWeight = txn.incoming_weight ?? 0
            const outPacks = txn.outgoing_packs ?? txn.outgoing_qty ?? 0
            const outWeight = txn.outgoing_weight ?? 0

            return (
              <div
                key={txn.id}
                id={`inventory-item-${txn.id}`}
                className={[
                  "border rounded-xl p-4 transition-all duration-200",
                  index % 2 === 0
                    ? "border-border/50 bg-white dark:bg-card"
                    : "border-border/50 bg-gray-50/70 dark:bg-muted/30",
                  "hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700",
                ].join(" ")}
              >
                <div className="space-y-3">
                  {/* Header: Date + Movement Type + Edit Button */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground font-medium">{formatTxnDate(txn.transaction_date)}</p>
                      <h3 className="font-semibold text-sm text-foreground line-clamp-2">{txn.product_name || "-"}</h3>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold border ${getMovementBadgeStyle(movementType)}`}>
                        {movementType}
                      </span>
                    </div>
                  </div>

                  {/* Barcode + Location */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground text-xs">Barcode:</span>
                      <p className="font-mono text-xs">{txn.barcode || "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">Location:</span>
                      <p className="text-xs">{txn.location || "Not Set"}</p>
                    </div>
                  </div>

                  {/* Unit Type Badge */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                    <span className="text-xs text-muted-foreground">Unit Type:</span>
                    {(() => {
                      const ut = deriveUnitType(txn)
                      return ut === "PACK" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800">
                          PACK
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-800">
                          BOX
                        </span>
                      )
                    })()}
                  </div>

                  {/* Incoming / Outgoing */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Incoming</span>
                      {inPacks > 0 ? (
                        <span className="text-green-600 dark:text-green-400 font-semibold">{formatNumber(inPacks)} <span className="text-[10px] font-normal opacity-70">{(txn.incoming_unit || "box") === "box" ? (inPacks === 1 ? "Box" : "Boxes") : (inPacks === 1 ? "Pack" : "Packs")}</span></span>
                      ) : (
                        <span className="text-muted-foreground">{"\u2014"}</span>
                      )}
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Incoming Weight</span>
                      <span className="text-green-600 dark:text-green-400 font-semibold">{formatWeight(inWeight)} kg</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Outgoing</span>
                      {outPacks > 0 ? (
                        <span className="text-red-600 dark:text-red-400 font-semibold">{formatNumber(outPacks)} <span className="text-[10px] font-normal opacity-70">{(txn.outgoing_unit || "pack") === "box" ? (outPacks === 1 ? "Box" : "Boxes") : (outPacks === 1 ? "Pack" : "Packs")}</span></span>
                      ) : (
                        <span className="text-muted-foreground">{"\u2014"}</span>
                      )}
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Outgoing Weight</span>
                      <span className="text-red-600 dark:text-red-400 font-semibold">{formatWeight(outWeight)} kg</span>
                    </div>
                  </div>

                  {/* Returns */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Good Return</span>
                      <span className="text-green-600 dark:text-green-400 font-semibold">{formatNumber(txn.good_return)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Damage Return</span>
                      <span className="text-orange-600 dark:text-orange-400 font-semibold">{formatNumber(txn.damage_return)}</span>
                    </div>
                  </div>

                  {/* Avg Weight + Status */}
                  <div className="pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-muted-foreground">Avg Weight:</span>
                        <span className="ml-1 text-sm font-semibold">
                          {avgData.value > 0 ? `${avgData.value.toFixed(2)} kg/pack` : "-"}
                        </span>
                      </div>
                      {avgData.value > 0 && (
                        avgData.valid ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            Valid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            Invalid
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  {/* Reference + Dates */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40 text-xs">
                    <div>
                      <span className="text-muted-foreground">Ref No:</span>
                      <p className="font-mono">{txn.reference_no || "-"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Production:</span>
                      <p>{formatDateFull(txn.production_date)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Process:</span>
                      <p>{formatDateFull(txn.process_date)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expiry:</span>
                      <p>{formatDateFull(txn.expiry_date)}</p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border/40">
                    {txn.barcode && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2.5 gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:text-emerald-300 dark:hover:bg-emerald-950/30"
                        onClick={() => setBarcodeViewItem({ barcode: txn.barcode, productName: txn.product_name || "Unknown Product" })}
                      >
                        <Barcode className="h-3.5 w-3.5" />
                        Barcode
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2.5 gap-1.5 text-xs font-medium text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      onClick={() => setEditingItem(txn as any)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2.5 gap-1.5 text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => setCancellingItem(txn as any)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
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
              <span className="font-medium text-foreground">{dataLength}</span> transactions
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
    </>
  )
}
