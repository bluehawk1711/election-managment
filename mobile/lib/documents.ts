/**
 * The Firestore snapshot → plain object boundary.
 *
 * `import type` only, so nothing here reaches `firebase/*` at runtime. That is
 * what lets `__tests__/documents.test.ts` run with no mocks, no emulator and no
 * environment variables — and it is why the Timestamp check below is
 * structural rather than `instanceof Timestamp`, which is unreliable the moment
 * two copies of the SDK end up in a bundle.
 *
 * This module exists where a Supabase project would have `lib/realtime.ts`.
 * There is no `applyChange` equivalent: `onSnapshot` hands back the entire
 * ordered result set on every change, so folding `docChanges()` into a local
 * array by hand would redo work the SDK just did. `docChanges()` is for
 * animating a diff, not for staying correct.
 *
 * The one runtime import is `lib/roles.ts`, which is itself pure — no
 * Firebase, no React — so the no-mock property of the tests here is kept.
 */
import { toAppRole, type AppRole } from '@/lib/roles';
import type { DbDoc, DbSnapshot } from '@/lib/db/types';

export interface Task {
  id: string;
  text: string;
  isComplete: boolean;
  /** Milliseconds since the epoch, or null while the server timestamp is pending. */
  createdAt: number | null;
  /** True while this device's write has not been acknowledged by the server. */
  pending: boolean;
  /** Lowercased words from `text`. Firestore has no `ilike`. */
  searchTokens: string[];
  /** The uid that owns this task. firestore.rules checks it on every operation. */
  ownerId: string;
}

