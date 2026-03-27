"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState, useCallback } from "react"
// Removed mock-auth and mock-firestore imports - always using live Firebase
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase-live"
import { onAuthStateChanged as fbOnAuthStateChanged, signInWithEmailAndPassword as fbSignIn, signOut as fbSignOut, sendPasswordResetEmail as fbSendReset } from "firebase/auth"
import { doc as fbDoc, getDoc as fbGetDoc, setDoc as fbSetDoc } from "firebase/firestore"
import type { User } from "@/lib/types"

interface AuthContextType {
  user: User | null
  firebaseUser: any | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  loginAsGuest: () => void
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  createDefaultUser: () => Promise<void>
  isAdmin: boolean
  isStaff: boolean
  isGuest: boolean
  canManageInventory: boolean
  firebaseError: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const DEFAULT_ADMIN_EMAIL = "admin@decktago.com"
const DEFAULT_ADMIN_PASSWORD = "admin123"

// *** Module-level variables — survive AuthProvider remounts during route changes ***
let _isGuestMode = false
let _guestUser: User | null = null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialize user from module-level guest user if guest mode is active (survives remounts)
  const [user, setUser] = useState<User | null>(_isGuestMode ? _guestUser : null)
  const [firebaseUser, setFirebaseUser] = useState<any | null>(null)
  const [loading, setLoading] = useState(_isGuestMode ? false : true)
  const [firebaseError, setFirebaseError] = useState<string | null>(null)

  useEffect(() => {
    let unsubscribe: (() => void) | null = null
    let timeoutId: NodeJS.Timeout | null = null
    let isResolved = false

    try {
      // Always use live Firebase - no longer using mock auth
      console.log("[Auth] Initializing Firebase authentication (always using live Firebase)")
      
      // Set a timeout to ensure loading becomes false even if Firebase is slow
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          console.log("[Auth] Firebase auth initialization timeout - setting loading to false")
          isResolved = true
          setLoading(false)
        }
      }, 2000) // 2 second timeout

      unsubscribe = fbOnAuthStateChanged(getFirebaseAuth(), async (authUser: any) => {
        try {
          // Clear timeout since we got a response
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          isResolved = true

          if (authUser) {
            const db = getFirebaseDb()
            const docRef = fbDoc(db, "users", authUser.uid)
            const docSnap = await fbGetDoc(docRef)
            if (docSnap.exists()) {
              const userData = docSnap.data() as any
              setUser({ uid: authUser.uid, ...userData })
            } else {
              // Create user document if it doesn't exist
              const userData = {
                uid: authUser.uid,
                email: authUser.email,
                role: "admin" as const,
                status: "active" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              await fbSetDoc(docRef, userData)
              setUser(userData as any)
            }
            setFirebaseUser(authUser)
          } else {
            // *** CRITICAL: Do NOT clear user state if guest mode is active ***
            if (_isGuestMode && _guestUser) {
              console.log("[Auth] onAuthStateChanged: no Firebase user, but GUEST MODE is active — restoring guest user")
              setUser(_guestUser)
              setFirebaseUser(null)
            } else {
              console.log("[Auth] onAuthStateChanged: no Firebase user, clearing state")
              setUser(null)
              setFirebaseUser(null)
            }
          }
        } catch (error) {
          console.error("[Auth] Error in auth state change:", error)
          setFirebaseError(error instanceof Error ? error.message : "Auth error")
        } finally {
          setLoading(false)
        }
      })

      return () => {
        if (unsubscribe) unsubscribe()
        if (timeoutId) clearTimeout(timeoutId)
      }
    } catch (error) {
      console.error("[v0] Auth initialization error:", error)
      setLoading(false)
      setFirebaseError(error instanceof Error ? error.message : "Auth initialization failed")
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      // Clear any previous errors
      setFirebaseError(null)
      
      // Always use live Firebase
      console.log("[Auth] Signing in with Firebase:", email)
      const result = await fbSignIn(getFirebaseAuth(), email, password)

      // Check user document in Firestore
      const db = getFirebaseDb()
      const authUser = (result as any).user
      const docRef = fbDoc(db, "users", authUser.uid)
      const docSnap = await fbGetDoc(docRef)

      if (!docSnap.exists()) {
        // Create user document if it doesn't exist
        const userData = {
          uid: authUser.uid,
          email: authUser.email,
          role: "admin" as const,
          status: "active" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        await fbSetDoc(docRef, userData)
        console.log("[Auth] Created user document for:", authUser.email)
      } else {
        const userData = docSnap.data() as any
        
        if (userData.role !== "admin" && userData.role !== "staff") {
          await fbSignOut(getFirebaseAuth())
          throw new Error("Access denied. Admin or staff access required.")
        }

        if (!userData.status || userData.status !== "active") {
          await fbSignOut(getFirebaseAuth())
          throw new Error(`Account status is "${userData.status}". Please contact an administrator.`)
        }
      }
    } catch (error: any) {
      console.error("[Auth] Sign in error:", error)
      setFirebaseError(error.message || "Failed to sign in")
      throw error
    }
  }

