/**
 * POST /api/account/password — rotate a user's Firebase Auth password with
 * the Admin SDK, WITHOUT knowing their current one.
 *
 * `firebase/auth` (client SDK) can only change the password of a
 * freshly-signed-in user, which is why every client-side "change someone
 * else's password" flow has to sign in AS them first — and that needs their
 * current password. The Admin SDK has no such constraint: `updateUser(uid,
 * { password })` is a direct write, so a super admin rotating a karykarta's
 * password is one button instead of a credential-retrieval exercise.
 *
 * The credentials never reach a browser bundle (same posture as
 * /api/roll/seed): the Admin SDK is initialized server-side only from
 * `FIREBASE_ADMIN_*` env vars in `admin/.env.local` (lib/admin-firebase.ts),
 * and the route is local-dev only — `next build` for a shared host exposes no
 * endpoint (that production answer is a Cloud Function on Blaze, as noted
 * throughout this repo).
 *
 * After a successful rotation the caller refreshes `accountSecrets/{uid}`
 * with a HASH of the new password (lib/vault.ts) — this route itself never
 * touches the vault, it stays the single writer of Auth itself.
 */
// No `export const runtime = 'nodejs'`: `cacheComponents` rejects route
// segment runtime config, and Node is the default runtime anyway.

const MIN_LENGTH = 6; // Firebase Auth's floor.

interface PasswordChange {
  uid?: unknown;
  password?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json(
      { ok: false, error: 'Password rotation is local-dev only in this prototype.' },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as PasswordChange;
  const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!uid) {
    return Response.json({ ok: false, error: 'Missing uid.' }, { status: 400 });
  }
  if (password.length < MIN_LENGTH) {
    return Response.json(
      { ok: false, error: `Passwords must be at least ${MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }

  try {
    // Import inside the handler so a module-load failure stays a JSON error
    // with the route's normal status instead of an empty 500.
    const { adminAuth } = await import('@/lib/admin-firebase');
    await adminAuth().updateUser(uid, { password });
    return Response.json({ ok: true });
  } catch (caught) {
    const code = (caught as { code?: string }).code ?? 'unknown';
    const message =
      code === 'auth/user-not-found'
        ? 'That uid has no Firebase Auth record — the profile exists but the login does not.'
        : code === 'auth/invalid-password'
          ? 'The password was rejected (minimum 6 characters).'
          : caught instanceof Error
            ? caught.message
            : 'Unknown Admin SDK failure.';
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}