# Google Maps API Key Setup Guide

## Quick Setup

1. **Create a `.env` file** in the project root (same directory as `package.json`)
2. **Add your Google Maps API key**:
   ```env
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_actual_api_key_here
   ```
   Or for Create React App:
   ```env
   REACT_APP_GOOGLE_MAPS_API_KEY=your_actual_api_key_here
   ```
   Or for Vite:
   ```env
   VITE_GOOGLE_MAPS_API_KEY=your_actual_api_key_here
   ```

3. **Restart your dev server** (required after editing `.env`):
   ```bash
   # Stop the current server (Ctrl+C)
   # Then restart:
   npm run dev    # Next.js
   # or
   npm start      # Create React App
   # or
   npm run dev    # Vite
   ```

## Where the API Key is Used

The API key is read **only** from environment variables in these locations:

1. **`hooks/use-google-maps.ts`** - Line 78: `getGoogleMapsApiKey()`
   - Detects build system (Next.js/Vite/CRA)
   - Reads from appropriate env var
   - **No hardcoded values**

2. **Google Maps Script URL** - Line 109:
   ```typescript
   script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
   ```

## Getting Your API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials)
2. Create a new API key or use an existing one
3. Enable "Maps JavaScript API" for your project
4. Copy the API key to your `.env` file

## Environment Variable Detection

The code automatically detects your build system:

- **Next.js**: Uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- **Vite**: Uses `VITE_GOOGLE_MAPS_API_KEY`
- **Create React App**: Uses `REACT_APP_GOOGLE_MAPS_API_KEY`

If the key is missing, you'll see a clear error message indicating which variable name to use.

## Important Notes

- ✅ **Never commit your `.env` file** to version control
- ✅ **Restart the dev server** after editing `.env`
- ✅ The API key is read at build/runtime, not hardcoded
- ✅ Script loads only once, preventing duplicates

## Troubleshooting

**Error: "Google Maps API key is not configured"**
- Check that `.env` file exists in project root
- Verify the variable name matches your build system
- Restart the dev server after adding the key

**Error: "Failed to load Google Maps"**
- Verify your API key is valid
- Check that "Maps JavaScript API" is enabled in Google Cloud Console
- Ensure API key restrictions allow your domain/localhost
