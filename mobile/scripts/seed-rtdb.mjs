/**
 * Firestore → Realtime Database seed.
 *
 *   node scripts/seed-rtdb.mjs            # everything
 *   node scripts/seed-rtdb.mjs voters     # one collection
 *   node scripts/seed-rtdb.mjs --dry-run
 *
 * ## Why the Admin SDK on both ends
 *
 * The client SDK would need `EXPO_PUBLIC_*` vars loaded into Node, would read
 * Firestore through security rules, and would write RTDB through rules that do
 * not exist yet. The Admin SDK skips all three and is what makes a bootstrap
 * script that can run before the rules are deployed.
 *
 * ## Why every timestamp is flattened
 *
 * Firestore hands back `Timestamp`, which lands in RTDB as the object
 * `{_seconds, _nanoseconds}`. `lib/documents.ts` → `millisOf` accepts a
 * `toMillis()` method, a plain `seconds` field, or a plain number — it
 * deliberately does NOT accept `_seconds`, so every seeded timestamp would
 * read back as `null` and `createdAt` would vanish from tasks, expenses and
 * profiles. Flattening here is what keeps `millisOf` truthful.
 *
 * ## Shape
 *
 * Target paths are keyed by the SAME id Firestore used, never by array
 * index — RTDB stores `set(ref, [a, b])` as `{"0": a, "1": b}`, which is how
 * the first draft of this script produced a tree nothing could read. The one
 * structural change is `wards/{wardNo}` (already keyed by ward number in
 * Firestore) and `voterPhones/{id}/proposals/{uid}` (a subcollection).
 *
 * Writes go through `update()` rather than `set()` so a re-run MERGES instead
 * of deleting anything that has changed in RTDB since the last run.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const DATABASE_URL =
  process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ||
  'https://election-managment-default-rtdb.asia-southeast1.firebasedatabase.app';

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });

// Pass the URL outright: the Admin SDK's default for a project is the
// legacy `https://<project>-default-rtdb.firebaseio.com`, and a regional
// instance does not answer there — it 404s with an empty body.
const db = getFirestore(app, 'default');
// `firebase-admin/database` is the v8-style surface — `db.ref(path).update()`
// rather than the modular `ref()`/`update()` pair, which it does not export.
const rtdb = getDatabaseWithUrl(DATABASE_URL, app);

/** RTDB rejects writes over 10 MB; 400 voter docs is well under. */
const CHUNK = 400;
const DRY = process.argv.includes('--dry-run');
// argv[0] is the node binary and argv[1] is this script — start at 2.
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/**
 * Recursive Firestore value → RTDB value.
 *
 * Returns `undefined` to mean "omit this key": RTDB treats `null` as absent,
 * so writing it would just be noisier bytes for the same result.
 */
function toRtdb(value) {
  if (value === null || value === undefined) return undefined;

  if (Array.isArray(value)) {
    const out = value.map(toRtdb).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }

  if (typeof value === 'object') {
    // `Timestamp` — check this BEFORE walking entries, or the private
    // `_seconds`/`_nanoseconds` fields become a nested object.
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value._seconds === 'number') {
      return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
    }
    if (typeof value.seconds === 'number') {
      return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
    }

    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const converted = toRtdb(child);
      if (converted !== undefined) out[key] = converted;
    }
    return Object.keys(out).length ? out : undefined;
  }

  return value;
}

/** Writes `entries` under `path` in chunks, logging progress. */
async function writeAll(path, entries) {
  const keys = Object.keys(entries);
  if (!keys.length) return 0;

  if (DRY) {
    console.log(`  [dry] ${path}: would write ${keys.length} nodes`);
    return keys.length;
  }

  let written = 0;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const payload = {};
    for (const key of slice) {
      const converted = toRtdb(entries[key]);
      if (converted !== undefined) payload[key] = converted;
    }
    // `update` merges at every level, so a re-run cannot clobber newer data.
    await rtdb.ref(path).update(payload);
    written += slice.length;
    if (keys.length > CHUNK) {
      process.stdout.write(`\r  ${path}: ${written}/${keys.length}`);
    }
  }
  if (keys.length > CHUNK) process.stdout.write('\n');
  return written;
}

/** Reads a whole collection into an id → data map, pruning empties. */
async function readCollection(name) {
  const snap = await db.collection(name).get();
  const map = {};
  for (const doc of snap.docs) map[doc.id] = doc.data();
  return map;
}

async function seedSimple(name, targetPath = name) {
  const data = await readCollection(name);
  const count = await writeAll(targetPath, data);
  console.log(`${name.padEnd(18)} → /${targetPath.padEnd(18)} ${count}`);
  return count;
}

/** voters is 6 855 docs, so chunking matters — writeAll handles it. */
async function seedVoters() {
  return seedSimple('voters');
}

/** Subcollection lives under each voter's node: `/voterPhones/{id}/proposals/{uid}`. */
async function seedVoterPhones() {
  const snap = await db.collection('voterPhones').get();
  const tops = {};
  const proposals = {};
  for (const doc of snap.docs) {
    tops[doc.id] = doc.data();
    const sub = await doc.ref.collection('proposals').get();
    for (const p of sub.docs) proposals[`${doc.id}/proposals/${p.id}`] = p.data();
  }
  const a = await writeAll('voterPhones', tops);
  const b = await writeAll('voterPhones', proposals);
  console.log(`voterPhones         → /voterPhones         ${a} (+${b} proposals)`);
  return a + b;
}

async function seedAppConfig() {
  const doc = await db.doc('appConfig/general').get();
  if (!doc.exists) {
    console.log('appConfig/general   ABSENT in Firestore — skipped (rules still allow reads)');
    return 0;
  }
  const n = await writeAll('appConfig', { general: doc.data() });
  console.log(`appConfig           → /appConfig           ${n}`);
  return n;
}

/** Collections with no rows are skipped rather than created as empty nodes. */
const FLAT = [
  ['wards'],
  ['users'],
  ['tasks'],
  ['issues'],
  ['events'],
  ['expenses'],
  ['compliance'],
  ['constituencies'],
  ['areas'],
  ['booths'],
  ['teamMembers'],
  ['campaigns'],
  ['teams'],
];

async function main() {
  console.log(`Seeding RTDB (${DRY ? 'DRY RUN' : 'live'}) → ${DATABASE_URL}\n`);

  let total = 0;
  const jobs = [
    ['voters', seedVoters],
    ['voterPhones', seedVoterPhones],
    ['appConfig', seedAppConfig],
    ...FLAT.map(([name]) => [name, () => seedSimple(name)]),
  ];

  const selected = jobs.filter(([name]) => !ONLY.length || ONLY.includes(name));
  if (!selected.length) {
    console.error(`Nothing matches ${ONLY.join(', ')}. Known: ${jobs.map(([n]) => n).join(', ')}`);
    process.exit(1);
  }

  for (const [, job] of selected) total += await job();

  console.log(`\nDone: ${total} nodes.`);
  if (!DRY) {
    console.log('Next: node scripts/grant-claims.mjs   (roles live in claims, not here)');
  }
  // The Admin SDK's RTDB keeps a socket open, so without this the process
  // finishes its work and then sits there until something kills it.
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
