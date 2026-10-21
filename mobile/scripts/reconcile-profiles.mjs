/**
 * One-way backfill: Auth custom claims → RTDB profile.
 *
 *   node scripts/reconcile-profiles.mjs          # dry run, prints every change
 *   node scripts/reconcile-profiles.mjs --write  # apply
 *
 * ## Why this is needed after the cutover
 *
 * The rules read `auth.token.role`, but the APP's UI reads `users/{uid}.role`
 * (`profileFromDoc`). Those are two different sources, and the migration left
 * them disagreeing: claims were backfilled for all 14 Auth users, while RTDB
 * received only the 8 profiles that existed in Firestore — and two of those
 * carried no `role` at all. The result is an account whose rules say
 * `superAdmin` while the app renders it as role-less.
 *
 * The claims are the authority here because they are the only complete copy:
 * they were set and verified per account. This script copies them INTO the
 * profile, never the other way round. Normal operation is the opposite
 * direction (panel edits profile → `grant-claims` mirrors it onto the token),
 * which is why this is a one-off migration tool and not part of the app.
 *
 * Missing profiles are created with the Auth display fields and
 * `onboarded: false`, matching what `ensureProfile` would write on next
 * sign-in. Existing profile fields are left alone except for the four
 * authority fields.
 *
 * Safe: dry-run by default; `--write` is required to touch anything.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const db = getDatabaseWithUrl(
  process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ||
    `https://${sa.project_id}-default-rtdb.asia-southeast1.firebasedatabase.app`,
  app
);

const { users } = await auth.listUsers(1000);
let changed = 0;
let conflicts = 0;

for (const user of users.sort((a, b) => (a.email || '').localeCompare(b.email || ''))) {
  const claims = user.customClaims ?? {};
  const snapshot = await db.ref(`users/${user.uid}`).once('value');
  const profile = snapshot.exists() ? snapshot.val() : null;

  // No role claim = no authority to copy. An Auth user with no profile is
  // inert and `ensureProfile` creates the node on first sign-in.
  if (typeof claims.role !== 'string') {
    if (profile?.role) {
      conflicts += 1;
      console.log(
        `CONFLICT ${user.email}: profile role=${profile.role} but the token has none — ` +
          'the UI would show authority the rules deny. Resolve by hand.'
      );
    }
    continue;
  }

  // Authority fields only: role, ward, team, lock, multi-device.
  const authority = {
    role: claims.role,
    ...(typeof claims.wardNo === 'number' ? { wardNo: claims.wardNo } : {}),
    ...(typeof claims.teamId === 'string' && claims.teamId !== ''
      ? { teamId: claims.teamId }
      : {}),
    ...(claims.locked === true ? { locked: true } : {}),
    ...(claims.multiDevice === true ? { multiDevice: true } : {}),
  };

  if (!profile) {
    changed += 1;
    const created = {
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      onboarded: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...authority,
    };
    console.log(`CREATE ${user.email}: ${JSON.stringify(authority)}`);
    if (WRITE) await db.ref(`users/${user.uid}`).set(created);
    continue;
  }

  const diff = {};
  for (const [key, value] of Object.entries(authority)) {
    if (profile[key] !== value) diff[key] = value;
  }
  if (Object.keys(diff).length === 0) continue;

  changed += 1;
  console.log(`PATCH  ${user.email}: ${JSON.stringify(diff)}`);
  if (WRITE) {
    await db.ref(`users/${user.uid}`).update({ ...diff, updatedAt: Date.now() });
  }
}

console.log(
  `\n${changed} profile(s) ${WRITE ? 'updated' : 'would change'}, ${conflicts} conflict(s).` +
    (WRITE ? '' : '\nDry run — re-run with --write to apply.')
);
process.exit(conflicts ? 1 : 0);