export interface Profile {
  id: string;
  email: string | null;
  displayName: string | null;
  /** `photoURL`, matching the Firebase `User` field it is kept in step with. */
  photoURL: string | null;
  onboarded: boolean;
  /**
   * Account role (plan-voters.md §5). `null` when the document predates the
   * role field or a super admin has not assigned one yet — which means *no*
   * capabilities, never a default.
   */
  role: AppRole | null;
  /** Ward a karykarta is assigned to; `null` for unrestricted roles. */
  wardNo: number | null;
  /**
   * The install this account is bound to — the per-device lock's record of
   * "the" device. `null` before the first launch and after a super-admin
   * unlock, which clears the binding on purpose so the next sign-in re-binds.
   *
   * Written by the auth provider on first sign-in only; firestore.rules
   * refuses every owner-side modification of an existing binding, so a
   * modified client cannot swap it out from under the lock.
   */
  device: { id: string; name: string; platform: string; lastActiveAt: number } | null;
  /**
   * Account lock. Rules AND this into every capability (`isLocked()`), so
   * `true` means zero voter reads, zero campaign writes, zero roster access —
   * while `users/{uid}` itself stays readable so the app can explain why.
   */
  locked: boolean;
  /** `'device_change'` (self-locked by a foreign sign-in) or `'admin'`. */
  lockedReason: 'device_change' | 'admin' | null;
  /** Epoch millis of the lock, or null. */
  lockedAt: number | null;
  /** The super admin who locked it, or `'system'` for a device lock. */
  lockedBy: string | null;
  /**
   * Multi-device exemption (firestore.rules §users `multiDevice` path).
   *
   * `true` means this account is NOT single-device bound: it may sign in from
   * any number of installs and never self-locks on a foreign one — the same
   * behavior the `superAdmin` role gets, but granted per-account by a super
   * admin from the roster. Defaults to `false`, i.e. the normal one-device
   * lock applies.
   */
  multiDevice: boolean;
  /** The super admin/developer uid who granted `multiDevice`, or null. */
  multiDeviceBy: string | null;
  /**
   * Team label (firestore.rules §users `teamId`). Two accounts sharing a
   * non-empty `teamId` may READ each other's voterEdits overlay (field
   * notes, leaning). Empty string / null = no team, shares nothing.
   * Writable only by account managers via the dedicated team-assignment
   * rule path — never self-assigned.
   */
  teamId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

/**
 * Reads a Firestore Timestamp as milliseconds, tolerating the two shapes it is
 * legitimately not one.
 *
 * `serverTimestamp()` resolves to **null** in the local echo of a write — the
 * snapshot the SDK delivers before the server has acknowledged it. That echo is
 * not an edge case, it is every single write, which makes
 * `doc.data().createdAt.toMillis()` a crash on the first task anyone adds.
 */
export function millisOf(value: unknown): number | null {
  if (value == null) return null;

  // The normal case: a Timestamp instance.
  if (typeof value === 'object' && 'toMillis' in value) {
    const { toMillis } = value as { toMillis: unknown };
    if (typeof toMillis === 'function') {
      return (value as { toMillis: () => number }).toMillis();
    }
  }

  // A Timestamp that has been through JSON — from the emulator's REST surface,
  // or a document seeded by a script.
  if (typeof value === 'object' && 'seconds' in value) {
    const { seconds, nanoseconds } = value as {
      seconds: number;
      nanoseconds?: number;
    };
    if (typeof seconds === 'number') {
      return seconds * 1000 + Math.floor((nanoseconds ?? 0) / 1e6);
    }
  }

  if (typeof value === 'number') return value;

  return null;
}

export function taskFromDoc(doc: DbSnapshot): Task {
  const data = doc.data();

  return {
    // Always `doc.id`, never `data().id`. Firestore does not store the document
    // id inside the document, so a stray `id` field would be someone else's.
    id: doc.id,
    text: typeof data.text === 'string' ? data.text : '',
    isComplete: data.isComplete === true,
    createdAt: millisOf(data.createdAt),
    pending: doc.metadata.hasPendingWrites,
    searchTokens: Array.isArray(data.searchTokens) ? data.searchTokens : [],
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : '',
  };
}

/**
 * The whole of the realtime layer.
 *
 * Genuinely this small: the query's `orderBy` already put the documents in
 * order, and the SDK already deduplicated your own writes against the server's
 * echo via latency compensation. There is nothing left to reconcile.
 */
/**
 * A list of tasks, in the order it arrived.
 *
 * Takes the rows rather than a query snapshot: `lib/db`'s `getDocs`/`onDocs`
 * already return a mapped, ordered array, so there is no `.docs` to unwrap and
 * nothing to reconcile — see the note below.
 */
export function tasksFromSnapshot(docs: readonly DbSnapshot[]): Task[] {
  return docs.map(taskFromDoc);
}

/**
 * `users/{uid}` → Profile, or null when the document does not exist yet.
 *
 * Null means "not created yet", never "not onboarded". There is no Cloud
 * Function creating this document — the provider writes it on first sight —
 * so between sign-up and that write there is a real window where a signed-in
 * user has no profile. Treating that as `onboarded: false` would flash the
 * onboarding flow at a returning user on a slow connection.
 */
export function profileFromDoc(snapshot: DbDoc): Profile | null {
  if (!snapshot.exists()) return null;

  const data = snapshot.data();

  return {
    id: snapshot.id,
    email: typeof data.email === 'string' ? data.email : null,
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    onboarded: data.onboarded === true,
    role: toAppRole(data.role),
    wardNo: typeof data.wardNo === 'number' ? data.wardNo : null,
    device: parseDevice(data.device),
    locked: data.locked === true,
    lockedReason:
      data.lockedReason === 'device_change' || data.lockedReason === 'admin'
        ? data.lockedReason
        : null,
    lockedAt: typeof data.lockedAt === 'number' ? data.lockedAt : null,
    lockedBy: typeof data.lockedBy === 'string' ? data.lockedBy : null,
    multiDevice: data.multiDevice === true,
    multiDeviceBy: typeof data.multiDeviceBy === 'string' ? data.multiDeviceBy : null,
    teamId: typeof data.teamId === 'string' && data.teamId !== '' ? data.teamId : null,
    createdAt: millisOf(data.createdAt),
    updatedAt: millisOf(data.updatedAt),
  };
}

/**
 * Defensive read of the bound-device map — untrusted data with a closed
 * key set, exactly like `enumOf`'s job for enums: anything malformed reads as
 * "no device", which lands on the first-bind path instead of crashing the
 * provider that decides whether to sign the user out.
 */
function parseDevice(
  value: unknown
): { id: string; name: string; platform: string; lastActiveAt: number } | null {
  if (!value || typeof value !== 'object') return null;
  const map = value as Record<string, unknown>;
  if (typeof map.id !== 'string' || !map.id) return null;
  return {
    id: map.id,
    name: typeof map.name === 'string' ? map.name : '',
    platform: typeof map.platform === 'string' ? map.platform : '',
    lastActiveAt: typeof map.lastActiveAt === 'number' ? map.lastActiveAt : 0,
  };
}

/**
 * Newest first, with pending writes at the very top.
 *
 * A task whose `createdAt` is still null is one this device just created, so it
 * is by definition the newest thing that happened — showing it last, or
 * dropping it to wherever a null sorts, makes the app look like it ignored you.
 */
export const byNewest = (a: Task, b: Task): number => {
  if (a.createdAt === b.createdAt) return 0;
  if (a.createdAt === null) return -1;
  if (b.createdAt === null) return 1;
  return b.createdAt - a.createdAt;
};

const MAX_TOKENS = 20;

/**
 * Splits text into the tokens the search screen queries with.
 *
 * Firestore has no `LIKE`, no substring matching and no full-text index. The
 * standard workaround is to write the searchable words alongside the document
 * and query them with `array-contains`, which is what this produces.
 *
 * The consequence, and it is a real one: this matches whole words only. "migra"
 * will not find "migration" the way Postgres' `ilike '%migra%'` would. When you
 * need real search, put a Typesense, Algolia or Elastic extension in front of
 * the collection — the Firestore docs list the official ones.
 *
 * Capped at MAX_TOKENS because `array-contains` indexes every entry, and
 * firestore.rules rejects a longer array outright.
 */
export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  return Array.from(new Set(words)).slice(0, MAX_TOKENS);
}
