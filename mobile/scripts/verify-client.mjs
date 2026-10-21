/**
 * What the ACTUAL client SDK returns, against production.
 *
 * `verify-live.mjs` proves rules via REST, but the app runs `firebase/database`,
 * and the two do not necessarily encode a node the same way. The thing this
 * exists to answer: does an object whose keys are "1".."13" come back as an
 * object or as a JSON array?
 *
 * That is not academic — RTDB's encoder turns sequential integer keys into a
 * JSON array, and `lib/db`'s `selectRows` refuses to read anything that is not
 * a plain object, so `/wards` would list as ZERO rows while
 * `GET /wards/5` returns a perfectly good ward.
 *
 *   EXPO_PUBLIC_FIREBASE_API_KEY=... node scripts/verify-client.mjs
 *
 * Read-only.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getDatabase, ref, get, connectDatabaseEmulator } from 'firebase/database';
import { initializeApp as initializeAdmin, cert, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const EMAIL = process.argv[2] || 'gauravgaur@gmail.com';
const EMULATING = process.env.EMULATOR === '1';

const config = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(config);
const auth = getAuth(app);
const db = getDatabase(app, env.EXPO_PUBLIC_FIREBASE_DATABASE_URL);

if (EMULATING) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
}

// The client SDK cannot mint a token; the Admin SDK can.
const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const adminApp = getApps().length
  ? getApps()[0]
  : initializeAdmin({ credential: cert(sa), projectId: sa.project_id });
const adminAuth = getAdminAuth(adminApp);

const user = await adminAuth.getUserByEmail(EMAIL);
const custom = await adminAuth.createCustomToken(user.uid);
await signInWithCustomToken(auth, custom);

console.log(`signed in as ${EMAIL} (role=${user.customClaims?.role ?? 'none'})\n`);

/**
 * Mirrors `childrenOf` from `lib/db/decode.ts`, which is the authoritative
 * implementation (and is unit-tested in `__tests__/db-decode.test.ts`).
 *
 * It cannot be imported here: that is a `.ts` module and this is `.mjs` run by
 * plain `node`, with no loader on the path. The duplication is the price of
 * keeping this script runnable as `node scripts/verify-client.mjs` with no
 * build step — so if you change one, change both, and trust the test file for
 * the logic and this script only for the SHAPE, which is the one thing no unit
 * test can see because it depends on data having been written.
 */
const childrenOf = (raw) =>
  Array.isArray(raw)
    ? raw.flatMap((value, index) => (value === null ? [] : [[String(index), value]]))
    : typeof raw === 'object' && raw !== null
      ? Object.entries(raw)
      : [];

// What `reference-provider` actually subscribes to, plus the one node whose
// read rule is deliberately narrower than the others.
const paths = [
  ['wards', 'ward list — integer keys, so this arrives as an ARRAY'],
  ['areas', 'area list reference-provider maps'],
  ['tasks', 'task list (empty node in this project)'],
  ['users', 'the roster, accountView only'],
  ['campaigns/active', 'a single doc — reads one node, never a list'],
  ['voters', 'the roll — denied for a bulk read, by design (ward-scoped per doc)'],
];

const DENIED = Symbol('denied');

const results = await Promise.all(
  paths.map(async ([path, why]) => {
    // The Node build rejects with `new Error('Permission denied')` — no
    // `.code` — so match on the message too, or a closed path falls through
    // and crashes on `snap.val()` instead of being reported as closed.
    const snap = await get(ref(db, path)).catch(
      (error) => ({ denied: error.code ?? error.message ?? String(error) })
    );
    return [path, why, snap.denied ? DENIED : snap];
  })
);

let failures = 0;

for (const [path, why, snap] of results) {
  if (snap === DENIED) {
    // A denial is the CORRECT outcome only for `/voters`: its rule is scoped
    // per document (wardNo) and no collection-level rule can express that, so
    // a bulk read is closed. Nothing lists it — `firestoreSource` is dead
    // code — and closing it also keeps 6 855 nodes off the wire.
    const expected = path === 'voters';
    if (!expected) failures += 1;
    console.log(`${expected ? 'PASS' : 'FAIL'}  /${path.padEnd(18)} → PERMISSION_DENIED`);
    console.log(`      ${why}`);
    continue;
  }

  const raw = snap.val();
  const rows = childrenOf(raw);
  const kind = raw === null ? 'null (empty)' : Array.isArray(raw) ? 'ARRAY' : 'object';
  const shapeOk = raw === null || typeof raw === 'object';

  if (!shapeOk) failures += 1;

  console.log(`${shapeOk ? 'PASS' : 'FAIL'}  /${path.padEnd(18)} → ${kind.padEnd(12)} ${rows.length} rows`);
  console.log(`      ${why}`);
}

console.log('');
if (failures) {
  console.log(`${failures} path(s) the app cannot read. Check the shape above against`);
  console.log('`lib/db/decode.ts` and the rule in `database.rules.json`.');
  process.exit(1);
}
console.log('every path the app reads is reachable and decodes to rows.');
process.exit(0);
