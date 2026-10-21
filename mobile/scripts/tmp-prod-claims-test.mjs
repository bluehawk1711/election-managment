/** Temporary production verification for POST /api/account/claims. Delete after use. */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';

const API_KEY = process.env.FIREBASE_API_KEY;
if (!API_KEY) throw new Error('FIREBASE_API_KEY is required.');

const DB_URL =
  'https://election-managment-default-rtdb.asia-southeast1.firebasedatabase.app';
const ROUTE = 'https://election-managment.vercel.app/api/account/claims';
const sa = JSON.parse(
  readFileSync(new URL('../service-account.json', import.meta.url), 'utf8')
);
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const db = getDatabaseWithUrl(DB_URL, app);

const stamp = Date.now();
const SUPER_EMAIL = `prod-claims-super-${stamp}@example.com`;
const TARGET_EMAIL = `prod-claims-target-${stamp}@example.com`;
const PASSWORD = `Prd-${stamp}!aA1`;

async function upsert(email, displayName) {
  try {
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password: PASSWORD, displayName });
    return user;
  } catch (caught) {
    if (caught.code !== 'auth/user-not-found') throw caught;
    return auth.createUser({ email, password: PASSWORD, displayName });
  }
}

async function signIn(email) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }
  );
  const data = await response.json();
  if (!response.ok || !data.idToken) {
    throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data;
}

let superUser = null;
let targetUser = null;

try {
  superUser = await upsert(SUPER_EMAIL, 'Prod Claims Super');
  await auth.setCustomUserClaims(superUser.uid, { role: 'superAdmin' });

  targetUser = await upsert(TARGET_EMAIL, 'Prod Claims Target');
  await db.ref(`users/${targetUser.uid}`).set({
    email: TARGET_EMAIL,
    displayName: 'Prod Claims Target',
    onboarded: true,
    role: 'karykarta',
    wardNo: 7,
    createdAt: stamp,
    updatedAt: stamp,
  });

  const session = await signIn(SUPER_EMAIL);
  const response = await fetch(ROUTE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.idToken}`,
      'x-request-id': `prod-debug-${stamp}`,
    },
    body: JSON.stringify({
      uid: targetUser.uid,
      operation: 'prod-debug-test',
    }),
  });
  const body = await response.text();
  console.log('route-status', response.status);
  console.log('route-body', body);
  console.log('route-request-id', response.headers.get('x-request-id'));
  if (response.status !== 200) {
    process.exitCode = 1;
  } else {
    const targetSession = await signIn(TARGET_EMAIL);
    const payload = JSON.parse(
      Buffer.from(targetSession.idToken.split('.')[1], 'base64url').toString()
    );
    console.log(
      'target-token-claims',
      JSON.stringify({ role: payload.role, wardNo: payload.wardNo })
    );
    if (payload.role !== 'karykarta' || payload.wardNo !== 7) {
      process.exitCode = 1;
    }
  }
} finally {
  if (targetUser) {
    await db.ref(`users/${targetUser.uid}`).remove().catch(() => undefined);
    await auth.deleteUser(targetUser.uid).catch(() => undefined);
  }
  if (superUser) {
    await db.ref(`users/${superUser.uid}`).remove().catch(() => undefined);
    await auth.deleteUser(superUser.uid).catch(() => undefined);
  }
}

process.exit(process.exitCode ?? 0);
