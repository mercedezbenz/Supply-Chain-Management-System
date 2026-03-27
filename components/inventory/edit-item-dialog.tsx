"use client"

import type React from "react"
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Lock, AlertTriangle, Save, X, Loader2 } from "lucide-react"
import { TransactionService } from "@/services/firebase-service"
import { FirebaseService } from "@/services/firebase-service"
import type { InventoryTransaction } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

/* ───────────────────── Storage locations (match add-item-dialog) ────────── */
const storageLocations: Record<string, string[]> = {
  "Left Storage": [
    "1LG1","1LG2","1LG3","1LG4","1LG5","1LG6","1LG7","1LG8","1LG9",
    "1L21","1L22","1L23","1L24","1L25","1L26","1L27","1L28","1L29",
    "1L30","1L31","1L32","1L33","1L34","1L35","1L36","1L37","1L38",
    "1L39","1L40","1L41","1L42","1L43","1L44","1L45","1L46","1L47","1L48","1L49",
  ],
  "Right Storage": [
    "1RG1","1RG2","1RG3","1RG4","1RG5","1RG6","1RG7","1RG8","1RG9",
    "1R21","1R22","1R23","1R24","1R25","1R26","1R27","1R28","1R29",
    "1R30","1R31","1R32","1R33","1R34","1R35","1R36","1R37","1R38",
    "1R39","1R40","1R41","1R42","1R43","1R44","1R45","1R46","1R47","1R48","1R49",
  ],
}

/* ───────────────────── Helper: parse date safely ───────────────────────── */
function toInputDate(val: any): string {
  if (!val) return ""
  try {
    let d: Date
    if (val instanceof Date) d = val
    else if (val?.toDate && typeof val.toDate === "function") d = val.toDate()
    else d = new Date(val)
    if (isNaN(d.getTime())) return ""
    return d.toISOString().split("T")[0]
  } catch {
    return ""
  }
}

