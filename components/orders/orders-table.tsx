"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Search, ChevronLeft, ChevronRight, Eye, ShoppingCart,
  Filter, Package, Clock, CheckCircle2, XCircle, TrendingUp, BanknoteIcon,
} from "lucide-react"
import { useOrders, type Order } from "@/hooks/useOrders"

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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const formatTime = (d: any): string => {
  const date = parseDate(d)
  if (!date || isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

const formatCurrency = (amount: number): string =>
  `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ─── Status Badge ───
const StatusBadge = ({ status }: { status: string }) => {
  let cls = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase "
  let icon = null

  switch (status) {
    case "pending":
      cls += "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800"
      icon = <Clock className="h-3 w-3" />
      break
    case "completed":
      cls += "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800"
      icon = <CheckCircle2 className="h-3 w-3" />
      break
    case "cancelled":
      cls += "bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800"
      icon = <XCircle className="h-3 w-3" />
      break
    default:
      cls += "bg-gray-50 text-gray-600 border border-gray-200"
  }

  return <span className={cls}>{icon}{status}</span>
}

type StatusFilter = "all" | "pending" | "completed" | "cancelled"

export function OrdersTable() {
  const { orders, loading } = useOrders()
  const router = useRouter()

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 8

  // ─── Stats ───
  const stats = useMemo(() => {
    const total = orders.length
    const pending = orders.filter(o => o.status === "pending").length
    const completed = orders.filter(o => o.status === "completed").length
    const cancelled = orders.filter(o => o.status === "cancelled").length
    const revenue = orders.filter(o => o.status === "completed").reduce((sum, o) => sum + (o.totalAmount || 0), 0)
    return { total, pending, completed, cancelled, revenue }
  }, [orders])

  // ─── Filtered + Searched ───
  const filteredOrders = useMemo(() => {
    let result = orders
    if (statusFilter !== "all") {
      result = result.filter(o => o.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(o =>
        o.customerName.toLowerCase().includes(q) ||
        o.customerEmail?.toLowerCase().includes(q) ||
        o.customerAddress?.toLowerCase().includes(q)
      )
    }
    return result
  }, [orders, statusFilter, search])

  // ─── Pagination ───
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ITEMS_PER_PAGE))
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  )

  // Reset page when filter/search changes
  useMemo(() => setCurrentPage(1), [statusFilter, search])

  if (loading) {
    return (
      <div className="space-y-6 pb-8 animate-in fade-in duration-300">
        <div><div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" /><div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></div>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (<Card key={i} className="rounded-2xl"><CardHeader className="pb-2 pt-5 px-5"><div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></CardHeader><CardContent className="px-5 pb-5"><div className="h-8 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></CardContent></Card>))}
        </div>
        <Card className="rounded-2xl"><CardContent className="p-6">{[...Array(5)].map((_, i) => (<div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse mb-2" />))}</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-bold text-gray-900 dark:text-foreground leading-tight tracking-[-0.01em]">
          Orders Management
        </h1>
        <p className="text-gray-400 dark:text-muted-foreground text-[13px] mt-1 tracking-wide">
          View and manage all customer orders
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {/* Total Orders */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 px-5 pt-5">
            <CardTitle className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Orders</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
              <Package className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="text-2xl font-bold text-gray-900 dark:text-foreground">{stats.total}</div>
          </CardContent>
        </Card>

        {/* Pending */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 px-5 pt-5">
            <CardTitle className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pending</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="text-2xl font-bold text-amber-500">{stats.pending}</div>
          </CardContent>
        </Card>

        {/* Completed */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 px-5 pt-5">
            <CardTitle className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Completed</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="text-2xl font-bold text-emerald-500">{stats.completed}</div>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 px-5 pt-5">
            <CardTitle className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Revenue</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center">
              <BanknoteIcon className="h-4 w-4 text-purple-500" />
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{formatCurrency(stats.revenue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Orders Table Card */}
      <Card className="rounded-2xl border border-gray-100 dark:border-border bg-white dark:bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <CardHeader className="px-6 pt-6 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold text-gray-900 dark:text-foreground">All Orders</CardTitle>
              <CardDescription className="text-sm text-gray-400 mt-0.5">
                {filteredOrders.length} order{filteredOrders.length === 1 ? "" : "s"} found
              </CardDescription>
            </div>
          </div>

          {/* Search + Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by name, email, or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-10 rounded-lg border-gray-200 dark:border-border bg-gray-50/50 dark:bg-secondary/30 text-sm"
              />
            </div>

            {/* Status filter pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter className="h-4 w-4 text-gray-400 mr-1 hidden sm:block" />
              {(["all", "pending", "completed", "cancelled"] as StatusFilter[]).map((s) => {
                const isActive = s === statusFilter
                let pillClass = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 border cursor-pointer "
                if (isActive) {
                  switch (s) {
                    case "pending": pillClass += "bg-amber-500 text-white border-amber-500 shadow-sm"; break
                    case "completed": pillClass += "bg-emerald-500 text-white border-emerald-500 shadow-sm"; break
                    case "cancelled": pillClass += "bg-red-500 text-white border-red-500 shadow-sm"; break
                    default: pillClass += "bg-sky-500 text-white border-sky-500 shadow-sm"
                  }
                } else {
                  pillClass += "bg-white dark:bg-secondary/20 text-gray-500 border-gray-200 dark:border-border hover:bg-gray-50 dark:hover:bg-secondary/40"
                }
                return (
                  <button key={s} onClick={() => setStatusFilter(s)} className={pillClass}>
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-6 pb-5 pt-0">
          {/* Scrollable table wrapper for responsive display */}
          <div className="overflow-x-auto">
            {/* Table Header */}
            <div className="grid grid-cols-[1.5fr_1.2fr_1.5fr_1.5fr_1fr_0.8fr_1fr_0.6fr] gap-3 text-[11px] font-semibold text-gray-400 dark:text-muted-foreground uppercase tracking-wider pb-3 border-b border-gray-100 dark:border-border min-w-[900px]">
              <div>Customer</div>
              <div>Email</div>
              <div>Address</div>
              <div>Products</div>
              <div className="text-center">Amount</div>
              <div className="text-center">Status</div>
              <div className="text-center">Date</div>
              <div className="text-right">Action</div>
            </div>

            {/* Table Rows */}
            <div className="divide-y divide-gray-50 dark:divide-border/50 min-w-[900px]">
              {paginatedOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="h-14 w-14 rounded-full bg-gray-50 dark:bg-secondary/50 flex items-center justify-center mb-3">
                    <ShoppingCart className="h-6 w-6 text-gray-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-500">
                    {orders.length === 0 ? "No orders yet" : "No orders found"}
                  </p>
                  <p className="text-xs text-gray-300 mt-1">
                    {search || statusFilter !== "all" ? "Try adjusting your filters" : "Orders will appear here once created"}
                  </p>
                </div>
              ) : (
                paginatedOrders.map((order) => {
                  let borderColor = "border-l-gray-200"
                  if (order.status === "pending") borderColor = "border-l-amber-400"
                  else if (order.status === "completed") borderColor = "border-l-emerald-400"
                  else if (order.status === "cancelled") borderColor = "border-l-red-400"

                  return (
                    <div
                      key={order.id}
                      className={`grid grid-cols-[1.5fr_1.2fr_1.5fr_1.5fr_1fr_0.8fr_1fr_0.6fr] gap-3 py-3.5 items-center transition-all duration-200 hover:bg-blue-50/40 dark:hover:bg-secondary/30 group border-l-[3px] ${borderColor} rounded-r-md -ml-px pl-3 cursor-pointer`}
                      onClick={() => router.push(`/orders/details?id=${order.id}`)}
                    >
                      {/* Customer Name */}
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-800 dark:text-foreground truncate">{order.customerName}</p>
                      </div>

                      {/* Email */}
                      <div className="min-w-0">
                        <p className="text-[12px] text-gray-500 dark:text-foreground/70 truncate" title={order.customerEmail}>
                          {order.customerEmail || "—"}
                        </p>
                      </div>

                      {/* Address */}
                      <div className="min-w-0">
                        <p className="text-[12px] text-gray-500 dark:text-foreground/70 truncate" title={order.customerAddress}>
                          {order.customerAddress || "—"}
                        </p>
                      </div>

                      {/* Products */}
                      <div className="min-w-0">
                        {order.items && order.items.length > 0 ? (
                          <div className="space-y-0.5">
                            {order.items.slice(0, 3).map((item, idx) => (
                              <p key={idx} className="text-[11px] text-gray-600 dark:text-foreground/70 truncate leading-tight">
                                • {item.name || "Unnamed"} <span className="text-gray-400">(x{item.quantity})</span>
                              </p>
                            ))}
                            {order.items.length > 3 && (
                              <p className="text-[10px] text-gray-400 italic">
                                +{order.items.length - 3} more
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-400">No items</p>
                        )}
                      </div>

                      {/* Amount */}
                      <div className="text-center">
                        <span className="text-sm font-bold text-gray-800 dark:text-foreground">{formatCurrency(order.totalAmount)}</span>
                      </div>

                      {/* Status */}
                      <div className="flex justify-center">
                        <StatusBadge status={order.status} />
                      </div>

                      {/* Date */}
                      <div className="text-center">
                        <p className="text-[13px] text-gray-600 dark:text-foreground">{formatDate(order.createdAt)}</p>
                        <p className="text-[11px] text-gray-400">{formatTime(order.createdAt)}</p>
                      </div>

                      {/* Action */}
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/orders/details?id=${order.id}`)
                          }}
                          className="h-8 px-3 text-xs font-medium rounded-lg border-gray-200 dark:border-border hover:bg-sky-50 hover:border-sky-300 hover:text-sky-600 dark:hover:bg-sky-950/30 transition-all"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-100 dark:border-border">
              <div className="text-xs text-gray-400">
                Showing {paginatedOrders.length} of {filteredOrders.length}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline" size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-8 px-3 text-xs font-medium rounded-lg"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-0.5" /> Previous
                </Button>
                <div className="flex items-center gap-0.5 px-2.5 py-1 bg-gray-50 dark:bg-secondary/40 rounded-lg">
                  <span className="text-xs font-bold text-gray-700 dark:text-foreground">{currentPage}</span>
                  <span className="text-xs text-gray-300">/</span>
                  <span className="text-xs text-gray-400">{totalPages}</span>
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 px-3 text-xs font-medium rounded-lg"
                >
                  Next <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
