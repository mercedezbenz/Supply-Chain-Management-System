"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  PackageOpen,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  PackageMinus,
  Loader2,
  Lock,
  Package,
  Scale,
  ShieldCheck,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "sonner"
import {
  InventoryService,
  TransactionService,
} from "@/services/firebase-service"
import type { InventoryItem } from "@/lib/types"
import { performFifoCheck } from "./fifo-warning-dialog"

// ---
// Types
// ---

interface OutgoingStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventoryItems: InventoryItem[]
  scannedItem?: InventoryItem | null
}

// ---
// Helpers
// ---

function resolveStockLeft(item: InventoryItem): number {
  const incoming = (item as any).incoming ?? (item as any).incomingStock ?? 0
  const outgoing = (item as any).outgoing ?? (item as any).outgoingStock ?? 0
  const goodReturn = (item as any).goodReturnStock ?? 0
  const damageReturn = (item as any).damageReturnStock ?? 0
  return Math.max(0, incoming - outgoing + goodReturn - damageReturn)
}

function getProductName(item: InventoryItem): string {
  if (item.name) return item.name
  if (item.subcategory) return `${item.category} - ${item.subcategory}`
  return item.category
}

function getExpiryDateObj(val: any): Date | null {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (val.seconds) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function getCreatedAtObj(val: any): Date | null {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (val.seconds) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function isDateNearExpiry(val: any): boolean {
  const expiry = getExpiryDateObj(val);
  if (!expiry) return false;
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays <= 90;
}

// ---
// Weight tally helpers
// ---

type TallyStatus = "tally" | "not-tally" | "no-data"

function getWeightTally(item: InventoryItem): {
  productionWeight: number | null
  packingWeight: number | null
  difference: number | null
  status: TallyStatus
} {
  const pw = (item as any).production_weight ?? null
  const pkw = (item as any).packing_weight ?? null
  if (pw === null || pw === undefined) {
    return { productionWeight: null, packingWeight: pkw, difference: null, status: "no-data" }
  }
  if (pkw === null || pkw === undefined) {
    return { productionWeight: pw, packingWeight: null, difference: null, status: "no-data" }
  }
  const diff = Math.abs(Number(pw) - Number(pkw))
  return {
    productionWeight: Number(pw),
    packingWeight: Number(pkw),
    difference: diff,
    status: diff <= 5 ? "tally" : "not-tally",
  }
}

// Inline reusable weight tally display block
function WeightTallyBlock({ item, compact = false }: { item: InventoryItem; compact?: boolean }) {
  const { productionWeight, packingWeight, difference, status } = getWeightTally(item)

  if (status === "no-data" && productionWeight === null && packingWeight === null) return null

  return (
    <div
      className={cn(
        "rounded-xl border p-4 flex flex-col gap-2",
        status === "not-tally"
          ? "bg-red-50 border-red-200"
          : status === "tally"
            ? "bg-emerald-50 border-emerald-200"
            : "bg-slate-50 border-slate-200"
      )}
    >
      {/* Weight rows */}
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        <div className="flex items-center justify-between gap-2 bg-white/60 rounded-lg px-3 py-2 border border-white/80">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Production Wt.</span>
          <span className="text-sm font-bold text-slate-800">
            {productionWeight !== null ? `${Number(productionWeight).toFixed(1)} kg` : "N/A"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 bg-white/60 rounded-lg px-3 py-2 border border-white/80">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Packing Wt.</span>
          <span className="text-sm font-bold text-slate-800">
            {packingWeight !== null ? `${Number(packingWeight).toFixed(1)} kg` : "N/A"}
          </span>
        </div>
      </div>

      {/* Tally status */}
      {status !== "no-data" && difference !== null && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-current/10">
          <span className="text-xs font-medium text-slate-500">Difference: {difference.toFixed(1)} kg</span>
          <div className="flex items-center gap-1.5">
            {status === "tally" ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Tally ✅
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold bg-red-100 text-red-700 border border-red-300">
                <AlertTriangle className="h-3 w-3" /> Not Tally ⚠️
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---
// Component
// ---

export function OutgoingStockDialog({
  open,
  onOpenChange,
  inventoryItems,
  scannedItem,
}: OutgoingStockDialogProps) {
  const { user } = useAuth()

  // State
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [quantity, setQuantity] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [detectedUnit, setDetectedUnit] = useState<"box" | "pack">("box")
  const [unitLoading, setUnitLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [filterType, setFilterType] = useState<"all" | "near_expiry" | "pork" | "chicken" | "beef">("all")
  const [sortBy, setSortBy] = useState<"added_desc" | "added_asc" | "expiry_asc" | "expiry_desc">("added_desc")
  const [showWeightWarning, setShowWeightWarning] = useState(false)

  // FIFO status is computed automatically from selectedItem — no manual state needed

  // Items with stock > 0
  const availableItems = useMemo(
    () =>
      inventoryItems
        .filter((item) => resolveStockLeft(item) > 0)
        .sort((a, b) => getProductName(a).localeCompare(getProductName(b))),
    [inventoryItems]
  )

  // Search, Filter, and Sort
  const filteredItems = useMemo(() => {
    let result = availableItems;

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (item) =>
          getProductName(item).toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          (item.subcategory || "").toLowerCase().includes(q) ||
          (item.barcode || "").toLowerCase().includes(q)
      )
    }

    if (filterType === "near_expiry") {
      result = result.filter(item => {
         const val = (item as any).expiryDate || (item as any).expirationDate;
         return isDateNearExpiry(val);
      })
    } else if (filterType !== "all") {
      result = result.filter(item => {
        const typeStr = [
          (item as any).productType,
          item.category,
          item.subcategory,
          getProductName(item)
        ].join(" ").toLowerCase();
        return typeStr.includes(filterType);
      })
    }

    result = [...result].sort((a, b) => {
       if (sortBy === "added_desc" || sortBy === "added_asc") {
         const aTime = getCreatedAtObj(a.createdAt)?.getTime() || 0;
         const bTime = getCreatedAtObj(b.createdAt)?.getTime() || 0;
         return sortBy === "added_desc" ? bTime - aTime : aTime - bTime;
       }
       if (sortBy === "expiry_asc" || sortBy === "expiry_desc") {
         const aExp = getExpiryDateObj((a as any).expiryDate || (a as any).expirationDate)?.getTime() || Infinity;
         const bExp = getExpiryDateObj((b as any).expiryDate || (b as any).expirationDate)?.getTime() || Infinity;
         return sortBy === "expiry_asc" ? aExp - bExp : bExp - aExp;
       }
       return 0;
    })

    return result;
  }, [availableItems, search, filterType, sortBy])

  const stockLeft = selectedItem ? resolveStockLeft(selectedItem) : 0
  const quantityNum = Math.max(0, Number(quantity) || 0)

  // Reset
  const reset = useCallback(() => {
    setSelectedItem(null)
    setQuantity("")
    setSearch("")
    setFilterType("all")
    setSortBy("added_desc")
    setErrors({})
    setDetectedUnit("box")
    setUnitLoading(false)
    setShowWeightWarning(false)
  }, [])

  // Product select — detect unit from transactions
  const handleProductSelect = useCallback(
    async (item: InventoryItem) => {
      setSelectedItem(item)
      setQuantity("")
      setErrors({})
      setUnitLoading(true)
      try {
        const txn = await TransactionService.findByBarcode(item.barcode || "")
        if (txn && (txn as any).incoming_unit) {
          setDetectedUnit((txn as any).incoming_unit as "box" | "pack")
        } else {
          setDetectedUnit("box")
        }
      } catch {
        setDetectedUnit("box")
      } finally {
        setUnitLoading(false)
      }
    },
    []
  )

  // Compute FIFO status automatically whenever selectedItem changes
  const fifoStatus = selectedItem
    ? performFifoCheck(selectedItem, inventoryItems)
    : null

  // Open/close effects
  useEffect(() => {
    if (!open) {
      reset()
    } else if (scannedItem) {
      handleProductSelect(scannedItem)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Quantity change handler
  const handleQuantityChange = (rawValue: string) => {
    if (rawValue === "") {
      setQuantity("")
      setErrors((p) => ({ ...p, quantity: "" }))
      return
    }
    const num = parseInt(rawValue, 10)
    if (isNaN(num) || num < 0) return
    setQuantity(String(num))
    if (num > stockLeft) {
      setErrors((p) => ({
        ...p,
        quantity: `Cannot exceed available stock (${stockLeft}).`,
      }))
    } else {
      setErrors((p) => ({ ...p, quantity: "" }))
    }
  }

  // Submit — simple stock deduction
  const handleConfirm = async () => {
    // Validate
    const newErrors: Record<string, string> = {}
    if (!selectedItem) {
      newErrors.product = "Please select a product."
    }
    if (!quantityNum || quantityNum <= 0) {
      newErrors.quantity = "Quantity must be greater than 0."
    } else if (quantityNum > stockLeft) {
      newErrors.quantity = `Cannot exceed available stock (${stockLeft}).`
    }
    if (unitLoading) {
      newErrors.unit = "Please wait — detecting unit."
    }

    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return
    if (!user || !selectedItem) return

    // Weight tally check — show warning before proceeding
    if (!showWeightWarning && selectedItem) {
      const tally = getWeightTally(selectedItem)
      if (tally.status === "not-tally") {
        setShowWeightWarning(true)
        return
      }
    }
    setShowWeightWarning(false)

    setLoading(true)
    try {
      const newStockLeft = stockLeft - quantityNum

      // 1. Update inventory item
      await InventoryService.updateItem(selectedItem.id, {
        outgoing: ((selectedItem as any).outgoing ?? 0) + quantityNum,
        stock: newStockLeft,
        total: newStockLeft,
      } as any)

      // 2. Create transaction ledger entry (append-only)
      await TransactionService.addTransaction({
        transaction_date: new Date(),
        product_name: getProductName(selectedItem),
        barcode: selectedItem.barcode || "",
        category: selectedItem.category,
        type:
          (selectedItem as any).productType ||
          (selectedItem as any).subcategory ||
          "",
        unit_type: detectedUnit.toUpperCase(),
        incoming_qty: 0,
        incoming_packs: 0,
        outgoing_qty: quantityNum,
        outgoing_packs: quantityNum,
        outgoing_unit: detectedUnit,
        avg_weight: 0,
        good_return: 0,
        damage_return: 0,
        stock_left: newStockLeft,
        expiry_date:
          (selectedItem as any).expiryDate ||
          (selectedItem as any).expirationDate ||
          null,
        reference_no: "",
        source: "delivery",
        created_at: new Date(),
      } as any)

      toast.success("Success", {
        description: "Product successfully released (stock out).",
      })

      reset()
      onOpenChange(false)
    } catch (error: any) {
      console.error("[ProductOut] Error:", error)
      toast.error("Error", {
        description: "Something went wrong. Please try again.",
      })
    } finally {
      setLoading(false)
    }
  }

  const unitLabel = detectedUnit === "pack" ? "Packs" : "Boxes"

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ── WIDER MODAL: max-w-3xl ── */}
      <DialogContent className="!w-[98vw] sm:!w-[95vw] !max-w-3xl !p-0 !overflow-hidden flex flex-col max-h-[90vh]">

        {/* ── HEADER (sticky) ── */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600 shrink-0">
                <PackageMinus className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold text-slate-800">Product Out</DialogTitle>
                <DialogDescription className="text-xs mt-0.5 text-slate-500">
                  {selectedItem
                    ? "Enter quantity to deduct from stock"
                    : "Select a product with available stock to proceed"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* ── BODY (scrollable) ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-5">
            {!selectedItem ? (
              /* ═══ STEP 1: Product Selection ═══ */
              <div className="grid gap-4">

                {/* ── Search + Filters Row ── */}
                <div className="flex flex-col sm:flex-row gap-2">
                  {/* Search */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search by name, category, or barcode..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-10 w-full"
                      autoFocus
                    />
                  </div>

                  {/* Filter + Sort */}
                  <div className="flex gap-2 shrink-0">
                    <Select value={filterType} onValueChange={(val: any) => setFilterType(val)}>
                      <SelectTrigger className="w-[140px] h-10 text-xs">
                        <SelectValue placeholder="Show..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">All Products</SelectItem>
                        <SelectItem value="pork" className="text-xs">Pork</SelectItem>
                        <SelectItem value="chicken" className="text-xs">Chicken</SelectItem>
                        <SelectItem value="beef" className="text-xs">Beef</SelectItem>
                        <SelectItem value="near_expiry" className="text-xs border-t mt-1">Near Expiry</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
                      <SelectTrigger className="w-[160px] h-10 text-xs">
                        <SelectValue placeholder="Sort by..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="added_desc" className="text-xs">Date Added (Newest)</SelectItem>
                        <SelectItem value="added_asc" className="text-xs">Date Added (Oldest)</SelectItem>
                        <SelectItem value="expiry_asc" className="text-xs">Expiry (Soonest)</SelectItem>
                        <SelectItem value="expiry_desc" className="text-xs">Expiry (Farthest)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Result count */}
                {search.trim() && (
                  <p className="text-xs text-slate-400 -mt-1">
                    {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""} found
                  </p>
                )}

                {/* ── Product List ── */}
                <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
                  {filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-14 text-slate-400">
                      <PackageOpen className="h-10 w-10 opacity-30" />
                      <p className="text-sm font-medium">
                        {availableItems.length === 0
                          ? "No items with available stock"
                          : "No items match your search"}
                      </p>
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const stock = resolveStockLeft(item)
                      const tally = getWeightTally(item)
                      const isNotTally = tally.status === "not-tally"
                      const nearExpiry = isDateNearExpiry((item as any).expiryDate || (item as any).expirationDate)
                      // FIFO badge
                      const fifoCheck = performFifoCheck(item, availableItems)
                      const isFifoOldest = fifoCheck.isFifoCompliant && fifoCheck.availableBatches.length > 1
                      const hasOlderStock = !fifoCheck.isFifoCompliant
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleProductSelect(item)}
                          className={cn(
                            // ── Two-column flex layout ──
                            "w-full flex items-center justify-between gap-4 px-5 py-4 text-left",
                            "transition-colors hover:bg-slate-50 active:bg-slate-100",
                            isNotTally && "bg-red-50/40 border-l-[3px] border-l-red-400",
                            hasOlderStock && !isNotTally && "border-l-[3px] border-l-amber-300"
                          )}
                        >
                          {/* ── LEFT: Product Info ── */}
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            {/* Icon */}
                            <div className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-lg shrink-0 mt-0.5",
                              isNotTally ? "bg-red-100" : nearExpiry ? "bg-orange-100" : "bg-slate-100"
                            )}>
                              <Package className={cn(
                                "h-4 w-4",
                                isNotTally ? "text-red-500" : nearExpiry ? "text-orange-500" : "text-slate-500"
                              )} />
                            </div>

                            {/* Text block */}
                            <div className="min-w-0 flex-1">
                              {/* Product name */}
                              <p className="font-semibold text-sm text-slate-800 truncate max-w-[240px] sm:max-w-none" title={getProductName(item)}>
                                {getProductName(item)}
                              </p>
                              {/* Barcode / Category */}
                              <p className="text-xs text-slate-400 mt-0.5 truncate">
                                {item.category}
                                {item.barcode && (
                                  <span className="font-mono"> · {item.barcode}</span>
                                )}
                              </p>
                              {/* Weight info */}
                              {(tally.productionWeight !== null || tally.packingWeight !== null) && (
                                <div className="flex items-center gap-3 mt-1.5">
                                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                                    <Scale className="h-3 w-3 text-slate-400" />
                                    <span className="font-medium">Prod:</span>
                                    {tally.productionWeight !== null ? ` ${Number(tally.productionWeight).toFixed(1)} kg` : " N/A"}
                                  </span>
                                  <span className="text-slate-300">·</span>
                                  <span className="text-[11px] text-slate-500">
                                    <span className="font-medium">Pack:</span>
                                    {tally.packingWeight !== null ? ` ${Number(tally.packingWeight).toFixed(1)} kg` : " N/A"}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* ── RIGHT: Badges + Stock ── */}
                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {/* Status badges row */}
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {nearExpiry && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  <AlertTriangle className="h-3 w-3" /> Near Expiry
                                </span>
                              )}
                              {tally.status === "tally" && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  <CheckCircle2 className="h-3 w-3" /> Tally
                                </span>
                              )}
                              {isNotTally && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  <AlertTriangle className="h-3 w-3" /> Not Tally
                                </span>
                              )}
                              {isFifoOldest && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  <ShieldCheck className="h-3 w-3" /> FIFO
                                </span>
                              )}
                              {hasOlderStock && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  <AlertTriangle className="h-3 w-3" /> Older Stock
                                </span>
                              )}
                            </div>

                            {/* Stock remaining badge */}
                            <Badge
                              className={cn(
                                "text-xs font-bold px-3 py-1",
                                stock <= 5
                                  ? "bg-orange-100 text-orange-700 border-orange-200"
                                  : "bg-emerald-100 text-emerald-700 border-emerald-200"
                              )}
                              variant="outline"
                            >
                              {stock} left
                            </Badge>
                          </div>

                          {/* Chevron */}
                          <ChevronRight className="h-4 w-4 text-slate-300 shrink-0 ml-1" />
                        </button>
                      )
                    })
                  )}
                </div>

                {errors.product && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {errors.product}
                  </p>
                )}
              </div>
            ) : (
              /* ═══ STEP 2: Quantity Input ═══ */
              <div className="grid gap-5">

                {/* ── Back + Selected Product Card ── */}
                <div className="flex items-start gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (!scannedItem) {
                        setSelectedItem(null)
                        setQuantity("")
                        setErrors({})
                        setShowWeightWarning(false)
                      }
                    }}
                    className={cn(
                      "h-9 w-9 shrink-0 mt-0.5",
                      scannedItem && "opacity-30 cursor-not-allowed"
                    )}
                    disabled={!!scannedItem}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                    <p className="font-bold text-base text-slate-900 truncate">
                      {getProductName(selectedItem)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {selectedItem.category}
                      {selectedItem.barcode && (
                        <span className="font-mono"> · {selectedItem.barcode}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* ── Weight Tally Card ── */}
                <WeightTallyBlock item={selectedItem} />

                {/* ── Stock Info Card (3-column) ── */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="grid grid-cols-3 gap-4 text-center divide-x divide-slate-200">
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Current Stock
                      </p>
                      <p className="text-3xl font-bold text-slate-800">
                        {stockLeft}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        To Deduct
                      </p>
                      <p
                        className={cn(
                          "text-3xl font-bold",
                          quantityNum > stockLeft
                            ? "text-red-600"
                            : quantityNum > 0
                              ? "text-orange-600"
                              : "text-slate-300"
                        )}
                      >
                        {quantityNum > 0 ? `-${quantityNum}` : "0"}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Remaining
                      </p>
                      <p
                        className={cn(
                          "text-3xl font-bold",
                          stockLeft - quantityNum <= 0
                            ? "text-red-600"
                            : stockLeft - quantityNum <= 5
                              ? "text-orange-600"
                              : "text-emerald-600"
                        )}
                      >
                        {Math.max(0, stockLeft - quantityNum)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── Quantity + Unit ── */}
                <div className="grid gap-3">
                  {/* Row 1: Quantity + Unit side-by-side */}
                  <div className="grid grid-cols-[1fr_130px] gap-3">
                    <div className="grid gap-1.5">
                      <Label className="text-sm font-semibold text-slate-700">
                        Quantity to Deduct{" "}
                        <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="number"
                        min="1"
                        max={stockLeft}
                        value={quantity}
                        onChange={(e) => handleQuantityChange(e.target.value)}
                        placeholder={`1 – ${stockLeft}`}
                        className={cn(
                          "h-12 text-xl font-bold",
                          errors.quantity ? "border-destructive" : ""
                        )}
                        autoFocus
                      />
                      {errors.quantity && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> {errors.quantity}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                        Unit
                        <Lock className="h-3 w-3 text-amber-500" />
                      </Label>
                      {unitLoading ? (
                        <div className="h-12 px-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-slate-400 text-sm cursor-wait animate-pulse">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Detecting…</span>
                        </div>
                      ) : (
                        <div className="h-12 px-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm font-bold cursor-not-allowed">
                          <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <span>{unitLabel}</span>
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                {/* ── Auto FIFO status indicator (replaces button) ── */}
                {fifoStatus && (
                  fifoStatus.isFifoCompliant ? (
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                      <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-emerald-800">Using oldest stock (FIFO)</p>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300 px-2 py-0.5 rounded-full">
                            <ShieldCheck className="h-3 w-3" /> FIFO Active
                          </span>
                        </div>
                        <p className="text-xs text-emerald-700 mt-0.5">
                          This is the oldest available batch. FIFO is automatically applied.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                      <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-amber-800">Older stocks available</p>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3" /> Older Stock Available
                          </span>
                        </div>
                        <p className="text-xs text-amber-700 mt-0.5">
                          FIFO will use the oldest batch first — there{" "}
                          {fifoStatus.availableBatches.length - 1 === 1 ? "is" : "are"}{" "}
                          {fifoStatus.availableBatches.length - 1} older batch(es) for this product.
                        </p>
                      </div>
                    </div>
                  )
                )}

                {/* ── Weight warning banner ── */}
                {showWeightWarning && (() => {
                  const tally = getWeightTally(selectedItem)
                  return (
                    <div className="rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 flex items-start gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                      <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-orange-800">Weight Difference Exceeds 5 kg</p>
                        <p className="text-xs text-orange-700 mt-0.5">
                          Production: <b>{tally.productionWeight !== null ? `${Number(tally.productionWeight).toFixed(1)} kg` : "N/A"}</b>
                          {" · "}
                          Packing: <b>{tally.packingWeight !== null ? `${Number(tally.packingWeight).toFixed(1)} kg` : "N/A"}</b>
                          {" · "}
                          Difference: <b>{tally.difference !== null ? `${tally.difference.toFixed(1)} kg` : "N/A"}</b>
                        </p>
                        <p className="text-xs text-orange-600 mt-1">Do you still want to proceed with the product out?</p>
                      </div>
                    </div>
                  )
                })()}

                {/* ── Scanned item badge ── */}
                {scannedItem && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <p className="text-[11px] text-emerald-700">
                      Product auto-selected from barcode scan
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── FOOTER (sticky) ── */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 bg-slate-50/50 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="min-w-[90px]"
          >
            Cancel
          </Button>
          {selectedItem && (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={
                loading || !quantityNum || quantityNum > stockLeft || unitLoading
              }
              className={cn(
                "gap-2 min-w-[160px] font-semibold",
                showWeightWarning
                  ? "bg-orange-600 hover:bg-orange-700 text-white"
                  : quantityNum > 0 && quantityNum <= stockLeft && !unitLoading
                    ? "bg-orange-500 hover:bg-orange-600 text-white"
                    : ""
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : showWeightWarning ? (
                <>
                  <AlertTriangle className="h-4 w-4" />
                  Proceed Anyway
                </>
              ) : (
                <>
                  <PackageMinus className="h-4 w-4" />
                  Confirm Product Out
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>

  </>
  )
}
