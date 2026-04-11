"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { format } from "date-fns"
import { CalendarIcon, Barcode, RefreshCw, CheckCircle2, Loader2, Printer, Plus } from "lucide-react"
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { InventoryService, BarcodeService, TransactionService } from "@/services/firebase-service"
import { useToast } from "@/hooks/use-toast"
import {
  CATEGORIES,
  getTypesForCategory,
  getFilteredProducts,
  categoryPrefixMap,
  categoryRequiresProductName,
  buildProductDisplayName,
  type ProductEntry,
} from "@/lib/product-data"

interface AddItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scannedItem?: import("@/lib/types").InventoryItem | null
}


// ─── Barcode helpers ───────────────────────────────────────────────────────────

const TYPE_CODES: Record<string, string> = {
  Pork: "P",
  Beef: "B",
  Chicken: "C",
  Retail: "R",
  Others: "O",
}

/** Generates a 6-character random alphanumeric string (A-Z, 0-9) */
function generateRandomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/** Build an abbreviated product code (2-3 uppercase letters) from a product name */
function buildProductCode(productName: string): string {
  if (!productName) return ""
  // Take first letter of each word, up to 3 characters
  return productName
    .split(/[\s\-()]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0])
    .join("")
    .substring(0, 3)
    .toUpperCase()
}

