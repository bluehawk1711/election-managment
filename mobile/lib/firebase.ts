import Constants from 'expo-constants';
import {
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
  type Persistence,
  type ReactNativeAsyncStorage,
} from 'firebase/auth';
import {
  connectDatabaseEmulator,
  getDatabase,
  type Database,
} from 'firebase/database';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { Platform } from 'react-native';
import { LargeSecureStore } from '@/lib/large-secure-store';

/**
 * The Firebase client.
 *
 * Everything imports through a subpath (`firebase/app`, `firebase/auth`,
 * `firebase/database`, `firebase/storage`) rather than the `firebase` root,
 * which re-exports every product Firebase ships. `firebase/firestore` is
 * deliberately absent — see the note where `db` used to be.
 *
 * There is no `metro.config.js` in this project and it does not need one. The
 * `sourceExts.push('cjs')` and `unstable_enablePackageExports = true` advice
 * you will find in older Firebase + Expo threads describes defaults that Expo
 * SDK 57 and Metro 0.84 already set.
 *
 * There is also no `AppState` listener refreshing tokens. A Supabase project
 * needs one because supabase-js refreshes on a JS timer that iOS suspends in
 * the background; Firebase refreshes proactively and again lazily inside
 * `getIdToken()`, and the Realtime Database and Storage both pull their token
 * through this same `Auth` instance. Nothing to wire up.
 */

/**
 * The Firestore database id is `default`, NOT `(default)` — kept here only as
 * the reference the seeding scripts point at.
 *
 * The app no longer opens Firestore (see the note where `db` used to be), but
 * `scripts/seed.mjs`, `seed-roll.mjs`, `verify-roll.mjs` and `create-user.mjs`
 * still write with the Admin SDK, and each carries its own copy of this string
 * with a comment saying it must match this one.
 *
 * Why it matters, because it is easy to "fix" in the wrong direction later.
 * This project was provisioned as ENTERPRISE with an explicitly named database
 * — `firebase.json` records it as `{"database": "default", "edition":
 * "ENTERPRISE"}` — and every read against `(default)` comes back
 * `5 NOT_FOUND: no such database` while the console shows empty collections:
 *
 *     admin.getFirestore(app, 'default')          → 200
 *     admin.getFirestore(app, '(default)')        → 404 NOT_FOUND
 *     GET /v1/projects/P/databases/default/documents/voters          → 200
 *     GET /v1/projects/P/databases/(default)/documents/voters        → 404
 *
 * The parentheses are the detail that is easy to get wrong.
 */
export const FIRESTORE_DATABASE_ID = 'default';

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  /**
   * The Realtime Database's URL, NOT an id — this is the one entry in
   * `FirebaseOptions` that names a *host*, and it is why RTDB cannot reuse
   * `FIRESTORE_DATABASE_ID` below.
   *
   * `getDatabase(app, 'default')` does not mean "the database called default".
   * The second argument is parsed as a URL, `'default'` has no host, and
   * `parseRepoInfo` calls `fatal('Cannot parse Firebase url. Please use
   * https://<YOUR FIREBASE>.firebaseio.com')` — at module import time, before
   * a single screen renders. `getDatabase(app)` with this key absent is no
   * better: the SDK cannot guess the host and throws "Unable to determine the
   * default Firebase database URL".
   *
   * The id `default` that Firestore needs is the id of the Firestore
   * *database resource* in `firebase.json`; the RTDB host is a separate
   * instance with its own name, normally `<project>-default-rtdb.firebaseio.com`.
   */
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error(
    'Missing Firebase environment variables. Copy .env.example to .env.local ' +
      'and fill in the seven EXPO_PUBLIC_FIREBASE_* values from Project settings ' +
      '→ General → Your apps → SDK setup and configuration. ' +
      'EXPO_PUBLIC_FIREBASE_DATABASE_URL is the Realtime Database host and is ' +
      'checked lazily by realtime() rather than here — see the note below.'
  );
}

/**
 * `getReactNativePersistence`, fetched off the namespace rather than imported.
 *
 * It exists in `@firebase/auth`'s React Native build and only there. Metro
 * picks that build on ios and android — the package's `exports` map has a
 * `react-native` condition and @expo/metro-config turns it on for those
 * platforms — but TypeScript resolves the `types` condition, which is listed
 * first and points at the browser build. So the symbol is real at runtime and
 * invisible to the compiler, and the obvious
 *
 *     import { getReactNativePersistence } from 'firebase/auth';
 *
 * does not compile. Verified against firebase@12.17.0 / @firebase/auth@1.13.4.
 *
 * A typed lookup keeps this file compiling on every platform and turns the
 * missing case into the explicit error below instead of a crash at first
 * sign-in.
 */
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence?: (
      storage: ReactNativeAsyncStorage
    ) => Persistence;
  }
).getReactNativePersistence;

