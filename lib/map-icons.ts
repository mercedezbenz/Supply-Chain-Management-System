/**
 * Creates a custom truck icon for Google Maps markers
 * Returns an SVG data URL that can be used as a marker icon
 * 
 * @throws Error if Google Maps API is not loaded
 */
export function createTruckIcon(): any {
  if (!window.google || !window.google.maps) {
    throw new Error("Google Maps API not loaded")
  }

  // SVG truck icon - simple truck shape
  const truckSvg = `
    <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="20" width="28" height="20" rx="2" fill="#2563eb" stroke="#1e40af" stroke-width="2"/>
      <rect x="8" y="12" width="20" height="12" rx="1" fill="#3b82f6" stroke="#2563eb" stroke-width="1"/>
      <circle cx="12" cy="38" r="6" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
      <circle cx="12" cy="38" r="3" fill="#64748b"/>
      <circle cx="28" cy="38" r="6" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
      <circle cx="28" cy="38" r="3" fill="#64748b"/>
      <rect x="32" y="24" width="8" height="8" rx="1" fill="#fbbf24" stroke="#f59e0b" stroke-width="1"/>
      <line x1="36" y1="26" x2="36" y2="30" stroke="#f59e0b" stroke-width="1"/>
      <line x1="34" y1="28" x2="38" y2="28" stroke="#f59e0b" stroke-width="1"/>
    </svg>
  `

  return {
    url: `data:image/svg+xml;base64,${btoa(truckSvg)}`,
    scaledSize: new (window.google.maps as any).Size(48, 48),
    anchor: new (window.google.maps as any).Point(24, 40), // Anchor at bottom center (where wheels touch ground)
    origin: new (window.google.maps as any).Point(0, 0),
  }
}

/**
 * Creates a truck icon using emoji fallback (simpler alternative)
 * This is a fallback if SVG doesn't work
 */
export function createTruckIconEmoji(): any {
  if (!window.google || !window.google.maps) {
    throw new Error("Google Maps API not loaded")
  }

  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <text x="24" y="32" font-size="32" text-anchor="middle" font-family="Arial">🚚</text>
      </svg>
    `),
    scaledSize: new (window.google.maps as any).Size(48, 48),
    anchor: new (window.google.maps as any).Point(24, 32),
  }
}

/**
 * Creates a Mapbox truck icon (DOM element)
 */
export function createMapboxTruckIcon(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'truck-marker'
  el.innerHTML = '🚚'
  el.style.fontSize = '32px'
  el.style.cursor = 'pointer'
  return el
}

/**
 * Creates a Mapbox driver photo marker (DOM element)
 * Shows the driver's profile photo in a circular marker with a border
 * Falls back to driver initials if no photo URL is provided
 */
export function createMapboxDriverPhotoMarker(photoUrl?: string | null, driverName?: string | null): HTMLElement {
  const el = document.createElement('div')
  el.className = 'driver-photo-marker'
  el.style.cursor = 'pointer'
  el.style.width = '50px'
  el.style.height = '50px'
  el.style.borderRadius = '50%'
  el.style.border = '3px solid #ffffff'
  el.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)'
  el.style.position = 'relative'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.overflow = 'hidden'

  // Get initials from driver name
  const getInitials = (name: string | null | undefined): string => {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
  }

  // Create initials fallback element
  const createInitialsFallback = () => {
    el.style.background = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
    el.innerHTML = `<span style="color: white; font-size: 18px; font-weight: 600;">${getInitials(driverName)}</span>`
  }

  if (photoUrl) {
    el.style.backgroundColor = '#e2e8f0'

    const img = document.createElement('img')
    img.src = photoUrl
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'cover'
    img.onerror = () => {
      // If image fails to load, show initials instead
      createInitialsFallback()
    }
    el.appendChild(img)
  } else {
    // No photo - show initials
    createInitialsFallback()
  }

  // Add a small green indicator dot at the bottom right
  const indicator = document.createElement('div')
  indicator.style.position = 'absolute'
  indicator.style.bottom = '0px'
  indicator.style.right = '0px'
  indicator.style.width = '14px'
  indicator.style.height = '14px'
  indicator.style.borderRadius = '50%'
  indicator.style.backgroundColor = '#22c55e'
  indicator.style.border = '2px solid #ffffff'
  el.appendChild(indicator)

  return el
}

/**
 * Creates a Mapbox pulse ring (DOM element)
 */
export function createMapboxPulseRing(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pulse-ring'
  el.style.width = '30px'
  el.style.height = '30px'
  el.style.borderRadius = '50%'
  el.style.background = 'rgba(14, 165, 233, 0.3)'
  el.style.border = '2px solid rgba(14, 165, 233, 0.8)'
  el.style.animation = 'pulse 2s ease-out infinite'

  // Add pulse animation if not exists
  if (!document.getElementById('pulse-animation-style')) {
    const style = document.createElement('style')
    style.id = 'pulse-animation-style'
    style.innerHTML = `
      @keyframes pulse {
        0% { transform: scale(0.5); opacity: 1; }
        100% { transform: scale(2.5); opacity: 0; }
      }
    `
    document.head.appendChild(style)
  }

  return el
}
