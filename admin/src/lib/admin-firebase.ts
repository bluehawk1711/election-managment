/**
 * One Admin SDK app for the whole server, credentialed from ENV VARS — never
 * from a `service-account.json` file. Next.js loads `admin/.env.local` into
 * `process.env` for every route handler automatically, so `next dev` needs no
 * extra wiring:
 *
 *   FIREBASE_ADMIN_PROJECT_ID    your Firebase project id
 *   FIREBASE_ADMIN_CLIENT_EMAIL  the service account's client email
 *   FIREBASE_ADMIN_PRIVATE_KEY   the private key, with `\n` escapes intact
 *                                (`.env.local` cannot hold real newlines, and
 *                                dotenv does NOT convert them — we do, below)
 *
 * These three are exactly the fields of a service-account JSON key; generate
 * them once from Firebase console → Service accounts → Generate new private
 * key and split the file into the three values. `admin/.env.local` is
 * gitignored (twice over: `admin/.gitignore` has `.env*`, and the repo root
 * ignores every `.env.*` at any depth), same protection the JSON file used to
 * have — and unlike a file path, the values can never be shipped in a client
 * bundle (this module is imported only from route handlers, which run in Node
 * on the server).
 *
 * The same vars are reused by `/api/roll/seed`, which passes them through to
 * `mobile/scripts/seed-roll.mjs` (child process inherits `process.env`).
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/** Missing vars collected at once — one clear error beats three round trips. */
function requiredEnv(): { projectId: string; clientEmail: string; privateKey: string } {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? '';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '';
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '')
    // dotenv leaves `\n` literal; PEM parsing needs real newlines. Idempotent,
    // so a value that already contains real newlines passes through fine.
    .replace(/\\n/g, '\n');

  const missing = [
    !projectId && 'FIREBASE_ADMIN_PROJECT_ID',
    !clientEmail && 'FIREBASE_ADMIN_CLIENT_EMAIL',
    !privateKey && 'FIREBASE_ADMIN_PRIVATE_KEY',
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing Admin SDK credentials: ${missing.join(', ')}. ` +
        'Set them in admin/.env.local (see the header of lib/admin-firebase.ts).'
    );
  }
  return { projectId, clientEmail, privateKey };
}

/** One Admin app per process — `initializeApp` throws on a second call. */
function adminApp() {
  if (getApps().length === 0) {
    const { projectId, clientEmail, privateKey } = requiredEnv();
    initializeApp({ credential: cert({ clientEmail, privateKey, projectId }), projectId });
  }
  return getApps()[0];
}

export function adminAuth() {
  adminApp();
  return getAuth();
}

export function adminDb() {
  adminApp();
  return getFirestore();
}

export function adminDatabase() {
  adminApp();
  return admin.database();
}
