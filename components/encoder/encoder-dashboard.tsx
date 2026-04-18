"use client"

import { useState } from "react"
import { useEncoderTasks } from "@/hooks/useEncoderTasks"
import { AuthLoadingSkeleton } from "@/components/skeletons/dashboard-skeleton"
import { Search, FileText, CheckCircle2, Factory } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EncoderTaskProcessingModal } from "./encoder-task-processing-modal"

const formatCurrency = (amount: number): string =>
  `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function EncoderDashboard() {
  const { tasks: orders, loading } = useEncoderTasks("pending")
  const [search, setSearch] = useState("")
  const [selectedTask, setSelectedTask] = useState<any | null>(null)

  const filteredOrders = orders.filter((order) => {
    const term = search.toLowerCase()
    return (
      order.customerName?.toLowerCase().includes(term) ||
      order.salesInvoiceNo?.toLowerCase().includes(term) ||
      order.deliveryReceiptNo?.toLowerCase().includes(term)
    )
  })

  if (loading) {
    return <AuthLoadingSkeleton />
  }

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-gray-900 dark:text-foreground tracking-tight">Encoder Tasks</h1>
          <p className="text-sm text-gray-500 dark:text-muted-foreground mt-1">
            View pending encoder tasks and process stock deductions via FIFO.
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-xl shadow-sm text-sm">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-100 dark:border-border">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by customer, invoice, or DR number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-secondary/30 border border-gray-200 dark:border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 transition-all text-gray-800 dark:text-foreground placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto text-sm font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">
            <CheckCircle2 className="h-4 w-4" />
            {filteredOrders.length} Pending Tasks
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto min-h-[400px]">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[350px] text-gray-400">
              <div className="h-14 w-14 rounded-full bg-gray-50 dark:bg-secondary/50 flex items-center justify-center mb-4">
                <FileText className="h-6 w-6 text-gray-300" />
              </div>
              <p className="font-medium text-gray-500 dark:text-foreground">No pending tasks found</p>
              <p className="text-xs mt-1">Tasks will appear here once marked as ready by sales</p>
            </div>
          ) : (
            <div className="min-w-[900px] w-full">
              {/* Header */}
              <div className="grid grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_1fr] gap-3 px-6 py-3 bg-gray-50/50 dark:bg-secondary/20 border-b border-gray-100 dark:border-border text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky top-0 z-10">
                <div>Customer Info</div>
                <div>Items</div>
                <div>Sales Invoice No.</div>
                <div>Delivery Receipt No.</div>
                <div>Date Created</div>
                <div className="text-right">Action</div>
              </div>

              {/* Body */}
              <div className="divide-y divide-gray-50 dark:divide-border/50">
                {filteredOrders.map((order) => (
                  <div
                    key={order.id}
                    className="grid grid-cols-[1.5fr_1.5fr_1fr_1fr_1fr_1fr] gap-3 py-4 px-6 items-center transition-all duration-200 hover:bg-sky-50/40 dark:hover:bg-secondary/30 group border-l-[3px] border-blue-400 rounded-r-md -ml-px"
                  >
                    {/* Customer */}
                    <div className="min-w-0 pr-4">
                      <div className="font-bold text-gray-900 dark:text-foreground text-[14px] truncate">
                        {order.customerName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-muted-foreground truncate mt-0.5">
                        Order #{order.orderId}
                      </div>
                    </div>

                    {/* Items */}
                    <div className="min-w-0 pr-4">
                      {order.items && order.items.length > 0 ? (
                        <ul className="text-[13px] text-gray-600 dark:text-foreground space-y-1">
                          {order.items.map((item, idx) => (
                            <li key={idx} className="truncate">
                              • {item.name} <span className="text-gray-400">({item.quantity})</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-gray-400 italic">No items</span>
                      )}
                    </div>

                    {/* Invoice */}
                    <div className="min-w-0 flex items-center">
                      <span className="font-mono text-sm text-gray-800 dark:text-foreground bg-gray-100 dark:bg-secondary px-2 py-1 rounded border border-gray-200 dark:border-border">
                        {order.salesInvoiceNo || "N/A"}
                      </span>
                    </div>

                    {/* Receipt */}
                    <div className="min-w-0 flex items-center">
                      <span className="font-mono text-sm text-gray-800 dark:text-foreground bg-gray-100 dark:bg-secondary px-2 py-1 rounded border border-gray-200 dark:border-border">
                        {order.deliveryReceiptNo || "N/A"}
                      </span>
                    </div>

                    {/* Date */}
                    <div className="min-w-0 flex flex-col justify-center">
                      <span className="text-[13px] text-gray-700 dark:text-foreground font-medium">
                        {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A"}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}
                      </span>
                    </div>

                    {/* Action */}
                    <div className="min-w-0 flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => setSelectedTask(order)}
                        className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm font-medium"
                      >
                        <Factory className="h-4 w-4 mr-2" />
                        Process
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Processing Modal */}
      {selectedTask && (
        <EncoderTaskProcessingModal 
          task={selectedTask} 
          isOpen={true} 
          onClose={() => setSelectedTask(null)} 
        />
      )}
    </div>
  )
}
