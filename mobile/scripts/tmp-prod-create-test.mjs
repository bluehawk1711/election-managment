/** Temporary production end-to-end account-creation test. Delete after use. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';

const API_KEY = process.env.FIREBASE_API_KEY;
if (!API_KEY) throw new Error('FIREBASE_API_KEY is required.');

const PROJECT = 'election-managment';
const DB_URL = `https://${PROJECT}-default-rtdb.asia-southeast1.firebasedatabase.app`;
const CLAIMS_ROUTE = 'https://election-managment.vercel.app/api/account/claims';
const sa = JSON.parse(
  readFileSync(new URL('../service-account.json', import.meta.url), 'utf8')
);
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const auth = getAuth(app);
const db = getDatabaseWithUrl(DB_URL, app);

const stamp = Date.now();
const SUPER_EMAIL = `prod-create-super-${stamp}@example.com`;
const TARGET_EMAIL = `prod-create-target-${stamp}@example.com`;
const SUPER_PASSWORD = `Spr-${stamp}!aA1`;
const TARGET_PASSWORD = `Tgt-${stamp}!aA1`;
const NOW = Date.now();

async function upsert(email, password, displayName) {
  try {
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password, displayName });
    return user;
  } catch (caught) {
    if (caught.code !== 'auth/user-not-found') throw caught;
    return auth.createUser({ email, password, displayName });
  }
}

async function signIn(email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await response.json();
  if (!response.ok || !data.idToken) {
    throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function signUp(email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await response.json();
  if (!response.ok || !data.localId) {
    throw new Error(`Sign-up failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function restWrite(method, path, token, value) {
  const response = await fetch(
    `${DB_URL}/${path}.json?auth=${encodeURIComponent(token)}`,
    {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    }
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`RTDB ${method} ${path} failed: ${response.status} ${body}`);
  }
  return body;
}

let superUser = null;
let targetUid = null;

try {
  superUser = await upsert(SUPER_EMAIL, SUPER_PASSWORD, 'Prod Create Super');
  await auth.setCustomUserClaims(superUser.uid, { role: 'superAdmin' });
  const superSession = await signIn(SUPER_EMAIL, SUPER_PASSWORD);

  // 1. Auth signup (the client's secondary-app step).
  const targetSession = await signUp(TARGET_EMAIL, TARGET_PASSWORD);
  targetUid = targetSession.localId;

  // 2. Profile write under the deployed rules, using PATCH = RTDB update().
  await restWrite('PATCH', `users/${targetUid}`, superSession.idToken, {
    email: TARGET_EMAIL,
    displayName: 'Prod Create Target',
    photoURL: null,
    onboarded: true,
    role: 'karykarta',
    wardNo: 9,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // 3. Vault write under the deployed accountSecrets rules.
  await restWrite('PUT', `accountSecrets/${targetUid}`, superSession.idToken, {
    uid: targetUid,
    email: TARGET_EMAIL,
    password: createHash('sha256')
      .update(`${TARGET_PASSWORD}::campaign-hq-vault::2026`)
      .digest('hex'),
    updatedAt: NOW,
    updatedBy: superUser.uid,
  });

  // 4. Claims publish through the production route.
  const response = await fetch(CLAIMS_ROUTE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${superSession.idToken}`,
      'x-request-id': `prod-create-${stamp}`,
    },
    body: JSON.stringify({
      uid: targetUid,
      operation: 'create-account',
    }),
  });
  const body = await response.text();
  console.log('claims-status', response.status);
  console.log('claims-body', body);
  if (response.status !== 200) throw new Error('Claims publish failed.');

  // 5. The new account signs in with its claims.
  const targetLogin = await signIn(TARGET_EMAIL, TARGET_PASSWORD);
  const payload = JSON.parse(
    Buffer.from(targetLogin.idToken.split('.')[1], 'base64url').toString()
  );
  console.log(
    'new-account-token-claims',
    JSON.stringify({ role: payload.role, wardNo: payload.wardNo })
  );
  if (payload.role !== 'karykarta' || payload.wardNo !== 9) {
    throw new Error('New account token does not carry the expected claims.');
  }

  const profile = (await db.ref(`users/${targetUid}`).once('value')).val();
  const vault = (await db.ref(`accountSecrets/${targetUid}`).once('value')).val();
  console.log(
    'profile-and-vault',
    JSON.stringify({ profileRole: profile?.role, hasVault: Boolean(vault) })
  );
} finally {
  if (targetUid) {
    await db.ref(`users/${targetUid}`).remove().catch(() => undefined);
    await db.ref(`accountSecrets/${targetUid}`).remove().catch(() => undefined);
    await auth.deleteUser(targetUid).catch(() => undefined);
  }
  if (superUser) {
    await db.ref(`users/${superUser.uid}`).remove().catch(() => undefined);
    await auth.deleteUser(superUser.uid).catch(() => undefined);
  }
}

process.exit(process.exitCode ?? 0);
