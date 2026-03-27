# Firebase Path Sanitization

## Overview

Firebase Realtime Database paths have restrictions on certain characters. This document explains how driver IDs (typically email addresses) are sanitized before being used in Firebase paths.

## Restricted Characters

Firebase Realtime Database paths **cannot contain** the following characters:
- `.` (period)
- `#` (hash)
- `$` (dollar sign)
- `[` (left bracket)
- `]` (right bracket)
- `@` (at sign)

## Solution

### Utility Functions

Created `lib/firebase-utils.ts` with two utility functions:

1. **`sanitizeFirebasePath(pathSegment: string)`**
   - General-purpose function to sanitize any path segment
   - Replaces all restricted characters with hyphens (`-`)

2. **`sanitizeDriverId(driverId: string | null | undefined)`**
   - Convenience function specifically for driver IDs (emails)
   - Handles null/undefined values safely

### Implementation

**Before:**
```typescript
const driverRef = ref(db, `drivers/${driverId}`)
// ❌ Fails if driverId = "deliveryy@decktago.com"
```

**After:**
```typescript
const sanitizedDriverId = sanitizeDriverId(driverId)
const driverRef = ref(db, `drivers/${sanitizedDriverId}`)
// ✅ Works: "deliveryy@decktago.com" → "deliveryy-decktago-com"
```

## Examples

| Original driverId | Sanitized Path |
|-------------------|----------------|
| `deliveryy@decktago.com` | `deliveryy-decktago-com` |
| `user.name@example.com` | `user-name-example-com` |
| `driver#123@test.com` | `driver-123-test-com` |
| `user[admin]@domain.com` | `user-admin-domain-com` |

## Where It's Used

The sanitization is applied in:
- **`components/deliveries/driver-tracking-modal.tsx`** (Line 134)
  - Firebase Realtime Database path: `drivers/${sanitizedDriverId}`

## Important Notes

1. **Consistency**: The same sanitization must be used when:
   - Writing driver location data to Firebase
   - Reading driver location data from Firebase
   - Any other operations using driverId in paths

2. **Display**: The original `driverId` is still displayed to users in the UI - only the Firebase path is sanitized.

3. **Reversibility**: The sanitization is **one-way**. To reverse it, you'd need to store a mapping or use a different approach (like using the sanitized version as the primary key).

## Testing

To verify the sanitization works:

1. Open browser console (F12)
2. Open Driver Tracking modal with an email driverId
3. Check console logs for:
   ```
   [DriverTrackingModal] Setting up Firebase listener for driver: deliveryy@decktago.com
   [DriverTrackingModal] Sanitized driverId for Firebase path: deliveryy-decktago-com
   ```

## Future Considerations

If you need to write driver location data from other parts of the application, ensure you use the same `sanitizeDriverId()` function:

```typescript
import { sanitizeDriverId } from "@/lib/firebase-utils"

const sanitizedId = sanitizeDriverId(driverEmail)
const driverRef = ref(db, `drivers/${sanitizedId}`)
// Now safe to write/read data
```
