"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getFirebaseRealtimeDb } from "@/lib/firebase-live"
import { ref, onValue, get } from "firebase/database"
import { useMapbox, MAPBOX_STYLES } from "@/hooks/use-mapbox"
import { createMapboxDriverPhotoMarker } from "@/lib/map-icons"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

interface DriverLocation {
  lat: number
  lng: number
}

interface DriverTrackingModalProps {
  driverId: string | null
  driverName?: string | null
  driverPhotoUrl?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Helper function to get location name from coordinates using Mapbox Geocoding API
async function getLocationName(lng: number, lat: number, accessToken: string): Promise<string> {
  try {
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${accessToken}&types=place,locality,neighborhood`
    )
    const data = await response.json()
    if (data.features && data.features.length > 0) {
      // Get the place name and postal code if available
      const place = data.features[0]
      const placeName = place.place_name || place.text
      // Try to find postal code from context
      const postalContext = place.context?.find((c: any) => c.id.startsWith("postcode"))
      const postal = postalContext?.text || ""
      return postal ? `${place.text}, ${postal}` : placeName
    }
    return "Unknown Location"
  } catch (error) {
    console.error("Geocoding error:", error)
    return "Unknown Location"
  }
}

export function DriverTrackingModal({ driverId, driverName, driverPhotoUrl, open, onOpenChange }: DriverTrackingModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const popupRef = useRef<mapboxgl.Popup | null>(null)

  const [mapInitialized, setMapInitialized] = useState(false)
  const [currentLocation, setCurrentLocation] = useState<DriverLocation | null>(null)
  const [locationName, setLocationName] = useState<string>("Loading...")
  const [mapError, setMapError] = useState<string | null>(null)
  const [initialLocationSet, setInitialLocationSet] = useState(false)
  const [resolvedPhotoUrl, setResolvedPhotoUrl] = useState<string | null>(null)
  const [driverInfo, setDriverInfo] = useState<{ licenseNumber?: string; truckPlateNumber?: string; photoUrl?: string }>({})

  // Use the Mapbox hook
  const { isReady, isLoading, error: mapboxError, accessToken } = useMapbox()

  // Fetch driver photo from Firestore if not provided
  useEffect(() => {
    if (!open || !driverId) return

    // If photo URL is already provided, use it
    if (driverPhotoUrl) {
      // Convert to displayable URL if needed
      let photoUrl = driverPhotoUrl
      if (driverPhotoUrl.includes('drive.google.com/file/d/')) {
        const match = driverPhotoUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/)
        if (match) {
          photoUrl = `https://lh3.googleusercontent.com/d/${match[1]}`
        }
      }
      setResolvedPhotoUrl(photoUrl)
      return
    }

    // Fetch from Firestore by email to get photo and other details
    const fetchDriverDetails = async () => {
      try {
        const { getFirebaseDb } = await import("@/lib/firebase-live")
        const { collection, query, where, getDocs } = await import("firebase/firestore")

        const db = getFirebaseDb()
        const usersRef = collection(db, "users")
        const q = query(usersRef, where("email", "==", driverId))
        const snapshot = await getDocs(q)

        if (!snapshot.empty) {
          const userData = snapshot.docs[0].data()

          // Get license and plate number
          setDriverInfo({
            licenseNumber: userData.licenseNumber,
            truckPlateNumber: userData.truckPlateNumber
          })

          // Get photo URL
          const photoUrl = userData.googleDrivePhotoUrl || userData.profilePhotoUrl
          if (photoUrl) {
            // Convert to displayable URL
            let displayUrl = photoUrl
            if (photoUrl.includes('drive.google.com/file/d/')) {
              const match = photoUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/)
              if (match) {
                displayUrl = `https://lh3.googleusercontent.com/d/${match[1]}`
              }
            }
            setResolvedPhotoUrl(displayUrl)
          }
        }
      } catch (error) {
        console.error("[DriverTrackingModal] Error fetching driver details:", error)
      }
    }

    fetchDriverDetails()
  }, [open, driverId, driverPhotoUrl])

  // Create popup content with driver photo at TOP and details below - readable version
  const createPopupContent = useCallback((name: string, lat: number, lng: number, locName: string, info: { licenseNumber?: string; truckPlateNumber?: string; photoUrl?: string } = {}) => {
    // Get initials for fallback avatar
    const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'DR'

    return `
      <div class="driver-popup-inner" style="font-family: system-ui, -apple-system, sans-serif; padding: 16px; min-width: 260px; max-width: 320px;">
        
        <!-- Driver Photo Section (at TOP, centered) -->
        <div style="display: flex; flex-direction: column; align-items: center; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;">
          ${info.photoUrl ? `
            <img 
              src="${info.photoUrl}" 
              alt="${name || 'Driver'}" 
              style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; border: 3px solid #3b82f6; box-shadow: 0 2px 8px rgba(59,130,246,0.3);"
              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
            />
            <div style="display: none; width: 70px; height: 70px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; font-size: 24px; font-weight: 700; align-items: center; justify-content: center; border: 3px solid #3b82f6;">${initials}</div>
          ` : `
            <div style="width: 70px; height: 70px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; font-size: 24px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 3px solid #3b82f6; box-shadow: 0 2px 8px rgba(59,130,246,0.3);">${initials}</div>
          `}
          <div style="margin-top: 8px; font-weight: 600; font-size: 16px; color: #1e293b; text-align: center;">🚚 ${name || "Driver"}</div>
        </div>
        
        <!-- Driver Details Section (below photo) -->
        <div style="display: grid; gap: 10px; padding: 12px; background: #f8fafc; border-radius: 10px; margin-bottom: 12px;">
          ${info.licenseNumber ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; line-height: 1.4;">
              <span style="color: #64748b; font-weight: 500;">📋 License:</span>
              <span style="font-weight: 600; color: #1e40af; background: #dbeafe; padding: 4px 10px; border-radius: 6px; font-size: 13px;">${info.licenseNumber}</span>
            </div>
          ` : ''}
          
          ${info.truckPlateNumber ? `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; line-height: 1.4;">
              <span style="color: #64748b; font-weight: 500;">🚛 Plate #:</span>
              <span style="font-weight: 600; color: #166534; background: #dcfce7; padding: 4px 10px; border-radius: 6px; font-size: 13px;">${info.truckPlateNumber}</span>
            </div>
          ` : ''}
        </div>

        <!-- Location Section -->
        <div style="font-size: 13px; color: #64748b; margin-bottom: 10px; line-height: 1.5; background: #fff; padding: 10px; border-radius: 8px; border: 1px solid #e2e8f0;">
          <strong style="color: #475569; font-size: 14px;">📍 Location:</strong><br/>
          <span style="color: #334155; font-size: 13px;">${locName}</span>
        </div>
        
        <!-- Coordinates -->
        <div style="font-size: 11px; color: #94a3b8; font-family: monospace; background: #f1f5f9; padding: 6px 10px; border-radius: 6px; text-align: center; line-height: 1.4;">
          Lat: ${lat.toFixed(6)} | Lng: ${lng.toFixed(6)}
        </div>
      </div>
    `
  }, [])

  // Initialize map
  const initializeMap = useCallback(async () => {
    if (!mapContainerRef.current || !accessToken || mapRef.current) return

    console.log("[DriverTrackingModal] Initializing Mapbox...")

    try {
      mapboxgl.accessToken = accessToken

      // Fetch current GPS location from Firebase first
      let initialCenter: [number, number] = [120.9842, 14.5995] // Default: Manila
      try {
        const db = getFirebaseRealtimeDb()
        const gpsRef = ref(db, "gps/latest")
        const snapshot = await get(gpsRef)
        const data = snapshot.val()
        if (data) {
          const lat = data.latitude ?? data.lat
          const lng = data.longitude ?? data.lng
          if (typeof lat === "number" && typeof lng === "number") {
            initialCenter = [lng, lat]
            console.log("[DriverTrackingModal] 📍 Initial GPS from Firebase:", { lat, lng })
          }
        }
      } catch (err) {
        console.warn("[DriverTrackingModal] Could not fetch initial GPS:", err)
      }

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLES.streets,
        center: initialCenter,
        zoom: 16,
        pitch: 0,
        bearing: 0,
        antialias: true
      })

      // Add navigation controls (zoom buttons)
      map.addControl(new mapboxgl.NavigationControl(), "top-right")
      map.addControl(new mapboxgl.FullscreenControl(), "top-right")

      map.on("load", () => {
        console.log("[DriverTrackingModal] ✅ Mapbox loaded")

        setTimeout(() => map.resize(), 100)

        // Create clickable driver photo marker (or initials fallback)
        try {
          const driverMarkerEl = createMapboxDriverPhotoMarker(resolvedPhotoUrl, driverName)
          driverMarkerEl.style.cursor = "pointer"

          // Create popup for the marker - attached above the marker icon
          const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            anchor: 'bottom',
            offset: [0, -15],
            maxWidth: '320px',
            className: "driver-popup"
          })
          popupRef.current = popup

          // Create marker at initial GPS location
          const marker = new mapboxgl.Marker({
            element: driverMarkerEl,
            anchor: "bottom",
          }).setLngLat(initialCenter).addTo(map)


          // Add click event to driver icon - fetch location name when clicked
          driverMarkerEl.addEventListener("click", async () => {
            const lngLat = marker.getLngLat()
            popup.setLngLat(lngLat)

            // Show popup immediately with "Fetching location..."
            popup.setHTML(createPopupContent(
              driverName || driverId || "Driver",
              lngLat.lat,
              lngLat.lng,
              "Fetching location...",
              { ...driverInfo, photoUrl: resolvedPhotoUrl || undefined }
            ))
            popup.addTo(map)

            // Fetch actual location name
            if (accessToken) {
              try {
                const actualLocationName = await getLocationName(lngLat.lng, lngLat.lat, accessToken)
                setLocationName(actualLocationName)
                // Update popup with real location name
                popup.setHTML(createPopupContent(
                  driverName || driverId || "Driver",
                  lngLat.lat,
                  lngLat.lng,
                  actualLocationName,
                  { ...driverInfo, photoUrl: resolvedPhotoUrl || undefined }
                ))
              } catch (err) {
                console.error("[DriverTrackingModal] Error fetching location:", err)
              }
            }
          })

          markerRef.current = marker
          console.log("[DriverTrackingModal] ✅ Driver marker created")
        } catch (err) {
          console.error("[DriverTrackingModal] Error creating marker:", err)
        }

        mapRef.current = map
        setMapInitialized(true)
        setMapError(null)
      })

      map.on("error", (e) => {
        console.error("[DriverTrackingModal] Mapbox error:", e)
        setMapError("Map failed to load.")
      })

    } catch (err) {
      console.error("[DriverTrackingModal] ❌ Error initializing Mapbox:", err)
      setMapError("Failed to initialize map.")
    }
  }, [accessToken, driverName, driverId, resolvedPhotoUrl, locationName, createPopupContent, driverInfo])

  // Initialize when modal opens
  useEffect(() => {
    if (!open || !isReady || !accessToken || mapRef.current) return

    const timeout = setTimeout(() => initializeMap(), 300)
    return () => clearTimeout(timeout)
  }, [open, isReady, accessToken, initializeMap])

  // Resize map when visible
  useEffect(() => {
    if (!open || !mapRef.current) return
    const resizeTimeout = setTimeout(() => mapRef.current?.resize(), 100)
    return () => clearTimeout(resizeTimeout)
  }, [open])

  // Firebase listener for real-time location
  useEffect(() => {
    if (!open || !mapInitialized || !mapRef.current) return

    console.log("[DriverTrackingModal] Setting up Firebase listener")

    const db = getFirebaseRealtimeDb()
    const gpsRef = ref(db, "gps/latest")

    const unsubscribe = onValue(gpsRef, async (snapshot) => {
      const data = snapshot.val()
      if (!data) return

      let lat: number | null = null
      let lng: number | null = null

      if (typeof data.lat === "number" && typeof data.lng === "number") {
        lat = data.lat
        lng = data.lng
      } else if (typeof data.latitude === "number" && typeof data.longitude === "number") {
        lat = data.latitude
        lng = data.longitude
      }

      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        console.log("[DriverTrackingModal] 📍 GPS Update from Firebase:", { lat, lng })
        console.log("[DriverTrackingModal] Raw Firebase data:", data)

        setCurrentLocation({ lat, lng })

        const lngLat: [number, number] = [lng, lat]

        // Update marker position
        if (markerRef.current) {
          console.log("[DriverTrackingModal] 🚚 Updating marker to:", lngLat)
          markerRef.current.setLngLat(lngLat)
        }

        // Update popup if it's open
        if (popupRef.current?.isOpen() && accessToken) {
          const locName = await getLocationName(lng, lat, accessToken)
          setLocationName(locName)
          popupRef.current.setHTML(createPopupContent(
            driverName || driverId || "Driver",
            lat,
            lng,
            locName,
            { ...driverInfo, photoUrl: resolvedPhotoUrl || undefined }
          ))
        }

        // Get location name for future popup openings
        if (accessToken) {
          const locName = await getLocationName(lng, lat, accessToken)
          setLocationName(locName)
        }

        // Pan map to new location immediately
        if (mapRef.current) {
          console.log("[DriverTrackingModal] 🗺️ Centering map to:", lngLat)
          mapRef.current.flyTo({
            center: lngLat,
            duration: 1000,
            essential: true,
            zoom: 16
          })
        }
      } else {
        console.warn("[DriverTrackingModal] ⚠️ Invalid coordinates received:", { lat, lng, rawData: data })
      }
    }, (error) => {
      console.error("[DriverTrackingModal] Firebase error:", error)
    })

    return () => unsubscribe()
  }, [open, mapInitialized, accessToken, driverName, driverId, createPopupContent])

  // Cleanup when modal closes
  useEffect(() => {
    if (!open && mapRef.current) {
      console.log("[DriverTrackingModal] Cleaning up Mapbox")
      popupRef.current?.remove()
      markerRef.current?.remove()
      mapRef.current.remove()
      mapRef.current = null
      markerRef.current = null
      popupRef.current = null
      setMapInitialized(false)
      setCurrentLocation(null)
      setLocationName("Loading...")
      setMapError(null)
      setResolvedPhotoUrl(null)
    }
  }, [open])

  const error = mapboxError || mapError

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[800px] w-[95vw] max-h-[85vh] overflow-hidden"
        style={{
          width: '800px',
          maxWidth: '95vw',
          height: 'auto',
          maxHeight: '85vh'
        }}
      >
        <DialogHeader>
          <DialogTitle>Driver Tracking</DialogTitle>
          <DialogDescription>
            {driverName ? `Real-time tracking for ${driverName}` : driverId ? `Real-time tracking for ${driverId}` : "Live vehicle tracking"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-hidden">
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-destructive text-sm font-medium">{error}</p>
            </div>
          )}

          <div
            className="relative w-full rounded-lg border overflow-hidden bg-muted"
            style={{
              height: '400px',
              minHeight: '400px',
              maxHeight: '400px',
              width: '100%'
            }}
          >
            <div
              ref={mapContainerRef}
              className="absolute inset-0 w-full h-full"
              style={{
                height: '400px',
                minHeight: '400px',
                width: '100%'
              }}
            />

            {(isLoading || (!mapInitialized && !error)) && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">Loading Mapbox...</p>
                </div>
              </div>
            )}
          </div>

          {/* Removed the coordinates section as requested */}
        </div>

        {/* Custom popup styles - fixed size and responsive */}
        <style jsx global>{`
          .driver-popup {
            z-index: 100 !important;
          }
          .driver-popup .mapboxgl-popup-content {
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 0;
            overflow: visible;
            animation: popupFadeIn 0.2s ease-out;
          }
          .driver-popup .mapboxgl-popup-tip {
            border-top-color: white;
            border-width: 10px;
          }
          .driver-popup .mapboxgl-popup-close-button {
            font-size: 18px;
            padding: 4px 8px;
            color: #64748b;
            z-index: 10;
            right: 2px;
            top: 2px;
          }
          .driver-popup .mapboxgl-popup-close-button:hover {
            color: #1e293b;
            background: rgba(0,0,0,0.05);
            border-radius: 50%;
          }
          .driver-popup-inner::-webkit-scrollbar {
            width: 4px;
          }
          .driver-popup-inner::-webkit-scrollbar-track {
            background: #f1f5f9;
            border-radius: 2px;
          }
          .driver-popup-inner::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 2px;
          }
          /* Prevent map resize on zoom */
          .mapboxgl-canvas {
            outline: none;
          }
          .mapboxgl-map {
            width: 100% !important;
            height: 100% !important;
          }
          @keyframes popupFadeIn {
            from {
              opacity: 0;
              transform: translateY(8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          /* Responsive modal styles */
          @media (max-width: 640px) {
            .driver-popup .mapboxgl-popup-content {
              max-width: 260px !important;
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  )
}
