/**
 * One Admin SDK app for the whole server, credentialed from ENV VARS — never
 * from a `service-account.json` file. Next.js loads `admin/.env.local` into
 * `process.env` for every route handler automatically, so `next dev` needs no
 * extra wiring:
 *
 *   FIREBASE_ADMIN_PROJECT_ID      your Firebase project id
 *   FIREBASE_ADMIN_CLIENT_EMAIL    the service account's client email
 *   FIREBASE_ADMIN_PRIVATE_KEY     the private key, with `\n` escapes intact
 *                                  (`.env.local` cannot hold real newlines,
 *                                  and dotenv does NOT convert them — we do,
 *                                  below)
 *   FIREBASE_ADMIN_DATABASE_URL    the Realtime Database URL — required,
 *                                  because this project's database is
 *                                  REGIONAL (see below)
 *
 * The first three are exactly the fields of a service-account JSON key;
 * generate them once from Firebase console → Service accounts → Generate new
 * private key and split the file into the three values. `admin/.env.local` is
 * gitignored (twice over: `admin/.gitignore` has `.env*`, and the repo root
 * ignores every `.env.*` at any depth), same protection the JSON file used to
 * have — and unlike a file path, the values can never be shipped in a client
 * bundle (this module is imported only from route handlers, which run in Node
 * on the server).
 *
 * ## Why the database URL is mandatory here
 *
 * The Admin SDK's `getDatabase(app)` with no URL assumes the legacy
 * `https://<project>-default-rtdb.firebaseio.com` host. This project was
 * provisioned as ENTERPRISE with an explicitly named, REGIONAL database
 * (`…-default-rtdb.asia-southeast1.firebasedatabase.app`), so the default
 * host answers `404 Not Found` — with no hint that the fix is a URL, which
 * is exactly the trap the client SDK already documents in `lib/firebase.ts`.
 * Passing it in explicitly removes the guesswork; it is the SAME value as
 * `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, split into a server-side name so this
 * module never reaches into `NEXT_PUBLIC_*` (which exists for the browser).
 */
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabaseWithUrl } from 'firebase-admin/database';

/** Missing vars collected at once — one clear error beats three round trips. */
function requiredEnv(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  databaseURL: string;
} {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? '';
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL ?? '';
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '')
    // dotenv leaves `\n` literal; PEM parsing needs real newlines. Idempotent,
    // so a value that already contains real newlines passes through fine.
    .replace(/\\n/g, '\n');
  const databaseURL = process.env.FIREBASE_ADMIN_DATABASE_URL ?? '';

  const missing = [
    !projectId && 'FIREBASE_ADMIN_PROJECT_ID',
    !clientEmail && 'FIREBASE_ADMIN_CLIENT_EMAIL',
    !privateKey && 'FIREBASE_ADMIN_PRIVATE_KEY',
    !databaseURL && 'FIREBASE_ADMIN_DATABASE_URL',
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `Missing Admin SDK credentials: ${missing.join(', ')}. ` +
        'Set them in admin/.env.local (see the header of lib/admin-firebase.ts).'
    );
  }
  return { projectId, clientEmail, privateKey, databaseURL };
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

/**
 * The Realtime Database handle, with the URL that makes it resolve at all
 * (see the header). Only the local-dev seed route needs it — every other
 * server route is Auth-only.
 */
export function adminDatabase() {
  const { databaseURL } = requiredEnv();
  // `getDatabaseWithUrl` rather than `getDatabase(app, url)`: the admin SDK's
  // `getDatabase` takes the app ALONE and guesses the legacy host, and this
  // database is regional — the URL form is the only one that takes it.
  return getDatabaseWithUrl(databaseURL, adminApp());
}