/**
 * Fast Refresh re-executes this module whenever it is edited, and every
 * initializer here throws on a second call — `initializeApp` with
 * `app/duplicate-app`, `initializeAuth` with `auth/already-initialized`,
 * `initializeFirestore` with "settings can no longer be changed". Deriving
 * everything from one `existing` binding means a single condition covers all
 * three.
 */
const existing = getApps()[0];
const app: FirebaseApp = existing ?? initializeApp(firebaseConfig);

function createAuth(instance: FirebaseApp): Auth {
  if (Platform.OS === 'web') {
    // An array: the first persistence the browser supports wins, and the SDK
    // migrates an existing account out of the fallback into the primary.
    // Note this installs no popupRedirectResolver — if you swap the web OAuth
    // path to `signInWithPopup`, pass `browserPopupRedirectResolver` here too.
    return initializeAuth(instance, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  }

  if (!getReactNativePersistence) {
    // Throwing rather than falling through is deliberate. The silent fallback
    // is in-memory persistence, which signs every user out on relaunch — a bug
    // that looks like "sessions randomly expire" and takes a day to trace.
    throw new Error(
      'firebase/auth did not expose getReactNativePersistence on this platform. ' +
        'Auth would fall back to in-memory persistence and sign the user out on ' +
        'every relaunch, so this fails loudly instead. Check that the installed ' +
        'firebase version still ships a React Native build.'
    );
  }

  return initializeAuth(instance, {
    // Firebase writes one JSON blob per user here — uid, providerData,
    // and stsTokenManager with both tokens. A bare email/password account is
    // around 1.5 KB and a Google account with a long photoURL goes past
    // SecureStore's 2048-byte ceiling, which is exactly what LargeSecureStore
    // exists to solve. Its interface already matches ReactNativeAsyncStorage,
    // so no adapter is needed.
    persistence: getReactNativePersistence(new LargeSecureStore()),
  });
}

// `getAuth(app)` on the `existing` branch is safe precisely because `existing`
// implies this module already ran `initializeAuth` — it returns that instance
// rather than creating a memory-persisted one.
export const auth = existing ? getAuth(app) : createAuth(app);

// There is deliberately no `db` export any more. Firestore is not part of the
// app: `lib/db` is the data layer, and it talks to the Realtime Database. Any
// screen still importing `db` from here is a port that was missed, and it
// should fail to compile rather than quietly keep reading the old backend —
// that is exactly how the "we migrated but the quota still ran out" state
// happened once. `firebase/firestore` is therefore absent from
// `package.json`'s runtime imports, so it is not in the bundle.

// Idempotent per bucket, so unlike the two above it needs no guard.
export const storage = getStorage(app);

/**
 * The Realtime Database handle, created on first use.
 *
 * **Lazy on purpose.** `getDatabase` throws when the URL is missing or
 * unparseable, and this module is imported by every screen. Eagerly building
 * the instance would turn one unset env var into "the app crashes at launch
 * and shows nothing". That is not hypothetical: the release workflows used to
 * write `.env` without `EXPO_PUBLIC_FIREBASE_DATABASE_URL`, so the first
 * database operation threw while the rest of the app looked fine — which reads
 * exactly like "logged in, then broken". Deferring it means the failure names
 * itself instead of taking the whole app down.
 *
 * `getDatabase` is itself memoised per app instance, so calling this once per
 * operation is free — and it is what makes Fast Refresh safe here, matching
 * the `existing` guard at the top of the file.
 */
let database: Database | null = null;

export function realtime(): Database {
  if (database) return database;

  const url = firebaseConfig.databaseURL;
  if (!url) {
    throw new Error(
      'EXPO_PUBLIC_FIREBASE_DATABASE_URL is not set. The Realtime Database is ' +
        'reached by host, not by id — copy .env.example to .env and set it to ' +
        'https://<project>-default-rtdb.firebaseio.com (Firebase console → ' +
        'Build → Realtime Database → Create database).'
    );
  }

  database = getDatabase(app, url);
  return database;
}

/**
 * Point everything at `npm run emulators` when EXPO_PUBLIC_FIREBASE_USE_EMULATOR=1.
 *
 * Gated on `!existing` because the `connect*Emulator` helpers throw once the
 * instance has issued its first request, which a Fast Refresh re-run would hit.
 */
if (!existing && process.env.EXPO_PUBLIC_FIREBASE_USE_EMULATOR === '1') {
  // `localhost` means the phone itself on a real device, so the emulator would
  // be unreachable. Expo already knows the dev server's LAN address — reuse it.
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';

  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(realtime(), host, 9000);
  connectStorageEmulator(storage, host, 9199);

  console.log(`[firebase] using emulators at ${host}`);
}

export { app };
