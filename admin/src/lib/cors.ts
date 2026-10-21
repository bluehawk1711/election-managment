/**
 * CORS for Campaign HQ's account API.
 *
 * The mobile app runs on a different origin from the admin panel (Expo web on
 * `localhost:8081`, or the native app with no origin at all), so the claims
 * route has to answer a browser preflight before the POST can happen.
 *
 * `*` is deliberate: authentication is a Bearer Firebase ID token, not a
 * cookie, and the route verifies that token and the caller's role server-side.
 * A hostile origin cannot do anything with an endpoint it has no valid manager
 * token for. A cookie-authenticated route would need an origin allow-list
 * instead.
 */
export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-request-id',
  'access-control-max-age': '86400',
} as const;

/** The preflight answer, with no body. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
