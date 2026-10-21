/**
 * POST /api/account/claims — mirror one account's PROFILE into its Firebase
 * Auth custom claims.
 *
 * ## Why the claims have to be written by the server at all
 *
 * `database.rules` cannot read `/users/{uid}` from a rule at `/tasks`: RTDB
 * has no cross-node reads, so the ONLY unforgeable statement of "who is this
 * caller" is the custom claim on their token — and only the Admin SDK can
 * write a claim. A panel that changed `users/{uid}.role` and stopped there
 * would leave the rules evaluating the OLD role until the token happened to
 * refresh, which is a privilege change that silently does nothing for up to
 * an hour.
 *
 * ## Why this route reads the profile instead of accepting one
 *
 * Claims are replaced wholesale by `setCustomUserClaims`, so an endpoint that
 * took `{ role, wardNo }` from the request body would let the caller forge
 * the OTHER claims (notably `locked`, which is the gate every other rule in
 * `database.rules` reads). Reading `users/{uid}` server-side makes the
 * PROFILE the single source of truth: every caller path — role grants, the
 * lock, the unlock, the team move — writes the profile first through the
 * ordinary client SDK (which the rules authorise), then calls this route to
 * publish the same facts onto the token. There is no second place where a
 * claim can disagree with a document.
 *
 * ## Who may call it
 *
 * The route is reachable in production, so it authenticates the caller: the
 * browser sends the signed-in manager's Firebase ID token, and only a
 * superAdmin or developer whose own token is not locked may publish claims.
 * Without that check this would be an unauthenticated write endpoint that
 * could be used to force a token refresh for any uid.
 *
 * ## Why the Admin SDK is imported inside the handler
 *
 * Every API route in this app is a Node serverless function, and
 * `firebase-admin` is the one dependency that can fail at MODULE LOAD time on
 * an older runtime (its auth stack has used Node-version-specific ESM
 * interop). When that happened, Vercel returned an empty 500 before any of a
 * route's code — including its error handling — could run. A dynamic import
 * moves that failure inside this function, so we can log the real reason,
 * return a JSON error with a request id, and still authenticate normally on a
 * runtime where the SDK is healthy.
 *
 * The credentials never reach a browser bundle (same posture as
 * /api/account/password and /api/roll/seed): the Admin SDK is initialized
 * server-side only from `FIREBASE_ADMIN_*` env vars in `admin/.env.local`
 * (lib/admin-firebase.ts). The deployment host must set the same three
 * credential variables; the database URL may come from the public variable
 * because it is not a secret.
 */
// No `export const runtime = 'nodejs'`: `cacheComponents` rejects route
// segment runtime config, and Node is the default runtime anyway.

import type { DecodedIdToken } from 'firebase-admin/auth';
import { CORS_HEADERS, corsPreflight } from '@/lib/cors';

const ROUTE = 'api/account/claims';
const ROLES = new Set(['karykarta', 'admin', 'superAdmin', 'developer']);

interface ClaimsRequest {
  uid?: unknown;
  /** Diagnostic label only (`create-account`, `lock`, `unlock`, ...). */
  operation?: unknown;
}

type LogFields = Record<string, unknown>;

/**
 * A request id shared by the browser console, the response, and the Vercel
 * log line. The caller may supply one (the browser does); otherwise the
 * server creates one. Values are deliberately restricted to a log-safe
 * alphabet so a caller cannot inject newlines into structured logs.
 */
function requestIdFor(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,80}$/.test(supplied)) return supplied;
  return (
    globalThis.crypto?.randomUUID?.() ??
    `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function log(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: LogFields
): void {
  // One line per event: Vercel's log viewer (and every log drain) can search
  // a prefix or a request id without needing to expand an object.
  const line = `[${ROUTE}] ${event} ${JSON.stringify({
    ...fields,
    node: process.version,
  })}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function codeOf(caught: unknown): string {
  return typeof caught === 'object' && caught !== null && 'code' in caught
    ? String((caught as { code: unknown }).code)
    : 'unknown';
}

function errorFields(caught: unknown): LogFields {
  if (caught instanceof Error) {
    return {
      errorName: caught.name,
      errorMessage: caught.message,
      ...(codeOf(caught) !== 'unknown' ? { errorCode: codeOf(caught) } : {}),
      // Six frames are enough to identify the failing module without
      // dumping an entire dependency stack into every log line.
      stack: caught.stack?.split('\n').slice(0, 7).join(' <- '),
    };
  }
  return { errorMessage: String(caught) };
}

function reply(
  requestId: string,
  status: number,
  body: Record<string, unknown>
): Response {
  return Response.json(
    { ...body, requestId },
    {
      status,
      headers: {
        ...CORS_HEADERS,
        'cache-control': 'no-store',
        'x-request-id': requestId,
      },
    }
  );
}

/** The caller's ID token, or null when the Authorization header is absent. */
function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  return match?.[1]?.trim() || null;
}

