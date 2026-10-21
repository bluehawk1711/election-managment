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
 * The credentials never reach a browser bundle (same posture as
 * /api/account/password and /api/roll/seed): the Admin SDK is initialized
 * server-side only from `FIREBASE_ADMIN_*` env vars in `admin/.env.local`
 * (lib/admin-firebase.ts), and the route is local-dev only — `next build`
 * for a shared host exposes no endpoint (that production answer is a Cloud
 * Function on Blaze, as noted throughout this repo).
 */
// No `export const runtime = 'nodejs'`: `cacheComponents` rejects route
// segment runtime config, and Node is the default runtime anyway.

import { adminAuth, adminDatabase } from '@/lib/admin-firebase';

interface ClaimsRequest {
  uid?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json(
      { ok: false, error: 'Claim writes are local-dev only in this prototype.' },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as ClaimsRequest;
  const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
  if (!uid) {
    return Response.json({ ok: false, error: 'Missing uid.' }, { status: 400 });
  }

  try {
    // The profile IS the source of truth (see the header). A missing profile
    // means the account's authority is gone with it, so the claims are
    // cleared rather than left behind as a ghost privilege.
    const snapshot = await adminDatabase().ref(`users/${uid}`).once('value');
    const profile = (snapshot.val() ?? null) as Record<string, unknown> | null;

    const claims = {
      role: typeof profile?.role === 'string' ? profile.role : null,
      wardNo: typeof profile?.wardNo === 'number' ? profile.wardNo : null,
      teamId:
        typeof profile?.teamId === 'string' && profile.teamId !== ''
          ? profile.teamId
          : null,
      locked: profile?.locked === true,
    };

    await adminAuth().setCustomUserClaims(uid, claims);

    // The target's access token still carries the OLD claims until it
    // refreshes (RTDB rules read `auth.token.*`), which is minutes, not
    // instant — noted here rather than papered over with a forced sign-out.
    return Response.json({ ok: true, claims });
  } catch (caught) {
    const code = (caught as { code?: string }).code ?? 'unknown';
    const message =
      code === 'auth/user-not-found'
        ? 'That uid has no Firebase Auth record — the profile exists but the login does not.'
        : caught instanceof Error
          ? caught.message
          : 'Unknown Admin SDK failure.';
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
