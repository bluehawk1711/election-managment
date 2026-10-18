/**
 * GET /api/account/detail?uid=… — the FIREBASE AUTH side of an account, via
 * the Admin SDK's `getUser`.
 *
 * `users/{uid}` holds the profile the app writes (role, device, lock…); the
 * Auth record holds the login facts nobody can read from Firestore: real
 * creation time, last sign-in, e-mail verification, disabled flag, phone
 * number and sign-in providers. The Accounts page's details dialog joins the
 * two so "all details about a user" is one screen.
 *
 * Same posture as /api/account/password: the Admin SDK is initialized
 * server-side only from `FIREBASE_ADMIN_*` env vars in `admin/.env.local`
 * (lib/admin-firebase.ts), and the route is local-dev only — `next build`
 * for a shared host exposes no endpoint (the production answer remains a
 * Cloud Function on Blaze). The client treats a 403/404 as "unavailable" and
 * simply omits the Auth section rather than failing the whole dialog.
 */
// No `export const runtime = 'nodejs'` here: this project enables
// `cacheComponents`, which rejects route segment runtime config outright —
// and Node is the default runtime anyway, which is what the Admin SDK needs.

import { adminAuth } from '@/lib/admin-firebase';

/** ISO timestamps → epoch millis; a missing value stays null. */
function toMillis(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json(
      { ok: false, error: 'Account detail lookup is local-dev only in this prototype.' },
      { status: 403 }
    );
  }

  const uid = new URL(request.url).searchParams.get('uid')?.trim() ?? '';
  if (!uid) {
    return Response.json({ ok: false, error: 'Missing uid.' }, { status: 400 });
  }

  try {
    const user = await adminAuth().getUser(uid);
    return Response.json({
      ok: true,
      detail: {
        uid: user.uid,
        email: user.email ?? null,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        createdAt: toMillis(user.metadata.creationTime),
        lastSignInAt: toMillis(user.metadata.lastSignInTime),
        phone: user.phoneNumber ?? null,
        providers: user.providerData.map((entry) => entry.providerId),
      },
    });
  } catch (caught) {
    const code = (caught as { code?: string }).code ?? 'unknown';
    const message =
      code === 'auth/user-not-found'
        ? 'That uid has no Firebase Auth record — the profile exists but the login does not.'
        : caught instanceof Error
          ? caught.message
          : 'Unknown Admin SDK failure.';
    return Response.json({ ok: false, error: message }, { status: 404 });
  }
}
