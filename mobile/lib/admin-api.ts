/**
 * Campaign HQ's account API — the one server-side step account creation needs.
 *
 * Firebase custom claims (`role`, `wardNo`, `locked`, …) can only be written
 * with the Admin SDK. The mobile app deliberately has no service-account
 * credentials, so it cannot set them itself: a client-side "set the claim"
 * would either ship a private key in the bundle or be a privilege escalation.
 *
 * The admin panel already owns the safe half of that problem:
 * `POST /api/account/claims` verifies the CALLER's Firebase ID token, requires
 * super admin / developer, reads `users/{uid}` server-side, and writes the
 * claims from that profile. Mobile calls it after creating the profile, so a
 * brand-new login carries its role on the very first sign-in.
 *
 * ## Why the URL is build-time configuration
 *
 * The admin panel is a separate deployment (Campaign HQ), often on a different
 * host from the mobile app. `EXPO_PUBLIC_ADMIN_API_URL` must be its ORIGIN,
 * with no trailing slash and no `/api` suffix; `adminApiBase` accepts the
 * common variants anyway so a copied deployment URL still works.
 *
 * When the variable is unset, `adminApiBase` returns `null` and account
 * creation refuses to start instead of leaving behind an Auth user the rules
 * will treat as roleless. That is the difference between "the form failed" and
 * "the form created an account that cannot read anything".
 */

/** The fields the claims route mirrors from `users/{uid}`. */
export interface AccountClaims {
  role?: string;
  wardNo?: number;
  teamId?: string;
  locked?: boolean;
  multiDevice?: boolean;
}

/** How long the app waits for Campaign HQ before calling it unreachable. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The admin panel origin, or `null` when this build has none configured.
 *
 * Accepts a trailing slash or an accidental `/api` suffix: both are easy to
 * paste from a deployment dashboard, and neither should turn into
 * `/api/api/account/claims`. `raw` is injectable so the normalization is
 * testable without touching `process.env`.
 */
export function adminApiBase(
  raw: string | undefined = process.env.EXPO_PUBLIC_ADMIN_API_URL
): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  const withoutApi = trimmed.endsWith('/api')
    ? trimmed.slice(0, -'/api'.length)
    : trimmed;

  return withoutApi.replace(/\/+$/, '') || null;
}

/** `POST /api/account/claims` on the configured origin. */
export function claimsEndpoint(base: string): string {
  return `${base}/api/account/claims`;
}

export interface PublishClaimsInput {
  /** `adminApiBase()` — the Campaign HQ origin. */
  base: string;
  /** The signed-in manager's fresh Firebase ID token. */
  token: string;
  /** The account whose claims should be published. */
  uid: string;
  /** Log label only (`mobile-create`); the server never trusts it for authz. */
  operation?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; production uses 15s. */
  timeoutMs?: number;
}

/**
 * Publishes one account's claims and returns what the server wrote.
 *
 * Throws on every failure path — a missing configuration, a network failure, a
 * timeout, a non-2xx response, or a server saying `ok: false`. The caller
 * treats that as "account creation failed" and rolls the Auth record back.
 *
 * The server's `requestId` is appended to the error when present: it is the
 * same id in the Vercel log line, which is what makes a field report
 * actionable.
 */
export async function publishAccountClaims({
  base,
  token,
  uid,
  operation = 'mobile-create',
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: PublishClaimsInput): Promise<AccountClaims> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetchImpl(claimsEndpoint(base), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ uid, operation }),
        signal: controller.signal,
      });
    } catch (caught) {
      if (controller.signal.aborted) {
        throw new Error(
          'Campaign HQ took too long to activate the account. Nothing was kept — try again.'
        );
      }
      throw new Error(
        'Could not reach Campaign HQ to activate the account. Nothing was kept — check the connection and try again.'
      );
    }

    const raw = await response.text().catch(() => '');
    let payload: {
      ok?: boolean;
      error?: string;
      requestId?: string;
      claims?: AccountClaims;
    } = {};

    if (raw) {
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        // A proxy's HTML error page or an empty body. The status is still
        // meaningful, so keep going and report it below.
      }
    }

    if (!response.ok || payload.ok !== true) {
      const reference = payload.requestId
        ? ` (ref: ${payload.requestId})`
        : '';
      throw new Error(
        `${payload.error ?? `Campaign HQ refused the activation (HTTP ${response.status}).`}${reference}`
      );
    }

    return payload.claims ?? {};
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this build can activate a newly created account. */
export function isAccountActivationConfigured(): boolean {
  return adminApiBase() !== null;
}
