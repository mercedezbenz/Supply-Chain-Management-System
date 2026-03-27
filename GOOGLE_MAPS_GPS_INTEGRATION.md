# Google Maps GPS Integration Guide

## Overview

The Driver Tracking modal now integrates Google Maps with Firebase Realtime Database to display real-time GPS location updates. The GPS coordinates are read from `gps/latest` path in Firebase Realtime Database.

## Features Implemented

### ✅ Firebase Realtime Database Integration
- **Path**: `gps/latest`
- **Real-time listener**: Automatically updates when GPS coordinates change
- **Data format support**: Handles both `lat/lng` and `latitude/longitude` formats
- **String/number parsing**: Automatically converts string coordinates to numbers

### ✅ Custom Truck Icon
- **SVG truck icon**: Custom blue truck with wheels and cargo area
- **Size**: 48x48 pixels
- **Anchor point**: Bottom center (where wheels touch ground)
- **Fallback**: Uses blue circle if truck icon fails to load

### ✅ Real-time Updates
- **Smooth marker movement**: Marker updates position without animation for smooth tracking
- **Smart map panning**: Only pans map if driver moved more than 50 meters
- **Optimized updates**: Marker optimization disabled for smoother real-time updates

### ✅ Responsive Design
- **Fixed height**: 450px (minimum 400px on smaller screens)
- **Full width**: Responsive to container width
- **Mobile-friendly**: Gesture handling enabled for touch devices
- **Zoom controls**: User can zoom in/out as needed

## Firebase Data Structure

The component expects GPS data at `gps/latest` in one of these formats:

**Format 1 (lat/lng):**
```json
{
  "lat": 14.5995,
  "lng": 120.9842
}
```

**Format 2 (latitude/longitude):**
```json
{
  "latitude": 14.5995,
  "longitude": 120.9842
}
```

**Format 3 (strings - auto-parsed):**
```json
{
  "lat": "14.5995",
  "lng": "120.9842"
}
```

## Map Configuration

- **Default zoom**: 15 (good for tracking)
- **Default center**: Manila, Philippines (14.5995, 120.9842)
- **Map controls**: Type control, zoom control, fullscreen
- **Street view**: Disabled
- **Gesture handling**: Greedy (one-finger pan/zoom on mobile)
- **POI clicks**: Disabled for better UX

## Components Updated

### 1. `components/deliveries/driver-tracking-modal.tsx`
- Changed Firebase path from `drivers/{driverId}` to `gps/latest`
- Added truck icon support
- Improved marker update logic with smooth panning
- Enhanced coordinate parsing to handle multiple formats

### 2. `lib/map-icons.ts` (NEW)
- `createTruckIcon()`: Creates custom SVG truck icon
- `createTruckIconEmoji()`: Fallback emoji truck icon

### 3. `hooks/use-google-maps.ts`
- Added geometry library to script URL for distance calculations

## Usage

The component automatically:
1. Loads Google Maps when modal opens
2. Connects to Firebase Realtime Database at `gps/latest`
3. Displays truck icon marker at GPS location
4. Updates marker position in real-time as coordinates change
5. Smoothly pans map when driver moves significantly

## Testing

1. **Set up Firebase Realtime Database**:
   - Create `gps/latest` node
   - Add `lat` and `lng` (or `latitude` and `longitude`) fields

2. **Test real-time updates**:
   - Update coordinates in Firebase Console
   - Watch marker move on map in real-time

3. **Check console logs**:
   ```
   [DriverTrackingModal] Setting up Firebase listener for GPS location at path: gps/latest
   [DriverTrackingModal] ✅ Received GPS location update: {lat: 14.5995, lng: 120.9842}
   [DriverTrackingModal] 🚚 Truck marker updated to: {lat: 14.5995, lng: 120.9842}
   ```

## Troubleshooting

### Marker not appearing
- Check Firebase Realtime Database has data at `gps/latest`
- Verify coordinates are valid numbers (between -90/90 for lat, -180/180 for lng)
- Check browser console for errors

### Map not loading
- Verify `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set in `.env.local`
- Restart dev server after adding API key
- Check Google Cloud Console that Maps JavaScript API is enabled

### Marker not updating
- Check Firebase listener is connected (see console logs)
- Verify data format matches expected structure
- Check network tab for Firebase connection errors

## Future Enhancements

- Add route/path history visualization
- Add speed indicator
- Add ETA calculations
- Add multiple truck markers for fleet tracking
- Add geofencing alerts
