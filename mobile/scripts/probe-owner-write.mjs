/**
 * Can a brand-new, roleless owner create and patch their OWN `users/{uid}`?
 *
 * This is the one write that has to succeed before the app can onboard anyone,
 * and `scripts/verify-live.mjs` does not cover it: every account it signs in as
 * already has a profile and a role claim, and the only writes it attempts are
 * two that must be REFUSED. So a rules file where an owner cannot create their
 * own profile passes `verify-live.mjs` completely.
 *
 * Why this can plausibly be broken. `database.rules.json` grants profile writes
 * through the PER-CHILD rules (`email`, `displayName`, `onboarded`, …) while
 * the node-level `.write` on `users/$uid` is deliberately delete-only. Whether
 * that combination permits the owner's write depends on how RTDB evaluates a
 * multi-child write, and the answer is not obvious from reading the file — so
 * this asks the live database instead of reasoning about it.
 *
 * `set` and `update` are tested SEPARATELY and that is the point. In RTDB REST
 * terms they are `PUT` and `PATCH`, and they do not validate the same way:
 * `PUT` replaces the whole node, `PATCH` touches only the named children.
 * `ensureProfile` and `useProfile` use different ones.
 *
 * Safe: it mints a throwaway Auth account with no claims (the real onboarding
 * state), asserts nothing about a real user's data, then deletes both the node
 * and the account on the way out — including on failure.
 *
 *   node scripts/probe-owner-write.mjs
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';

const PROJECT = 'election-managment';
const URL_BASE = `https://${PROJECT}-default-rtdb.asia-southeast1.firebasedatabase.app`;

const sa = JSON.parse(readFileSync(new URL('../service-account.json', import.meta.url), 'utf8'));

// Loaded here rather than assumed in the environment: this script is run by
// hand, and requiring the caller to export the key first is exactly the kind of
// friction that stops someone running a check.
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const apiKey = env.match(/^EXPO_PUBLIC_FIREBASE_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) throw new Error('EXPO_PUBLIC_FIREBASE_API_KEY is not set in mobile/.env');

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
// `getDatabaseWithUrl`, not `getDatabase`: the Admin SDK cannot discover the
// URL from this service account. The regional host matters — the legacy
// `<project>-default-rtdb.firebaseio.com` form 404s with an empty body.
const adminDb = getDatabaseWithUrl(URL_BASE, app);

const stamp = Date.now();
const email = `rules-probe-${stamp}@example.com`;
const password = `Probe!${stamp}xY`;

const problems = [];
let uid = null;
let idToken = null;
let phonePath = null;
let editPath = null;

/** The exact payload `ensureProfile` writes, with RTDB's timestamp placeholder. */
const PROFILE = {
  email,
  displayName: 'Rules probe',
  onboarded: false,
  createdAt: { '.sv': 'timestamp' },
  updatedAt: { '.sv': 'timestamp' },
};

async function send(method, path, body, token = idToken) {
  const r = await fetch(`${URL_BASE}/${path}.json?auth=${token}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, ok: r.ok, text: r.ok ? await r.text() : '' };
}

/** Mints an ID token for an existing account, the way `verify-live.mjs` does. */
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
  const { idToken: token } = await res.json();
  return { uid: account.uid, token, claims: account.customClaims ?? {} };
}

function report(label, expected, { status, ok }) {
  const pass = expected === 'allow' ? ok : status === 401;
  if (!pass) problems.push(`${label}: expected ${expected}, got HTTP ${status}`);
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${String(status).padEnd(4)} ${label.padEnd(46)} (expected ${expected})`
  );
}

