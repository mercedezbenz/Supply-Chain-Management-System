"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  ScanLine,
  PackagePlus,
  Truck,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Loader2,
  Package,
  MapPin,
  CalendarDays,
  ArrowRightLeft,
  CornerDownLeft,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { InventoryItem } from "@/lib/types"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ScanItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventoryItems: InventoryItem[]
  onAddStock?: (item: InventoryItem) => void
  onProductOut?: (item: InventoryItem) => void
  onRegisterNew?: (barcode: string) => void
}

type ScanState = "idle" | "searching" | "found" | "not-found"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

function formatDate(d: any): string {
  if (!d) return "—"
  try {
    const date = d instanceof Date ? d : d?.toDate ? d.toDate() : new Date(d)
    if (isNaN(date.getTime())) return "—"
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  } catch {
    return "—"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ScanItemDialog({
  open,
  onOpenChange,
  inventoryItems,
  onAddStock,
  onProductOut,
  onRegisterNew,
}: ScanItemDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [barcodeValue, setBarcodeValue] = useState("")
  const [scanState, setScanState] = useState<ScanState>("idle")
  const [foundItem, setFoundItem] = useState<InventoryItem | null>(null)
  const [lastScannedBarcode, setLastScannedBarcode] = useState("")

  // ── Reset ─────────────────────────────────────────────────────────────
  const resetScan = useCallback(() => {
    setBarcodeValue("")
    setScanState("idle")
    setFoundItem(null)
    setLastScannedBarcode("")
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  // ── Auto-focus when dialog opens ─────────────────────────────────────
  useEffect(() => {
    if (open) {
      resetScan()
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open, resetScan])

  // ── Handle scan ──────────────────────────────────────────────────────
  const handleScan = useCallback(
    (barcode: string) => {
      const trimmed = barcode.trim()
      if (!trimmed) return

      setScanState("searching")
      setLastScannedBarcode(trimmed)
      setBarcodeValue("")

      setTimeout(() => {
        const match = inventoryItems.find(
          (item) => item.barcode?.toLowerCase() === trimmed.toLowerCase()
        )
        if (match) {
          setScanState("found")
          setFoundItem(match)
        } else {
          setScanState("not-found")
          setFoundItem(null)
        }
      }, 300)
    },
    [inventoryItems]
  )

  // ── Key handler ──────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleScan(barcodeValue)
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────
  const handleAddStock = () => {
    if (foundItem && onAddStock) {
      onAddStock(foundItem)
      onOpenChange(false)
    }
  }

  const handleProductOut = () => {
    if (foundItem && onProductOut) {
      onProductOut(foundItem)
      onOpenChange(false)
    }
  }

  const handleRegisterNew = () => {
    if (onRegisterNew) {
      onRegisterNew(lastScannedBarcode)
      onOpenChange(false)
    }
  }

  const stockLeft = foundItem ? resolveStockLeft(foundItem) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] !p-0 !gap-0">

        {/* ════════ HEADER ════════ */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <DialogHeader className="!space-y-1">
            <DialogTitle className="flex items-center gap-2.5 text-xl">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100">
                <ScanLine className="h-5 w-5 text-violet-600" />
              </div>
              Scan Item
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              Scan a barcode using your USB scanner or type it manually and press Enter.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ════════ SCANNER INPUT ════════ */}
        <div className="px-6 pt-5 pb-4">
          <div className="relative">
            <ScanLine className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-violet-400" />
            <Input
              ref={inputRef}
              value={barcodeValue}
              onChange={(e) => setBarcodeValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Scan barcode or type manually…"
              className="pl-12 pr-20 h-14 text-lg font-mono tracking-wider border-2 border-violet-200 focus-visible:ring-violet-300 focus-visible:border-violet-400 rounded-xl bg-white"
              autoFocus
              autoComplete="off"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {barcodeValue && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => {
                    setBarcodeValue("")
                    inputRef.current?.focus()
                  }}
                >
                  Clear
                </Button>
              )}
              <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                <CornerDownLeft className="h-3 w-3" /> Enter
              </kbd>
            </div>
          </div>
        </div>

        {/* ════════ CONTENT AREA ════════ */}
        <div className="px-6 pb-6">

          {/* ── IDLE STATE ────────────────────────────────────────── */}
          {scanState === "idle" && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 border border-violet-100">
                <ScanLine className="h-8 w-8 text-violet-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Ready to scan</p>
                <p className="text-xs text-slate-400 mt-0.5">Point your scanner at a barcode — input captures automatically.</p>
              </div>
            </div>
          )}

          {/* ── SEARCHING ─────────────────────────────────────────── */}
          {scanState === "searching" && (
            <div className="flex items-center justify-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              <p className="text-sm font-medium text-slate-600">Searching for barcode…</p>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              FOUND — Product Info
          ══════════════════════════════════════════════════════════ */}
          {scanState === "found" && foundItem && (
            <div className="grid gap-4 animate-in fade-in-0 slide-in-from-bottom-3 duration-300">

              {/* Match status banner */}
              <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-700">Barcode Matched</p>
                  <p className="text-xs text-emerald-600/70 font-mono">{lastScannedBarcode}</p>
                </div>
              </div>

              {/* Product Info Card */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                {/* Product header */}
                <div className="px-5 py-4 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold text-slate-800 leading-tight">
                        {getProductName(foundItem)}
                      </p>
                      <p className="text-sm text-slate-400 font-mono mt-1">{foundItem.barcode}</p>
                    </div>
                    <Badge
                      className={cn(
                        "text-sm font-bold px-3 py-1 shrink-0",
                        stockLeft <= 0
                          ? "bg-red-100 text-red-700 border-red-200"
                          : stockLeft <= 5
                            ? "bg-amber-100 text-amber-700 border-amber-200"
                            : "bg-emerald-100 text-emerald-700 border-emerald-200"
                      )}
                      variant="outline"
                    >
                      {stockLeft} Stock Left
                    </Badge>
                  </div>
                </div>

                {/* Info grid — 2 columns */}
                <div className="p-5 grid grid-cols-2 gap-x-6 gap-y-4">
                  {/* Category */}
                  <div className="flex items-start gap-3">
                    <Package className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Category</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">{foundItem.category}</p>
                    </div>
                  </div>

                  {/* Subcategory */}
                  <div className="flex items-start gap-3">
                    <Package className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Subcategory</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {(foundItem as any).subcategory || "—"}
                      </p>
                    </div>
                  </div>

                  {/* Incoming */}
                  <div className="flex items-start gap-3">
                    <ArrowRightLeft className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Incoming</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {(foundItem as any).incoming ?? 0}
                      </p>
                    </div>
                  </div>

                  {/* Outgoing */}
                  <div className="flex items-start gap-3">
                    <ArrowRightLeft className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Outgoing</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {(foundItem as any).outgoing ?? 0}
                      </p>
                    </div>
                  </div>

                  {/* Good Return */}
                  <div className="flex items-start gap-3">
                    <RotateCcw className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Good Return</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {(foundItem as any).goodReturnStock ?? 0}
                      </p>
                    </div>
                  </div>

                  {/* Damage Return */}
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Damage Return</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {(foundItem as any).damageReturnStock ?? 0}
                      </p>
                    </div>
                  </div>

                  {/* Expiry Date */}
                  <div className="flex items-start gap-3">
                    <CalendarDays className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Expiry Date</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {formatDate((foundItem as any).expiryDate ?? (foundItem as any).expirationDate)}
                      </p>
                    </div>
                  </div>

                  {/* Storage Location */}
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Location</p>
                      <p className="text-sm font-semibold text-slate-700 mt-0.5">
                        {(foundItem as any).storageLocation ?? (foundItem as any).location ?? "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* No stock warning */}
              {stockLeft <= 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-sm font-medium text-red-700">No stock available — Product Out is disabled.</p>
                </div>
              )}

              {/* ── Action Buttons ────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Button
                  type="button"
                  onClick={handleAddStock}
                  className="h-12 gap-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl"
                >
                  <PackagePlus className="h-5 w-5" />
                  Add Stock (Incoming)
                </Button>
                <Button
                  type="button"
                  onClick={handleProductOut}
                  disabled={stockLeft <= 0}
                  className={cn(
                    "h-12 gap-2.5 font-semibold text-sm rounded-xl",
                    stockLeft <= 0
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed hover:bg-slate-200"
                      : "bg-orange-500 hover:bg-orange-600 text-white"
                  )}
                >
                  <Truck className="h-5 w-5" />
                  Product Out
                </Button>
              </div>

              {/* Scan again */}
              <div className="flex justify-center pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetScan}
                  className="gap-2 text-sm text-slate-400 hover:text-slate-600"
                >
                  <RotateCcw className="h-4 w-4" />
                  Scan Another Item
                </Button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              NOT FOUND
          ══════════════════════════════════════════════════════════ */}
          {scanState === "not-found" && (
            <div className="grid gap-4 animate-in fade-in-0 slide-in-from-bottom-3 duration-300">
              {/* Warning banner */}
              <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-700">Barcode Not Found</p>
                  <p className="text-xs text-amber-600/70 font-mono">{lastScannedBarcode}</p>
                </div>
              </div>

              {/* Empty state card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col items-center gap-3 py-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 border border-amber-200">
                  <AlertTriangle className="h-7 w-7 text-amber-500" />
                </div>
                <p className="text-sm text-slate-500 max-w-[280px] text-center leading-relaxed">
                  No item in inventory matches this barcode. You can register it as a new item or try scanning again.
                </p>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Button
                  type="button"
                  onClick={handleRegisterNew}
                  className="h-12 gap-2.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-sm rounded-xl"
                >
                  <PackagePlus className="h-5 w-5" />
                  Register as New Item
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetScan}
                  className="h-12 gap-2.5 font-semibold text-sm rounded-xl border-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Scan Again
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
