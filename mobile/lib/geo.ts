/**
 * Geo helpers for the "nearest voter" flow (plan-voters.md §6.1).
 *
 * Pure and synchronous: nothing here touches a device sensor. The caller
 * supplies the origin from `expo-location` and the voter's fix comes from the
 * overlay (`VoterLocation`), so these stay unit-testable without mocking any
 * native module.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle (haversine) distance in metres.
 *
 * Over ward-scale distances — hundreds of metres, a few kilometres — the
 * error against an ellipsoidal model is a few metres, far below the accuracy
 * of a phone fix, so the sphere is the right trade: one `sqrt`/`atan2` chain
 * per row over a few thousand rows stays comfortably inside a frame.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `850 m` below a kilometre, `1.2 km` above — the units a person actually
 * reads on a walk. Latin units in both locales: the Hindi roll reads `km`
 * in everyday use, and swapping scripts mid-list would be worse than either.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}
