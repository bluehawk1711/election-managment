/**
 * Every collection write the app makes, against PRODUCTION, as the real roles.
 *
 *   node scripts/probe-writes.mjs
 *
 * ## Why this exists next to `verify-live.mjs` and `probe-owner-write.mjs`
 *
 * `verify-live.mjs` asserts READS and two writes that must be refused.
 * `probe-owner-write.mjs` covers the profile/overlay/phone paths. Neither ever
 * creates a task, an event, an issue, an expense or a compliance item — so a
 * `.validate` whose enum drifted from `lib/models.ts` passes both scripts and
 * still breaks the app the first time someone taps "save".
 *
 * That is not hypothetical: the first RTDB port validated `tasks.status`
 * against `todo|doing|done|blocked` and `events.type` against
 * `rally|doorToDoor|meeting|party|other`, while both apps write
 * `pending|in_progress|completed|issue` and
 * `meeting|training|public|deadline`. Every task create and three of four
 * event types were rejected. Nothing short of a real write would have caught it.
 *
 * ## What it asserts
 *
 * For a karykarta (the least-privileged writing role): the exact payload each
 * hook builds, then a status transition, then a delete. A write that the rules
 * reject is printed with its HTTP status, and the script exits non-zero.
 *
 * The device section covers the owner-side rebind exemption, including the
 * superAdmin self-rebind the RTDB port originally dropped. `ganpat@ward5.com`
 * and the super admin are dev accounts; their device binding is snapshotted
 * and restored.
 *
 * Safe: every created node is removed in `finally`, including on failure.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const PROJECT = 'election-managment';
const URL_BASE = `https://${PROJECT}-default-rtdb.asia-southeast1.firebasedatabase.app`;

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const apiKey = env.match(/^EXPO_PUBLIC_FIREBASE_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) throw new Error('EXPO_PUBLIC_FIREBASE_API_KEY is not set in mobile/.env');

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const adminDb = getDatabaseWithUrl(URL_BASE, app);

const KARYKARTA_EMAIL = process.env.PROBE_KARYKARTA_EMAIL ?? 'ganpat@ward5.com';
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'gauravgaur@gmail.com';

/** RTDB's server-timestamp placeholder — what `serverTimestamp()` sends. */
const SV = { '.sv': 'timestamp' };

const stamp = Date.now();
const problems = [];
const created = [];
let karykarta;
let admin;
let originalKarykartaClaims;
let karykartaUid;
let originalKarykartaProfile;
let originalAdminProfile;

async function send(method, path, body, token) {
  const r = await fetch(`${URL_BASE}/${path}.json?auth=${token}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
}

async function loginAs(address) {
  const account = await auth.getUserByEmail(address);
  const custom = await auth.createCustomToken(account.uid);
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
  return { uid: account.uid, token: idToken, claims: account.customClaims ?? {} };
}

function report(label, expected, { status, ok }) {
  const pass = expected === 'allow' ? ok : status === 401;
  if (!pass) problems.push(`${label}: expected ${expected}, got HTTP ${status}`);
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${String(status).padEnd(4)} ${label.padEnd(52)} (expected ${expected})`
  );
}

/** Writes, reports, and remembers the path for cleanup. */
async function attempt(label, method, path, body, token, expected = 'allow') {
  const result = await send(method, path, body, token);
  report(label, expected, result);
  // Never track `users/...`: those are PATCHes on real profiles, and the
  // cleanup removes whatever it is handed.
  if (result.ok && method !== 'DELETE' && !path.startsWith('users/')) created.push(path);
  return result;
}

function device(id) {
  return { id, name: 'Rules probe phone', platform: 'android' };
}

