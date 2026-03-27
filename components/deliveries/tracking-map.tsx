"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MapPin, Navigation, Clock, Zap, Moon, Sun } from "lucide-react"
import type { Delivery } from "@/lib/types"
import { SinotackTrackingService } from "@/lib/sinotrack-service"
import { formatTimestamp } from "@/lib/utils"
import { useMapbox, MAPBOX_STYLES, type MapboxStyleKey } from "@/hooks/use-mapbox"
import { createMapboxTruckIcon, createMapboxPulseRing } from "@/lib/map-icons"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

interface TrackingMapProps {
  delivery: Delivery
}

interface LocationData {
  latitude: number
  longitude: number
  speed?: number
  timestamp: Date
}

export function TrackingMap({ delivery }: TrackingMapProps) {
  const [location, setLocation] = useState<LocationData | undefined>(delivery.lastKnownLocation as LocationData | undefined)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [currentStyle, setCurrentStyle] = useState<MapboxStyleKey>("streets")
  const [mapInitialized, setMapInitialized] = useState(false)
  const [pathHistory, setPathHistory] = useState<[number, number][]>([])
  const pathHistoryRef = useRef<[number, number][]>([])

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const pulseMarkerRef = useRef<mapboxgl.Marker | null>(null)

  // Use the Mapbox hook
  const { isReady, isLoading, error: mapError, accessToken } = useMapbox()

  // Toggle map style
  const toggleMapStyle = useCallback(() => {
    if (!mapRef.current) return

    const newIsDark = !isDarkMode
    setIsDarkMode(newIsDark)
    const newStyle = newIsDark ? "dark" : "streets"
    setCurrentStyle(newStyle)
    mapRef.current.setStyle(MAPBOX_STYLES[newStyle])
  }, [isDarkMode])

  // Subscribe to real-time location updates
  useEffect(() => {
    if (!delivery.sinotackDeviceId) return

    const subscribe = async () => {
      const unsubscribe = await SinotackTrackingService.subscribeToDeviceUpdates(
        delivery.sinotackDeviceId!,
        (newLocation) => {
          setLocation(newLocation)
        },
      )
      return unsubscribe
    }

    let unsubscribe: (() => void) | null = null
    subscribe().then((unsub) => {
      unsubscribe = unsub
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [delivery.sinotackDeviceId])

  // Initialize Mapbox map
  useEffect(() => {
    if (!isReady || !accessToken || mapInitialized || !location) return

    const initTimeout = setTimeout(() => {
      if (!mapContainerRef.current) return

      try {
        const center: [number, number] = [location.longitude, location.latitude]

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: MAPBOX_STYLES[currentStyle],
          center: center,
          zoom: 15,
          antialias: true,
        })

        // Add controls
        map.addControl(new mapboxgl.NavigationControl(), "top-right")
        map.addControl(new mapboxgl.FullscreenControl(), "top-right")

        map.on("load", () => {
          // Add source and layer for the path history (route line)
          map.addSource("route", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: pathHistoryRef.current,
              },
            },
          })

          map.addLayer({
            id: "route",
            type: "line",
            source: "route",
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#0ea5e9", // primary color (sky-500)
              "line-width": 4,
              "line-opacity": 0.5,
            },
          })

          // Create pulse ring marker
          try {
            const pulseEl = createMapboxPulseRing()
            pulseMarkerRef.current = new mapboxgl.Marker({
              element: pulseEl,
              anchor: "center",
            })
              .setLngLat(center)
              .addTo(map)

            // Create truck marker
            const truckEl = createMapboxTruckIcon()
            markerRef.current = new mapboxgl.Marker({
              element: truckEl,
              anchor: "bottom",
            })
              .setLngLat(center)
              .addTo(map)
          } catch (err) {
            console.error("[TrackingMap] Error creating markers:", err)
          }
        })

        mapRef.current = map
        setMapInitialized(true)
      } catch (err) {
        console.error("[TrackingMap] Error initializing map:", err)
      }
    }, 100)

    return () => clearTimeout(initTimeout)
  }, [isReady, accessToken, mapInitialized, currentStyle, location])

  // Update marker position when location changes
  useEffect(() => {
    if (!mapRef.current || !location) return

    const lngLat: [number, number] = [location.longitude, location.latitude]

    // Update path history
    const newPoint: [number, number] = [location.longitude, location.latitude]
    const lastPoint = pathHistoryRef.current[pathHistoryRef.current.length - 1]

    if (!lastPoint || (lastPoint[0] !== newPoint[0] || lastPoint[1] !== newPoint[1])) {
      const updatedHistory = [...pathHistoryRef.current, newPoint]
      pathHistoryRef.current = updatedHistory
      setPathHistory(updatedHistory)

      // Update map line source
      if (mapRef.current && mapRef.current.getSource("route")) {
        (mapRef.current.getSource("route") as mapboxgl.GeoJSONSource).setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: updatedHistory,
          },
        })
      }
    }

    if (markerRef.current) {
      markerRef.current.setLngLat(lngLat)
    }

    if (pulseMarkerRef.current) {
      pulseMarkerRef.current.setLngLat(lngLat)
    }

    mapRef.current.flyTo({
      center: lngLat,
      duration: 1000,
      essential: true,
    })
  }, [location])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      markerRef.current?.remove()
      pulseMarkerRef.current?.remove()
      mapRef.current?.remove()
    }
  }, [])

  if (!delivery.sinotackDeviceId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live Tracking</CardTitle>
          <CardDescription>No Sinotrack device assigned to this delivery</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Assign a Sinotrack device ID to enable real-time tracking</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Live Tracking
            </span>
            <div className="flex items-center gap-2">
              {location && (
                <Badge variant="default" className="bg-green-500">
                  Active
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleMapStyle}
                className="flex items-center gap-1"
              >
                {isDarkMode ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error state */}
          {mapError && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-destructive text-sm">{mapError}</p>
            </div>
          )}

          {/* Map container */}
          <div className="w-full h-96 rounded-lg overflow-hidden border relative">
            <div
              ref={mapContainerRef}
              className="w-full h-full"
              style={{ minHeight: "384px" }}
            />

            {/* Loading overlay */}
            {(isLoading || (!mapInitialized && isReady)) && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-muted-foreground text-sm">Loading map...</p>
                </div>
              </div>
            )}
          </div>

          {location && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Navigation className="h-4 w-4" />
                  <span>Coordinates</span>
                </div>
                <div className="font-mono text-sm">
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </div>
              </div>

              {location.speed !== undefined && (
                <div className="space-y-2 p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Zap className="h-4 w-4" />
                    <span>Speed</span>
                  </div>
                  <div className="font-mono text-sm">{location.speed} km/h</div>
                </div>
              )}

              <div className="space-y-2 p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Last Update</span>
                </div>
                <div className="font-mono text-sm">{formatTimestamp(location.timestamp)}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
