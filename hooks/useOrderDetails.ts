"use client"

import { useEffect, useState } from "react"
import { getFirebaseDb } from "@/lib/firebase-live"
import {
  doc as fbDoc,
  onSnapshot as fbOnSnapshot,
  updateDoc as fbUpdateDoc,
} from "firebase/firestore"
import type { Order } from "./useOrders"
import { mapDocToOrder } from "./useOrders"

/**
 * Custom hook that subscribes to a single order document in real-time.
 *
 * Returns:
 *  - order: Order | null
 *  - loading: boolean
 *  - updateStatus: (newStatus) => Promise<void>
 */
export function useOrderDetails(orderId: string | null) {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orderId) {
      setOrder(null)
      setLoading(false)
      return
    }

    let unsubscribe: (() => void) | undefined

    try {
      const db = getFirebaseDb()
      const docRef = fbDoc(db, "orders", orderId)

      unsubscribe = fbOnSnapshot(
        docRef,
        (snapshot) => {
          if (snapshot.exists()) {
            setOrder(mapDocToOrder(snapshot.id, snapshot.data()))
          } else {
            setOrder(null)
          }
          setLoading(false)
        },
        (error) => {
          console.error("[useOrderDetails] Snapshot error:", error)
          setOrder(null)
          setLoading(false)
        }
      )
    } catch (error) {
      console.error("[useOrderDetails] Failed to initialize:", error)
      setOrder(null)
      setLoading(false)
    }

    return () => {
      unsubscribe?.()
    }
  }, [orderId])

  /** Update the order status in Firestore */
  const updateStatus = async (newStatus: "pending" | "ready_for_processing" | "processing" | "ready_for_delivery" | "completed" | "cancelled") => {
    if (!orderId) return
    try {
      const db = getFirebaseDb()
      const docRef = fbDoc(db, "orders", orderId)
      await fbUpdateDoc(docRef, { status: newStatus })
      console.log(`[useOrderDetails] Updated order ${orderId} status to ${newStatus}`)
    } catch (error) {
      console.error("[useOrderDetails] Failed to update status:", error)
      throw error
    }
  }

  return { order, loading, updateStatus }
}