  const resetPassword = async (email: string) => {
    try {
      // Always use live Firebase
      await fbSendReset(getFirebaseAuth(), email)
    } catch (error) {
      throw error
    }
  }

  const createDefaultUser = async () => {
    try {
      // Always use live Firebase - create user in Firestore
      const db = getFirebaseDb()
      const userData = {
        uid: "admin-123",
        email: DEFAULT_ADMIN_EMAIL,
        role: "admin" as const,
        status: "active" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const docRef = fbDoc(db, "users", userData.uid)
      await fbSetDoc(docRef, userData)

      console.log("[Auth] Default admin user created successfully in Firebase")
    } catch (error: any) {
      console.error("[Auth] Error creating default user:", error)
      throw error
    }
  }

  const loginAsGuest = useCallback(() => {
    console.log("[Auth] ======= GUEST LOGIN START =======")
    
    const guestUser: User = {
      uid: "guest-local",
      email: "guest@decktago.com",
      role: "guest" as const,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    
    // Set MODULE-LEVEL variables FIRST — these survive component remounts
    _isGuestMode = true
    _guestUser = guestUser
    
    // Then set React state
    setUser(guestUser)
    setFirebaseUser(null)
    setLoading(false)
    
    console.log("[Auth] Guest user set:", guestUser)
    console.log("[Auth] _isGuestMode:", _isGuestMode)
    console.log("[Auth] ======= GUEST LOGIN END =======")
  }, [])

  const logout = async () => {
    try {
      console.log("[Auth] Logging out, _isGuestMode:", _isGuestMode)
      
      // Clear module-level guest mode flag FIRST
      _isGuestMode = false
      _guestUser = null
      
      // Only sign out from Firebase if we have a real Firebase user (not guest)
      if (firebaseUser) {
        await fbSignOut(getFirebaseAuth())
      }
      
      // Immediately clear local user state
      setUser(null)
      setFirebaseUser(null)
      
      // Clear any cached data
      if (typeof window !== "undefined") {
        localStorage.removeItem("auth")
        localStorage.removeItem("firestore")
        // Redirect to login page
        window.location.href = "/login"
      }
    } catch (error) {
      console.error("[Auth] Logout error:", error)
      // Still clear state and redirect even if signOut fails
      _isGuestMode = false
      _guestUser = null
      setUser(null)
      setFirebaseUser(null)
      if (typeof window !== "undefined") {
        localStorage.removeItem("auth")
        localStorage.removeItem("firestore")
        window.location.href = "/login"
      }
    }
  }

  const isAdmin = user?.role === "admin" && user?.status === "active"
  const isStaff = user?.role === "staff" && user?.status === "active"
  const isGuest = user?.role === "guest" && user?.status === "active"
  const canManageInventory = (user?.role === "admin" || user?.role === "staff") && user?.status === "active"

  const value = {
    user,
    firebaseUser,
    loading,
    signIn,
    loginAsGuest,
    logout,
    resetPassword,
    createDefaultUser,
    isAdmin,
    isStaff,
    isGuest,
    canManageInventory,
    firebaseError,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
