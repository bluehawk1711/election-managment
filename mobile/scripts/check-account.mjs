import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const dotEnv = { ...readEnvFile(path.join(ROOT, '.env')), ...readEnvFile(path.join(ROOT, '.env.local')) };
const email = process.argv[2];
const password = process.argv[3];
if (!email) {
  console.error('usage: node scripts/check-account.mjs <email> [password]');
  process.exit(1);
}

const projectId =
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
  dotEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
  JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects?.default;

const app = initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth(app);
const rtdb = getDatabaseWithUrl(
  process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ||
    dotEnv.EXPO_PUBLIC_FIREBASE_DATABASE_URL ||
    `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
  app
);

const user = await auth.getUserByEmail(email);
console.log('Auth  :', { uid: user.uid, email: user.email, verified: user.emailVerified, disabled: user.disabled });
// The rules read this, not the profile — print both so a UI/authority split
// (right profile, wrong token) is visible in one glance.
console.log('Claims:', JSON.stringify(user.customClaims ?? {}));

const snapshot = await rtdb.ref(`users/${user.uid}`).once('value');
console.log(
  'Profile:',
  snapshot.exists()
    ? JSON.stringify(snapshot.val())
    : 'MISSING — the app will show the no-role empty state'
);

const key = dotEnv.EXPO_PUBLIC_FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '';
if (!/^AIza[0-9A-Za-z_-]{10,}$/.test(key)) {
  console.log('Password check skipped: no usable web API key in .env');
} else {
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + key, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  console.log('Password:', res.ok ? 'ACCEPTED' : 'REJECTED ' + JSON.stringify(body.error?.message ?? body));
}

// The Admin SDK keeps a database socket open, which would otherwise hold the
// event loop after the results are already printed.
process.exit(0);