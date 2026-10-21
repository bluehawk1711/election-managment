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
 * Role/ward/team/lock are read from the profile in Firestore, which is still
 * the place the app writes them during the migration — `lib/db` is the RTDB
 * door, but this script is deliberately independent of the client code it
 * configures.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const db = getFirestore(app, 'default');

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
  };
}

function describe(c) {
  const parts = [`role=${c.role ?? '(none)'}`];
  if ('wardNo' in c) parts.push(`wardNo=${c.wardNo}`);
  if ('teamId' in c) parts.push(`teamId=${c.teamId}`);
  if ('locked' in c) parts.push('LOCKED');
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
      const doc = await db.doc(`users/${user.uid}`).get();
      await apply(user, doc.exists ? doc.data() : null);
    }
    console.log('\nTokens refresh within the hour; sessions are NOT signed out.');
    return;
  }

  let changed = 0;
  for (const user of users) {
    const doc = await db.doc(`users/${user.uid}`).get();
    // An Auth user with no profile gets NO claims: inert, but still able to
    // onboard their own profile, which needs no role at all.
    await apply(user, doc.exists ? doc.data() : null);
    changed += 1;
  }
  console.log(`\nSet claims on ${changed}/${users.length} Auth users.`);
  console.log('Tokens refresh within the hour; sessions are NOT signed out.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
