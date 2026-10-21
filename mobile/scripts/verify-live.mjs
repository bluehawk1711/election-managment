/**
 * End-to-end check of claims → rules → data, against PRODUCTION.
 *
 *   node scripts/verify-live.mjs gauravgaur@gmail.com     # superAdmin
 *   node scripts/verify-live.mjs ganpat@ward5.com         # karykarta, ward 5
 *
 * ## Why this is the check that matters
 *
 * The rules read `auth.token.role` from the **token**. Not from a profile
 * document, not from anything a script writes directly — so parsing the rules
 * file, loading it in the emulator, or reading a row back with the Admin SDK
 * (which bypasses rules entirely) says nothing about whether a real user can
 * get at their data. This mints a custom token for a real account, exchanges
 * it for an ID token the same way the app does, and asks the live database.
 *
 * It asserts the DENY side as deliberately as the allow side. A rules file
 * where everything returns 200 is not "permissive", it is security theatre,
 * and it is indistinguishable from a working one by inspection alone.
 *
 * Read-only except two writes that must be refused — see `mustRefuse`.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const PROJECT = 'election-managment';
const URL_BASE = `https://${PROJECT}-default-rtdb.asia-southeast1.firebasedatabase.app`;

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
if (!apiKey) throw new Error('EXPO_PUBLIC_FIREBASE_API_KEY is not set (see mobile/.env)');

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const db = getFirestore(app, 'default');

/** The three rungs `database.rules` actually checks, from `lib/roles.ts`. */
const ROLES = {
  karykarta: { voter: true, roster: false },
  admin: { voter: true, roster: true },
  superAdmin: { voter: true, roster: true },
  developer: { voter: true, roster: true },
};

const email = process.argv[2] || 'gauravgaur@gmail.com';
const user = await auth.getUserByEmail(email);
const role = user.customClaims?.role;
if (!role || !ROLES[role]) throw new Error(`${email} has no usable role claim — run grant-claims.mjs`);
const wardNo = user.customClaims?.wardNo;

// 1. custom token → 2. ID token over REST, exactly as the client SDK would.
const custom = await auth.createCustomToken(user.uid);
const res = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  }
);
if (!res.ok) throw new Error(`signInWithCustomToken ${res.status}: ${await res.text()}`);
const { idToken } = await res.json();

console.log(
  `${email}\n  uid=${user.uid}\n  claims=${JSON.stringify(user.customClaims)}\n`
);

const problems = [];

/** GET `path`, expecting HTTP 200 or 401. */
async function probe(label, path, expected) {
  const r = await fetch(`${URL_BASE}/${path}?auth=${idToken}`);
  const ok = expected === 'allow' ? r.ok : r.status === 401;
  const body = r.ok ? await r.text() : '';
  const note = body ? (body === 'null' ? 'empty' : body.slice(0, 70)) : '';
  if (!ok) problems.push(`${label}: expected ${expected}, got HTTP ${r.status}`);
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${expected.padEnd(5)}  ${label.padEnd(42)} HTTP ${r.status}${
      note ? `  ${note}` : ''
    }`
  );
  return body;
}

/**
 * A write that must be refused for EVERY role, so asserting it cannot corrupt
 * anything: `selfRole` fails the `auth.uid !== $uid` clause whatever the
 * caller's rank, and `newWard` hits a `.write: false` node.
 */
async function mustRefuse(label, path, body) {
  const r = await fetch(`${URL_BASE}/${path}?auth=${idToken}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ok = r.status === 401;
  if (!ok) problems.push(`${label}: write was NOT refused (HTTP ${r.status})`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  deny  ${label.padEnd(42)} HTTP ${r.status}`);
}

// --- fixtures -------------------------------------------------------------

/** Another account with a profile, to test the roster's directionality. */
const { users: allUsers } = await auth.listUsers(1000);
const other = allUsers.find(
  (u) => u.uid !== user.uid && u.customClaims?.role && (u.email || '').endsWith('.com')
);

/** One voter inside this account's ward, and one provably outside it. */
const inMyWard =
  typeof wardNo === 'number'
    ? (await db.collection('voters').where('wardNo', '==', wardNo).limit(1).get()).docs[0]?.id
    : null;
const otherWard = await db
  .collection('voters')
  .where('wardNo', '==', wardNo === 13 ? 12 : 13)
  .limit(1)
  .get();
const outside = otherWard.docs[0]?.id;

const can = ROLES[role];

// --- reads ----------------------------------------------------------------

await probe('read own profile', `users/${user.uid}.json`, 'allow');
await probe('read own edits', `users/${user.uid}/voterEdits.json`, 'allow');
await probe('read campaign', 'campaigns/active.json', 'allow');
await probe('read appConfig (the update gate, public by design)', 'appConfig/general.json', 'allow');
await probe('read a ward', 'wards/5.json', can.voter ? 'allow' : 'deny');
await probe('read the ward list', 'wards.json', can.voter ? 'allow' : 'deny');
await probe('list tasks', 'tasks.json', can.voter ? 'allow' : 'deny');
await probe('read the roster', 'users.json', can.roster ? 'allow' : 'deny');
if (other) {
  await probe(`read another account (${other.email})`, `users/${other.uid}.json`, can.roster ? 'allow' : 'deny');
}

// --- ward scoping: the rule `auth.token.wardNo === data.wardNo` ------------

if (inMyWard) {
  await probe(`read my own ward's voter (${inMyWard})`, `voters/${inMyWard}.json`, 'allow');
}
if (outside) {
  await probe(`read a voter in another ward (${outside})`, `voters/${outside}.json`, can.roster ? 'allow' : 'deny');
}

// --- writes that must never succeed --------------------------------------

await mustRefuse('change my OWN role', `users/${user.uid}/role.json`, 'developer');
await mustRefuse('write a ward (roll metadata)', 'wards/99.json', { name: 'Invented' });

// --- anonymous -------------------------------------------------------------

for (const [label, path, expected] of [
  ['anonymous /users', 'users.json', 'deny'],
  ['anonymous /campaigns/active', 'campaigns/active.json', 'deny'],
  ['anonymous /wards', 'wards.json', 'deny'],
  ['anonymous /appConfig/general (must stay public)', 'appConfig/general.json', 'allow'],
]) {
  const r = await fetch(`${URL_BASE}/${path}`);
  const ok = expected === 'allow' ? r.ok : r.status === 401;
  if (!ok) problems.push(`${label}: expected ${expected}, got HTTP ${r.status}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expected.padEnd(5)}  ${label.padEnd(42)} HTTP ${r.status}`);
}

console.log('');
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('every expectation held for this role.');
process.exit(0);
