"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { format } from "date-fns"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Search, PackageOpen, AlertTriangle, CheckCircle2, Truck, User, MapPin, CalendarIcon, FileText, ShieldCheck, Factory, Lock, Loader2 } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { InventoryService, CustomerTransactionService, StockMovementService, TransactionService } from "@/services/firebase-service"
import type { InventoryItem } from "@/lib/types"
import { getRegions, getProvinces, getCities, getBarangays, getZipCode } from "@/lib/ph-address-data"

// ---
// Types
// ---

interface OutgoingStockDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventoryItems: InventoryItem[]
  scannedItem?: InventoryItem | null
}

type Step = "product" | "details" | "address"

const EMPTY = {
  productId: "",
  quantity: "",
  unit: "pack" as "pack" | "box",
  weightKg: "",
  firstName: "",
  middleName: "",
  lastName: "",
  houseNumber: "",
  streetName: "",
  region: "",
  province: "",
  city: "",
  barangay: "",
  zipCode: "",
  // Delivery & Document fields
  deliveryDate: undefined as Date | undefined,
  transferSlipNo: "",
  deliveryReceiptNo: "",
  salesInvoiceNo: "",
  processingDate: new Date() as Date | undefined,
  // Production fields
  productionDate: undefined as Date | undefined,
  internalReferenceNo: "",
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

export function OutgoingStockDialog({ open, onOpenChange, inventoryItems, scannedItem }: OutgoingStockDialogProps) {
  const { user } = useAuth()
  const { toast } = useToast()

  const [step, setStep] = useState<Step>("product")
  const [formData, setFormData] = useState(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [outgoingType, setOutgoingType] = useState<"delivery" | "production">("delivery")
  const [detectedUnit, setDetectedUnit] = useState<"box" | "pack" | null>(null)
  const [unitLoading, setUnitLoading] = useState(false)

  // Date picker popover state
  const [deliveryDateOpen, setDeliveryDateOpen] = useState(false)
  const [processingDateOpen, setProcessingDateOpen] = useState(false)
  const deliveryDateRef = useRef<HTMLDivElement>(null)
  const processingDateRef = useRef<HTMLDivElement>(null)

  // Date picker outside click handlers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (deliveryDateRef.current && !deliveryDateRef.current.contains(event.target as Node)) {
        setDeliveryDateOpen(false)
      }
      if (processingDateRef.current && !processingDateRef.current.contains(event.target as Node)) {
        setProcessingDateOpen(false)
      }
    }
    if (deliveryDateOpen || processingDateOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [deliveryDateOpen, processingDateOpen])

  // --- Address cascading data ---
  const regions = useMemo(() => getRegions(), [])
  const provinces = useMemo(() => getProvinces(formData.region), [formData.region])
  const cities = useMemo(() => getCities(formData.region, formData.province), [formData.region, formData.province])
  const barangays = useMemo(() => getBarangays(formData.region, formData.province, formData.city), [formData.region, formData.province, formData.city])

  // --- Items with available stock (> 0 only) ---
  const availableItems = useMemo(
    () =>
      inventoryItems
        .filter((item) => resolveStockLeft(item) > 0)
        .sort((a, b) => getProductName(a).localeCompare(getProductName(b))),
    [inventoryItems],
  )

  const filteredItems = useMemo(() => {
    if (!search.trim()) return availableItems
    const q = search.trim().toLowerCase()
    return availableItems.filter(
      (item) =>
        getProductName(item).toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.subcategory || "").toLowerCase().includes(q) ||
        (item.barcode || "").toLowerCase().includes(q),
    )
  }, [availableItems, search])

  const selectedItem = useMemo(
    () => availableItems.find((i) => i.id === formData.productId) ?? null,
    [availableItems, formData.productId],
  )

  const selectedStockLeft = selectedItem ? resolveStockLeft(selectedItem) : 0
  const quantityNum = Math.max(0, Number(formData.quantity) || 0)
  const stockAfterDispatch = Math.max(0, selectedStockLeft - quantityNum)
  const quantityExceedsStock = quantityNum > selectedStockLeft

  // --- Full name & address auto-build ---
  const fullName = [formData.firstName.trim(), formData.middleName.trim(), formData.lastName.trim()]
    .filter(Boolean)
    .join(" ")

  const fullAddress = useMemo(() => {
    const parts = [
      formData.houseNumber.trim(),
      formData.streetName.trim(),
      formData.barangay ? `Brgy. ${formData.barangay}` : "",
      formData.city,
      formData.province,
      formData.region,
      formData.zipCode,
    ].filter(Boolean)
    return parts.join(", ")
  }, [formData])

  // --- Reset ---
  const reset = useCallback(() => {
    setStep("product")
    setFormData(EMPTY)
    setErrors({})
    setSearch("")
    setOutgoingType("delivery")
    setDetectedUnit(null)
    setUnitLoading(false)
  }, [])

  // --- Product select: detect unit from transaction (ALWAYS locks unit) ---
  const handleProductSelect = useCallback(async (item: InventoryItem) => {
    setFormData((p) => ({ ...p, productId: item.id, quantity: "" }))
    setErrors((p) => ({ ...p, productId: "" }))
    setDetectedUnit(null)
    setUnitLoading(true)
    try {
      const txn = await TransactionService.findByBarcode(item.barcode || "")
      if (txn && (txn as any).incoming_unit) {
        const unit = (txn as any).incoming_unit as "box" | "pack"
        setDetectedUnit(unit)
        setFormData((p) => ({ ...p, unit }))
      } else {
        // No transaction found — default to "box" and lock
        setDetectedUnit("box")
        setFormData((p) => ({ ...p, unit: "box" }))
      }
    } catch {
      // If lookup fails, default to "box" and lock
      setDetectedUnit("box")
      setFormData((p) => ({ ...p, unit: "box" }))
    } finally {
      setUnitLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      reset()
    } else if (scannedItem) {
      // Auto-select scanned item and skip to details step
      handleProductSelect(scannedItem)
      setStep("details")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // --- Cascading reset handlers ---
  const handleRegionChange = (region: string) => {
    setFormData((p) => ({ ...p, region, province: "", city: "", barangay: "", zipCode: "" }))
  }

  const handleProvinceChange = (province: string) => {
    setFormData((p) => ({ ...p, province, city: "", barangay: "", zipCode: "" }))
  }

  const handleCityChange = (city: string) => {
    const zip = getZipCode(formData.region, formData.province, city)
    setFormData((p) => ({ ...p, city, barangay: "", zipCode: zip }))
  }

  const handleBarangayChange = (barangay: string) => {
    setFormData((p) => ({ ...p, barangay }))
  }

  // --- Quantity --- clamp to stock left on blur, enforce max in onChange ---
  const handleQuantityChange = (rawValue: string) => {
    // Allow empty
    if (rawValue === "") {
      setFormData((p) => ({ ...p, quantity: "" }))
      setErrors((p) => ({ ...p, quantity: "" }))
      return
    }
    const num = parseInt(rawValue, 10)
    if (isNaN(num) || num < 0) return
    setFormData((p) => ({ ...p, quantity: String(num) }))
    if (num > selectedStockLeft) {
      setErrors((p) => ({ ...p, quantity: `Cannot exceed available stock (${selectedStockLeft}).` }))
    } else {
      setErrors((p) => ({ ...p, quantity: "" }))
    }
  }

  // --- Validation per step ---
  const validateStep = (s: Step): boolean => {
    const newErrors: Record<string, string> = {}

    if (s === "product") {
      if (!formData.productId) newErrors.productId = "Please select a product."
    }

    if (s === "details") {
      if (!quantityNum || quantityNum <= 0) {
        newErrors.quantity = "Quantity must be greater than 0."
      } else if (quantityNum > selectedStockLeft) {
        newErrors.quantity = `Cannot exceed available stock (${selectedStockLeft}).`
      }
      // Unit mismatch validation — always enforce locked unit
      if (detectedUnit && formData.unit !== detectedUnit) {
        const unitLabel = detectedUnit === "box" ? "Boxes" : "Packs"
        newErrors.unit = `Invalid unit. This product is stored in ${unitLabel} only.`
      }
      // Block if unit detection hasn't completed yet
      if (unitLoading) {
        newErrors.unit = "Please wait — detecting unit from stock records."
      }
      // Only require customer/delivery info for delivery type
      if (outgoingType === "delivery") {
        if (!formData.firstName.trim()) newErrors.firstName = "First name is required."
        if (!formData.lastName.trim()) newErrors.lastName = "Last name is required."
        if (!formData.deliveryDate) newErrors.deliveryDate = "Delivery date is required."
        if (!formData.deliveryReceiptNo.trim()) newErrors.deliveryReceiptNo = "Delivery receipt no. is required."
        if (!formData.salesInvoiceNo.trim()) newErrors.salesInvoiceNo = "Sales invoice no. is required."
      }
      if (outgoingType === "production") {
        if (!formData.productionDate) newErrors.productionDate = "Production date is required."
      }
    }

    if (s === "address") {
      if (!formData.houseNumber.trim()) newErrors.houseNumber = "House/Block/Lot number is required."
      if (!formData.region) newErrors.region = "Region is required."
      if (!formData.province) newErrors.province = "Province is required."
      if (!formData.city) newErrors.city = "City / Municipality is required."
      if (!formData.barangay) newErrors.barangay = "Barangay is required."
      if (!formData.zipCode.trim()) newErrors.zipCode = "ZIP code is required."
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (step === "product" && validateStep("product")) setStep("details")
    else if (step === "details" && validateStep("details")) {
      if (outgoingType === "production") {
        // For production: skip address, show confirm directly
        setShowConfirm(true)
      } else {
        setStep("address")
      }
    }
  }

  const handleBack = () => {
    if (step === "details" && !scannedItem) setStep("product")
    else if (step === "address") setStep("details")
  }

  // --- Submit ---
  const handleSubmit = async () => {
    if (!validateStep("address")) return
    if (!user || !selectedItem) return

    setLoading(true)
    try {
      const newStockLeft = selectedStockLeft - quantityNum

      // 1. Update inventory
      await InventoryService.updateItem(selectedItem.id, {
        outgoing: ((selectedItem as any).outgoing ?? 0) + quantityNum,
        stock: newStockLeft,
        total: newStockLeft,
      } as any)

      // 2. Create customer_transaction --- shows as Pending in Delivery Tracking
      await CustomerTransactionService.addTransaction({
        customerName: fullName,
        customerAddress: fullAddress,
        productId: selectedItem.id,
        productName: getProductName(selectedItem),
        productBarcode: selectedItem.barcode || "",
        quantity: quantityNum,
        unit: formData.unit,
        weightKg: formData.weightKg ? Number(formData.weightKg) : null,
        category: selectedItem.category,
        subcategory: (selectedItem as any).subcategory || "",
        transactionType: "PRODUCT_OUT",
        transactionDate: new Date(),
        deliveryDate: formData.deliveryDate || null,
        transferSlipNo: formData.transferSlipNo.trim() || null,
        deliveryReceiptNo: formData.deliveryReceiptNo.trim() || null,
        salesInvoiceNo: formData.salesInvoiceNo.trim() || null,
        processingDate: formData.processingDate || null,
        addressDetails: {
          houseNumber: formData.houseNumber,
          streetName: formData.streetName,
          barangay: formData.barangay,
          city: formData.city,
          province: formData.province,
          region: formData.region,
          zipCode: formData.zipCode,
        },
        assignedDriverId: null,
        assignedDriverName: null,
        // Transaction Documents
        transactionDocuments: {
          transaction_type: "outgoing",
          source: "delivery",
          delivery_date: formData.deliveryDate || null,
          delivery_receipt_no: formData.deliveryReceiptNo.trim(),
          sales_invoice_no: formData.salesInvoiceNo.trim(),
          customer_name: fullName,
          transfer_slip_no: formData.transferSlipNo.trim() || null,
        },
        createdBy: user.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // 3. APPEND-ONLY LEDGER: Always create a NEW transaction row for outgoing
      const avgWeight = formData.weightKg ? Number(formData.weightKg) : 0

      const transactionPayload = {
        transaction_date: new Date(),
        product_name: getProductName(selectedItem),
        barcode: selectedItem.barcode || "",
        category: selectedItem.category,
        type: (selectedItem as any).productType || (selectedItem as any).subcategory || "",
        unit_type: formData.unit.toUpperCase(),
        incoming_qty: 0,
        incoming_packs: 0,
        outgoing_qty: quantityNum,
        outgoing_packs: quantityNum,
        outgoing_unit: formData.unit,
        avg_weight: avgWeight,
        good_return: 0,
        damage_return: 0,
        stock_left: newStockLeft,
        location: (selectedItem as any).storageLocation || (selectedItem as any).location || "",
        to_location: fullAddress || "",
        customer_name: fullName || "",
        customer_address: fullAddress || "",
        delivery_address: fullAddress || "",
        addressDetails: {
          houseNumber: formData.houseNumber,
          streetName: formData.streetName,
          barangay: formData.barangay,
          city: formData.city,
          province: formData.province,
          region: formData.region,
          zipCode: formData.zipCode,
        },
        expiry_date: (selectedItem as any).expiryDate || (selectedItem as any).expirationDate || null,
        reference_no: [formData.deliveryReceiptNo.trim(), formData.salesInvoiceNo.trim()].filter(Boolean).join(" / "),
        source: "delivery",
        process_date: formData.processingDate || null,
        created_at: new Date(),
      }

      console.log("[OutgoingStock] Transaction payload:", transactionPayload)

      await TransactionService.addTransaction(transactionPayload as any)

      setShowConfirm(false)
      toast({
        title: "✅ Stock Successfully Deducted",
        description: `${quantityNum} ${formData.unit === "box" ? (quantityNum === 1 ? "Box" : "Boxes") : (quantityNum === 1 ? "Pack" : "Packs")} of "${getProductName(selectedItem)}" dispatched for delivery.`,
      })

      reset()
      onOpenChange(false)
    } catch (error: any) {
      console.error("[OutgoingStockDialog] Error:", error)
      setShowConfirm(false)
      toast({
        title: "❌ Failed to Deduct Stock",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  // --- Submit (Production) ---
  const handleSubmitProduction = async () => {
    if (!user || !selectedItem) return

    setLoading(true)
    try {
      const newStockLeft = selectedStockLeft - quantityNum

      // 1. Update inventory
      await InventoryService.updateItem(selectedItem.id, {
        outgoing: ((selectedItem as any).outgoing ?? 0) + quantityNum,
        stock: newStockLeft,
        total: newStockLeft,
      } as any)

      // 2. Log as stock movement (no customer transaction needed for production)
      await StockMovementService.addMovement({
        inventoryItemId: selectedItem.id,
        barcode: selectedItem.barcode || "",
        category: selectedItem.category,
        subcategory: (selectedItem as any).subcategory || "",
        movementType: "OUTGOING",
        quantity: quantityNum,
        previousStock: selectedStockLeft,
        newStock: newStockLeft,
        reason: "For Production",
        // Transaction Documents
        transactionDocuments: {
          transaction_type: "outgoing",
          source: "production",
          production_date: formData.productionDate || null,
          internal_reference_no: formData.internalReferenceNo.trim() || null,
        },
        createdBy: user.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // 3. APPEND-ONLY LEDGER: Always create a NEW transaction row for outgoing (production)
      const prodAvgWeight = formData.weightKg ? Number(formData.weightKg) : 0

      await TransactionService.addTransaction({
        transaction_date: new Date(),
        product_name: getProductName(selectedItem),
        barcode: selectedItem.barcode || "",
        category: selectedItem.category,
        type: (selectedItem as any).productType || (selectedItem as any).subcategory || "",
        unit_type: formData.unit.toUpperCase(),
        incoming_qty: 0,
        incoming_packs: 0,
        outgoing_qty: quantityNum,
        outgoing_packs: quantityNum,
        outgoing_unit: formData.unit,
        avg_weight: prodAvgWeight,
        good_return: 0,
        damage_return: 0,
        stock_left: newStockLeft,
        location: (selectedItem as any).storageLocation || (selectedItem as any).location || "",
        expiry_date: (selectedItem as any).expiryDate || (selectedItem as any).expirationDate || null,
        reference_no: formData.internalReferenceNo.trim() || "",
        source: "production",
        production_date: formData.productionDate || null,
        created_at: new Date(),
      } as any)

      setShowConfirm(false)
      toast({
        title: "✅ Stock Successfully Deducted",
        description: `${quantityNum} ${formData.unit === "box" ? (quantityNum === 1 ? "Box" : "Boxes") : (quantityNum === 1 ? "Pack" : "Packs")} of "${getProductName(selectedItem)}" sent to production.`,
      })

      reset()
      onOpenChange(false)
    } catch (error: any) {
      console.error("[OutgoingStockDialog] Production Error:", error)
      setShowConfirm(false)
      toast({
        title: "❌ Failed to Deduct Stock",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------
  const stepIndex = step === "product" ? 0 : step === "details" ? 1 : 2
  const STEPS = ["product", "details", "address"] as const

  // helper for formatting dates in summary
  const fmtDate = (d: any): string => {
    if (!d) return "-"
    try {
      const date = d instanceof Date ? d : d?.toDate ? d.toDate() : new Date(d)
      return isNaN(date.getTime()) ? "-" : format(date, "MMM dd, yyyy")
    } catch { return "-" }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-[92vw] !max-w-[1200px] !max-h-[none] !overflow-visible !p-0"
      >
        {/* =============== HEADER =============== */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-600 font-bold text-sm shrink-0">
                {stepIndex + 1}
              </div>
              <div>
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <Truck className="h-4 w-4 text-sky-500" />
                  Outgoing Stock -{" "}
                  {step === "product" ? "Select Product" : step === "details" ? "Details & Documents" : "Delivery Address"}
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Step {stepIndex + 1} of 3 - Creates a Pending delivery in Delivery Tracking
                </DialogDescription>
              </div>
            </div>
            <div className="mt-3 flex gap-1.5">
              {STEPS.map((s, i) => (
                <div key={s} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= stepIndex ? "bg-sky-500" : "bg-slate-200")} />
              ))}
            </div>
          </DialogHeader>
        </div>

        {/* =============== 2-COLUMN BODY =============== */}
        <div className="grid grid-cols-[1fr_380px] min-h-[520px]">

          {/* =============== LEFT COLUMN (Forms) =============== */}
          <div className="p-6 border-r border-slate-100 overflow-y-auto max-h-[70vh]">

            {/* =========== STEP 1 - Product Selector =========== */}
            {step === "product" && (
              <div className="grid gap-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Select a Product</p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input placeholder="Search by name, category, or barcode..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-10" autoFocus />
                </div>
                {errors.productId && (
                  <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {errors.productId}</p>
                )}
                <div className="max-h-[400px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                      <PackageOpen className="h-8 w-8 opacity-40" />
                      <p className="text-sm">{availableItems.length === 0 ? "No items with available stock" : "No items match your search"}</p>
                    </div>
                  ) : (
                    filteredItems.map((item) => {
                      const stock = resolveStockLeft(item)
                      const isSelected = formData.productId === item.id
                      return (
                        <button key={item.id} type="button"
                          onClick={() => handleProductSelect(item)}
                          className={cn("w-full flex items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50", isSelected && "bg-sky-50 hover:bg-sky-50")}>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-slate-800 truncate">{getProductName(item)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{item.category}{item.subcategory ? ` | ${item.subcategory}` : ""}{item.barcode && ` | ${item.barcode}`}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge className={cn("text-xs font-semibold", stock <= 5 ? "bg-orange-100 text-orange-700 border-orange-200" : "bg-green-100 text-green-700 border-green-200")} variant="outline">{stock} left</Badge>
                            {isSelected && <CheckCircle2 className="h-4 w-4 text-sky-500 shrink-0" />}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {/* =========== STEP 2 - Details & Documents =========== */}
            {step === "details" && selectedItem && (
              <div className="grid gap-5">
                {/* Scanned Item Banner */}
                {scannedItem && (
                  <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 shrink-0">
                      <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-emerald-700">Using Scanned Item 🔒</p>
                      <p className="text-xs text-emerald-600/80 truncate">{getProductName(selectedItem)} &bull; {selectedItem.barcode}</p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] shrink-0" variant="outline">Auto-filled 🔒</Badge>
                  </div>
                )}
                {/* Outgoing Type Selector */}
                <div className="grid gap-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Outgoing Purpose</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOutgoingType("delivery")}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border-2 px-4 py-3 text-left transition-all",
                        outgoingType === "delivery"
                          ? "border-sky-500 bg-sky-50 text-sky-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                      )}
                    >
                      <Truck className="h-5 w-5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">For Delivery</p>
                        <p className="text-[10px] opacity-70">Customer order dispatch</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOutgoingType("production")}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border-2 px-4 py-3 text-left transition-all",
                        outgoingType === "production"
                          ? "border-amber-500 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                      )}
                    >
                      <Factory className="h-5 w-5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">For Production</p>
                        <p className="text-[10px] opacity-70">Internal use / processing</p>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Quantity + Unit + Weight */}
                <div className="grid gap-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Stock & Transaction</p>
                  <div className="grid grid-cols-[1fr_110px] gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Quantity <span className="text-red-500">*</span> <span className="ml-2 text-xs font-normal text-slate-400">Max: {selectedStockLeft}</span></Label>
                      <Input type="number" min="1" max={selectedStockLeft} value={formData.quantity} onChange={(e) => handleQuantityChange(e.target.value)} placeholder={`1 - ${selectedStockLeft}`} className={cn("h-9", errors.quantity ? "border-destructive" : "")} />
                      {errors.quantity && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {errors.quantity}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                        Unit
                        <Lock className="h-3 w-3 text-amber-500" />
                      </Label>
                      {unitLoading ? (
                        <div className="h-9 px-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-slate-400 text-sm cursor-wait animate-pulse">
                          <span>Detecting…</span>
                        </div>
                      ) : (
                        <div className="h-9 px-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium cursor-not-allowed">
                          <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <span className="capitalize">{detectedUnit === "pack" ? "Pack" : "Box"}</span>
                          <span className="text-[10px] font-normal text-amber-600 ml-auto">🔒 Locked</span>
                        </div>
                      )}
                      {errors.unit && <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {errors.unit}</p>}
                    </div>
                  </div>
                  {/* Locked unit info note */}
                  <div className="col-span-full flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <p className="text-[11px] text-amber-700 leading-snug">
                      Unit is fixed based on available stock. Only <span className="font-bold uppercase">{detectedUnit === "pack" ? "Packs" : "Boxes"}</span> can be used for this product.
                    </p>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs font-medium text-slate-600">Total Weight <span className="text-slate-400">(kg, optional)</span></Label>
                    <div className="flex gap-2 items-center">
                      <Input type="number" min="0" step="0.01" value={formData.weightKg} onChange={(e) => setFormData((p) => ({ ...p, weightKg: e.target.value }))} placeholder="e.g. 25.5" className="h-9 flex-1" />
                      <span className="text-sm font-medium text-slate-500 shrink-0">kg</span>
                    </div>
                  </div>
                </div>

                {/* Delivery & Document Details - only for delivery type */}
                {outgoingType === "delivery" && (
                <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 grid gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-sky-500" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-sky-600">Delivery & Document Details</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Delivery Date <span className="text-red-500">*</span></Label>
                      <Button type="button" variant="outline" onClick={() => setDeliveryDateOpen(!deliveryDateOpen)}
                        className={cn("h-9 w-full justify-start text-left font-normal text-sm", !formData.deliveryDate && "text-muted-foreground", errors.deliveryDate && "border-destructive", deliveryDateOpen && "ring-2 ring-sky-200 border-sky-400")}>
                        <CalendarIcon className="mr-2 h-3.5 w-3.5 text-slate-500" />
                        {formData.deliveryDate ? format(formData.deliveryDate, "MMM dd, yyyy") : "Pick a date"}
                      </Button>
                      {deliveryDateOpen && (
                        <div ref={deliveryDateRef} className="absolute top-full left-0 mt-1 z-[9999] w-[280px] rounded-xl border bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                          <Calendar mode="single" selected={formData.deliveryDate} onSelect={(date) => { setFormData((p) => ({ ...p, deliveryDate: date })); setErrors((p) => ({ ...p, deliveryDate: "" })); setDeliveryDateOpen(false) }} initialFocus className="rounded-lg" />
                        </div>
                      )}
                      {errors.deliveryDate && <p className="text-[11px] text-destructive">{errors.deliveryDate}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Delivery Receipt No. <span className="text-red-500">*</span></Label>
                      <Input value={formData.deliveryReceiptNo} onChange={(e) => { setFormData((p) => ({ ...p, deliveryReceiptNo: e.target.value })); setErrors((p) => ({ ...p, deliveryReceiptNo: "" })) }} placeholder="e.g. DR-00123" className={cn("h-9", errors.deliveryReceiptNo ? "border-destructive" : "")} />
                      {errors.deliveryReceiptNo && <p className="text-[11px] text-destructive">{errors.deliveryReceiptNo}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Transfer Slip No. <span className="text-slate-400">(optional)</span></Label>
                      <Input value={formData.transferSlipNo} onChange={(e) => setFormData((p) => ({ ...p, transferSlipNo: e.target.value }))} placeholder="e.g. TS-00456" className="h-9" />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Sales Invoice No. <span className="text-red-500">*</span></Label>
                      <Input value={formData.salesInvoiceNo} onChange={(e) => { setFormData((p) => ({ ...p, salesInvoiceNo: e.target.value })); setErrors((p) => ({ ...p, salesInvoiceNo: "" })) }} placeholder="e.g. SI-00789" className={cn("h-9", errors.salesInvoiceNo ? "border-destructive" : "")} />
                      {errors.salesInvoiceNo && <p className="text-[11px] text-destructive">{errors.salesInvoiceNo}</p>}
                    </div>
                    <div className="relative grid gap-1 col-span-2">
                      <Label className="text-xs font-medium text-slate-600">Processing Date <span className="text-slate-400">(auto-filled today)</span></Label>
                      <Button type="button" variant="outline" onClick={() => setProcessingDateOpen(!processingDateOpen)}
                        className={cn("h-9 w-full justify-start text-left font-normal text-sm", !formData.processingDate && "text-muted-foreground", processingDateOpen && "ring-2 ring-sky-200 border-sky-400")}>
                        <CalendarIcon className="mr-2 h-3.5 w-3.5 text-slate-500" />
                        {formData.processingDate ? format(formData.processingDate, "MMM dd, yyyy") : "Pick a date"}
                      </Button>
                      {processingDateOpen && (
                        <div ref={processingDateRef} className="absolute bottom-full left-0 mb-1 z-[9999] w-[280px] rounded-xl border bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                          <Calendar mode="single" selected={formData.processingDate} onSelect={(date) => { setFormData((p) => ({ ...p, processingDate: date })); setProcessingDateOpen(false) }} initialFocus className="rounded-lg" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                )}

                {/* Production Document Details - only for production type */}
                {outgoingType === "production" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 grid gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-amber-500" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">Production Documents</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Production Date <span className="text-red-500">*</span></Label>
                      <Input
                        type="date"
                        value={formData.productionDate ? format(formData.productionDate, "yyyy-MM-dd") : ""}
                        onChange={(e) => {
                          const val = e.target.value
                          setFormData((p) => ({ ...p, productionDate: val ? new Date(val + "T00:00:00") : undefined }))
                          setErrors((p) => ({ ...p, productionDate: "" }))
                        }}
                        className={cn("h-9", errors.productionDate ? "border-destructive" : "")}
                      />
                      {errors.productionDate && <p className="text-[11px] text-destructive">{errors.productionDate}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Internal Reference No. <span className="text-slate-400">(optional)</span></Label>
                      <Input value={formData.internalReferenceNo} onChange={(e) => setFormData((p) => ({ ...p, internalReferenceNo: e.target.value }))} placeholder="e.g. IR-00123" className="h-9" />
                    </div>
                  </div>
                </div>
                )}

                {/* Customer Name - only for delivery type */}
                {outgoingType === "delivery" && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 grid gap-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-slate-500" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Customer Name</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">First Name <span className="text-red-500">*</span></Label>
                      <Input value={formData.firstName} onChange={(e) => { setFormData((p) => ({ ...p, firstName: e.target.value })); setErrors((p) => ({ ...p, firstName: "" })) }} placeholder="e.g. Juan" className={cn("h-9", errors.firstName ? "border-destructive" : "")} />
                      {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-600">Last Name <span className="text-red-500">*</span></Label>
                      <Input value={formData.lastName} onChange={(e) => { setFormData((p) => ({ ...p, lastName: e.target.value })); setErrors((p) => ({ ...p, lastName: "" })) }} placeholder="e.g. Dela Cruz" className={cn("h-9", errors.lastName ? "border-destructive" : "")} />
                      {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs font-medium text-slate-600">Middle Name <span className="text-slate-400">(optional)</span></Label>
                    <Input value={formData.middleName} onChange={(e) => setFormData((p) => ({ ...p, middleName: e.target.value }))} placeholder="e.g. Santos" className="h-9" />
                  </div>
                  {fullName && (
                    <div className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                      <p className="text-sm font-medium text-slate-700">{fullName}</p>
                    </div>
                  )}
                </div>
                )}
              </div>
            )}

            {/* =========== STEP 3 - Delivery Address =========== */}
            {step === "address" && (
              <div className="grid gap-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-sky-500" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Delivery Address</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-700">Region <span className="text-red-500">*</span></Label>
                      <Select value={formData.region} onValueChange={handleRegionChange}>
                        <SelectTrigger className={cn("h-9 rounded-lg", errors.region ? "border-destructive" : "")}><SelectValue placeholder="Select region..." /></SelectTrigger>
                        <SelectContent>{regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                      {errors.region && <p className="text-[11px] text-destructive">{errors.region}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-700">Province <span className="text-red-500">*</span></Label>
                      <Select value={formData.province} onValueChange={handleProvinceChange} disabled={!formData.region}>
                        <SelectTrigger className={cn("h-9 rounded-lg", errors.province ? "border-destructive" : "")}><SelectValue placeholder={formData.region ? "Select province..." : "Select region first"} /></SelectTrigger>
                        <SelectContent>{provinces.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {errors.province && <p className="text-[11px] text-destructive">{errors.province}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-700">City / Municipality <span className="text-red-500">*</span></Label>
                      <Select value={formData.city} onValueChange={handleCityChange} disabled={!formData.province}>
                        <SelectTrigger className={cn("h-9 rounded-lg", errors.city ? "border-destructive" : "")}><SelectValue placeholder={formData.province ? "Select city..." : "Select province first"} /></SelectTrigger>
                        <SelectContent>{cities.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {errors.city && <p className="text-[11px] text-destructive">{errors.city}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-700">Barangay <span className="text-red-500">*</span></Label>
                      <Select value={formData.barangay} onValueChange={handleBarangayChange} disabled={!formData.city}>
                        <SelectTrigger className={cn("h-9 rounded-lg", errors.barangay ? "border-destructive" : "")}><SelectValue placeholder={formData.city ? "Select barangay..." : "Select city first"} /></SelectTrigger>
                        <SelectContent className="max-h-[220px]">{barangays.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                      </Select>
                      {errors.barangay && <p className="text-[11px] text-destructive">{errors.barangay}</p>}
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs font-medium text-slate-700">ZIP Code <span className="text-red-500">*</span></Label>
                    <div className="relative">
                      <Input value={formData.zipCode} onChange={(e) => { const val = e.target.value.replace(/\D/g, "").slice(0, 6); setFormData((p) => ({ ...p, zipCode: val })); setErrors((p) => ({ ...p, zipCode: "" })) }}
                        placeholder="e.g. 1600" maxLength={6} className={cn("h-9 rounded-lg text-sm", errors.zipCode ? "border-destructive" : "")} />
                      {formData.city && formData.zipCode && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2"><Badge className="text-[10px] bg-sky-100 text-sky-700 border-sky-200" variant="outline">Auto-filled</Badge></div>
                      )}
                    </div>
                    {errors.zipCode && <p className="text-[11px] text-destructive">{errors.zipCode}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-700">House / Block / Lot <span className="text-red-500">*</span></Label>
                      <Input value={formData.houseNumber} onChange={(e) => { setFormData((p) => ({ ...p, houseNumber: e.target.value })); setErrors((p) => ({ ...p, houseNumber: "" })) }}
                        placeholder="e.g. Blk 5 Lot 12" className={cn("h-9 rounded-lg text-sm", errors.houseNumber ? "border-destructive" : "")} />
                      {errors.houseNumber && <p className="text-[11px] text-destructive">{errors.houseNumber}</p>}
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs font-medium text-slate-700">Street Name <span className="text-slate-400 font-normal">(optional)</span></Label>
                      <Input value={formData.streetName} onChange={(e) => setFormData((p) => ({ ...p, streetName: e.target.value }))} placeholder="e.g. Rizal Street" className="h-9 rounded-lg text-sm" />
                    </div>
                  </div>
                </div>
                <div className="rounded-lg p-2.5 grid gap-0.5" style={{ background: "#e0f2fe", border: "1px solid #bae6fd" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#0369a1" }}>Generated Full Address</p>
                  <p className={cn("text-[13px] leading-snug", fullAddress ? "font-medium" : "italic opacity-60")} style={{ color: fullAddress ? "#0369a1" : undefined }}>
                    {fullAddress || "Fill in the fields above..."}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* =============== RIGHT COLUMN (Summary Panel) =============== */}
          <div className="p-6 bg-slate-50/50 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">

            {/* STEP 1 - Selected Product Preview */}
            {step === "product" && (
              <>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Selected Product</p>
                {selectedItem ? (
                  <div className="rounded-xl border border-sky-200 bg-white p-4 grid gap-3">
                    <p className="text-lg font-bold text-slate-800">{getProductName(selectedItem)}</p>
                    <p className="text-xs font-mono text-slate-400">{selectedItem.barcode}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><p className="text-slate-400 uppercase text-[10px]">Category</p><p className="font-medium text-slate-700">{selectedItem.category}</p></div>
                      <div><p className="text-slate-400 uppercase text-[10px]">Subcategory</p><p className="font-medium text-slate-700">{(selectedItem as any).subcategory || "-"}</p></div>
                      <div><p className="text-slate-400 uppercase text-[10px]">Location</p><p className="font-medium text-slate-700">{(selectedItem as any).storageLocation ?? (selectedItem as any).location ?? "-"}</p></div>
                      <div><p className="text-slate-400 uppercase text-[10px]">Expiry</p><p className="font-medium text-slate-700">{fmtDate((selectedItem as any).expiryDate ?? (selectedItem as any).expirationDate)}</p></div>
                    </div>
                    <Badge className={cn("text-sm font-bold w-fit px-3 py-1", resolveStockLeft(selectedItem) <= 5 ? "bg-orange-100 text-orange-700 border-orange-200" : "bg-green-100 text-green-700 border-green-200")} variant="outline">
                      {resolveStockLeft(selectedItem)} Stock Left
                    </Badge>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center flex-1 text-center text-slate-300 gap-3 py-12">
                    <PackageOpen className="h-12 w-12 opacity-30" />
                    <p className="text-sm">Select a product from the list</p>
                  </div>
                )}
              </>
            )}

            {/* STEP 2 - Product + Stock Summary */}
            {step === "details" && selectedItem && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Product</p>
                  <p className="text-base font-bold text-slate-800">{getProductName(selectedItem)}</p>
                  <p className="text-xs font-mono text-slate-400">{selectedItem.barcode}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                    <div><p className="text-slate-400 uppercase text-[10px]">Category</p><p className="font-medium text-slate-700">{selectedItem.category}</p></div>
                    <div><p className="text-slate-400 uppercase text-[10px]">Subcategory</p><p className="font-medium text-slate-700">{(selectedItem as any).subcategory || "-"}</p></div>
                    <div><p className="text-slate-400 uppercase text-[10px]">Location</p><p className="font-medium text-slate-700">{(selectedItem as any).storageLocation ?? (selectedItem as any).location ?? "-"}</p></div>
                    <div><p className="text-slate-400 uppercase text-[10px]">Expiry</p><p className="font-medium text-slate-700">{fmtDate((selectedItem as any).expiryDate ?? (selectedItem as any).expirationDate)}</p></div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Stock Summary</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-center">
                      <p className="text-[10px] text-slate-400 uppercase">Current</p>
                      <p className="text-xl font-bold text-slate-700">{selectedStockLeft}</p>
                    </div>
                    <div className="rounded-lg bg-orange-50 border border-orange-200 p-2.5 text-center">
                      <p className="text-[10px] text-orange-500 uppercase">Outgoing</p>
                      <p className="text-xl font-bold text-orange-600">{quantityNum > 0 ? `-${quantityNum}` : "0"}</p>
                    </div>
                    <div className={cn("rounded-lg border p-2.5 text-center",
                      stockAfterDispatch === 0 ? "bg-red-50 border-red-200" : stockAfterDispatch <= 5 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
                    )}>
                      <p className={cn("text-[10px] uppercase", stockAfterDispatch === 0 ? "text-red-500" : stockAfterDispatch <= 5 ? "text-amber-500" : "text-emerald-500")}>Remaining</p>
                      <p className={cn("text-xl font-bold", stockAfterDispatch === 0 ? "text-red-600" : stockAfterDispatch <= 5 ? "text-amber-600" : "text-emerald-600")}>{stockAfterDispatch}</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* STEP 3 - Full Transaction Summary */}
            {step === "address" && selectedItem && (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Product</p>
                  <p className="font-bold text-slate-800">{getProductName(selectedItem)}</p>
                  <p className="text-xs font-mono text-slate-400">{selectedItem.barcode}</p>
                  <div className="grid grid-cols-2 gap-1 text-xs mt-1">
                    <p className="text-slate-500"><span className="text-slate-400">Cat:</span> {selectedItem.category}</p>
                    <p className="text-slate-500"><span className="text-slate-400">Sub:</span> {(selectedItem as any).subcategory || "-"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                    <p className="text-[10px] text-slate-400 uppercase">Current</p>
                    <p className="text-lg font-bold text-slate-700">{selectedStockLeft}</p>
                  </div>
                  <div className="rounded-lg bg-orange-50 border border-orange-200 p-2 text-center">
                    <p className="text-[10px] text-orange-500 uppercase">Out</p>
                    <p className="text-lg font-bold text-orange-600">-{quantityNum}</p>
                  </div>
                  <div className={cn("rounded-lg border p-2 text-center",
                    stockAfterDispatch === 0 ? "bg-red-50 border-red-200" : stockAfterDispatch <= 5 ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
                  )}>
                    <p className={cn("text-[10px] uppercase", stockAfterDispatch === 0 ? "text-red-500" : stockAfterDispatch <= 5 ? "text-amber-500" : "text-emerald-500")}>Left</p>
                    <p className={cn("text-lg font-bold", stockAfterDispatch === 0 ? "text-red-600" : stockAfterDispatch <= 5 ? "text-amber-600" : "text-emerald-600")}>{stockAfterDispatch}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Transaction Details</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-slate-400 uppercase text-[10px]">Delivery Date</p><p className="font-medium text-slate-700">{formData.deliveryDate ? format(formData.deliveryDate, "MMM dd, yyyy") : "-"}</p></div>
                    <div><p className="text-slate-400 uppercase text-[10px]">Processing Date</p><p className="font-medium text-slate-700">{formData.processingDate ? format(formData.processingDate, "MMM dd, yyyy") : "-"}</p></div>
                    <div><p className="text-slate-400 uppercase text-[10px]">Transfer Slip</p><p className="font-medium text-slate-700">{formData.transferSlipNo || "-"}</p></div>
                    <div><p className="text-slate-400 uppercase text-[10px]">DR No.</p><p className="font-medium text-slate-700">{formData.deliveryReceiptNo || "-"}</p></div>
                    <div className="col-span-2"><p className="text-slate-400 uppercase text-[10px]">Sales Invoice</p><p className="font-medium text-slate-700">{formData.salesInvoiceNo || "-"}</p></div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 grid gap-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600">Customer</p>
                  <p className="font-semibold text-slate-800 text-sm">{fullName || "-"}</p>
                  <p className="text-xs text-slate-500">{quantityNum} {formData.unit}(s){formData.weightKg ? ` | ${formData.weightKg} kg` : ""}</p>
                </div>
                <div className="rounded-lg p-3" style={{ background: "#e0f2fe", border: "1px solid #bae6fd" }}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "#0369a1" }}>Delivery Address</p>
                  <p className={cn("text-sm leading-snug", fullAddress ? "font-medium" : "italic opacity-60")} style={{ color: fullAddress ? "#0369a1" : undefined }}>
                    {fullAddress || "Not yet provided"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-slate-400 uppercase">Status</p>
                  <Badge className="bg-sky-100 text-sky-700 border-sky-200 text-[10px]" variant="outline">Pending</Badge>
                </div>
              </>
            )}
          </div>
        </div>

        {/* =============== FOOTER =============== */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          {step !== "product" && !(step === "details" && scannedItem) && (
            <Button type="button" variant="outline" onClick={handleBack} disabled={loading}>Back</Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          {step === "product" ? (
            <Button type="button" onClick={handleNext}
              disabled={!formData.productId}
              className="bg-sky-500 hover:bg-sky-600 text-white">
              Next
            </Button>
          ) : step === "details" && outgoingType === "production" ? (
            <Button type="button" onClick={() => { if (validateStep("details")) setShowConfirm(true) }}
              disabled={loading || quantityExceedsStock || !quantityNum}
              className="bg-amber-500 hover:bg-amber-600 text-white gap-2">
              <Factory className="h-4 w-4" />
              Confirm & Deduct Stock
            </Button>
          ) : step === "details" ? (
            <Button type="button" onClick={handleNext}
              disabled={quantityExceedsStock}
              className="bg-sky-500 hover:bg-sky-600 text-white">
              Next
            </Button>
          ) : (
            <Button type="button" onClick={() => { if (validateStep("address")) setShowConfirm(true) }} disabled={loading} className="bg-sky-500 hover:bg-sky-600 text-white gap-2">
              <Truck className="h-4 w-4" />
              Create Delivery
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>

    {/* =============== CONFIRMATION MODAL =============== */}
    <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-full shrink-0", outgoingType === "production" ? "bg-amber-100 text-amber-600" : "bg-amber-100 text-amber-600")}>
              {outgoingType === "production" ? <Factory className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            </div>
            <div>
              <AlertDialogTitle className="text-base">
                {outgoingType === "production" ? "Confirm Production Deduction" : "Confirm Delivery Creation"}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs mt-0.5">
                {outgoingType === "production"
                  ? "Are you sure you want to deduct this stock for production? This action will update the inventory."
                  : "Are you sure all details are correct? Please confirm that you have reviewed all product, stock, customer, and delivery information before proceeding."}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        {/* Summary Preview */}
        {selectedItem && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 grid gap-2.5 text-sm mt-1">
            <div className="flex items-start gap-2">
              <span className="text-slate-400 text-xs font-semibold uppercase w-20 shrink-0 pt-0.5">Product</span>
              <span className="font-medium text-slate-800">{getProductName(selectedItem!)}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-400 text-xs font-semibold uppercase w-20 shrink-0 pt-0.5">Quantity</span>
              <span className="font-medium text-slate-800">{quantityNum} {formData.unit}(s){formData.weightKg ? ` | ${formData.weightKg} kg` : ""}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-400 text-xs font-semibold uppercase w-20 shrink-0 pt-0.5">Purpose</span>
              <span className="font-medium text-slate-800">{outgoingType === "production" ? "For Production" : "For Delivery"}</span>
            </div>
            {outgoingType === "delivery" && (
              <>
                <div className="flex items-start gap-2">
                  <span className="text-slate-400 text-xs font-semibold uppercase w-20 shrink-0 pt-0.5">Customer</span>
                  <span className="font-medium text-slate-800">{fullName || "-"}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-slate-400 text-xs font-semibold uppercase w-20 shrink-0 pt-0.5">Address</span>
                  <span className="font-medium text-slate-800 text-xs leading-snug">{fullAddress || "-"}</span>
                </div>
              </>
            )}
          </div>
        )}

        <AlertDialogFooter className="mt-2">
          <Button type="button" variant="outline" onClick={() => setShowConfirm(false)} disabled={loading}>
            Go Back
          </Button>
          <Button type="button" onClick={() => { outgoingType === "production" ? handleSubmitProduction() : handleSubmit() }} disabled={loading}
            className={cn("gap-2 text-white", outgoingType === "production" ? "bg-amber-500 hover:bg-amber-600" : "bg-sky-500 hover:bg-sky-600")}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : outgoingType === "production" ? <Factory className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            {loading ? "Processing..." : outgoingType === "production" ? "Confirm & Deduct Stock" : "Confirm & Create Delivery"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
