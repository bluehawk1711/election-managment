/**
 * Set Auth custom claims from each account's profile.
 *
 *   node scripts/grant-claims.mjs                 # backfill everyone
 *   node scripts/grant-claims.mjs <email> --role superAdmin --ward 6
 *   node scripts/grant-claims.mjs <email> --clear
 *
 * ## Why this script has to exist at all
 *
 * RTDB security rules cannot read another path, so `firestore.rules`' question
 * "is this caller an admin?" — answered by `get(...users/{uid}.role`) — has no
 * equivalent. The role has to travel on the token, and only the Admin SDK can
 * put it there: a client SDK cannot set custom claims, no matter what the
 * calling code claims to be. So this script, not the app, is the authority.
 *
 * ## Why it does NOT call revokeRefreshTokens
 *
 * `revokeRefreshTokens` would make the change bite instantly, but it also
 * invalidates every refresh token — which signs the target out of the app
 * entirely. For a first-time backfill that is a self-inflicted outage. Claims
 * instead reach the rules on the token's next refresh (≤ 1 hour) without
 * touching anyone's session. Revoke deliberately when REMOVING authority:
 *
 *     await auth.revokeRefreshTokens(uid);
 *
 * ## Reading the source of truth
 *
 * Role/ward/team/lock are read from the profile in **Realtime Database** — the
 * same node the app and the admin panel write. Reading Firestore here would be
 * reading a backup: after the cutover, a role change lands in RTDB and this
 * script would happily re-grant the old one.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const DATABASE_URL =
  process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ||
  `https://${sa.project_id}-default-rtdb.asia-southeast1.firebasedatabase.app`;
const db = getDatabaseWithUrl(DATABASE_URL, app);

/** The profile node, or `null` when no profile exists yet. */
async function profileFor(uid) {
  const snapshot = await db.ref(`users/${uid}`).once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

const ROLES = ['karykarta', 'admin', 'superAdmin', 'developer'];

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

/** Claims are the ONLY role source the rules can see, so never set an unknown one. */
function claimsFor(profile) {
  if (!profile) return {};

  const role = typeof profile.role === 'string' && ROLES.includes(profile.role) ? profile.role : null;

  return {
    role,
    // Absent ward/team become absent claims, not 0/'' — `auth.token.wardNo`
    // must not accidentally equal a real ward 0.
    ...(typeof profile.wardNo === 'number' ? { wardNo: profile.wardNo } : {}),
    ...(typeof profile.teamId === 'string' && profile.teamId !== '' ? { teamId: profile.teamId } : {}),
    ...(profile.locked === true ? { locked: true } : {}),
    // Not device-bound. The rules cannot read this sibling from the `device`
    // node, so the exemption has to ride on the token like the role does.
    ...(profile.multiDevice === true ? { multiDevice: true } : {}),
  };
}

function describe(c) {
  const parts = [`role=${c.role ?? '(none)'}`];
  if ('wardNo' in c) parts.push(`wardNo=${c.wardNo}`);
  if ('teamId' in c) parts.push(`teamId=${c.teamId}`);
  if ('locked' in c) parts.push('LOCKED');
  if ('multiDevice' in c) parts.push('MULTI-DEVICE');
  return parts.join(' ');
}

async function apply(user, profile) {
  if (argv.includes('--clear')) {
    await auth.setCustomUserClaims(user.uid, null);
    console.log(`${user.email}  claims CLEARED`);
    return;
  }

  // Explicit flags beat the profile, so a one-off promotion does not need a
  // profile edit first.
  const profileCopy = { ...profile };
  const roleFlag = flag('--role');
  if (roleFlag) {
    if (!ROLES.includes(roleFlag)) {
      throw new Error(`--role must be one of ${ROLES.join(', ')}`);
    }
    profileCopy.role = roleFlag;
  }
  const wardFlag = flag('--ward');
  if (wardFlag) profileCopy.wardNo = Number(wardFlag);
  const teamFlag = flag('--team');
  if (teamFlag) profileCopy.teamId = teamFlag;
  if (argv.includes('--locked')) profileCopy.locked = true;

  const claims = claimsFor(profileCopy);
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${(user.email || user.uid).padEnd(34)} ${describe(claims)}`);
}

async function main() {
  const { users } = await auth.listUsers(1000);

  if (positional.length) {
    for (const target of positional) {
      const user = users.find((u) => (u.email || '').toLowerCase() === target.toLowerCase());
      if (!user) throw new Error(`No Auth user for ${target}`);
      await apply(user, await profileFor(user.uid));
    }
    console.log('\nTokens refresh within the hour; sessions are NOT signed out.');
    return;
  }

  let changed = 0;
  for (const user of users) {
    // An Auth user with no profile gets NO claims: inert, but still able to
    // onboard their own profile, which needs no role at all.
    await apply(user, await profileFor(user.uid));
    changed += 1;
  }
  console.log(`\nSet claims on ${changed}/${users.length} Auth users.`);
  console.log('Tokens refresh within the hour; sessions are NOT signed out.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
