"use client"

import { useEffect, useState } from "react"
import { getFirebaseDb } from "@/lib/firebase-live"
import {
  collection as fbCollection,
  onSnapshot as fbOnSnapshot,
  query as fbQuery,
  where as fbWhere,
} from "firebase/firestore"

export interface OrderItem {
  id?: string
  name: string
  quantity: number
  price: number
}

export interface ShippingAddress {
  fullName: string
  email: string
  address: string
  city: string
}

export interface Order {
  id: string
  customerName: string
  customerEmail: string
  customerAddress: string
  customerPhone?: string
  shippingAddress: ShippingAddress
  items: OrderItem[]
  totalAmount: number
  status: "pending" | "ready_for_processing" | "processing" | "ready_for_delivery" | "completed" | "cancelled"
  salesInvoiceNo?: string
  deliveryReceiptNo?: string
  isInvoiceConfirmed?: boolean
  createdAt: Date | any
}

/**
 * Calculate total from items array: sum of (price × quantity)
 */
function calculateTotal(items: OrderItem[]): number {
  return (items || []).reduce((sum, item) => {
    return sum + ((item.price || 0) * (item.quantity || 0))
  }, 0)
}

/**
 * Parse a Firestore timestamp into a JS Date for sorting.
 */
function parseTimestamp(ts: any): Date {
  if (!ts) return new Date(0)
  if (ts instanceof Date) return ts
  if (typeof ts === "string") return new Date(ts)
  if (ts?.toDate) return ts.toDate()
  if (ts?.seconds) return new Date(ts.seconds * 1000)
  return new Date(0)
}

/**
 * Map a raw Firestore document to the Order interface.
 * Supports both the shippingAddress sub-object structure and legacy flat fields.
 */
function mapDocToOrder(docId: string, d: any): Order {
  const shipping: ShippingAddress = d.shippingAddress || {}
  const items: OrderItem[] = d.items ?? []
  const calculatedTotal = calculateTotal(items)

  return {
    id: docId,
    // Prefer shippingAddress fields, fall back to legacy flat fields
    customerName: shipping.fullName || d.customerName || "Unknown",
    customerEmail: shipping.email || d.customerEmail || "",
    customerAddress: shipping.address
      ? `${shipping.address}${shipping.city ? `, ${shipping.city}` : ""}`
      : d.customerAddress || "",
    customerPhone: d.customerPhone ?? "",
    shippingAddress: {
      fullName: shipping.fullName || d.customerName || "Unknown",
      email: shipping.email || d.customerEmail || "",
      address: shipping.address || d.customerAddress || "",
      city: shipping.city || "",
    },
    items,
    // Use stored totalAmount if available, otherwise calculate from items
    totalAmount: d.totalAmount ?? calculatedTotal,
    // Normalize status to lowercase for consistent filtering
    status: (d.status ? String(d.status).toLowerCase() : "pending") as Order["status"],
    salesInvoiceNo: d.salesInvoiceNo || "",
    deliveryReceiptNo: d.deliveryReceiptNo || "",
    isInvoiceConfirmed: d.isInvoiceConfirmed || false,
    createdAt: d.createdAt,
  }
}

/**
 * Custom hook that subscribes to the `orders` Firestore collection
 * in real-time using `onSnapshot`.
 *
 * IMPORTANT: We do NOT use orderBy() to avoid requiring a Firestore index
 * and to ensure documents without a createdAt field are not silently excluded.
 * Sorting is done client-side instead.
 *
 * Returns:
 *  - orders: Order[]   — all orders, newest first
 *  - loading: boolean  — true while the initial snapshot is loading
 */
export function useOrders(filterStatus?: "pending" | "ready_for_processing" | "processing" | "ready_for_delivery" | "completed" | "cancelled") {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    console.log("[useOrders] Initializing Firestore subscription...")

    try {
      const db = getFirebaseDb()

      if (!db) {
        console.error("[useOrders] Firebase DB is null/undefined — Firebase not initialized yet")
        setOrders([])
        setLoading(false)
        return
      }

      // Subscribe to the "orders" collection
      const ordersRef = fbCollection(db, "orders")
      
      let q = ordersRef as any
      if (filterStatus) {
        console.log(`[useOrders] Filtering by status: ${filterStatus}`)
        q = fbQuery(ordersRef, fbWhere("status", "==", filterStatus))
      }

      console.log("[useOrders] Subscribing to 'orders' collection (no orderBy)...")

      unsubscribe = fbOnSnapshot(
        q,
        (snapshot: any) => {
          console.log(`[useOrders] ✅ Snapshot received — ${snapshot.docs.length} documents`)

          // Log raw data for debugging
          if (snapshot.docs.length > 0) {
            console.log("[useOrders] First doc raw data:", JSON.stringify(snapshot.docs[0].data(), null, 2))
          } else {
            console.warn("[useOrders] ⚠️ Collection 'orders' is empty — no documents found")
          }

          const data: Order[] = snapshot.docs.map((doc: any) =>
            mapDocToOrder(doc.id, doc.data())
          )

          // Sort client-side: newest first by createdAt
          data.sort((a, b) => {
            const dateA = parseTimestamp(a.createdAt)
            const dateB = parseTimestamp(b.createdAt)
            return dateB.getTime() - dateA.getTime()
          })

          console.log(`[useOrders] Mapped ${data.length} orders:`,
            data.map(o => ({
              id: o.id,
              name: o.customerName,
              email: o.customerEmail,
              items: o.items?.length,
              total: o.totalAmount,
              status: o.status,
            }))
          )

          setOrders(data)
          setLoading(false)
        },
        (error: any) => {
          console.error("[useOrders] ❌ Snapshot error:", error)
          console.error("[useOrders] Error code:", (error as any)?.code)
          console.error("[useOrders] Error message:", (error as any)?.message)
          setOrders([])
          setLoading(false)
        }
      )
    } catch (error) {
      console.error("[useOrders] ❌ Failed to initialize subscription:", error)
      setOrders([])
      setLoading(false)
    }

    return () => {
      console.log("[useOrders] Unsubscribing from orders collection")
      unsubscribe?.()
    }
  }, [])

  return { orders, loading }
}

export { mapDocToOrder, calculateTotal }