/**
 * Browser preflight for the mobile app's cross-origin POST. Expo web cannot
 * send the Authorization header until this succeeds; native fetch does not
 * preflight, but answers the same request either way.
 */
export function OPTIONS(): Response {
  return corsPreflight();
}

/**
 * The custom-claim object for a profile.
 *
 * Absent/false values are OMITTED, not written as null/false. That matches
 * `mobile/scripts/grant-claims.mjs` and keeps the token small; every rule
 * checks positive values (`locked == true`, `multiDevice == true`), so an
 * absent key is the same decision as false. `setCustomUserClaims` replaces
 * the whole claim object, so an omitted key still removes the old privilege.
 */
function claimsFor(profile: Record<string, unknown> | null): Record<
  string,
  string | number | boolean
> {
  const claims: Record<string, string | number | boolean> = {};
  if (!profile) return claims;

  const role =
    typeof profile.role === 'string' && ROLES.has(profile.role)
      ? profile.role
      : null;
  if (role) claims.role = role;

  // A ward is meaningful only for a karykarta. The profile rule already
  // enforces that, but deriving the claim defensively keeps a malformed or
  // legacy profile from granting ward scope to an admin.
  if (
    role === 'karykarta' &&
    typeof profile.wardNo === 'number' &&
    Number.isFinite(profile.wardNo) &&
    profile.wardNo > 0
  ) {
    claims.wardNo = profile.wardNo;
  }

  if (typeof profile.teamId === 'string' && profile.teamId.trim() !== '') {
    claims.teamId = profile.teamId.trim();
  }
  if (profile.locked === true) claims.locked = true;
  if (profile.multiDevice === true) claims.multiDevice = true;

  return claims;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFor(request);
  const started = Date.now();
  const vercelId = request.headers.get('x-vercel-id') ?? null;

  log('info', 'request', {
    requestId,
    vercelId,
    hasToken: Boolean(bearerToken(request)),
  });

  // Load the SDK before doing anything else: if it cannot load, the empty
  // 500 that Vercel used to return is replaced by a useful logged error and
  // a JSON body with a request id. This is the single most useful diagnostic
  // when the deployment runtime and the SDK disagree.
  let adminSdk: typeof import('@/lib/admin-firebase');
  try {
    adminSdk = await import('@/lib/admin-firebase');
    log('info', 'admin-loaded', { requestId });
  } catch (caught) {
    log('error', 'admin-import-failed', {
      requestId,
      vercelId,
      ...errorFields(caught),
    });
    return reply(requestId, 500, {
      ok: false,
      error: 'The server could not load the Firebase Admin SDK.',
      stage: 'admin-import',
    });
  }

  const token = bearerToken(request);
  if (!token) {
    log('warn', 'missing-token', { requestId, vercelId });
    return reply(requestId, 401, {
      ok: false,
      error: 'Sign in again — the claim request carried no ID token.',
      stage: 'auth-header',
    });
  }

  let auth: ReturnType<typeof adminSdk.adminAuth>;
  try {
    auth = adminSdk.adminAuth();
  } catch (caught) {
    log('error', 'admin-init-failed', {
      requestId,
      vercelId,
      ...errorFields(caught),
    });
    return reply(requestId, 500, {
      ok: false,
      error: 'Claim publishing is not configured correctly on this server.',
      stage: 'admin-init',
    });
  }

  let caller: DecodedIdToken;
  try {
    // `true` asks the Admin SDK to check revocation as well as the signature.
    caller = await auth.verifyIdToken(token, true);
  } catch (caught) {
    const code = codeOf(caught);
    const message = caught instanceof Error ? caught.message : String(caught);
    const isConfigError =
      /PEM|private key|credential|ERR_REQUIRE_ESM|MODULE_NOT_FOUND/i.test(
        `${code} ${message}`
      );
    const isTransient =
      /network|timeout|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(
        `${code} ${message}`
      );

    log(isConfigError || isTransient ? 'error' : 'warn', 'token-verify-failed', {
      requestId,
      vercelId,
      ...errorFields(caught),
    });

    if (isConfigError) {
      return reply(requestId, 500, {
        ok: false,
        error: 'The server could not verify sign-ins because its Firebase credentials are invalid.',
        stage: 'admin-credentials',
      });
    }
    if (isTransient) {
      return reply(requestId, 503, {
        ok: false,
        error: 'The server could not reach Firebase Auth — try again in a moment.',
        stage: 'auth-network',
      });
    }
    return reply(requestId, 401, {
      ok: false,
      error: 'Sign in again — the claim request’s token was rejected.',
      stage: 'token',
    });
  }

  log('info', 'caller-verified', {
    requestId,
    callerUid: caller.uid,
    callerRole: caller.role ?? null,
  });

  if (
    caller.locked === true ||
    (caller.role !== 'superAdmin' && caller.role !== 'developer')
  ) {
    log('warn', 'caller-forbidden', {
      requestId,
      callerUid: caller.uid,
      callerRole: caller.role ?? null,
      callerLocked: caller.locked === true,
    });
    return reply(requestId, 403, {
      ok: false,
      error: 'Only a super admin or developer can publish claims.',
      stage: 'authorization',
    });
  }

  const body = (await request.json().catch(() => ({}))) as ClaimsRequest;
  const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
  const operation =
    typeof body.operation === 'string' && /^[a-z0-9-]{1,40}$/.test(body.operation)
      ? body.operation
      : 'claims';
  if (!uid) {
    log('warn', 'missing-uid', {
      requestId,
      callerUid: caller.uid,
      operation,
    });
    return reply(requestId, 400, {
      ok: false,
      error: 'Missing uid.',
      stage: 'request-body',
    });
  }

  let database: ReturnType<typeof adminSdk.adminDatabase>;
  try {
    database = adminSdk.adminDatabase();
  } catch (caught) {
    log('error', 'database-init-failed', {
      requestId,
      callerUid: caller.uid,
      targetUid: uid,
      operation,
      ...errorFields(caught),
    });
    return reply(requestId, 500, {
      ok: false,
      error: 'The server could not reach the account database.',
      stage: 'database-init',
    });
  }

  let profile: Record<string, unknown> | null;
  try {
    // The profile IS the source of truth (see the header). A missing profile
    // means the account's authority is gone with it, so the claims are
    // cleared rather than left behind as a ghost privilege.
    const snapshot = await database.ref(`users/${uid}`).once('value');
    profile = (snapshot.val() ?? null) as Record<string, unknown> | null;
  } catch (caught) {
    log('error', 'profile-read-failed', {
      requestId,
      callerUid: caller.uid,
      targetUid: uid,
      operation,
      ...errorFields(caught),
    });
    return reply(requestId, 502, {
      ok: false,
      error: 'The account profile could not be read from the database.',
      stage: 'profile-read',
    });
  }

  const claims = claimsFor(profile);

  try {
    await auth.setCustomUserClaims(uid, claims);
  } catch (caught) {
    const code = codeOf(caught);
    if (code === 'auth/user-not-found') {
      log('warn', 'target-user-missing', {
        requestId,
        callerUid: caller.uid,
        targetUid: uid,
        operation,
        ...errorFields(caught),
      });
      return reply(requestId, 400, {
        ok: false,
        error:
          'That uid has no Firebase Auth record — the profile exists but the login does not.',
        stage: 'claims-write',
      });
    }
    log('error', 'claims-write-failed', {
      requestId,
      callerUid: caller.uid,
      targetUid: uid,
      operation,
      ...errorFields(caught),
    });
    return reply(requestId, 500, {
      ok: false,
      error: 'The claims update failed on the server.',
      stage: 'claims-write',
    });
  }

  // The target's access token still carries the OLD claims until it
  // refreshes (RTDB rules read `auth.token.*`), which is minutes, not
  // instant — noted here rather than papered over with a forced sign-out.
  log('info', 'claims-published', {
    requestId,
    callerUid: caller.uid,
    targetUid: uid,
    operation,
    claims,
    durationMs: Date.now() - started,
  });

  return reply(requestId, 200, { ok: true, claims });
}
