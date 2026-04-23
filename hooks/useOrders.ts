"use client"

import { useEffect, useState } from "react"
import { getFirebaseDb } from "@/lib/firebase-live"
import {
  collection as fbCollection,
  onSnapshot as fbOnSnapshot,
  query as fbQuery,
  where as fbWhere,
  doc as fbDoc,
  getDoc as fbGetDoc,
  getDocs as fbGetDocs,
} from "firebase/firestore"

export interface OrderItem {
  id?: string
  productId?: string
  name: string
  quantity: number
  unit?: string
  imageUrl?: string
}

export interface ShippingAddress {
  fullName: string
  phoneNumber: string
  address: string
  city: string
}

export interface Order {
  id: string
  customerName: string
  customerPhone: string
  customerAddress: string
  shippingAddress: ShippingAddress
  items: OrderItem[]
  status: "pending" | "ready_for_processing" | "processing" | "ready_for_delivery" | "completed" | "cancelled"
  salesInvoiceNo?: string
  deliveryReceiptNo?: string
  isInvoiceConfirmed?: boolean
  createdAt: Date | any
  userId?: string
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
  
  // Update items to include unit
  const items: OrderItem[] = (d.items ?? []).map((p: any) => ({
    ...p,
    name: p.name || "Unnamed",
    quantity: p.quantity ?? p.qty ?? 0,
    unit: p.unit || "unit"
  }))

  return {
    id: docId,
    // Prefer shippingAddress fields, fall back to legacy flat fields
    customerName: shipping.fullName || d.customerName || "Unknown",
    customerPhone: shipping.phoneNumber || d.customerPhone || "N/A",
    customerAddress: shipping.address
      ? `${shipping.address}${shipping.city ? `, ${shipping.city}` : ""}`
      : d.customerAddress || "",
    shippingAddress: {
      fullName: shipping.fullName || d.customerName || "Unknown",
      phoneNumber: shipping.phoneNumber || d.customerPhone || "N/A",
      address: shipping.address || d.customerAddress || "",
      city: shipping.city || "",
    },
    items,
    // Normalize status to lowercase for consistent filtering
    status: (d.status ? String(d.status).toLowerCase() : "pending") as Order["status"],
    salesInvoiceNo: d.salesInvoiceNo || "",
    deliveryReceiptNo: d.deliveryReceiptNo || "",
    isInvoiceConfirmed: d.isInvoiceConfirmed || false,
    createdAt: d.createdAt,
    userId: d.userId || d.customerId || "",
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
        async (snapshot: any) => {
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

          // Batch fetch products to get image URLs
          const productMap: Record<string, string> = {}
          try {
            const productsSnapshot = await fbGetDocs(fbCollection(db, "products"))
            productsSnapshot.forEach(doc => {
              productMap[doc.id] = doc.data().imageUrl || ""
            })
          } catch (err) {
            console.error("[useOrders] Error fetching products for images:", err)
          }

          // Step 1: Fetch phone numbers from users collection if missing and attach images
          const resolvedData = await Promise.all(data.map(async (order) => {
            // Attach images to items
            const itemsWithImages = order.items.map(item => ({
              ...item,
              imageUrl: productMap[item.id || item.productId || ""] || ""
            }))
            
            const processedOrder = { ...order, items: itemsWithImages }

            // Only fetch if phone is "N/A" and userId exists
            if ((processedOrder.customerPhone === "N/A" || !processedOrder.customerPhone) && processedOrder.userId) {
              try {
                const userDoc = await fbGetDoc(fbDoc(db, "users", processedOrder.userId))
                if (userDoc.exists()) {
                  const userData = userDoc.data()
                  return {
                    ...processedOrder,
                    customerPhone: userData.phoneNumber || ""
                  }
                }
              } catch (err) {
                console.error(`[useOrders] Error fetching user phone for ${processedOrder.userId}:`, err)
              }
            }
            return processedOrder
          }))

          // Sort client-side: newest first by createdAt
          resolvedData.sort((a, b) => {
            const dateA = parseTimestamp(a.createdAt)
            const dateB = parseTimestamp(b.createdAt)
            return dateB.getTime() - dateA.getTime()
          })

          console.log(`[useOrders] Mapped ${resolvedData.length} orders with phone resolution`)

          setOrders(resolvedData)
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

export { mapDocToOrder }
