"use client"

import { useState, useEffect } from "react"
import { doc, updateDoc, collection, addDoc, serverTimestamp, runTransaction } from "firebase/firestore"
import { getFirebaseDb, auth } from "@/lib/firebase-live"
import { FirebaseService } from "@/services/firebase-service"
import { InventoryItem } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Package, Clock, AlertTriangle, ShieldCheck, ChevronRight, CheckCircle2, CalendarDays } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { updateOrderStatus } from "@/lib/order-utils"


interface EncoderTaskProcessingModalProps {
  task: any
  isOpen: boolean
  onClose: () => void
}

export function EncoderTaskProcessingModal({ task, isOpen, onClose }: EncoderTaskProcessingModalProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [planState, setPlanState] = useState<any[]>([])

  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationState, setVerificationState] = useState<any[]>([])
  const [scannerInput, setScannerInput] = useState("")
  
  // Real-time verification variables
  const [scannedBarcodes, setScannedBarcodes] = useState<string[]>([])
  const [isFifoOverridden, setIsFifoOverridden] = useState(false)

  // Fetch all inventory (matching inventory dashboard)
  useEffect(() => {
    if (isOpen) {
      const s = (task.status || "").toUpperCase()
      if ((s === "FOR_VERIFICATION" || s === "COMPLETED") && task.selectedStocks) {
        setIsVerifying(true);
        // Persist scanning states across closes by initializing safely
        setVerificationState(task.selectedStocks.map((b: any) => ({ ...b, scannedQty: b.scannedQty || 0 })));
        setScannedBarcodes(task.scannedBarcodes || []);
      } else {
        setIsVerifying(false);
        setVerificationState([]);
      }

      setLoading(true)
      FirebaseService.getCollection<InventoryItem>("inventory")
        .then((invData) => {
          setInventory(invData);
        })
        .finally(() => setLoading(false))
    }
  }, [isOpen, task])

  const getProcessingPlan = () => {
    const plan: any[] = []
    
    // Deduplicate batches by barcode or ID to prevent ghost duplicates
    const uniqueBatches = Array.from(
      new Map(
        inventory.map((item: any) => [
          item.barcode || item.batchNumber || item.id,
          item
        ])
      ).values()
    )

    // Filter only valid stock
    const filteredBatches = uniqueBatches.filter((item: any) => {
      const incoming = item.incoming ?? item.stockIncoming ?? item.incomingStock ?? 0
      const outgoing = item.outgoing ?? item.stockOutgoing ?? item.outgoingStock ?? 0
      const good = item.goodReturnStock ?? 0
      const bad = item.damageReturnStock ?? 0

      const remaining = incoming - outgoing + good - bad
      return remaining > 0
    })

    // Map remaining quantity
    const invMap = filteredBatches.map((inv: any) => {
      const incoming = inv.incoming ?? inv.stockIncoming ?? inv.incomingStock ?? 0
      const outgoing = inv.outgoing ?? inv.stockOutgoing ?? inv.outgoingStock ?? 0
      const good = inv.goodReturnStock ?? 0
      const bad = inv.damageReturnStock ?? 0
      const remainingQty = incoming - outgoing + good - bad
      return { ...inv, remainingQty }
    })

    task.items?.forEach((item: any) => {
      const neededQty = item.quantity || 0
      
      const itemPlan = {
        name: item.name,
        needed: neededQty,
        unit: item.unit || "boxes/packs",
        batches: [] as any[],
        isExpanded: true,
      }

      const orderName = item.name || "";
      
      // Find matching batches using exact name matching, ONLY > 0 transaction-verified stock, and skip archived
      let matchingBatches = invMap.filter(inv => {
        const invName = inv.productName || inv.name || "";
        const isArchived = Boolean((inv as any).isDeleted) || Boolean((inv as any).archived);
        return invName === orderName && inv.remainingQty > 0 && !isArchived;
      });
      
      // 3. Sort FIFO (Expiration asc, then CreatedAt asc)
      matchingBatches.sort((a, b) => {
        const aExp = a.expirationDate || a.expiryDate;
        const bExp = b.expirationDate || b.expiryDate;
        const aTimeExp = aExp?.seconds ? aExp.seconds * 1000 : (aExp?.toDate ? aExp.toDate().getTime() : Infinity);
        const bTimeExp = bExp?.seconds ? bExp.seconds * 1000 : (bExp?.toDate ? bExp.toDate().getTime() : Infinity);
        
        if (aTimeExp !== bTimeExp) {
            return aTimeExp - bTimeExp;
        }

        const aAdd = a.createdAt;
        const bAdd = b.createdAt;
        const aTimeAdd = aAdd?.seconds ? aAdd.seconds * 1000 : (aAdd?.toDate ? aAdd.toDate().getTime() : Infinity);
        const bTimeAdd = bAdd?.seconds ? bAdd.seconds * 1000 : (bAdd?.toDate ? bAdd.toDate().getTime() : Infinity);
        return aTimeAdd - bTimeAdd;
      });

      let remainingQtyToFill = neededQty;

      // Map ALL shown matches so user can manually choose exact quantity
      for (const inv of matchingBatches) {
        let qtyToTake = 0;
        const available = inv.remainingQty;

        if (available > 0 && remainingQtyToFill > 0) {
           qtyToTake = Math.min(available, remainingQtyToFill);
           remainingQtyToFill = Math.max(0, remainingQtyToFill - qtyToTake);
        }

        itemPlan.batches.push({
          inventoryId: inv.id,
          barcode: (inv as any).batchNumber || inv.barcode || "N/A", 
          available: available,
          quantity: qtyToTake,
          productionWeight: (inv as any).production_weight || 0,
          packingWeight: (inv as any).packing_weight || 0,
          expiryDate: inv.expirationDate || inv.expiryDate,
          createdAt: inv.createdAt
        });
      }

      plan.push(itemPlan)
    })

    return plan
  }

  useEffect(() => {
    if (inventory.length > 0) {
      setPlanState(getProcessingPlan())
    }
  }, [inventory])

  // Step 1: Confirmation explicitly seals exact selections in Firebase database
  const handleConfirmSelection = async () => {
    if (!auth.currentUser) return toast.error("User not authenticated")
    
    // Safety guard: block submission if any product is not fully fulfilled
    const unfulfilled = planState.find(p => {
      const totalQty = p.batches.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0);
      return totalQty < p.needed;
    });
    if (unfulfilled) {
      toast.error(`Incomplete selection for "${unfulfilled.name}". Please fulfill required boxes before confirming.`);
      return;
    }
    
    setProcessing(true)
    try {
      const selectedBatches: any[] = []
      for (const p of planState) {
        for (const b of p.batches) {
          if (b.quantity > 0) {
            selectedBatches.push({
              itemName: p.name,
              inventoryId: b.inventoryId,
              barcode: b.barcode,
              quantity: b.quantity || 0,
              productionWeight: b.productionWeight || 0,
              packingWeight: b.packingWeight || 0,
              dateAdded: b.createdAt || null,
              scannedQty: 0 // Initialize at zero for verification phase
            })
          }
        }
      }

      const db = getFirebaseDb()
      await updateDoc(doc(db, "encoder_tasks", task.id), {
        selectedStocks: selectedBatches,
        status: "FOR_VERIFICATION",
        scanned: false
      })

      // Fix applied here
      await updateOrderStatus(task.orderId, "in_production")

      toast.success("Selection confirmed! Task moved to Verification tab.")
      onClose() // Close the modal so it appears in the next tab

    } catch (error: any) {
      toast.error("Failed to lock selection: " + error.message)
    } finally {
      setProcessing(false)
    }
  }

  // Step 2: Handle barcode scan — 1 scan = 1 box deducted
  const handleScan = async () => {
    console.log("HANDLE SCAN CALLED")
    
    if (task.status !== "FOR_VERIFICATION") {
      console.log("❌ Scan blocked - not in verification stage")
      return
    }

    const code = scannerInput.trim()
    if (!code || processing) return
    setScannerInput("")

    // Find matching batch in selectedStocks
    const batchIdx = verificationState.findIndex((b) => b.barcode === code)
    if (batchIdx === -1) {
      toast.error("Invalid barcode. This batch is not part of the current order.")
      return
    }
    
    const batch = verificationState[batchIdx]
    const requiredQty = batch.quantity || 0
    const currentScanned = batch.scannedQty || 0
    
    // Prevent double scan if batch already fully verified
    if (batch.scanned || currentScanned >= requiredQty) {
      toast.error(`Batch ${code} is already verified and deducted!`)
      return
    }

    console.log("SCAN TRIGGERED")
    console.log("TASK STATUS:", task.status)
    console.log("BATCH:", batch)

    // Execute atomic Firestore transaction: deduct 1 per scan
    setProcessing(true)
    try {
      const db = getFirebaseDb()
      // The system MUST NOT directly update inventory.remaining.
      // Stock must ONLY be deducted via transactions.
      await addDoc(collection(db, "transactions"), {
        type: "OUT",

        orderId: task.orderId,
        productName: batch.itemName || batch.productName || "Unknown",

        barcode: batch.barcode,
        barcode_base: batch.barcode_base || null,

        inventoryId: batch.inventoryId,

        outgoing_qty: 1,
        outgoing_packs: 1,

        incoming_qty: 0,
        incoming_packs: 0,

        good_return: 0,
        damage_return: 0,

        created_at: serverTimestamp(),

        source: "encoder_verification"
      })

      console.log("OUT TRANSACTION CREATED", {
        barcode: batch.barcode,
        orderId: task.orderId
      })

      // Update local verification state
      const newState = [...verificationState]
      const newScannedQty = currentScanned + 1
      newState[batchIdx] = { 
        ...newState[batchIdx], 
        scannedQty: newScannedQty,
        scanned: newScannedQty >= requiredQty,
        scannedAt: new Date().toISOString()
      }
      setVerificationState(newState)

      // Add to scannedBarcodes
      const newScannedBarcodes = [...scannedBarcodes, code]
      setScannedBarcodes(newScannedBarcodes)

      // Update encoder_tasks in Firestore
      await updateDoc(doc(db, "encoder_tasks", task.id), {
        selectedStocks: newState,
        scannedBarcodes: newScannedBarcodes,
        scannedCount: newScannedBarcodes.length,
        lastScannedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      // Beep sound feedback
      try { 
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.frequency.value = 1200
        gain.gain.value = 0.15
        osc.start()
        osc.stop(audioCtx.currentTime + 0.1)
      } catch {}

      toast.success(`✔ Verified & deducted 1 box for ${batch.itemName} (${newScannedQty}/${requiredQty})`)

      // Check if ALL batches are now fully verified
      const allDone = newState.every((b: any) => b.scanned === true)
      
      if (allDone) {
        // Move task to FOR_DELIVERY (not directly ON_DELIVERY)
        await updateDoc(doc(db, "encoder_tasks", task.id), {
          status: "FOR_DELIVERY",
          scanned: true,
          updatedAt: serverTimestamp()
        })

        await addDoc(collection(db, "notifications"), {
          title: "Ready for Delivery",
          message: `Order #${task.orderId.slice(-6).toUpperCase()} has been fully verified and is ready for delivery.`,
          targetRole: "sales",
          type: "order",
          isRead: false,
          orderId: task.orderId,
          createdAt: serverTimestamp()
        })

        // Fix applied here
        console.log("STATUS UPDATE → IN TRANSIT after scan complete")
        await updateOrderStatus(task.orderId, "in_transit")

        toast.success("🎉 All batches verified! Task moved to For Delivery.")
        onClose()
      }

    } catch (err: any) {
      toast.error(err.message || "Stock unavailable or already deducted")
    } finally {
      setProcessing(false)
    }
  }

  // Validate that ALL products have their required box quantity fully met
  const isFullyFulfilled = planState.length > 0 && planState.every(p => {
    const totalQty = p.batches.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0);
    return totalQty >= p.needed;
  });
  
  // Compute totals for the warning message
  const selectionSummary = planState.map(p => {
    const totalQty = p.batches.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0);
    return { name: p.name, needed: p.needed, selected: totalQty, remaining: Math.max(0, p.needed - totalQty) };
  });
  const hasIncompleteItems = selectionSummary.some(s => s.remaining > 0);

  const disableConfirm = !isFullyFulfilled || loading || processing;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !processing && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Process Encoder Task</DialogTitle>
          <DialogDescription>
            Review the FIFO distribution for Order #{task.orderId}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 dark:bg-secondary/30 p-4 rounded-lg border border-gray-100 dark:border-border">
            <div>
              <span className="text-gray-500 block mb-1">Customer</span>
              <span className="font-semibold">{task.customerName}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">Sales Invoice No.</span>
              <span className="font-mono">{task.salesInvoiceNo || task.salesInvoiceNumber || "N/A"}</span>
            </div>
          </div>

          <div className="space-y-4">
            {isVerifying ? (
              <div className="space-y-6 animate-in fade-in duration-300">
                {/* Overall progress */}
                {(() => {
                  const totalRequired = verificationState.reduce((s: number, b: any) => s + (b.quantity || 0), 0);
                  const totalScanned = verificationState.reduce((s: number, b: any) => s + (b.scannedQty || 0), 0);
                  const allDone = totalScanned >= totalRequired;
                  return (
                    <div className={cn("px-6 py-5 rounded-xl border", allDone ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30" : "bg-sky-50 dark:bg-sky-950/20 border-sky-100 dark:border-sky-900/30")}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className={cn("text-[15px] font-bold", allDone ? "text-emerald-900 dark:text-emerald-300" : "text-sky-900 dark:text-sky-300")}>
                          {allDone ? "✅ Verification Complete" : "Scan Barcodes to Verify"}
                        </h3>
                        <span className={cn("text-sm font-black px-3 py-1 rounded-full border", allDone ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-sky-100 text-sky-700 border-sky-200")}>
                          {totalScanned} / {totalRequired} boxes
                        </span>
                      </div>
                      <p className={cn("text-xs mb-4 font-medium", allDone ? "text-emerald-600/80" : "text-sky-600/80")}>
                        {allDone ? "All boxes verified and deducted from inventory." : "Scan each barcode once to verify and deduct the full allocated quantity."}
                      </p>
                      
                      {/* Progress bar */}
                      <div className="h-2.5 w-full bg-white/60 dark:bg-black/20 rounded-full overflow-hidden shadow-inner mb-4">
                        <div 
                          className={cn("h-full transition-all duration-500 ease-out rounded-full", allDone ? "bg-emerald-500" : "bg-sky-500")}
                          style={{ width: `${totalRequired > 0 ? Math.min(100, (totalScanned / totalRequired) * 100) : 0}%` }}
                        />
                      </div>
                      
                      {!allDone && (
                        <div className="relative">
                          <Input 
                            autoFocus
                            placeholder={processing ? "Processing scan..." : "Scan or type barcode and press Enter..."} 
                            value={scannerInput}
                            onChange={(e) => setScannerInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleScan()
                            }}
                            disabled={processing}
                            className={cn("h-12 text-center font-mono font-bold text-lg shadow-inner bg-white dark:bg-black/50", processing && "opacity-50")}
                          />
                          {processing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/30 rounded-md">
                              <div className="flex items-center gap-2 text-sky-600 font-bold text-sm">
                                <div className="h-4 w-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                                Deducting...
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="grid gap-3">
                  {verificationState.map((b, idx) => {
                    const scanned = b.scannedQty || 0;
                    const required = b.quantity || 0;
                    const isFullyScanned = b.scanned === true || scanned >= required;
                    return (
                      <div key={idx} className={cn(
                        "p-4 rounded-xl border transition-all duration-300",
                        isFullyScanned 
                          ? "bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50" 
                          : "bg-white border-gray-200 dark:bg-card dark:border-border"
                      )}>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2.5">
                            {isFullyScanned ? (
                              <div className="h-7 w-7 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm">
                                <CheckCircle2 className="h-4 w-4 text-white" />
                              </div>
                            ) : (
                              <div className="h-7 w-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                <Package className="h-3.5 w-3.5 text-slate-400" />
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-bold text-gray-900 dark:text-foreground">{b.itemName}</p>
                              <p className="text-xs font-mono text-gray-500">{b.barcode}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={cn("text-[17px] font-black tabular-nums", 
                              isFullyScanned ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"
                            )}>
                              {scanned} / {required}
                            </span>
                            <p className={cn("text-[10px] font-bold uppercase tracking-wider mt-0.5", 
                              isFullyScanned ? "text-emerald-500" : "text-gray-400"
                            )}>
                              {isFullyScanned ? "✓ Verified & Deducted" : `Awaiting scan (${required} box)`}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <Package className="h-4 w-4 text-sky-500" />
                  Step 1: Stock Selection Plan
                </h3>
            
            {loading ? (
              <div className="py-8 text-center text-gray-500 text-sm">Loading available batches...</div>
            ) : (
              <div className="space-y-4">
                {/* FIFO Control Panel */}
                <div className="flex justify-between items-center bg-sky-50 dark:bg-sky-950/20 p-3.5 rounded-xl border border-sky-100 dark:border-sky-900/50 mb-4 shadow-sm">
                  <div>
                    <h4 className="text-sm font-bold text-sky-900 dark:text-sky-300 flex items-center gap-2">
                       {isFifoOverridden ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4 text-emerald-500" />}
                       Allocation Model: {isFifoOverridden ? "Manual Override" : "Strict FIFO"}
                    </h4>
                    <p className="text-xs text-sky-700/80 dark:text-sky-400/80 mt-0.5">
                      {isFifoOverridden ? "You are freely allocating stock. Please ensure correctness." : "Automatically distributing oldest stock first."}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {isFifoOverridden ? (
                      <Button variant="outline" className="h-9 px-3 gap-2 text-xs bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50 font-bold rounded-lg" onClick={() => {
                        setPlanState(getProcessingPlan())
                        setIsFifoOverridden(false)
                        toast.success("Restored to Strict FIFO allocation.")
                      }}>
                        <CheckCircle2 className="h-4 w-4" /> Auto Assign FIFO
                      </Button>
                    ) : (
                      <Button variant="outline" className="h-9 px-3 gap-2 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 font-bold rounded-lg" onClick={() => {
                        if (window.confirm("Are you sure you want to deviate from FIFO? This is not recommended and might lead to older stock expiring.")) {
                          setIsFifoOverridden(true)
                          toast.warning("FIFO overridden. You can now manually allocate stock.")
                        }
                      }}>
                        <AlertTriangle className="h-4 w-4" /> Override FIFO
                      </Button>
                    )}
                  </div>
                </div>

                {planState.map((p, idx) => {
                  const totalQty = p.batches.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0);
                  const isMatch = totalQty === p.needed;
                  const isUnder = totalQty < p.needed;
                  
                  // Product metrics
                  const totalRemaining = p.batches.reduce((sum: number, b: any) => sum + b.available, 0);
                  const nearExpiryBatches = p.batches.filter((b: any) => {
                     if (!b.expiryDate) return false;
                     const d = b.expiryDate.toDate ? b.expiryDate.toDate() : new Date(b.expiryDate.seconds * 1000);
                     const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                     return diffDays <= 90;
                  });
                  const hasNearExpiry = nearExpiryBatches.length > 0;
                  const isLowStock = totalRemaining <= 5;
                  
                  // Removed average weights for display

                  const renderBatchRow = (batch: any, bIdx: number, isSuggested: boolean, hasSelection: boolean) => {
                    const handleUpdateQty = (val: number) => {
                      if (!isFifoOverridden) { toast.error("Click 'Override FIFO' to modify allocations manually."); return; }
                      const newPlan = [...planState];
                      const b = newPlan[idx].batches[bIdx];
                      if (val > b.available) val = b.available;
                      b.quantity = val;
                      setPlanState(newPlan);
                    };
                    
                    const days = batch.expiryDate?.toDate ? Math.ceil(((batch.expiryDate.toDate ? batch.expiryDate.toDate() : new Date(batch.expiryDate.seconds * 1000)).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                    const isActive = hasSelection || batch.uiExpanded || (isSuggested && !hasSelection && batch.uiExpanded !== false);

                    return (
                       <div key={bIdx} 
                            onClick={() => {
                               if (!isActive && isFifoOverridden) {
                                  const newPlan = [...planState];
                                  newPlan[idx].batches[bIdx].uiExpanded = true;
                                  setPlanState(newPlan);
                               }
                            }}
                            className={cn(
                           "flex flex-col md:items-center justify-between text-sm py-4 px-5 rounded-xl border-2 transition-all duration-200 group relative",
                           isActive ? isSuggested ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40" : hasSelection ? "border-sky-200 bg-sky-50/40 dark:border-sky-900/40 dark:bg-sky-950/20" : "border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 focus:bg-slate-100" 
                                    : "border-slate-100 bg-white dark:border-slate-800 dark:bg-card hover:border-slate-300 cursor-pointer"
                       )}>
                         <div className="flex flex-col md:flex-row md:items-center justify-between w-full">
                           <div className="flex flex-col gap-2.5 mb-4 md:mb-0 flex-1">
                             <div className="flex items-center gap-2">
                               <span className={cn("text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0", isSuggested ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 dark:bg-slate-800 text-slate-400")}>#{bIdx + 1} {isSuggested && " (Suggested)"}</span>
                               <span className={cn("font-mono font-bold text-base", hasSelection ? "text-sky-900 dark:text-sky-100" : "text-slate-800 dark:text-slate-200")}>
                                 {batch.barcode}
                               </span>
                             </div>
                             <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
                               <Badge
                                 className={cn("text-[10px] font-bold px-2 py-0.5", batch.available <= 5 ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-slate-100 text-slate-600 border-slate-200")}
                                 variant="outline"
                               >{batch.available} in stock</Badge>
                               
                               <span className="flex items-center gap-1">
                                 <Clock className="h-3.5 w-3.5 text-slate-400" />
                                 Exp: {batch.expiryDate?.toDate ? batch.expiryDate.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : "N/A"}
                               </span>
                               {days !== null && days <= 90 && (
                                  <Badge variant="outline" className={cn("text-[9px] font-bold px-1.5 py-0", days < 0 || days <= 7 ? "bg-red-100 text-red-700 border-red-200" : "bg-orange-100 text-orange-700 border-orange-200")}>
                                    {days < 0 ? "Expired" : `${days}d left`}
                                  </Badge>
                               )}
                               <span className="flex items-center gap-1 text-slate-400">
                                 <CalendarDays className="h-3.5 w-3.5" />
                                 Added: {batch.createdAt?.toDate ? batch.createdAt.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : "N/A"}
                               </span>
                             </div>
                           </div>

                           {isActive ? (
                             <div className="flex flex-col md:items-end gap-2 shrink-0 animate-in fade-in slide-in-from-right-4 duration-300">
                               <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900/50 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                 <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-bold bg-white dark:bg-slate-800 hover:text-sky-600 hover:border-sky-300" onClick={(e) => { e.stopPropagation(); handleUpdateQty(batch.quantity + 1); }}>+1 box</Button>
                                 <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-bold bg-white dark:bg-slate-800 hover:text-sky-600 hover:border-sky-300" onClick={(e) => { e.stopPropagation(); handleUpdateQty(batch.quantity + 2); }}>+2 box</Button>
                                 <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-bold bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border-emerald-200 hover:bg-emerald-50" onClick={(e) => { e.stopPropagation(); handleUpdateQty(batch.available); }}>MAX</Button>
                                 <Button size="sm" variant="ghost" className="h-8 px-3 text-xs font-bold hover:bg-red-50 hover:text-red-600 text-red-500 transition-colors" onClick={(e) => { e.stopPropagation(); handleUpdateQty(0);
                                      const newPlan = [...planState];
                                      newPlan[idx].batches[bIdx].uiExpanded = false;
                                      setPlanState(newPlan);
                                  }}>Clear</Button>
                               </div>
                               
                               <div className={cn("flex flex-col items-end w-full bg-white dark:bg-black/20 p-2 rounded-lg border shadow-sm transition-colors", hasSelection ? "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/20" : "border-slate-100 dark:border-slate-800")}>
                                 <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">Selected</span>
                                 <div className="font-bold text-sm text-slate-800 dark:text-slate-200">
                                     <span className={cn(hasSelection ? "text-sky-700 dark:text-sky-400" : "")}>{batch.quantity || 0} box</span> 
                                 </div>
                               </div>
                             </div>
                           ) : (
                             <div className="flex shrink-0 ml-4 items-center gap-2">
                                {!isFifoOverridden ? (
                                    <Badge variant="outline" className="bg-slate-50 text-slate-400 px-3 py-1 font-semibold border-slate-200">Locked</Badge>
                                ) : (
                                    <Button size="sm" variant="ghost" className="text-sky-600 font-bold hover:bg-sky-50 hover:text-sky-700 pointer-events-none">Select Batch <ChevronRight className="w-4 h-4 ml-1"/></Button>
                                )}
                             </div>
                           )}
                         </div>
                       </div>
                    );
                  };

                  return (
                  <div key={idx} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden mb-6 bg-white dark:bg-card shadow-sm">
                    {/* TOP SUMMARY SECTION */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-4">
                      
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                         <div className="flex items-center gap-3">
                           <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl shrink-0 mt-0.5", hasNearExpiry ? "bg-orange-100 dark:bg-orange-900/30" : "bg-sky-100 dark:bg-sky-900/30")}>
                             <Package className={cn("h-5 w-5", hasNearExpiry ? "text-orange-500" : "text-sky-600 dark:text-sky-400")} />
                           </div>
                           <div>
                               <h3 className="font-bold text-slate-800 dark:text-slate-200 text-lg leading-tight">{p.name}</h3>
                           </div>
                         </div>
                         
                         {/* Validation feedback near the top */}
                         <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {totalQty === p.needed ? (
                               <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 px-3 py-1 font-bold text-sm shadow-sm"><CheckCircle2 className="w-4 h-4 mr-1.5" /> FULFILLED</Badge>
                            ) : totalQty > 0 ? (
                               <Badge className="bg-amber-100 text-amber-800 border-amber-300 px-3 py-1 font-bold text-sm shadow-sm"><Clock className="w-4 h-4 mr-1.5" /> IN PROGRESS</Badge>
                            ) : (
                               <Badge className="bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:border-slate-700 px-3 py-1 font-bold text-sm shadow-sm"><AlertTriangle className="w-4 h-4 mr-1.5 opacity-50" /> NOT STARTED</Badge>
                            )}
                            {hasNearExpiry && <span className="text-[10px] font-bold text-orange-600 flex items-center bg-orange-50 dark:bg-orange-950/30 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3 mr-1" /> Near Expiry Stock Exists</span>}
                         </div>
                      </div>

                      <div className="flex items-center justify-between text-sm bg-white dark:bg-card border border-slate-200 dark:border-slate-800 rounded-lg p-3 shadow-sm pt-4 pb-4">
                         <div className="text-center w-1/3 border-r border-slate-100 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Required</span>
                            <span className="font-bold text-lg text-slate-700 dark:text-slate-200">{p.needed} box</span>
                         </div>
                         <div className="text-center w-1/3 border-r border-slate-100 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Selected</span>
                            <span className={cn("font-bold text-lg cursor-default", totalQty >= p.needed ? "text-emerald-600" : totalQty > 0 ? "text-sky-600" : "text-slate-500")}>{totalQty} box</span>
                         </div>
                         <div className="text-center w-1/3">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Remaining</span>
                            <span className={cn("font-bold text-lg", totalQty >= p.needed ? "text-emerald-600" : "text-amber-600 text-red-500")}>{Math.max(0, p.needed - totalQty)} box</span>
                         </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1 w-full mt-1">
                         <div className="h-2.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner flex">
                           <div 
                             className={cn("h-full transition-all duration-500 ease-out", totalQty >= p.needed ? "bg-emerald-500" : "bg-sky-500 border-r border-sky-400")}
                             style={{ width: `${Math.min(100, (totalQty / p.needed) * 100)}%` }}
                           />
                         </div>
                      </div>
                    </div>
                    
                    {/* BATCHES SECTION */}
                    <div className="p-4 bg-white dark:bg-card">
                      {p.batches.length > 0 ? (
                        <div className="space-y-3">
                          {p.batches.map((batch: any, bIdx: number) => {
                             const hasSelection = batch.quantity > 0;
                             const isSuggested = bIdx === 0 && p.batches.length > 1; // Highlight oldest
                             return renderBatchRow(batch, bIdx, isSuggested, hasSelection);
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-6 text-slate-400 text-sm">
                           <Package className="h-8 w-8 opacity-30" />
                           <p>No batches found</p>
                        </div>
                      )}
                    </div>

                  </div>
                )})}
              </div>
            )}
            </>
            )}
          </div>
        </div>

        {/* Warning message when selection is incomplete */}
        {!isVerifying && hasIncompleteItems && (
          <div className="mx-6 mb-2 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg flex items-start gap-2.5 animate-in fade-in duration-200">
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">Incomplete Selection</p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                {selectionSummary.filter(s => s.remaining > 0).map(s => 
                  `${s.name}: need ${s.remaining} more box(es)`
                ).join(" · ")}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 border-t border-gray-100 dark:border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={processing}>
            Cancel
          </Button>
          {!isVerifying ? (
            <Button 
              onClick={handleConfirmSelection} 
              disabled={disableConfirm}
              className={cn(
                "shadow-sm transition-all",
                disableConfirm 
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed opacity-60" 
                  : "bg-sky-600 hover:bg-sky-700 text-white"
              )}
            >
              {processing ? "Saving..." : "Confirm Selection"}
            </Button>
          ) : (
            <Button 
              onClick={onClose} 
              className="bg-sky-100 text-sky-700 hover:bg-sky-200 shadow-sm"
            >
              Close Viewer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
