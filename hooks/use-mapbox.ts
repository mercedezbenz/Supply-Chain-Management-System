"use client"

import { useEffect, useState } from "react"
import mapboxgl from "mapbox-gl"

/**
 * Gets the Mapbox access token from environment variables
 * Supports: Next.js (NEXT_PUBLIC_), Vite (VITE_), Create React App (REACT_APP_)
 */
function getMapboxAccessToken(): string | undefined {
    // Check for Vite (import.meta.env) - only in Vite environments
    try {
        // @ts-ignore - import.meta is Vite-specific
        if (typeof import.meta !== "undefined" && import.meta.env) {
            // @ts-ignore
            return import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
        }
    } catch {
        // Not a Vite environment, continue
    }

    // Check for Next.js (process.env.NEXT_PUBLIC_) or CRA (process.env.REACT_APP_)
    if (typeof process !== "undefined" && process.env) {
        const envToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.REACT_APP_MAPBOX_ACCESS_TOKEN
        if (envToken) return envToken
    }

    // No hardcoded fallback — token must be set via environment variable
    return undefined
}

interface UseMapboxResult {
    isReady: boolean
    isLoading: boolean
    error: string | null
    accessToken: string | null
}

/**
 * Hook to initialize Mapbox GL JS and manage access token
 * Returns the ready state and access token for map initialization
 */
export function useMapbox(): UseMapboxResult {
    const [isReady, setIsReady] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [accessToken, setAccessToken] = useState<string | null>(null)

    useEffect(() => {
        const token = getMapboxAccessToken()

        if (!token) {
            // Determine which env var name to suggest
            let envVarName = "REACT_APP_MAPBOX_ACCESS_TOKEN"
            try {
                // @ts-ignore - import.meta is Vite-specific
                if (typeof import.meta !== "undefined" && import.meta.env) {
                    envVarName = "VITE_MAPBOX_ACCESS_TOKEN"
                } else if (typeof process !== "undefined" && process.env) {
                    envVarName = "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN"
                }
            } catch {
                // Default to NEXT_PUBLIC
                envVarName = "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN"
            }

            const envFileName = envVarName.startsWith("NEXT_PUBLIC_") ? ".env.local" : ".env"
            setError(
                `Mapbox access token is not configured. Please set ${envVarName} in your ${envFileName} file and restart the dev server (npm run dev).`
            )
            setIsLoading(false)
            return
        }

        // Set the access token for Mapbox GL
        mapboxgl.accessToken = token
        setAccessToken(token)
        setIsReady(true)
        setIsLoading(false)
        setError(null)
    }, [])

    return { isReady, isLoading, error, accessToken }
}

/**
 * Available Mapbox map styles
 */
export const MAPBOX_STYLES = {
    // Light styles
    streets: "mapbox://styles/mapbox/streets-v12",
    light: "mapbox://styles/mapbox/light-v11",
    outdoors: "mapbox://styles/mapbox/outdoors-v12",

    // Dark styles
    dark: "mapbox://styles/mapbox/dark-v11",
    navigationNight: "mapbox://styles/mapbox/navigation-night-v1",

    // Satellite
    satellite: "mapbox://styles/mapbox/satellite-v9",
    satelliteStreets: "mapbox://styles/mapbox/satellite-streets-v12",
} as const

export type MapboxStyleKey = keyof typeof MAPBOX_STYLES
