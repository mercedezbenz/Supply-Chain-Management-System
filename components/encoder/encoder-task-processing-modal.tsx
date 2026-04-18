"use client"

import { useState, useEffect } from "react"
import { doc, updateDoc } from "firebase/firestore"
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
import { Package, Clock, ShieldAlert } from "lucide-react"
import { Input } from "@/components/ui/input"

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

  // Fetch all inventory to do client-side filtering and FIFO sorting
  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      FirebaseService.getCollection<InventoryItem>("inventory")
        .then((data) => {
          // Filter out zero-total items and sort by expiry
          const validInventory = data
            .filter((inv) => (inv.total || 0) > 0)
            .sort((a, b) => {
              const aTime = a.expiryDate?.toDate ? a.expiryDate.toDate().getTime() : Infinity
              const bTime = b.expiryDate?.toDate ? b.expiryDate.toDate().getTime() : Infinity
              return aTime - bTime // Earliest expiry first (FIFO)
            })
          setInventory(validInventory)
        })
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  const getProcessingPlan = () => {
    const plan: any[] = []
    
    // We clone inventory so we can deduct quantities safely during calculation
    const invMap = inventory.map(inv => ({ ...inv, remainingTotal: inv.total || 0 }))

    task.items?.forEach((item: any) => {
      const neededQty = item.quantity || 0
      let qtyToFulfill = neededQty
      
      const itemPlan = {
        name: item.name,
        needed: neededQty,
        batches: [] as any[],
        shortage: 0
      }

      // Find matching inventory items (match by name, category, or subcategory)
      const exactMatches = invMap.filter(inv => {
        const iName = inv.name?.toLowerCase() || ""
        const iCat = inv.category?.toLowerCase() || ""
        const iSub = inv.subcategory?.toLowerCase() || ""
        const tName = item.name?.toLowerCase() || ""
        
        return iName === tName || iCat === tName || iSub === tName
      })

      // Try to fulfill using available sorted batches
      for (const inv of exactMatches) {
        if (qtyToFulfill <= 0) break;
        if (inv.remainingTotal > 0) {
          const deduct = Math.min(inv.remainingTotal, qtyToFulfill)
          inv.remainingTotal -= deduct
          qtyToFulfill -= deduct
          
          itemPlan.batches.push({
            inventoryId: inv.id,
            barcode: inv.barcode,
            deducted: deduct,
            weight: 0,
            expiryDate: inv.expiryDate
          })
        }
      }

      itemPlan.shortage = qtyToFulfill
      plan.push(itemPlan)
    })

    return plan
  }

  useEffect(() => {
    if (inventory.length > 0) {
      setPlanState(getProcessingPlan())
    }
  }, [inventory])

  const handleCompleteTask = async () => {
    if (!auth.currentUser) {
      toast.error("User not authenticated")
      return
    }
    setProcessing(true)
    try {
      const plan = planState
      const db = getFirebaseDb()
      
      // 1. Deduct Stock from Inventory
      for (const p of plan) {
        for (const batch of p.batches) {
          // Get current inventory to calculate correct new total
          const currentInv = await FirebaseService.getDocument<InventoryItem>("inventory", batch.inventoryId)
          if (currentInv) {
            const newOutgoing = (currentInv.outgoing || 0) + batch.deducted
            const newTotal = (currentInv.stock || 0) + (currentInv.incoming || 0) - newOutgoing
            
            await FirebaseService.updateDocument("inventory", batch.inventoryId, {
              outgoing: newOutgoing,
              total: newTotal
            })
            
            // Optionally: insert StockLog or InventoryTransaction here if necessary
            await FirebaseService.addDocument("stock_logs", {
              category: currentInv.category || "General",
              barcode: currentInv.barcode,
              action: "outgoing",
              quantity: Number(batch.deducted),
              weight: Number(batch.weight) || 0,
              previousStock: currentInv.total || 0,
              newStock: newTotal,
              reason: `Encoder Task: ${task.orderId} (SI: ${task.salesInvoiceNo})`,
              createdBy: "Encoder",
              createdAt: new Date()
            })
          }
        }
      }

      // 2. Update Encoder Task to "done"
      await updateDoc(doc(db, "encoder_tasks", task.id), { status: "done" })

      // 3. Update Order status to "ready_for_delivery"
      await updateDoc(doc(db, "orders", task.orderId), { 
        status: "ready_for_delivery",
        updatedAt: new Date()
      })

      toast.success("Task completed successfully!")
      onClose()
    } catch (error: any) {
      console.error(error)
      toast.error("Failed to complete task: " + error.message)
    } finally {
      setProcessing(false)
    }
  }

  const hasShortage = planState.some(p => p.shortage > 0)

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
              <span className="font-mono">{task.salesInvoiceNo || "N/A"}</span>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-foreground flex items-center gap-2">
              <Package className="h-4 w-4 text-sky-500" />
              FIFO Stock Deduction Plan
            </h3>
            
            {loading ? (
              <div className="py-8 text-center text-gray-500 text-sm">Loading available batches...</div>
            ) : (
              <div className="space-y-4">
                {planState.map((p, idx) => (
                  <div key={idx} className="border border-gray-200 dark:border-border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 dark:bg-secondary/50 px-4 py-2 flex justify-between items-center text-sm font-medium">
                      <span>{p.name}</span>
                      <span>Needed: {p.needed}</span>
                    </div>
                    
                    <div className="p-4 bg-white dark:bg-card">
                      {p.batches.length > 0 ? (
                        <div className="space-y-2">
                          {p.batches.map((batch: any, bIdx: number) => (
                            <div key={bIdx} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                              <div className="flex items-center gap-3">
                                <span className="font-mono bg-gray-100 dark:bg-secondary px-2 py-0.5 rounded text-xs">
                                  {batch.barcode}
                                </span>
                                <span className="text-gray-500 flex items-center gap-1 text-xs">
                                  <Clock className="h-3 w-3" />
                                  Exp: {batch.expiryDate?.toDate ? batch.expiryDate.toDate().toLocaleDateString() : "N/A"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input 
                                  type="number" 
                                  className="h-7 w-20 text-xs px-2" 
                                  placeholder="Qty"
                                  value={batch.deducted}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    const newPlan = [...planState];
                                    newPlan[idx].batches[bIdx].deducted = val;
                                    setPlanState(newPlan);
                                  }}
                                />
                                <Input 
                                  type="number" 
                                  className="h-7 w-20 text-xs px-2" 
                                  placeholder="Kg"
                                  value={batch.weight || ""}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    const newPlan = [...planState];
                                    newPlan[idx].batches[bIdx].weight = val;
                                    setPlanState(newPlan);
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 italic">No matching inventory batches found.</div>
                      )}

                      {p.shortage > 0 && (
                        <div className="mt-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 p-2 rounded flex items-start gap-2">
                          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold">Stock Shortage Warning ({p.shortage} missing)</p>
                            <p className="text-xs opacity-90">There is not enough inventory to fulfill this item.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-6 border-t border-gray-100 dark:border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={processing}>
            Cancel
          </Button>
          <Button 
            onClick={handleCompleteTask} 
            disabled={loading || processing || hasShortage}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {processing ? "Processing..." : "Process / Ready for Delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