try {
  // No custom claims, which is the real state of a freshly signed-up account.
  const created = await auth.createUser({
    email,
    password,
    displayName: 'Rules probe',
    emailVerified: true,
  });
  uid = created.uid;

  const custom = await auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    }
  );
  if (!res.ok) throw new Error(`signInWithCustomToken ${res.status}: ${await res.text()}`);
  ({ idToken } = await res.json());

  console.log(`\nroleless owner ${email}\n  uid=${uid}\n`);

  // The two writes the app actually makes, tested apart — `set` and `update`
  // do NOT validate the same way, which is the whole reason this script exists.
  //
  // A plain `PUT` (RTDB `set`) is expected to be REFUSED: it is validated at
  // the `users/$uid` node, whose only `.write` is delete-only by design, and a
  // node-level grant cannot be revoked by a child. That is why both
  // `ensureProfile` and `useCreateAccount` pass `{ merge: true }`.
  report('PUT  whole profile (plain set — refused by design)', 'deny', await send('PUT', `users/${uid}`, PROFILE));
  report(
    'PATCH profile fields (ensureProfile/useProfile)',
    'allow',
    await send('PATCH', `users/${uid}`, PROFILE)
  );

  // The create-account flow writes role from the NEW account's session because
  // it runs on the secondary Firebase app. Under claims that is self-service,
  // so it must be refused — this asserts the direction of the fix.
  report(
    'PATCH own role (create-account flow)',
    'deny',
    await send('PATCH', `users/${uid}`, { role: 'superAdmin' })
  );
  report('PUT  own role', 'deny', await send('PUT', `users/${uid}/role`, 'superAdmin'));

  // The other half of `useCreateAccount`: it writes the new profile from the
  // ADMIN's session, not the new account's, so `auth.uid !== $uid` and the
  // account-admin rules must accept it. If this fails, creating an account
  // from inside the app leaves an Auth user with no usable profile.
  const admin = await loginAs(process.env.SUPER_ADMIN_EMAIL ?? 'gauravgaur@gmail.com');
  report(
    'superAdmin PATCHes a new account role',
    'allow',
    await send('PATCH', `users/${uid}`, { role: 'karykarta', wardNo: 5 }, admin.token)
  );

  // `clearFinalize()` writes `''` for `finalizedBy`/`finalizedName` and removes
  // `finalizedAt`. The previous RTDB rule demanded a length of at least 1 for
  // those two, so it accepted "choose this number" and rejected "undo it" —
  // the exact asymmetry `firestore.rules` did not have (`text(x, 0, 128)`).
  // Asserted here because it is a RULES change, and a rules change is not
  // verified by reading it.
  phonePath = `voterPhones/__probe-${stamp}`;  report(
    'superAdmin CLEARS a finalized phone (the undo path)',
    'allow',
    await send(
      'PATCH',
      phonePath,
      { wardNo: 1, finalPhone: '', finalizedBy: '', finalizedName: '' },
      admin.token
    )
  );
  report(
    'superAdmin SETS a finalized phone',
    'allow',
    await send(
      'PATCH',
      phonePath,
      {
        wardNo: 1,
        finalPhone: '+919999999999',
        finalizedBy: admin.uid,
        finalizedName: 'Rules probe',
        finalizedAt: Date.now(),
      },
      admin.token
    )
  );
  report(
    'karykarta CANNOT finalize a phone',
    'deny',
    await send('PATCH', phonePath, { finalPhone: '+918888888888' })
  );

  // The overlay push. Every voter edit the app saves is written to exactly this
  // path, and `pushEdits()` swallows failures by design (the entry stays queued
  // and retries), so a rules mistake here does not look like an error — it
  // looks like "my edits never reach my other phone".
  const karykarta = await loginAs('ganpat@ward5.com');
  editPath = `users/${karykarta.uid}/voterEdits/__probe_${stamp}`;
  report(
    'karykarta pushes an edit overlay',
    'allow',
    await send(
      'PATCH',
      editPath,
      {
        wardNo: 5,
        updatedAt: Date.now(),
        updatedBy: karykarta.uid,
        name: 'Rules probe',
        phone: '+919999999999',
        voted: 'voted',
        leaning: 'center',
        age: 42,
        location: { lat: 28.6, lng: 77.2 },
      },
      karykarta.token
    )
  );
  report(
    'karykarta CANNOT push into another account',
    'deny',
    await send(
      'PATCH',
      `users/${uid}/voterEdits/__probe_${stamp}`,
      { wardNo: 5, updatedAt: Date.now(), updatedBy: uid },
      karykarta.token
    )
  );
  // The political-field ban is on the WRITE rule, not a validate, so it has to
  // be asserted as a write that must fail rather than a shape that must.
  report(
    'karykarta CANNOT push a `party` field',
    'deny',
    await send('PATCH', editPath, { party: 'probe' }, karykarta.token)
  );

  console.log(
    problems.length
      ? `\n${problems.length} PROBLEM(S):\n  - ${problems.join('\n  - ')}`
      : '\nAll probes behaved as intended.'
  );
} finally {
  // Cleanup runs on success and failure alike.
  if (editPath) {
    await adminDb.ref(editPath).remove().catch(() => undefined);
  }
  if (phonePath) {
    await adminDb.ref(phonePath).remove().catch(() => undefined);
  }
  if (uid) {
    await adminDb.ref(`users/${uid}`).remove().catch(() => undefined);
    await auth.deleteUser(uid).catch(() => undefined);
    console.log('cleaned up the throwaway account');
  }
}

// The Admin SDK keeps a database socket open, which would otherwise hold the
// event loop for the full shell timeout after the results are already printed.
process.exit(problems.length ? 1 : 0);
