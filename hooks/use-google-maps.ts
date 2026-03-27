import { useEffect, useState, useRef } from "react"

/**
 * Detects the build system and returns the appropriate Google Maps API key from environment variables
 * Supports: Next.js (NEXT_PUBLIC_), Vite (VITE_), Create React App (REACT_APP_)
 */
function getGoogleMapsApiKey(): string | undefined {
  // Check for Vite (import.meta.env) - only in Vite environments
  try {
    // @ts-ignore - import.meta is Vite-specific
    if (typeof import.meta !== "undefined" && import.meta.env) {
      // @ts-ignore
      return import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    }
  } catch {
    // Not a Vite environment, continue
  }

  // Check for Next.js (process.env.NEXT_PUBLIC_) or CRA (process.env.REACT_APP_)
  if (typeof process !== "undefined" && process.env) {
    return (
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      process.env.REACT_APP_GOOGLE_MAPS_API_KEY
    )
  }

  return undefined
}

interface UseGoogleMapsResult {
  isLoaded: boolean
  isLoading: boolean
  error: string | null
}

/**
 * Hook to load Google Maps JavaScript API script once
 * Prevents duplicate script loading across multiple components
 */
export function useGoogleMaps(): UseGoogleMapsResult {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef(false)

  useEffect(() => {
    // Check if already loaded
    if (window.google && window.google.maps) {
      setIsLoaded(true)
      return
    }

    // Check if already loading
    if (loadingRef.current) {
      return
    }

    // Check if script tag already exists
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    )
    if (existingScript) {
      // If script exists and Google Maps is already loaded
      if (window.google && window.google.maps) {
        setIsLoaded(true)
        setIsLoading(false)
        return
      }

      // Wait for existing script to load
      const handleLoad = () => {
        setIsLoaded(true)
        setIsLoading(false)
        existingScript.removeEventListener("load", handleLoad)
        existingScript.removeEventListener("error", handleError)
      }

      const handleError = () => {
        setError("Failed to load Google Maps script")
        setIsLoading(false)
        existingScript.removeEventListener("load", handleLoad)
        existingScript.removeEventListener("error", handleError)
      }

      existingScript.addEventListener("load", handleLoad)
      existingScript.addEventListener("error", handleError)
      loadingRef.current = true
      setIsLoading(true)
      return
    }

    // Get API key from environment variable
    const apiKey = getGoogleMapsApiKey()

    if (!apiKey) {
      // Determine which env var name to suggest
      let envVarName = "REACT_APP_GOOGLE_MAPS_API_KEY"
      try {
        // @ts-ignore - import.meta is Vite-specific
        if (typeof import.meta !== "undefined" && import.meta.env) {
          envVarName = "VITE_GOOGLE_MAPS_API_KEY"
        } else if (
          typeof process !== "undefined" &&
          process.env?.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY !== undefined
        ) {
          envVarName = "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"
        }
      } catch {
        // Default to REACT_APP_GOOGLE_MAPS_API_KEY
      }

      const envFileName = envVarName.startsWith("NEXT_PUBLIC_") ? ".env.local" : ".env"
      setError(
        `Google Maps API key is not configured. Please set ${envVarName} in your ${envFileName} file and restart the dev server (npm run dev).`
      )
      setIsLoading(false)
      return
    }

    // Load Google Maps script
    loadingRef.current = true
    setIsLoading(true)

    const script = document.createElement("script")
    // Load geometry library for distance calculations (optional but useful)
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`
    script.async = true
    script.defer = true

    script.onload = () => {
      setIsLoaded(true)
      setIsLoading(false)
      loadingRef.current = false
    }

    script.onerror = () => {
      setError(
        "Failed to load Google Maps. Please check your API key and ensure it's valid."
      )
      setIsLoading(false)
      loadingRef.current = false
    }

    document.head.appendChild(script)

    // Cleanup function
    return () => {
      // Don't remove script on cleanup - it should persist for other components
      loadingRef.current = false
    }
  }, [])

  return { isLoaded, isLoading, error }
}

