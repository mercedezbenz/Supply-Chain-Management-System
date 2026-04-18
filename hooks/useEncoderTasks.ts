"use client"

import { useEffect, useState } from "react"
import { getFirebaseDb } from "@/lib/firebase-live"
import { auth } from "@/lib/firebase-live"
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore"
import { onAuthStateChanged } from "firebase/auth"

export interface EncoderTask {
  id: string
  orderId: string
  customerName: string
  customerEmail: string
  items: any[]
  totalAmount: number
  salesInvoiceNo: string
  deliveryReceiptNo: string
  status: "pending" | "processing" | "done"
  createdAt: any
}

export function useEncoderTasks(status?: "pending" | "processing" | "done") {
  const [tasks, setTasks] = useState<EncoderTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | undefined
    let unsubscribeAuth: (() => void) | undefined

    console.log("[useEncoderTasks] Initializing — waiting for auth state...")

    try {
      const firebaseAuth = auth
      if (!firebaseAuth) {
        console.error("[useEncoderTasks] Firebase Auth not initialized yet")
        setLoading(false)
        return
      }

      // Wait for the user to be authenticated before subscribing to encoder_tasks
      unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
        // Clean up any previous snapshot listener when auth state changes
        if (unsubscribeSnapshot) {
          unsubscribeSnapshot()
          unsubscribeSnapshot = undefined
        }

        if (!user) {
          console.warn("[useEncoderTasks] No authenticated user — cannot fetch encoder_tasks")
          setTasks([])
          setLoading(false)
          return
        }

        console.log(`[useEncoderTasks] Auth ready (uid: ${user.uid}) — subscribing to encoder_tasks collection`)
        
        try {
          const db = getFirebaseDb()
          if (!db) {
            console.error("[useEncoderTasks] Firebase DB is null/undefined")
            setTasks([])
            setLoading(false)
            return
          }

          const tasksRef = collection(db, "encoder_tasks")

          let q = tasksRef as any
          if (status) {
            console.log(`[useEncoderTasks] Filtering by status: "${status}"`)
            q = query(tasksRef, where("status", "==", status))
          }

          unsubscribeSnapshot = onSnapshot(
            q,
            (snapshot: any) => {
              const data: EncoderTask[] = snapshot.docs.map((doc: any) => ({
                id: doc.id,
                ...doc.data()
              } as EncoderTask))

              // Sort client-side to avoid composite index requirements
              data.sort((a, b) => {
                const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0
                const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0
                return timeB - timeA
              })

              console.log(`[useEncoderTasks] ✅ Snapshot received — ${data.length} task(s):`, data.map(t => ({
                id: t.id,
                orderId: t.orderId,
                customer: t.customerName,
                status: t.status,
              })))
              setTasks(data)
              setLoading(false)
            },
            (error: any) => {
              console.error("[useEncoderTasks] ❌ Snapshot error:", error)
              console.error("[useEncoderTasks] Error code:", error?.code)
              console.error("[useEncoderTasks] Error message:", error?.message)
              setTasks([])
              setLoading(false)
            }
          )
        } catch (err) {
          console.error("[useEncoderTasks] Failed to set up Firestore listener:", err)
          setTasks([])
          setLoading(false)
        }
      })
    } catch (err) {
      console.error("[useEncoderTasks] Hook initialization error:", err)
      setLoading(false)
    }

    return () => {
      console.log("[useEncoderTasks] Cleaning up listeners")
      unsubscribeSnapshot?.()
      unsubscribeAuth?.()
    }
  }, [status])

  return { tasks, loading }
}
