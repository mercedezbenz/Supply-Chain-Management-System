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
  Search,
  PackageOpen,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  PackageMinus,
  Loader2,
  Lock,
  Package,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  InventoryService,
  TransactionService,
} from "@/services/firebase-service"
import type { InventoryItem } from "@/lib/types"

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
  const { toast } = useToast()

  // State
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [quantity, setQuantity] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [detectedUnit, setDetectedUnit] = useState<"box" | "pack">("box")
  const [unitLoading, setUnitLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Items with stock > 0
  const availableItems = useMemo(
    () =>
      inventoryItems
        .filter((item) => resolveStockLeft(item) > 0)
        .sort((a, b) => getProductName(a).localeCompare(getProductName(b))),
    [inventoryItems]
  )

  // Search filter
  const filteredItems = useMemo(() => {
    if (!search.trim()) return availableItems
    const q = search.trim().toLowerCase()
    return availableItems.filter(
      (item) =>
        getProductName(item).toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.subcategory || "").toLowerCase().includes(q) ||
        (item.barcode || "").toLowerCase().includes(q)
    )
  }, [availableItems, search])

  const stockLeft = selectedItem ? resolveStockLeft(selectedItem) : 0
  const quantityNum = Math.max(0, Number(quantity) || 0)

  // Reset
  const reset = useCallback(() => {
    setSelectedItem(null)
    setQuantity("")
    setSearch("")
    setErrors({})
    setDetectedUnit("box")
    setUnitLoading(false)
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
        location:
          (selectedItem as any).storageLocation ||
          (selectedItem as any).location ||
          "",
        expiry_date:
          (selectedItem as any).expiryDate ||
          (selectedItem as any).expirationDate ||
          null,
        reference_no: "",
        source: "delivery",
        created_at: new Date(),
      } as any)

      const unitLabel =
        detectedUnit === "pack"
          ? quantityNum === 1
            ? "Pack"
            : "Packs"
          : quantityNum === 1
            ? "Box"
            : "Boxes"

      toast({
        title: "✅ Product Out Successful",
        description: `${quantityNum} ${unitLabel} of "${getProductName(selectedItem)}" deducted from stock.`,
      })

      reset()
      onOpenChange(false)
    } catch (error: any) {
      console.error("[ProductOut] Error:", error)
      toast({
        title: "❌ Failed to Deduct Stock",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const unitLabel = detectedUnit === "pack" ? "Packs" : "Boxes"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[98vw] sm:!w-[95vw] !max-w-[540px] !p-0 !overflow-hidden">
        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600 shrink-0">
                <PackageMinus className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg">Product Out</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {selectedItem
                    ? "Enter quantity to deduct from stock"
                    : "Select a product with available stock"}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-5">
          {!selectedItem ? (
            /* ═══ STEP 1: Product Selection ═══ */
            <div className="grid gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name, category, or barcode..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-10"
                  autoFocus
                />
              </div>

              {/* Product List */}
              <div className="max-h-[380px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-slate-400">
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
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleProductSelect(item)}
                        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 shrink-0">
                            <Package className="h-4 w-4 text-slate-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-slate-800 truncate">
                              {getProductName(item)}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 truncate">
                              {item.category}
                              {item.barcode && ` · ${item.barcode}`}
                            </p>
                          </div>
                        </div>
                        <Badge
                          className={cn(
                            "text-xs font-semibold shrink-0",
                            stock <= 5
                              ? "bg-orange-100 text-orange-700 border-orange-200"
                              : "bg-green-100 text-green-700 border-green-200"
                          )}
                          variant="outline"
                        >
                          {stock} left
                        </Badge>
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
              {/* Back button + Selected product */}
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
                    }
                  }}
                  className={cn(
                    "h-8 w-8 shrink-0 mt-0.5",
                    scannedItem && "opacity-30 cursor-not-allowed"
                  )}
                  disabled={!!scannedItem}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-base text-slate-900 truncate">
                    {getProductName(selectedItem)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedItem.category}
                    {selectedItem.barcode && ` · ${selectedItem.barcode}`}
                  </p>
                </div>
              </div>

              {/* Stock info card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Current Stock
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      {stockLeft}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      To Deduct
                    </p>
                    <p
                      className={cn(
                        "text-2xl font-bold",
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
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Remaining
                    </p>
                    <p
                      className={cn(
                        "text-2xl font-bold",
                        stockLeft - quantityNum <= 0
                          ? "text-red-600"
                          : stockLeft - quantityNum <= 5
                            ? "text-orange-600"
                            : "text-green-600"
                      )}
                    >
                      {Math.max(0, stockLeft - quantityNum)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Quantity input + locked unit */}
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700">
                    Quantity to Deduct{" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    max={stockLeft}
                    value={quantity}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    placeholder={`1 - ${stockLeft}`}
                    className={cn(
                      "h-11 text-lg font-semibold",
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
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    Unit
                    <Lock className="h-3 w-3 text-amber-500" />
                  </Label>
                  {unitLoading ? (
                    <div className="h-11 px-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-slate-400 text-sm cursor-wait animate-pulse">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Detecting…</span>
                    </div>
                  ) : (
                    <div className="h-11 px-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm font-semibold cursor-not-allowed">
                      <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span>{unitLabel}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Scanned item badge */}
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

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4 bg-slate-50/50">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
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
                "gap-2 min-w-[140px]",
                quantityNum > 0 && quantityNum <= stockLeft && !unitLoading
                  ? "bg-orange-500 hover:bg-orange-600 text-white"
                  : ""
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <PackageMinus className="h-4 w-4" />
                  Confirm
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
