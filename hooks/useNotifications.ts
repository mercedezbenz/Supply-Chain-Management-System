import { useState, useEffect } from "react"
import { collection, query, where, orderBy, onSnapshot, updateDoc, doc, Timestamp } from "firebase/firestore"
import { getFirebaseDb } from "@/lib/firebase-live"

export interface Notification {
  id: string
  title: string
  message: string
  targetRole: string
  userId?: string | null
  type: "ORDER" | "STOCK" | "SYSTEM" | "order"
  isRead: boolean
  createdAt: any
}

/**
 * Inventory-related keywords used to reject notifications that leaked
 * into the sales/encoder bell (e.g. old docs without proper targetRole).
 */
const INVENTORY_KEYWORDS = [
  "low stock",
  "out of stock",
  "expir",         // matches "expired", "expiring", "expiry"
  "stock alert",
  "reorder",
  "inventory",
]

function isInventoryNotification(n: Notification): boolean {
  const text = `${n.title ?? ""} ${n.message ?? ""}`.toLowerCase()
  return INVENTORY_KEYWORDS.some((kw) => text.includes(kw))
}

export function useNotifications(userRole?: string) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userRole) {
      setNotifications([])
      setLoading(false)
      return
    }

    // STEP 6: Clear old state immediately on role change
    setNotifications([])
    setLoading(true)

    const db = getFirebaseDb()
    const notificationsRef = collection(db, "notifications")

    // STEP 2: FORCE ROLE-BASED QUERY — strict equality on targetRole
    const q = query(
      notificationsRef,
      where("targetRole", "==", userRole),
      orderBy("createdAt", "desc")
    )

    console.log("[useNotifications] Subscribing for role:", userRole)

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        })) as Notification[]

        // STEP 3: HARD FILTER (FAILSAFE) — double-check targetRole
        let filtered = data.filter((n) => n.targetRole === userRole)

        // STEP 5: CONTENT-BASED FILTER — strip inventory notifications
        // from sales/encoder bells (they belong in ExpiryNotifications)
        if (userRole === "sales" || userRole === "encoder") {
          filtered = filtered.filter((n) => !isInventoryNotification(n))
        }

        // STEP 4: DEBUG LOGS
        console.log("ROLE:", userRole)
        console.log("ALL NOTIFS:", data.length, data)
        console.log("FILTERED:", filtered.length, filtered)

        setNotifications(filtered)
        setLoading(false)
      },
      (error) => {
        console.error("[useNotifications] Error fetching notifications:", error)
        // If the query fails (e.g. missing composite index), set empty
        setNotifications([])
        setLoading(false)
      }
    )

    return () => unsubscribe()
  }, [userRole])

  const markAsRead = async (notificationId: string) => {
    try {
      const db = getFirebaseDb()
      await updateDoc(doc(db, "notifications", notificationId), {
        isRead: true,
      })
    } catch (e) {
      console.error("[useNotifications] Failed to mark as read:", e)
    }
  }

  const markAllAsRead = async () => {
    try {
      const db = getFirebaseDb()
      // Only unread notifications intended for this user
      const unread = notifications.filter((n) => !n.isRead)
      const updates = unread.map((n) =>
        updateDoc(doc(db, "notifications", n.id), { isRead: true })
      )
      await Promise.all(updates)
    } catch (e) {
      console.error("[useNotifications] Failed to mark all as read:", e)
    }
  }

  return { notifications, loading, markAsRead, markAllAsRead }
}