try {
  karykarta = await loginAs(KARYKARTA_EMAIL);
  admin = await loginAs(SUPER_ADMIN_EMAIL);
  karykartaUid = karykarta.uid;
  originalKarykartaClaims = karykarta.claims;

  console.log(
    `\nkarykarta ${KARYKARTA_EMAIL}  uid=${karykarta.uid}  claims=${JSON.stringify(karykarta.claims)}`
  );
  console.log(`superAdmin ${SUPER_ADMIN_EMAIL}  uid=${admin.uid}\n`);

  // ------------------------------------------------------------- tasks ----
  // The exact shape `useTasks.create` writes: every Task field, with RTDB
  // timestamps, so the rules see the same node the app creates.
  const taskPath = `tasks/__probe_${stamp}`;
  await attempt('karykarta creates a task', 'PUT', taskPath, {
    title: 'Rules probe task',
    description: '',
    assigneeId: '',
    areaId: '',
    boothId: '',
    dueDate: null,
    status: 'pending',
    report: '',
    createdBy: karykarta.uid,
    createdAt: SV,
    updatedAt: SV,
  }, karykarta.token);
  await attempt('karykarta moves it to in_progress', 'PATCH', taskPath, {
    status: 'in_progress',
    updatedAt: SV,
  }, karykarta.token);
  await attempt('karykarta moves it to completed', 'PATCH', taskPath, {
    status: 'completed',
    updatedAt: SV,
  }, karykarta.token);
  await attempt('the drifted `todo` enum is refused', 'PATCH', taskPath, {
    status: 'todo',
  }, karykarta.token, 'deny');
  await attempt('karykarta deletes the task', 'DELETE', taskPath, undefined, karykarta.token);

  // ------------------------------------------------------------ events ----
  const eventPath = `events/__probe_${stamp}`;
  await attempt('karykarta creates a `training` event', 'PUT', eventPath, {
    title: 'Rules probe training',
    type: 'training',
    startsAt: Date.now() + 86_400_000,
    endsAt: null,
    location: '',
    description: '',
    createdAt: SV,
  }, karykarta.token);
  await attempt('karykarta changes it to a `public` event', 'PATCH', eventPath, {
    type: 'public',
  }, karykarta.token);
  await attempt('the drifted `rally` enum is refused', 'PATCH', eventPath, {
    type: 'rally',
  }, karykarta.token, 'deny');
  await attempt('karykarta deletes the event', 'DELETE', eventPath, undefined, karykarta.token);

  // ------------------------------------------------------------ issues ----
  const issuePath = `issues/__probe_${stamp}`;
  await attempt('karykarta creates an issue', 'PUT', issuePath, {
    category: 'road',
    title: 'Rules probe issue',
    description: '',
    areaId: '',
    photoUrl: '',
    status: 'open',
    reportedBy: 'Rules probe',
    reportedAt: SV,
    updatedAt: SV,
  }, karykarta.token);
  await attempt('karykarta resolves it', 'PATCH', issuePath, {
    status: 'resolved',
    updatedAt: SV,
  }, karykarta.token);
  await attempt('an unknown issue status is refused', 'PATCH', issuePath, {
    status: 'closed',
  }, karykarta.token, 'deny');
  await attempt('karykarta deletes the issue', 'DELETE', issuePath, undefined, karykarta.token);

  // ---------------------------------------------------------- expenses ----
  const expensePath = `expenses/__probe_${stamp}`;
  await attempt('karykarta creates a pending expense', 'PUT', expensePath, {
    date: Date.now(),
    category: 'travel',
    amount: 42,
    description: '',
    receiptUrl: '',
    status: 'pending',
    createdBy: karykarta.uid,
    createdAt: SV,
  }, karykarta.token);
  await attempt('karykarta approves it (shared collection)', 'PATCH', expensePath, {
    status: 'approved',
  }, karykarta.token);
  await attempt('karykarta deletes the expense', 'DELETE', expensePath, undefined, karykarta.token);

  // -------------------------------------------------------- compliance ----
  const compliancePath = `compliance/__probe_${stamp}`;
  await attempt('karykarta creates a compliance item', 'PUT', compliancePath, {
    title: 'Rules probe compliance',
    category: '',
    status: 'pending',
    dueDate: null,
    notes: '',
    updatedAt: SV,
  }, karykarta.token);
  await attempt('karykarta marks it done', 'PATCH', compliancePath, {
    status: 'done',
    updatedAt: SV,
  }, karykarta.token);
  await attempt('an unknown compliance status is refused', 'PATCH', compliancePath, {
    status: 'blocked',
  }, karykarta.token, 'deny');
  await attempt('karykarta deletes the item', 'DELETE', compliancePath, undefined, karykarta.token);

  // --------------------------------------------------------- proposals ----
  // `writeProposal` is a plain `set()` on the proposal node — a child of a
  // `$voterId` whose own `.write` is superAdmin-only. This asserts that the
  // owner rule on `proposals/$propId` really does grant the write on its own.
  const phonePath = `voterPhones/__probe_${stamp}`;
  await attempt('karykarta files their own proposal', 'PUT',
    `${phonePath}/proposals/${karykarta.uid}`, {
      phone: '9876543210',
      authorName: 'Rules probe',
      wardNo: karykarta.claims.wardNo ?? 5,
      updatedAt: Date.now(),
    }, karykarta.token);
  await attempt('karykarta CANNOT file for another account', 'PUT',
    `${phonePath}/proposals/__someone_${stamp}`, {
      phone: '9876543210',
      authorName: 'Rules probe',
      wardNo: karykarta.claims.wardNo ?? 5,
      updatedAt: Date.now(),
    }, karykarta.token, 'deny');

  // ------------------------------------------------------------ devices ---
  // Snapshot the two profiles so the rebind checks can be undone exactly.
  originalKarykartaProfile =
    (await adminDb.ref(`users/${karykartaUid}`).once('value')).val() ?? {};
  originalAdminProfile =
    (await adminDb.ref(`users/${admin.uid}`).once('value')).val() ?? {};

  // Start from "no binding" so the first write is unambiguously a first bind.
  await adminDb.ref(`users/${karykartaUid}/device`).remove();

  await attempt('karykarta binds their device (first bind)', 'PATCH',
    `users/${karykartaUid}`, { device: device(`probe-a-${stamp}`) }, karykarta.token);
  await attempt('karykarta CANNOT rebind their device', 'PATCH',
    `users/${karykartaUid}`, { device: device(`probe-b-${stamp}`) }, karykarta.token, 'deny');

  // A multi-device account is not single-bound — the grant is admin-only, and
  // the exemption reaches the rule as a CLAIM (RTDB cannot read the sibling
  // `multiDevice` from the `device` node). A fresh sign-in is required because
  // the old ID token still carries the old claim set.
  await attempt('superAdmin grants multiDevice', 'PATCH',
    `users/${karykartaUid}`, { multiDevice: true }, admin.token);
  await auth.setCustomUserClaims(karykartaUid, {
    ...originalKarykartaClaims,
    multiDevice: true,
  });
  karykarta = await loginAs(KARYKARTA_EMAIL);
  await attempt('a multiDevice account MAY rebind', 'PATCH',
    `users/${karykartaUid}`, { device: device(`probe-b-${stamp}`) }, karykarta.token);

  await attempt('superAdmin revokes multiDevice', 'PATCH',
    `users/${karykartaUid}`, { multiDevice: null }, admin.token);
  await auth.setCustomUserClaims(karykartaUid, originalKarykartaClaims);
  karykarta = await loginAs(KARYKARTA_EMAIL);
  await attempt('without multiDevice it is bound again', 'PATCH',
    `users/${karykartaUid}`, { device: device(`probe-c-${stamp}`) }, karykarta.token, 'deny');

  // The lock: an owner may set it ON but never OFF. The first port compared
  // `data.child('locked')` — a child of the boolean itself, permanently
  // absent — so every owner could unlock themselves.
  await attempt('superAdmin locks the account', 'PATCH', `users/${karykartaUid}`, {
    locked: true,
    lockedReason: 'admin',
    lockedAt: Date.now(),
    lockedBy: 'system',
  }, admin.token);
  await attempt('karykarta CANNOT unlock themselves', 'PATCH',
    `users/${karykartaUid}`, { locked: false }, karykarta.token, 'deny');
  await attempt('karykarta CANNOT delete the lock', 'PATCH',
    `users/${karykartaUid}/locked`, null, karykarta.token, 'deny');
  await attempt('superAdmin unlocks the account', 'PATCH', `users/${karykartaUid}`, {
    locked: false,
    lockedReason: '',
    lockedAt: null,
    lockedBy: '',
  }, admin.token);

  // The regression this section exists for: `auth.uid === $uid` used to lose
  // the superAdmin exemption, so the one account that must stay reachable
  // could never move to a new phone.
  await adminDb.ref(`users/${admin.uid}/device`).remove();
  await attempt('superAdmin binds their own device', 'PATCH',
    `users/${admin.uid}`, { device: device(`probe-admin-a-${stamp}`) }, admin.token);
  await attempt('superAdmin MAY rebind their own device', 'PATCH',
    `users/${admin.uid}`, { device: device(`probe-admin-b-${stamp}`) }, admin.token);

  console.log(
    problems.length
      ? `\n${problems.length} PROBLEM(S):\n  - ${problems.join('\n  - ')}`
      : '\nAll write probes behaved as intended.'
  );
} finally {
  for (const path of created) {
    await adminDb.ref(path).remove().catch(() => undefined);
  }
  // Claims are replaced wholesale, so a failure between the grant and the
  // revoke would leave the test account with `multiDevice: true` forever.
  if (karykartaUid && originalKarykartaClaims) {
    await auth.setCustomUserClaims(karykartaUid, originalKarykartaClaims).catch(() => undefined);
  }
  // Restore the two real profiles exactly: device and every lock field back to
  // what they were, and multiDevice removed — those are the only keys touched.
  if (originalKarykartaProfile) {
    await adminDb
      .ref(`users/${karykartaUid}`)
      .update({
        device: originalKarykartaProfile.device ?? null,
        multiDevice: originalKarykartaProfile.multiDevice ?? null,
        locked: originalKarykartaProfile.locked ?? null,
        lockedReason: originalKarykartaProfile.lockedReason ?? null,
        lockedAt: originalKarykartaProfile.lockedAt ?? null,
        lockedBy: originalKarykartaProfile.lockedBy ?? null,
      })
      .catch(() => undefined);
  }
  if (originalAdminProfile) {
    await adminDb
      .ref(`users/${admin.uid}`)
      .update({ device: originalAdminProfile.device ?? null })
      .catch(() => undefined);
  }
  console.log('cleaned up probe nodes and restored profiles/claims');
}

// The Admin SDK keeps a database socket open, which would otherwise hold the
// event loop for the full shell timeout after the results are already printed.
process.exit(problems.length ? 1 : 0);