/* ───────────────────── Props ───────────────────────────────────────────── */
interface EditItemDialogProps {
  transaction: InventoryTransaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditItemDialog({ transaction, open, onOpenChange }: EditItemDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  // ─── Form state (only editable fields) ────────────────────────────────
  const [formData, setFormData] = useState({
    goodReturn: "",
    damageReturn: "",
    incomingWeight: "",
    outgoingWeight: "",
    productionDate: "",
    processDate: "",
    expiryDate: "",
    location: "",
    referenceNo: "",
  })

  // ─── Sync form data when transaction changes ─────────────────────────
  useEffect(() => {
    if (!transaction) return
    const txn = transaction as any
    setFormData({
      goodReturn: String(txn.good_return ?? 0),
      damageReturn: String(txn.damage_return ?? 0),
      incomingWeight: String(txn.incoming_weight ?? ""),
      outgoingWeight: String(txn.outgoing_weight ?? ""),
      productionDate: toInputDate(txn.production_date),
      processDate: toInputDate(txn.process_date),
      expiryDate: toInputDate(txn.expiry_date),
      location: txn.location || "",
      referenceNo: txn.reference_no || "",
    })
  }, [transaction])

  // ─── Simple field updater ─────────────────────────────────────────────
  const updateField = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }, [])

  // ─── Save handler ─────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!transaction) return

    setLoading(true)
    try {
      const goodReturn = Math.max(0, parseFloat(formData.goodReturn) || 0)
      const damageReturn = Math.max(0, parseFloat(formData.damageReturn) || 0)
      const inWeight = Math.max(0, parseFloat(formData.incomingWeight) || 0)
      const outWeight = Math.max(0, parseFloat(formData.outgoingWeight) || 0)

      // Only update safe metadata fields — never touch stock quantities
      const updateData: any = {
        good_return: goodReturn,
        damage_return: damageReturn,
        incoming_weight: inWeight,
        outgoing_weight: outWeight,
        location: formData.location,
        reference_no: formData.referenceNo,
        production_date: formData.productionDate ? new Date(formData.productionDate + "T00:00:00") : null,
        process_date: formData.processDate ? new Date(formData.processDate + "T00:00:00") : null,
        expiry_date: formData.expiryDate ? new Date(formData.expiryDate + "T00:00:00") : null,
        updatedAt: new Date(),
      }

      await TransactionService.updateTransaction(transaction.id, updateData)

      // Log the edit to inventory_logs
      try {
        await FirebaseService.addDocument("inventory_logs", {
          action: "EDIT_TRANSACTION",
          transactionId: transaction.id,
          productName: (transaction as any).product_name,
          barcode: (transaction as any).barcode,
          changes: {
            good_return: goodReturn,
            damage_return: damageReturn,
            incoming_weight: inWeight,
            outgoing_weight: outWeight,
            location: formData.location,
            reference_no: formData.referenceNo,
          },
          editedAt: new Date(),
        })
      } catch (logErr) {
        console.warn("[EditItemDialog] Failed to log adjustment:", logErr)
      }

      toast({
        title: "✅ Inventory Updated",
        description: "Inventory item has been updated successfully.",
      })
      onOpenChange(false)
    } catch (error: any) {
      console.error("[EditItemDialog] Save failed:", error)
      toast({
        title: "❌ Update Failed",
        description: error?.message || "Failed to update the record. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  if (!transaction) return null

  const txn = transaction as any

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-[92vw] !max-w-[1200px] !max-h-[none] !overflow-visible !p-0"
      >
        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="text-xl">Edit Inventory Item</DialogTitle>
            <DialogDescription>
              Update returns, weight, dates, location, and reference info. Product identity cannot be changed.
            </DialogDescription>
          </DialogHeader>

          {/* Warning Banner */}
          <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 mt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 shrink-0">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-700">Stock Editing Restricted</p>
              <p className="text-xs text-red-600/80">
                Stock quantities cannot be edited here. Use <strong>Add Item</strong> for incoming stock or <strong>Outgoing Stock</strong> for deductions.
              </p>
            </div>
          </div>

          {/* Product Identity Bar */}
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 border border-gray-200 dark:bg-gray-900/50 dark:border-gray-800 px-4 py-3 mt-3">
            <Lock className="h-4 w-4 text-gray-400 shrink-0" />
            <div className="min-w-0 flex-1 flex items-center gap-4 text-sm">
              <span className="font-semibold text-foreground truncate">{txn.product_name || "—"}</span>
              <span className="text-muted-foreground font-mono text-xs">{txn.barcode || "—"}</span>
              <span className="text-muted-foreground text-xs">{txn.category || "—"} · {txn.type || "—"}</span>
              {(() => {
                const ut = (txn.unit_type || "BOX").toUpperCase()
                return ut === "PACK" ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-green-100 text-green-700 border-green-200">PACK</span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border bg-blue-100 text-blue-700 border-blue-200">BOX</span>
                )
              })()}
            </div>
          </div>
        </div>

        {/* ── 2-COLUMN GRID LAYOUT (matches Add Item modal) ────────── */}
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 items-stretch">

            {/* ════════════════ LEFT COLUMN ════════════════ */}
            <div className="flex flex-col gap-4">

              {/* Returns Section */}
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-900 p-4 grid gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Returns</p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Good Return</Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 5"
                      value={formData.goodReturn}
                      onChange={(e) => updateField("goodReturn", e.target.value)}
                      className="h-10"
                    />
                    <p className="text-[10px] text-muted-foreground">Adds back to available stock</p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Damage Return</Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 2"
                      value={formData.damageReturn}
                      onChange={(e) => updateField("damageReturn", e.target.value)}
                      className="h-10"
                    />
                    <p className="text-[10px] text-muted-foreground">Tracked as loss only</p>
                  </div>
                </div>
              </div>

              {/* Weight Section */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 dark:bg-blue-950/20 dark:border-blue-900 p-4 grid gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-400">Weight</p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Incoming Weight (kg)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 50.00"
                      value={formData.incomingWeight}
                      onChange={(e) => updateField("incomingWeight", e.target.value)}
                      className="h-10"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Outgoing Weight (kg)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="e.g. 25.00"
                      value={formData.outgoingWeight}
                      onChange={(e) => updateField("outgoingWeight", e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ════════════════ RIGHT COLUMN ════════════════ */}
            <div className="flex flex-col gap-4">

              {/* Dates Section */}
              <div className="rounded-xl border border-amber-100 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-900 p-4 grid gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Dates</p>

                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Production Date</Label>
                    <Input
                      type="date"
                      value={formData.productionDate}
                      onChange={(e) => updateField("productionDate", e.target.value)}
                      className="h-10"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Process Date</Label>
                    <Input
                      type="date"
                      value={formData.processDate}
                      onChange={(e) => updateField("processDate", e.target.value)}
                      className="h-10"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Expiry Date</Label>
                    <Input
                      type="date"
                      value={formData.expiryDate}
                      onChange={(e) => updateField("expiryDate", e.target.value)}
                      className="h-10"
                    />
                  </div>
                </div>
              </div>

              {/* Location Section */}
              <div className="rounded-xl border border-violet-100 bg-violet-50/40 dark:bg-violet-950/20 dark:border-violet-900 p-4 grid gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">Location</p>

                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Storage Location</Label>
                  <Select value={formData.location} onValueChange={(v) => updateField("location", v)}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select storage location" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(storageLocations).map(([group, locs]) => (
                        <div key={group}>
                          <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 pt-2 pb-1">{group}</p>
                          {locs.map((loc) => (
                            <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Reference Section */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/40 dark:bg-gray-950/20 dark:border-gray-800 p-4 grid gap-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">Reference</p>

                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Reference No.</Label>
                  <Input
                    type="text"
                    placeholder="e.g. DR-1023 / INV-2024"
                    value={formData.referenceNo}
                    onChange={(e) => updateField("referenceNo", e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── FOOTER ─────────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/60 bg-gray-50/50 dark:bg-muted/20 rounded-b-xl">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="h-10 px-5"
            >
              <X className="h-4 w-4 mr-1.5" />
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