/** Format a Date as YYYYMMDD string for barcode embedding */
function formatDateForBarcode(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}${m}${d}`
}

/** Builds a structured barcode: [CategoryCode][TypeCode][ProductCode]-[Random6]-[YYYYMMDD] */
function buildBarcode(category: string, type: string, productionDate: Date, productName?: string): string {
  const catCode = categoryPrefixMap[category] ?? category.slice(0, 2).toUpperCase()
  const typeCode = TYPE_CODES[type] ?? type.charAt(0).toUpperCase()
  const prodCode = productName ? buildProductCode(productName) : ""
  const random = generateRandomCode()
  const dateStr = formatDateForBarcode(productionDate)
  return `${catCode}${typeCode}${prodCode}-${random}-${dateStr}`
}

/** Keeps generating until a barcode is confirmed unique in Firestore */
async function generateUniqueBarcode(
  category: string,
  type: string,
  productionDate: Date,
  productName?: string,
  maxAttempts = 20,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = buildBarcode(category, type, productionDate, productName)
    const exists = await BarcodeService.checkBarcodeExists(candidate)
    if (!exists) return candidate
  }
  throw new Error("Could not generate a unique barcode after multiple attempts. Please try again.")
}

// ─── Component ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  barcode: "",
  barcodeBase: "",
  category: "",
  productType: "",
  productName: "",
  productionDate: undefined as Date | undefined,
  expirationDate: undefined as Date | undefined,
  incomingStock: "",
  incomingUnit: "box" as "box" | "pack",
  weightKg: "",
  avgWeightMin: "",
  avgWeightMax: "",
}

// Special sentinel value for "+ Add Item" option
const ADD_NEW_PRODUCT_SENTINEL = "__ADD_NEW_PRODUCT__"

export function AddItemDialog({ open, onOpenChange, scannedItem }: AddItemDialogProps) {
  const isScanned = !!scannedItem
  const { user } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const datePickerRef = useRef<HTMLDivElement>(null)

  // Barcode generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [barcodeReady, setBarcodeReady] = useState(false)

  const [formData, setFormData] = useState(EMPTY_FORM)

  // Custom product list (user-added products during session)
  const [customProducts, setCustomProducts] = useState<ProductEntry[]>([])
  // "+ Add Item" inline form
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [newProductName, setNewProductName] = useState("")

  const resetAll = useCallback(() => {
    setFormData(EMPTY_FORM)
    setErrors({})
    setDatePickerOpen(false)
    setIsGenerating(false)
    setBarcodeReady(false)
    setShowAddProduct(false)
    setNewProductName("")
  }, [])

  // ── Auto-fill from scanned item ─────────────────────────────────────────
  useEffect(() => {
    if (open && scannedItem) {
      const itemAny = scannedItem as any
      setFormData((prev) => ({
        ...prev,
        category: itemAny.category || "",
        productType: itemAny.productType || itemAny.subcategory || "",
        productName: itemAny.productName || itemAny.name || "",
        barcode: itemAny.barcode || "",
      }))
      if (itemAny.barcode) {
        setBarcodeReady(true)
      }
    } else if (!open) {
      resetAll()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Date picker outside-click / escape ──────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(event.target as Node)) {
        setDatePickerOpen(false)
      }
    }
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDatePickerOpen(false)
    }
    if (datePickerOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleEscapeKey)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscapeKey)
    }
  }, [datePickerOpen])

  // ── Derived values ────────────────────────────────────────────────────────
  const showProductDropdown = categoryRequiresProductName(formData.category)

  const availableTypes = formData.category
    ? getTypesForCategory(formData.category)
    : []

  const availableProducts = formData.category && formData.productType
    ? [
        ...getFilteredProducts(formData.category, formData.productType),
        ...customProducts.filter(
          (p) => p.category === formData.category && p.type === formData.productType
        ),
      ]
    : []

  // Auto-derived display name
  const autoProductName = (() => {
    if (formData.category === "Raw Material" && formData.productType) {
      return `Raw Material - ${formData.productType}`
    }
    if (formData.productName) {
      return formData.productName
    }
    if (formData.category && formData.productType) {
      return `${formData.category} - ${formData.productType}`
    }
    return ""
  })()

  // Generate a deterministic product ID based on the product name for batch grouping
  const productId = (autoProductName || formData.category)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")

  // ── Change handlers ───────────────────────────────────────────────────────
  const handleCategoryChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      category: value,
      productType: "",
      productName: "",
      barcode: "",
    }))
    setBarcodeReady(false)
    setShowAddProduct(false)
    setErrors((prev) => ({ ...prev, category: "", productType: "", productName: "", barcode: "" }))
  }

  const handleTypeChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      productType: value,
      productName: "",
      barcode: "",
    }))
    setBarcodeReady(false)
    setShowAddProduct(false)
    setErrors((prev) => ({ ...prev, productType: "", productName: "", barcode: "" }))
  }

  const handleProductNameChange = (value: string) => {
    if (value === ADD_NEW_PRODUCT_SENTINEL) {
      setShowAddProduct(true)
      return
    }
    setFormData((prev) => ({ ...prev, productName: value, barcode: "" }))
    setBarcodeReady(false)
    setErrors((prev) => ({ ...prev, productName: "", barcode: "" }))
  }

  // ── Add new product inline ────────────────────────────────────────────────
  const handleSaveNewProduct = () => {
    const trimmed = newProductName.trim()
    if (!trimmed) return

    const newEntry: ProductEntry = {
      category: formData.category,
      type: formData.productType,
      name: trimmed,
    }
    setCustomProducts((prev) => [...prev, newEntry])
    setFormData((prev) => ({ ...prev, productName: trimmed }))
    setShowAddProduct(false)
    setNewProductName("")
    setErrors((prev) => ({ ...prev, productName: "" }))

    toast({
      title: "Product Added",
      description: `"${trimmed}" has been added to the dropdown.`,
    })
  }

  // Check if we can generate barcode
  const canGenerate = (() => {
    if (!formData.category || !formData.productType) return false
    if (showProductDropdown && !formData.productName) return false
    if (!formData.productionDate) return false
    return true
  })()

  // ── Auto-generate barcode when all fields are selected ──────────────────
  const prevCanGenerateRef = useRef(false)
  useEffect(() => {
    // Only auto-trigger when canGenerate transitions from false → true
    // and no barcode exists yet
    if (canGenerate && !prevCanGenerateRef.current && !formData.barcode && !isGenerating) {
      handleGenerateBarcode()
    }
    prevCanGenerateRef.current = canGenerate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate, formData.barcode, isGenerating])

  // ── Barcode SVG ref for JsBarcode preview ────────────────────────────────
  const barcodeSvgRef = useRef<SVGSVGElement | null>(null)
  const [svgMounted, setSvgMounted] = useState(false)

  // Callback ref: fires the instant the <svg> enters the DOM
  const barcodeSvgCallbackRef = useCallback((node: SVGSVGElement | null) => {
    barcodeSvgRef.current = node
    setSvgMounted(!!node)
  }, [])

  useEffect(() => {
    if (!svgMounted || !barcodeSvgRef.current || !formData.barcode) return
    import("jsbarcode").then((mod) => {
      const JsBarcode = mod.default || mod
      try {
        JsBarcode(barcodeSvgRef.current!, formData.barcode, {
          format: "CODE128",
          width: 2.5,
          height: 90,
          displayValue: true,
          fontSize: 16,
          fontOptions: "bold",
          margin: 10,
          background: "#ffffff",
          lineColor: "#000000",
        })
      } catch (err) {
        console.error("[JsBarcode] render error:", err)
      }
    })
  }, [svgMounted, formData.barcode])

  // ── Generate Unique Barcode ─────────────────────────────────────────────
  const handleGenerateBarcode = async () => {
    if (!canGenerate || isGenerating || !formData.productionDate) return
    setIsGenerating(true)
    setBarcodeReady(false)
    setFormData((prev) => ({ ...prev, barcode: "", barcodeBase: "" }))
    setErrors((prev) => ({ ...prev, barcode: "" }))

    try {
      // Generate the full barcode: [CatTypeProduct]-[Random6]-[YYYYMMDD]
      const finalBarcode = await generateUniqueBarcode(
        formData.category,
        formData.productType,
        formData.productionDate,
        formData.productName || undefined,
      )

      // Derive the base (everything before the date suffix)
      const parts = finalBarcode.split("-")
      const barcodeBase = parts.slice(0, -1).join("-") // e.g. FPPBB-KCY2H7

      // Save the barcode to generated_barcodes collection
      await BarcodeService.saveBarcodeRecord({
        barcode: finalBarcode,
        category: formData.category,
        productName: autoProductName || formData.category,
      })

      setFormData((prev) => ({
        ...prev,
        barcode: finalBarcode,
        barcodeBase: barcodeBase,
      }))
      setBarcodeReady(true)

      // Build formatted dates for the toast
      const prodDateFormatted = format(formData.productionDate, "MMMM dd, yyyy")
      toast({
        title: "Barcode Generated & Saved",
        description: `Barcode: ${finalBarcode} | Production: ${prodDateFormatted}`,
      })
    } catch (error: any) {
      toast({
        title: "Barcode Generation Failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }

  // ── Print barcode (hidden iframe — won't be blocked by popup blocker) ───
  const handlePrintBarcode = () => {
    const printArea = document.getElementById("barcode-print-area")
    if (!printArea) return

    const svgEl = printArea.querySelector("svg")
    if (!svgEl) return

    const svgHtml = svgEl.outerHTML

    // Create a hidden iframe
    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.top = "-10000px"
    iframe.style.left = "-10000px"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "none"
    document.body.appendChild(iframe)

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) {
      document.body.removeChild(iframe)
      return
    }

    const displayName = autoProductName || formData.category
    const barcodeText = formData.barcode
    const productionDateStr = formData.productionDate
      ? format(formData.productionDate, "MMM dd, yyyy")
      : "—"
    const expirationDateStr = formData.expirationDate
      ? format(formData.expirationDate, "MMM dd, yyyy")
      : "—"

    iframeDoc.open()
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Barcode</title>
          <style>
            @page {
              margin: 8mm;
            }
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              background: white;
              font-family: Arial, Helvetica, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .label {
              text-align: center;
              padding: 12px 20px;
              max-width: 420px;
              width: 100%;
            }
            .product-name {
              font-size: 15pt;
              font-weight: 700;
              letter-spacing: 0.5px;
              margin-bottom: 6px;
              line-height: 1.2;
            }
            .barcode-text {
              font-size: 10pt;
              font-family: 'Courier New', Courier, monospace;
              font-weight: 600;
              letter-spacing: 2.5px;
              color: #222;
              margin-bottom: 8px;
            }
            .barcode-img {
              margin: 4px auto 8px;
              display: flex;
              justify-content: center;
            }
            .barcode-img svg {
              max-width: 100%;
              height: auto;
            }
            .barcode-text-bottom {
              font-size: 10pt;
              font-family: 'Courier New', Courier, monospace;
              font-weight: 600;
              letter-spacing: 2.5px;
              color: #222;
              margin-bottom: 10px;
            }
            .separator {
              width: 60%;
              margin: 0 auto 10px;
              border: none;
              border-top: 1px dashed #bbb;
            }
            .dates {
              display: flex;
              flex-direction: column;
              gap: 3px;
              align-items: center;
            }
            .date-row {
              font-size: 9.5pt;
              color: #333;
              line-height: 1.5;
            }
            .date-label {
              font-weight: 600;
            }
            .date-value {
              font-weight: 400;
            }
          </style>
        </head>
        <body>
          <div class="label">
            <div class="product-name">${displayName}</div>
            <div class="barcode-text">${barcodeText}</div>
            <div class="barcode-img">${svgHtml}</div>
            <div class="barcode-text-bottom">${barcodeText}</div>
            <hr class="separator" />
            <div class="dates">
              <div class="date-row">
                <span class="date-label">Production Date:</span>
                <span class="date-value">${productionDateStr}</span>
              </div>
              <div class="date-row">
                <span class="date-label">Expiration Date:</span>
                <span class="date-value">${expirationDateStr}</span>
              </div>
            </div>
          </div>
        </body>
      </html>
    `)
    iframeDoc.close()

    // Wait for iframe to render, then print
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        // Remove iframe after printing
        setTimeout(() => {
          document.body.removeChild(iframe)
        }, 1000)
      }, 250)
    }

    // Fallback if onload doesn't fire (already loaded)
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe)
          }
        }, 1000)
      }
    }, 500)
  }

  // ── Validation ─────────────────────────────────────────────────────────

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.barcode.trim()) {
      newErrors.barcode = "Barcode is required — click 'Generate Unique Barcode' first"
    }
    if (!formData.category) newErrors.category = "Category is required"
    if (!formData.productType) newErrors.productType = "Type is required"
    if (showProductDropdown && !formData.productName) {
      newErrors.productName = "Product name is required"
    }
    if (!formData.expirationDate) newErrors.expirationDate = "Expiration date is required"

    const incomingNum = Number(formData.incomingStock.trim())
    if (formData.incomingStock.trim() === "" || isNaN(incomingNum) || incomingNum < 0) {
      newErrors.incomingStock = "Incoming stock must be a valid number (0 or greater)"
    }


    // Average weight validation
    const avgMin = parseFloat(formData.avgWeightMin)
    const avgMax = parseFloat(formData.avgWeightMax)
    const totalWeight = parseFloat(formData.weightKg)
    const packs = parseInt(formData.incomingStock)
    if (formData.avgWeightMin && formData.avgWeightMax && formData.weightKg && formData.incomingStock) {
      if (!isNaN(avgMin) && !isNaN(avgMax) && !isNaN(totalWeight) && !isNaN(packs) && packs > 0) {
        const weightPerPack = totalWeight / packs
        if (weightPerPack < avgMin || weightPerPack > avgMax) {
          newErrors.weightKg = `Weight per pack (${weightPerPack.toFixed(2)} kg) is outside the average range (${avgMin}-${avgMax} kg)`
          newErrors.avgWeight = `Computed ${weightPerPack.toFixed(2)} kg/pack does not match range`
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to add items.",
        variant: "destructive",
      })
      return
    }

    if (!validateForm()) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields correctly.",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    try {
      const incoming = Number.parseInt(formData.incomingStock) || 0
      const stockLeft = incoming

      const itemData: any = {
        barcode: formData.barcode.trim(),
        barcode_base: formData.barcodeBase || formData.barcode.trim(),
        product_id: productId,
        name: autoProductName || formData.category,
        category: formData.category,
        productType: formData.productType,
        productName: formData.productName || null,
        // Legacy compatibility
        subcategory: formData.productName || formData.productType || null,
        incoming,
        outgoing: 0,
        stock: stockLeft,
        total: stockLeft,
        stockSource: "incoming",
        goodReturnStock: 0,
        damageReturnStock: 0,
        productionDate: formData.productionDate || null,
        expiryDate: formData.expirationDate || null,
        expirationDate: formData.expirationDate || null,
        unit_type: formData.incomingUnit.toUpperCase(),
        avg_weight: formData.weightKg ? parseFloat(formData.weightKg) : 0,
        avgWeightMin: formData.avgWeightMin ? parseFloat(formData.avgWeightMin) : null,
        avgWeightMax: formData.avgWeightMax ? parseFloat(formData.avgWeightMax) : null,
        qualityStatus: "GOOD" as const,
        transactionDocuments: {
          transaction_type: "incoming",
          source: "incoming",
        },
        createdBy: user.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      await InventoryService.addItem(itemData)

      // APPEND-ONLY LEDGER: Always create a NEW transaction row for every incoming event
      const avgWeight = formData.weightKg ? parseFloat(formData.weightKg) : 0

      console.log("[AddItem] Payload avg_weight:", avgWeight)

      await TransactionService.addTransaction({
        transaction_date: new Date(),
        product_name: autoProductName || formData.category,
        product_id: productId,
        barcode: formData.barcode.trim(),
        barcode_base: formData.barcodeBase || formData.barcode.trim(),
        category: formData.category,
        type: formData.productType,
        unit_type: formData.incomingUnit.toUpperCase(),
        incoming_qty: incoming,
        incoming_packs: incoming,
        incoming_unit: formData.incomingUnit,
        avg_weight: avgWeight,
        outgoing_qty: 0,
        outgoing_packs: 0,
        good_return: 0,
        damage_return: 0,
        stock_left: stockLeft,
        production_date: formData.productionDate || null,
        expiry_date: formData.expirationDate || null,
        reference_no: "",
        source: "incoming",
        process_date: null,
        created_at: new Date(),
      } as any)

      toast({
        title: "✅ Item Successfully Added",
        description: `${itemData.name} has been added to inventory.`,
      })

      resetAll()
      onOpenChange(false)
    } catch (error: any) {
      console.error("Error adding item:", error)
      toast({
        title: "❌ Failed to Add Item",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      resetAll()
      onOpenChange(false)
    }
  }

  // Stock left preview
  const incoming = Number.parseInt(formData.incomingStock) || 0
  const stockLeft = incoming

  // ── Category color helper ─────────────────────────────────────────────────
  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "Raw Material": return "bg-amber-100 text-amber-800 border-amber-200"
      case "Finished Product": return "bg-green-100 text-green-800 border-green-200"
      case "By-product": return "bg-yellow-100 text-yellow-800 border-yellow-200"
      default: return ""
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="!w-[98vw] sm:!w-[95vw] md:!w-[92vw] !max-w-[1220px] !max-h-[95vh] sm:!max-h-[92vh] !overflow-visible !p-0"
      >
        <div className="p-3 sm:p-4 md:p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg md:text-xl">{isScanned ? "Add Stock to Scanned Item" : "Add New Inventory Item"}</DialogTitle>
            <DialogDescription>
              {isScanned
                ? "Product details are locked from scan. Fill in stock entry details below."
                : "Fill in the details below to add a new item to your inventory."}
            </DialogDescription>
          </DialogHeader>
          {/* Scanned Item Banner */}
          {isScanned && scannedItem && (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 mt-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-700">Using Scanned Item \uD83D\uDD12</p>
                <p className="text-xs text-emerald-600/80 truncate">
                  {(scannedItem as any).name || scannedItem.category} &bull; {scannedItem.barcode}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 shrink-0">Auto-filled \uD83D\uDD12</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* ── 2-COLUMN LAYOUT: 65/35 split ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 sm:gap-5 md:gap-6 p-3 sm:p-4 md:p-6 max-h-[calc(95vh-180px)] sm:max-h-[calc(92vh-180px)] overflow-y-auto overflow-x-visible">

            {/* ════════════════ LEFT COLUMN: All Form Sections ════════════════ */}
            <div className="flex flex-col gap-5 min-w-0">

              {/* ── 1. PRODUCT CLASSIFICATION ─────────────────────────────── */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-5 grid gap-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">Product Classification</p>

                {/* Category + Type side-by-side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700">
                      Category <span className="text-red-500">*</span>
                    </Label>
                    {isScanned ? (
                      <div className="h-9 px-3 flex items-center rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800 cursor-not-allowed">
                        <span>{formData.category || "—"}</span>
                        <span className="text-[10px] font-normal text-emerald-600 ml-auto">\uD83D\uDD12 Locked</span>
                      </div>
                    ) : (
                    <Select value={formData.category} onValueChange={handleCategoryChange}>
                      <SelectTrigger className={cn("h-9", errors.category ? "border-destructive" : "")}>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            <span className="flex items-center gap-2">
                              <span className={cn(
                                "inline-block w-2 h-2 rounded-full",
                                cat === "Raw Material" ? "bg-amber-500" :
                                cat === "Finished Product" ? "bg-green-500" :
                                "bg-yellow-500"
                              )} />
                              {cat}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    )}
                    {errors.category && <p className="text-xs text-destructive">{errors.category}</p>}
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700">
                      Type <span className="text-red-500">*</span>
                    </Label>
                    {isScanned ? (
                      <div className="h-9 px-3 flex items-center rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800 cursor-not-allowed">
                        <span>{formData.productType || "—"}</span>
                        <span className="text-[10px] font-normal text-emerald-600 ml-auto">\uD83D\uDD12 Locked</span>
                      </div>
                    ) : (
                    <Select
                      value={formData.productType}
                      onValueChange={handleTypeChange}
                      disabled={!formData.category}
                    >
                      <SelectTrigger className={cn("h-9", errors.productType ? "border-destructive" : "")}>
                        <SelectValue placeholder={formData.category ? "Select type" : "Select category first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTypes.map((t) => (
                          <SelectItem key={t} value={t}>
                            <span className="flex items-center gap-2">
                              <span className="text-base">
                                {t === "Beef" ? "\uD83D\uDC04" : t === "Pork" ? "\uD83D\uDC37" : t === "Chicken" ? "\uD83D\uDC14" : t === "Retail" ? "\uD83D\uDED2" : "\uD83D\uDCE6"}
                              </span>
                              {t}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    )}
                    {errors.productType && <p className="text-xs text-destructive">{errors.productType}</p>}
                  </div>
                </div>

                {/* Product Name dropdown — only for Finished Product & By-product */}
                {showProductDropdown && formData.productType && (
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700">
                      Product Name <span className="text-red-500">*</span>
                    </Label>
                    {isScanned ? (
                      <div className="h-9 px-3 flex items-center rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800 cursor-not-allowed">
                        <span>{formData.productName || "\u2014"}</span>
                        <span className="text-[10px] font-normal text-emerald-600 ml-auto">\uD83D\uDD12 Locked</span>
                      </div>
                    ) : !showAddProduct ? (
                      <>
                        <Select
                          value={formData.productName}
                          onValueChange={handleProductNameChange}
                        >
                          <SelectTrigger className={cn("h-9", errors.productName ? "border-destructive" : "")}>
                            <SelectValue placeholder="Select product name" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel className="text-xs text-slate-400">
                                {formData.category} — {formData.productType}
                              </SelectLabel>
                              {availableProducts.map((p) => (
                                <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                              ))}
                            </SelectGroup>
                            <SelectGroup>
                              <SelectItem value={ADD_NEW_PRODUCT_SENTINEL}>
                                <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                                  <Plus className="h-3.5 w-3.5" />
                                  Add Item
                                </span>
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {errors.productName && <p className="text-xs text-destructive">{errors.productName}</p>}
                      </>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          value={newProductName}
                          onChange={(e) => setNewProductName(e.target.value)}
                          placeholder="Enter new product name"
                          className="h-9 flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              handleSaveNewProduct()
                            }
                            if (e.key === "Escape") {
                              setShowAddProduct(false)
                              setNewProductName("")
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 px-3"
                          onClick={handleSaveNewProduct}
                          disabled={!newProductName.trim()}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-9 px-2"
                          onClick={() => {
                            setShowAddProduct(false)
                            setNewProductName("")
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Raw Material info banner */}
                {formData.category === "Raw Material" && formData.productType && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <span className="text-base">🥩</span>
                    <p className="text-xs text-amber-700">
                      <span className="font-semibold">Raw Material</span> — represents whole/boxed meat (unprocessed). No product name selection needed.
                    </p>
                  </div>
                )}
              </div>

              {/* Product Name Preview */}
              {autoProductName && (
                <div className="grid gap-1.5 -mt-1">
                  <Label className="text-sm font-medium text-slate-700">
                    Product Name <span className="text-slate-400 font-normal">(auto-generated)</span>
                  </Label>
                  <div className="h-9 px-3 flex items-center rounded-md border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700">
                    {autoProductName}
                  </div>
                </div>
              )}

              {/* ── 2. STOCK ENTRY ────────────────────────────────────────── */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-5 grid gap-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-blue-500">Stock Entry</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Incoming Stock */}
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700">
                      Incoming Stock <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex gap-1.5">
                      <Input
                        id="incomingStock"
                        type="number"
                        min="0"
                        value={formData.incomingStock}
                        onChange={(e) => {
                          setFormData((prev) => ({ ...prev, incomingStock: e.target.value }))
                          setErrors((prev) => ({ ...prev, incomingStock: "" }))
                        }}
                        placeholder="e.g. 25"
                        className={cn("h-9 flex-1", errors.incomingStock ? "border-destructive" : "")}
                      />
                      <Select
                        value={formData.incomingUnit}
                        onValueChange={(v) => setFormData((prev) => ({ ...prev, incomingUnit: v as "box" | "pack" }))}
                      >
                        <SelectTrigger className="h-9 w-[80px] shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="box">Box</SelectItem>
                          <SelectItem value="pack">Pack</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {errors.incomingStock && <p className="text-xs text-destructive">{errors.incomingStock}</p>}
                  </div>

                  {/* Weight */}
                  <div className="grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700">
                      Weight <span className="text-slate-400 font-normal">(kg)</span>
                    </Label>
                    <div className="flex gap-1.5 items-center">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.weightKg}
                        onChange={(e) => {
                          setFormData((prev) => ({ ...prev, weightKg: e.target.value }))
                          setErrors((prev) => ({ ...prev, weightKg: "", avgWeight: "" }))
                        }}
                        placeholder="e.g. 25.5"
                        className={cn("h-9 flex-1", errors.weightKg ? "border-red-500 bg-red-50" : "")}
                      />
                      <span className="text-sm font-medium text-slate-500 shrink-0">kg</span>
                    </div>
                    {errors.weightKg && <p className="text-xs text-red-600">{errors.weightKg}</p>}
                  </div>
                </div>

                {/* Weight Range (optional) */}
                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700">
                    Weight Range <span className="text-slate-400 font-normal">(kg per pack/box, optional)</span>
                  </Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.avgWeightMin}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, avgWeightMin: e.target.value }))
                        setErrors((prev) => ({ ...prev, avgWeight: "" }))
                      }}
                      placeholder="Min (e.g. 4)"
                      className={cn("h-9 flex-1", errors.avgWeight ? "border-red-500 bg-red-50" : "")}
                    />
                    <span className="text-sm font-medium text-slate-400">to</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={formData.avgWeightMax}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, avgWeightMax: e.target.value }))
                        setErrors((prev) => ({ ...prev, avgWeight: "" }))
                      }}
                      placeholder="Max (e.g. 5)"
                      className={cn("h-9 flex-1", errors.avgWeight ? "border-red-500 bg-red-50" : "")}
                    />
                    <span className="text-sm font-medium text-slate-500 shrink-0">kg</span>
                  </div>
                  {errors.avgWeight && <p className="text-xs text-red-600">{errors.avgWeight}</p>}
                  {(() => {
                    const packs = parseInt(formData.incomingStock)
                    const weight = parseFloat(formData.weightKg)
                    const min = parseFloat(formData.avgWeightMin)
                    const max = parseFloat(formData.avgWeightMax)
                    if (!isNaN(packs) && packs > 0 && !isNaN(weight) && !isNaN(min) && !isNaN(max)) {
                      const wpp = weight / packs
                      const ok = wpp >= min && wpp <= max
                      return (
                        <p className={cn("text-xs font-medium", ok ? "text-emerald-600" : "text-red-600")}>
                          {ok ? "✓" : "✗"} Weight per pack: {wpp.toFixed(2)} kg (range: {min}-{max} kg)
                        </p>
                      )
                    }
                    return null
                  })()}
                </div>
              </div>

              {/* ── 3. PRODUCTION, EXPIRATION & STORAGE ──────────────────── */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-5 grid gap-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Production, Expiration & Storage</p>
                {/* Production Date */}
                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700">
                    Production Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="date"
                    value={formData.productionDate ? format(formData.productionDate, "yyyy-MM-dd") : ""}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val) {
                        const parsed = new Date(val + "T00:00:00")
                        if (!isNaN(parsed.getTime())) {
                          setFormData((prev) => ({ ...prev, productionDate: parsed, barcode: "" }))
                          setBarcodeReady(false)
                          if (errors.productionDate) {
                            setErrors((prev) => ({ ...prev, productionDate: "" }))
                          }
                        }
                      } else {
                        setFormData((prev) => ({ ...prev, productionDate: undefined, barcode: "" }))
                        setBarcodeReady(false)
                      }
                    }}
                    className={cn(
                      "h-9 text-sm",
                      errors.productionDate && "border-destructive",
                      formData.productionDate && "text-slate-800 font-medium"
                    )}
                  />
                  {errors.productionDate && <p className="text-xs text-destructive">{errors.productionDate}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative grid gap-1.5">
                    <Label className="text-sm font-medium text-slate-700">
                      Expiration Date <span className="text-red-500">*</span>
                    </Label>
                    {/* Manual date input */}
                    <div className="flex gap-1.5">
                      <Input
                        type="date"
                        value={formData.expirationDate ? format(formData.expirationDate, "yyyy-MM-dd") : ""}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val) {
                            const parsed = new Date(val + "T00:00:00")
                            if (!isNaN(parsed.getTime())) {
                              setFormData((prev) => ({ ...prev, expirationDate: parsed }))
                              if (errors.expirationDate) {
                                setErrors((prev) => ({ ...prev, expirationDate: "" }))
                              }
                            }
                          } else {
                            setFormData((prev) => ({ ...prev, expirationDate: undefined }))
                          }
                        }}
                        className={cn(
                          "h-9 flex-1 text-sm",
                          errors.expirationDate && "border-destructive",
                          formData.expirationDate && "text-slate-800 font-medium"
                        )}
                      />
                    </div>
                    {errors.expirationDate && <p className="text-xs text-destructive">{errors.expirationDate}</p>}
                  </div>
                </div>
              </div>
            </div>

            {/* ════════════════ RIGHT COLUMN: Barcode Generator ════════════════ */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              <div className={`rounded-xl border-2 border-slate-200 bg-gradient-to-b from-slate-50 to-white p-6 grid gap-5 transition-opacity duration-200 shadow-sm ${!isScanned && !canGenerate ? 'opacity-40 pointer-events-none' : ''}`}>
                <div className="flex items-center gap-2.5 pb-1 border-b border-slate-100">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Barcode className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {isScanned ? "Barcode (Scanned)" : "Barcode Generator"}
                    </p>
                    <p className="text-[10px] text-slate-400">CODE128 format</p>
                  </div>
                </div>

                {/* Generate button — hidden when scanned */}
                {!isScanned && (
                  <>
                    <Button
                      type="button"
                      onClick={handleGenerateBarcode}
                      disabled={!canGenerate || isGenerating}
                      className={cn(
                        "h-12 w-full font-semibold transition-all duration-200 gap-2 text-sm shadow-sm",
                        barcodeReady
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20",
                        (!canGenerate && !isGenerating) && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Checking uniqueness…
                        </>
                      ) : barcodeReady ? (
                        <>
                          <RefreshCw className="h-4 w-4" />
                          Re-generate Barcode
                        </>
                      ) : (
                        <>
                          <Barcode className="h-4 w-4" />
                          Generate Unique Barcode
                        </>
                      )}
                    </Button>
                    {!canGenerate && (
                      <p className="text-xs text-slate-400 text-center -mt-1">
                        {!formData.category
                          ? "Select Category and Type first"
                          : !formData.productType
                            ? "Select Type first"
                            : showProductDropdown && !formData.productName
                              ? "Select Product Name first"
                              : !formData.productionDate
                                ? "Set Production Date first"
                                : "Complete required fields first"}
                      </p>
                    )}
                  </>
                )}

                {/* Barcode value display */}
                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    Barcode <span className="text-red-500">*</span>
                    {barcodeReady && (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                        <CheckCircle2 className="h-3 w-3" />
                        Unique &amp; Ready
                      </span>
                    )}
                  </Label>
                  <div
                    className={cn(
                      "h-10 px-3 flex items-center rounded-md border text-sm font-mono tracking-widest transition-colors",
                      barcodeReady
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-400",
                      errors.barcode ? "border-destructive" : ""
                    )}
                  >
                    {formData.barcode || (
                      <span className="font-sans tracking-normal text-slate-400">
                        {isGenerating ? "Generating…" : "Auto-filled after generation"}
                      </span>
                    )}
                  </div>
                  {errors.barcode && <p className="text-xs text-destructive">{errors.barcode}</p>}
                </div>

                {/* Production & Expiration Date display (read-only) */}
                {barcodeReady && (
                  <div className="grid gap-3">
                    {formData.productionDate && (
                      <div className="grid gap-1.5">
                        <Label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                          Production Date
                          <span className="inline-flex items-center text-[10px] font-normal text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                            Embedded in barcode
                          </span>
                        </Label>
                        <div className="h-10 px-3 flex items-center justify-between rounded-md border border-violet-200 bg-violet-50 text-sm transition-colors">
                          <span className="font-semibold text-violet-700 tracking-wide">
                            {format(formData.productionDate, "MMMM dd, yyyy")}
                          </span>
                          <span className="text-[10px] text-violet-400 font-normal font-mono">
                            {formatDateForBarcode(formData.productionDate)}
                          </span>
                        </div>
                      </div>
                    )}
                    {formData.expirationDate && (
                      <div className="grid gap-1.5">
                        <Label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                          Expiration Date
                        </Label>
                        <div className="h-10 px-3 flex items-center justify-between rounded-md border border-orange-200 bg-orange-50 text-sm transition-colors">
                          <span className="font-semibold text-orange-700 tracking-wide">
                            {format(formData.expirationDate, "MMMM dd, yyyy")}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Large Barcode Preview (printable) ──────────────── */}
                <div className="grid gap-1.5">
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    Barcode Preview
                    <span className="text-slate-400 font-normal text-xs">(CODE128)</span>
                  </Label>
                  <div
                    id="barcode-print-area"
                    className={cn(
                      "rounded-xl border-2 flex flex-col items-center justify-center transition-colors min-h-[170px] bg-white p-4",
                      barcodeReady
                        ? "border-emerald-200 shadow-sm shadow-emerald-100"
                        : "border-dashed border-slate-200"
                    )}
                  >
                    {barcodeReady ? (
                      <svg ref={barcodeSvgCallbackRef} className="w-full max-w-full" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 py-6 text-slate-400">
                        <Barcode className="h-10 w-10 opacity-20" />
                        <p className="text-xs">No barcode generated yet</p>
                        <p className="text-[10px] text-slate-300">Select category & type to begin</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Print button */}
                {barcodeReady && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrintBarcode}
                    className="h-11 w-full gap-2 border-slate-300 hover:bg-slate-50 font-medium text-sm"
                  >
                    <Printer className="h-4 w-4" />
                    Print Barcode
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? "Adding…" : "Add Item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}