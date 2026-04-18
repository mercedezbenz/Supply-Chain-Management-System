"use client"

import { useRef, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { doc, updateDoc, collection, addDoc, serverTimestamp, getDocs, query, where } from "firebase/firestore"
import { getFirebaseDb, auth } from "@/lib/firebase-live"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import {
  ArrowLeft, User, MapPin, Phone, Mail, Package, CheckCircle2,
  XCircle, Clock, Printer, Receipt, FileText,
} from "lucide-react"
import { useOrderDetails } from "@/hooks/useOrderDetails"
import { ReceiptView } from "./receipt-view"
import { AuthLoadingSkeleton } from "@/components/skeletons/dashboard-skeleton"
import { useAuth } from "@/hooks/use-auth"

// ─── Helpers ───
const parseDate = (d: any): Date | null => {
  if (!d) return null
  if (typeof d === "string") return new Date(d)
  if (d instanceof Date) return d
  if (d?.toDate) return d.toDate()
  if (d?.seconds) return new Date(d.seconds * 1000)
  return null
}

const formatDate = (d: any): string => {
  const date = parseDate(d)
  if (!date || isNaN(date.getTime())) return "N/A"
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

const formatTime = (d: any): string => {
  const date = parseDate(d)
  if (!date || isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

const formatCurrency = (amount: number): string =>
  `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Status badge
const StatusBadge = ({ status }: { status: string }) => {
  let cls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase "
  let icon = null

  switch (status) {
    case "pending":
      cls += "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
      icon = <Clock className="h-3.5 w-3.5" />
      break
    case "ready_for_processing":
      cls += "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800"
      icon = <Clock className="h-3.5 w-3.5" />
      break
    case "completed":
      cls += "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
      icon = <CheckCircle2 className="h-3.5 w-3.5" />
      break
    case "cancelled":
      cls += "bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
      icon = <XCircle className="h-3.5 w-3.5" />
      break
    default:
      cls += "bg-gray-50 text-gray-600 border border-gray-200"
  }

  return <span className={cls}>{icon}{status}</span>
}

interface OrderDetailsProps {
  orderId: string
}

export function OrderDetails({ orderId }: OrderDetailsProps) {
  const router = useRouter()
  const { order, loading, updateStatus } = useOrderDetails(orderId)
  const { user, isReadOnly } = useAuth()
  const isSales = user?.role?.toLowerCase() === "sales"
  const receiptRef = useRef<HTMLDivElement>(null)

  const [confirmAction, setConfirmAction] = useState<"pending" | "ready_for_processing" | "completed" | "cancelled" | null>(null)
  const [updating, setUpdating] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  
  // Fulfillment Fields
  const [invoiceNo, setInvoiceNo] = useState("")
  const [receiptNo, setReceiptNo] = useState("")

  useEffect(() => {
    if (order) {
      setInvoiceNo(order.salesInvoiceNo || "")
      setReceiptNo(order.deliveryReceiptNo || "")
    }
  }, [order])

  const handleFieldBlur = async (field: "salesInvoiceNo" | "deliveryReceiptNo", value: string) => {
    if (!order) return
    // Only update if changed
    if (order[field] === value) return
    
    try {
      const db = getFirebaseDb()
      await updateDoc(doc(db, "orders", orderId), { [field]: value })
      toast.success("Order details saved")
    } catch (error: any) {
      toast.error("Failed to save: " + error.message)
    }
  }

  const handleConfirmInvoice = async () => {
    if (!auth.currentUser) {
      toast.error("User not authenticated")
      return
    }

    if (!invoiceNo.trim() || !receiptNo.trim()) {
      toast.error("Sales Invoice No. and Delivery Receipt No. are required to confirm the invoice.")
      return
    }

    setUpdating(true)
    try {
      const db = getFirebaseDb()
      await updateDoc(doc(db, "orders", orderId), {
        isInvoiceConfirmed: true,
        salesInvoiceNo: invoiceNo,
        deliveryReceiptNo: receiptNo,
        updatedAt: serverTimestamp()
      })
      toast.success("Invoice confirmed successfully!")
    } catch (error: any) {
      toast.error("Failed to confirm invoice: " + error.message)
    } finally {
      setUpdating(false)
    }
  }

  const handleStatusChange = async () => {
    if (!auth.currentUser) {
      toast.error("User not authenticated")
      console.error("[OrderDetails] handleStatusChange — No authenticated user!")
      return
    }

    if (!confirmAction || !order) return
    
    if (confirmAction.toLowerCase() === "ready_for_processing" && !order.isInvoiceConfirmed) {
      toast.error("You must confirm the invoice first.")
      setConfirmAction(null)
      return
    }
    
    setUpdating(true)
    try {
      const db = getFirebaseDb()
      const targetStatus = confirmAction.toLowerCase() === "ready_for_processing" ? "ready_for_processing" : confirmAction

      console.log(`[OrderDetails] ▶ Updating order "${orderId}" status to "${targetStatus}"`)

      const updateData: any = { 
        status: targetStatus,
        updatedAt: serverTimestamp()
      }
      
      await updateDoc(doc(db, "orders", orderId), updateData)
      console.log(`[OrderDetails] ✅ Order "${orderId}" status updated to "${targetStatus}"`)
      
      // Create encoder task if marked for processing
      if (targetStatus === "ready_for_processing") {
        console.log("[OrderDetails] ▶ Order marked as ready_for_processing — creating encoder task...")
        const tasksRef = collection(db, "encoder_tasks");
        
        // Check for existing task (may fail if user lacks read permission)
        let shouldCreate = true;
        try {
          const q = query(tasksRef, where("orderId", "==", orderId));
          const existingTasks = await getDocs(q);
          shouldCreate = existingTasks.empty;
          if (!shouldCreate) {
            console.log(`[OrderDetails] ⚠️ Encoder task already exists for order "${orderId}", skipping creation`);
          }
        } catch (readErr: any) {
          console.warn("[OrderDetails] Could not check for existing tasks (permission issue), will create anyway:", readErr.message);
          shouldCreate = true;
        }

        if (shouldCreate) {
          const encoderTaskData = {
            orderId: orderId,
            customerName: order.customerName || "",
            customerEmail: order.customerEmail || "",
            items: order.items || [],
            totalAmount: order.totalAmount || 0,
            salesInvoiceNo: invoiceNo,
            deliveryReceiptNo: receiptNo,
            status: "pending",
            createdAt: serverTimestamp()
          };
          console.log("[OrderDetails] ▶ Creating encoder_tasks document with data:", JSON.stringify({
            ...encoderTaskData,
            createdAt: "(serverTimestamp)",
            items: `${(order.items || []).length} item(s)`
          }));
          
          const docRef = await addDoc(tasksRef, encoderTaskData);
          console.log(`[OrderDetails] ✅ Encoder task created successfully! Document ID: ${docRef.id}`);
          toast.success("Order marked as ready and sent to Encoder");
        } else {
          toast.success("Order marked as ready (Encoder task already exists)");
        }
      } else {
        toast.success(`Order marked as ${targetStatus}`)
      }
    } catch (error: any) {
      console.error("[OrderDetails] ❌ Failed to update status / create encoder task:", error)
      toast.error("Failed to update status: " + error.message)
    } finally {
      setUpdating(false)
      setConfirmAction(null)
    }
  }

  const handlePrint = () => {
    setShowReceipt(true)
    setTimeout(() => {
      window.print()
    }, 300)
  }

  if (loading) {
    return <AuthLoadingSkeleton />
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-16 w-16 rounded-full bg-gray-100 dark:bg-secondary/50 flex items-center justify-center mb-4">
          <Package className="h-7 w-7 text-gray-300" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-foreground mb-1">Order Not Found</h2>
        <p className="text-sm text-gray-400 mb-6">This order may have been deleted or doesn't exist.</p>
        <Button variant="outline" onClick={() => router.push("/orders")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Orders
        </Button>
      </div>
    )
  }

  const subtotal = (order.items || []).reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.price || 0),
    0,
  )

  return (
    <>
      {/* Print styles — hide everything except receipt when printing */}
      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-receipt-area, .print-receipt-area * { visibility: visible !important; }
          .print-receipt-area {
            position: absolute;
            left: 0; top: 0;
            width: 100%;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="space-y-6 pb-8 no-print">
        {/* Back button + Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/orders")}
            className="h-9 px-3 rounded-lg border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-secondary/50"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Button>
          <div className="flex-1">
            <h1 className="text-[24px] font-bold text-gray-900 dark:text-foreground leading-tight">
              Order Details
            </h1>
            <p className="text-gray-400 text-[12px] font-mono mt-0.5">#{order.id}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-5 lg:grid-cols-5">
          {/* LEFT: Order Info (3 cols) */}
          <div className="lg:col-span-3 space-y-5">
            {/* Customer Info Card */}
            <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <CardHeader className="px-6 pt-6 pb-3">
                <CardTitle className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center">
                    <User className="h-4 w-4 text-sky-500" />
                  </div>
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Name</p>
                    <p className="text-sm font-medium text-gray-800 dark:text-foreground">{order.customerName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Email
                    </p>
                    <p className="text-sm text-gray-600 dark:text-foreground/80">{order.customerEmail || "Not provided"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> Address
                    </p>
                    <p className="text-sm text-gray-600 dark:text-foreground/80">{order.customerAddress || "Not provided"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <Phone className="h-3 w-3" /> Phone
                    </p>
                    <p className="text-sm text-gray-600 dark:text-foreground/80">{order.customerPhone || "Not provided"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Items Card */}
            <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <CardHeader className="px-6 pt-6 pb-3">
                <CardTitle className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center">
                    <Package className="h-4 w-4 text-purple-500" />
                  </div>
                  Order Items
                  <span className="ml-auto text-xs font-normal text-gray-400">
                    {order.items?.length || 0} item{(order.items?.length || 0) === 1 ? "" : "s"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                {order.items && order.items.length > 0 ? (
                  <>
                    {/* Header */}
                    <div className="grid grid-cols-[2fr_0.8fr_1fr_1fr] gap-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider pb-3 border-b border-gray-100 dark:border-border">
                      <div>Product</div>
                      <div className="text-center">Qty</div>
                      <div className="text-right">Price</div>
                      <div className="text-right">Subtotal</div>
                    </div>

                    {/* Rows */}
                    <div className="divide-y divide-gray-50 dark:divide-border/50">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-[2fr_0.8fr_1fr_1fr] gap-3 py-3 items-center">
                          <p className="text-sm font-medium text-gray-800 dark:text-foreground">{item.name || "Unnamed"}</p>
                          <p className="text-sm text-gray-500 text-center">{item.quantity}</p>
                          <p className="text-sm text-gray-500 text-right">{formatCurrency(item.price || 0)}</p>
                          <p className="text-sm font-semibold text-gray-800 dark:text-foreground text-right">
                            {formatCurrency((item.quantity || 0) * (item.price || 0))}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Totals */}
                    <div className="border-t-2 border-gray-100 dark:border-border mt-2 pt-3 space-y-2">
                      <div className="flex justify-between text-sm text-gray-500">
                        <span>Subtotal</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold text-gray-900 dark:text-foreground">
                        <span>Total</span>
                        <span className="text-purple-600 dark:text-purple-400">{formatCurrency(order.totalAmount)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-400 py-6 text-center">No items in this order</p>
                )}
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              {isSales && !isReadOnly && order.status === "pending" && (
                <>
                  {!order.isInvoiceConfirmed ? (
                    <Button
                      onClick={handleConfirmInvoice}
                      disabled={updating}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Confirm Invoice
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setConfirmAction("ready_for_processing")}
                      className="bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark as Ready for Processing
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setConfirmAction("cancelled")}
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 rounded-lg"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel Order
                  </Button>
                </>
              )}
              {isSales && !isReadOnly && order.status === "cancelled" && (
                <Button
                  onClick={() => setConfirmAction("pending")}
                  variant="outline"
                  className="border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 rounded-lg"
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Re-open as Pending
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handlePrint}
                className="rounded-lg border-gray-200 dark:border-border"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print Receipt
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowReceipt(!showReceipt)}
                className="rounded-lg border-gray-200 dark:border-border"
              >
                <Receipt className="h-4 w-4 mr-2" />
                {showReceipt ? "Hide" : "View"} Receipt
              </Button>
            </div>
          </div>

          {/* RIGHT: Order Meta + Receipt Preview (2 cols) */}
          <div className="lg:col-span-2 space-y-5">
            {/* Order Meta Card */}
            <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <CardHeader className="px-6 pt-6 pb-3">
                <CardTitle className="text-base font-bold text-gray-900 dark:text-foreground">Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</span>
                  <StatusBadge status={order.status} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</span>
                  <span className="text-sm text-gray-700 dark:text-foreground">{formatDate(order.createdAt)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Time</span>
                  <span className="text-sm text-gray-700 dark:text-foreground">{formatTime(order.createdAt)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Items</span>
                  <span className="text-sm text-gray-700 dark:text-foreground">{order.items?.length || 0}</span>
                </div>
                <div className="border-t border-gray-100 dark:border-border pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-foreground">Total Amount</span>
                    <span className="text-xl font-bold text-purple-600 dark:text-purple-400">{formatCurrency(order.totalAmount)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Fulfillment Fields Card */}
            <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <CardHeader className="px-6 pt-6 pb-3">
                <CardTitle className="text-base font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-indigo-500" />
                  </div>
                  Fulfillment Details
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sales Invoice No.</label>
                  <Input 
                    placeholder="Enter Sales Invoice No." 
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    onBlur={(e) => handleFieldBlur("salesInvoiceNo", e.target.value)}
                    readOnly={isReadOnly || !isSales || order.isInvoiceConfirmed}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Delivery Receipt No.</label>
                  <Input 
                    placeholder="Enter Delivery Receipt No." 
                    value={receiptNo}
                    onChange={(e) => setReceiptNo(e.target.value)}
                    onBlur={(e) => handleFieldBlur("deliveryReceiptNo", e.target.value)}
                    readOnly={isReadOnly || !isSales || order.isInvoiceConfirmed}
                    className="h-10"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Receipt Preview */}
            {showReceipt && (
              <div className="animate-in slide-in-from-top-2 duration-300">
                <div className="print-receipt-area">
                  <ReceiptView ref={receiptRef} order={order} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Printable receipt (hidden, used by window.print) */}
      <div className="print-receipt-area hidden print:block">
        <ReceiptView order={order} />
      </div>

      {/* Confirm Status Change Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent className="sm:max-w-[420px]">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                confirmAction === "completed" ? "bg-emerald-100 dark:bg-emerald-950/40" :
                confirmAction === "ready_for_processing" ? "bg-blue-100 dark:bg-blue-950/40" :
                confirmAction === "cancelled" ? "bg-red-100 dark:bg-red-950/40" :
                "bg-amber-100 dark:bg-amber-950/40"
              }`}>
                {confirmAction === "completed" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                {confirmAction === "ready_for_processing" && <CheckCircle2 className="h-5 w-5 text-blue-600" />}
                {confirmAction === "cancelled" && <XCircle className="h-5 w-5 text-red-600" />}
                {confirmAction === "pending" && <Clock className="h-5 w-5 text-amber-600" />}
              </div>
              <AlertDialogTitle>
                {confirmAction === "completed" && "Mark as Completed?"}
                {confirmAction === "ready_for_processing" && "Ready for Processing?"}
                {confirmAction === "cancelled" && "Cancel this Order?"}
                {confirmAction === "pending" && "Re-open this Order?"}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="pt-2 text-sm">
              {confirmAction === "completed" && "This will mark the order as completed. The customer will be notified."}
              {confirmAction === "ready_for_processing" && "This will send the task to the Encoder to process the stock deduction."}
              {confirmAction === "cancelled" && "This will cancel the order. This action can be undone by re-opening."}
              {confirmAction === "pending" && "This will set the order back to pending status."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg" disabled={updating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStatusChange}
              disabled={updating}
              className={`rounded-lg ${
                confirmAction === "completed" ? "bg-emerald-600 hover:bg-emerald-700" :
                confirmAction === "ready_for_processing" ? "bg-blue-600 hover:bg-blue-700" :
                confirmAction === "cancelled" ? "bg-red-600 hover:bg-red-700" :
                "bg-amber-600 hover:bg-amber-700"
              } text-white`}
            >
              {updating ? "Updating..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
