/**
 * The durable copy of the base roll (plan-voters.md §4, and the V7 "cached +
 * refetch in background" requirement).
 *
 * Why this exists at all: `initializeFirestore`'s `persistentLocalCache()` is
 * backed by IndexedDB, which React Native does not implement, so the JS SDK
 * gives us per-session *memory* only. Kill the app on the platform and the roll
 * is gone — which for a 6,855-row collection means re-downloading a few MB on
 * every cold start, on 3G, before a karykarta standing in a lane can look
 * anyone up.
 *
 * AsyncStorage is the durable store that does work on RN. The trade is that
 * AsyncStorage is a key/value blob store, not a query engine, so this file
 * caches *whole* per-ward arrays rather than trying to mirror Firestore's
 * offline engine:
 *
 *   `roll:cache:v1:wards`        → `WardsBundle`
 *   `roll:cache:v1:ward:{n}`     → `{ savedAt: number, voters: RollVoter[] }`
 *
 * One key per ward, not one key for the roll: a ward is the unit the user
 * navigates by, so opening ward 7 only ever pays for ward 7.
 *
 * `voters` for "all wards" (`wardNo === null`) is deliberately NOT cached as a
 * single key — it would be one multi-megabyte JSON blob rewritten on every ward
 * fetch. `readAll` instead stitches the per-ward copies together, and falls
 * back to a network read for any ward it has never cached.
 *
 * The cache is a *hint*, never a source of truth. Every field is treated as
 * untrusted on read: a shape check rejects a corrupt or half-written blob, and
 * anything that fails it is deleted rather than served.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RollVoter, WardsBundle, WardMeta } from '@/lib/roll/types';

/**
 * Bumped when `RollVoter` or `WardsBundle` changes shape.
 *
 * A v1 blob parsed against v2 fields is the kind of thing that shows up as a
 * list of voters with blank names, and nothing in the app would flag it. The
 * prefix makes the invalidation automatic: old keys are simply never read, and
 * the storage is reclaimed on the next successful write of the same kind.
 */
const VERSION = 'v1';
const WARDS_KEY = `roll:cache:${VERSION}:wards`;
const wardKey = (wardNo: number): string => `roll:cache:${VERSION}:ward:${wardNo}`;

/** The storage surface this module needs; AsyncStorage satisfies it. */
export interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: string[]): Promise<void>;
}

export const cacheStorage: CacheStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
  getAllKeys: () => AsyncStorage.getAllKeys(),
  multiRemove: (keys) => AsyncStorage.multiRemove(keys),
};

// ---------------------------------------------------------------------------
// The memory mirror
// ---------------------------------------------------------------------------
//
// AsyncStorage is the durable half, but it is **async**, and an async read is
// precisely what produces the loading flash this layer exists to remove.
// `useRoll` initialises `loading` to `true`, so on a fresh mount the screen
// paints a skeleton, waits a tick for AsyncStorage, and then throws the
// skeleton away and draw the very same rows it already had on disk. Navigating
// away and back re-ran that whole dance every time.
//
// Two layers, then: a `Map` that `useRoll` can read **synchronously** during
// its first render, and AsyncStorage underneath. Same shape as
// `lib/cache/query-cache.ts`, for the same reason.
//
// Deliberately *not* prewarmed for all thirteen wards: that is ~6,855 rows of
// JSON parsed on every cold start, which would cost more than it saves. The
// wards bundle (13 small documents) and the wards actually in use are what get
// pulled forward; the rest load on demand and then stay resident.
const wardMemory = new Map<number, WardCache>();
let wardsMemory: WardsBundle | null = null;

/** The ward bundle held in memory, or `null`. Synchronous. */
export function peekWards(): WardsBundle | null {
  return wardsMemory;
}

/** One ward's rows held in memory, or `null`. Synchronous. */
export function peekWard(wardNo: number): WardCache | null {
  return wardMemory.get(wardNo) ?? null;
}

/** True when this ward can be rendered without touching storage. */
export function isResident(wardNo: number): boolean {
  return wardMemory.has(wardNo);
}

/**
 * Pulls persisted copies into memory ahead of first use.
 *
 * `wardNumbers` is an explicit list rather than "all 13", for the startup cost
 * reason above. Called once from the app root.
 */
export async function prewarm(
  storage: CacheStorage,
  wardNumbers: readonly number[] = []
): Promise<void> {
  await Promise.all([
    readWards(storage),
    ...wardNumbers.map(async (wardNo) => {
      if (wardMemory.has(wardNo)) return;
      await readWard(storage, wardNo);
    }),
  ]);
}

export interface WardCache {
  voters: RollVoter[];
  /** When this copy was written, for the "as of" line in Settings. */
  savedAt: number;
}

/**
 * Whether a value is shaped like `WardMeta`.
 *
 * A cheap structural check, not a validator: it catches `{}`, `null`, a JSON
 * object from an older version, and the `null` that `JSON.parse` returns for a
 * literal `"null"`. Field-level types are not re-checked because `rollVoterFromDoc`
 * already degrades a missing field, and a half-valid array of voters is far
 * better than an empty screen when the cache is the only thing available.
 */
function looksLikeWards(value: unknown): value is WardsBundle {
  if (typeof value !== 'object' || value === null) return false;
  const bundle = value as Partial<WardsBundle>;
  return Array.isArray(bundle.wards) && bundle.wards.length > 0;
}

function looksLikeVoterList(value: unknown): value is RollVoter[] {
  if (!Array.isArray(value)) return false;
  // An empty array is legitimate (a genuinely empty ward) but is also what a
  // failed write leaves behind, so require at least one row to trust it.
  return value.length === 0 || typeof value[0] === 'object';
}

async function readJson<T>(storage: CacheStorage, key: string): Promise<T | null> {
  let raw: string | null;
  try {
    raw = await storage.getItem(key);
  } catch {
    // A storage read can fail on a full disk or during a Keychain unlock. A
    // cache miss is always recoverable; throwing here would block the network
    // path that follows.
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Truncated blob (killed mid-write) — drop it and re-fetch.
    void storage.removeItem(key);
    return null;
  }
}

/** The last-known ward metadata, or `null` if never written or now corrupt. */
export async function readWards(storage: CacheStorage): Promise<WardsBundle | null> {
  if (wardsMemory) return wardsMemory;
  const parsed = await readJson<unknown>(storage, WARDS_KEY);
  if (!looksLikeWards(parsed)) return null;
  wardsMemory = parsed;
  return parsed;
}

/** Writes ward metadata. Failures are swallowed — this is a cache. */
export async function writeWards(storage: CacheStorage, bundle: WardsBundle): Promise<void> {
  if (!looksLikeWards(bundle)) return;
  wardsMemory = bundle;
  try {
    await storage.setItem(WARDS_KEY, JSON.stringify(bundle));
  } catch {
    // Out of quota, typically. The app still works, just without a cold-start
    // cache, so this is not worth surfacing.
  }
}

/**
 * The cached copy of one ward, or `null` on a miss.
 *
 * A ward that legitimately has zero voters is indistinguishable from a miss
 * here, which is why `looksLikeVoterList` accepts an empty array but
 * `readWard` does not: the network path re-reads an empty ward once per session
 * and that costs one small query, not a wrong answer.
 */
export async function readWard(
  storage: CacheStorage,
  wardNo: number
): Promise<WardCache | null> {
  const resident = wardMemory.get(wardNo);
  if (resident) return resident;

  const parsed = await readJson<unknown>(storage, wardKey(wardNo));
  if (typeof parsed !== 'object' || parsed === null) return null;
  const entry = parsed as Partial<WardCache>;
  if (!looksLikeVoterList(entry.voters)) return null;
  if (typeof entry.savedAt !== 'number') return null;
  const cache = { voters: entry.voters, savedAt: entry.savedAt };
  wardMemory.set(wardNo, cache);
  return cache;
}

export async function writeWard(
  storage: CacheStorage,
  wardNo: number,
  voters: RollVoter[]
): Promise<void> {
  if (!looksLikeVoterList(voters)) return;
  const entry: WardCache = { savedAt: Date.now(), voters };
  wardMemory.set(wardNo, entry);
  try {
    await storage.setItem(wardKey(wardNo), JSON.stringify(entry));
  } catch {
    // See `writeWards`. Quota pressure on a ward with 800 Hindi names is the
    // realistic failure, and it is not worth an error path.
  }
}

/**
 * Cached voters for every ward in `wards`, skipping any ward with no copy.
 *
 * Returns a `Map` rather than a flat array precisely so the caller can tell
 * which wards are missing and fetch only those. `wardNo === null` (every ward)
 * uses this; the returned map's `.size` is what tells the caller whether it has
 * a complete picture.
 */
export async function readAll(
  storage: CacheStorage,
  wards: readonly WardMeta[]
): Promise<Map<number, WardCache>> {
  const found = new Map<number, WardCache>();
  await Promise.all(
    wards.map(async (ward) => {
      const entry = await readWard(storage, ward.wardNo);
      if (entry) found.set(ward.wardNo, entry);
    })
  );
  return found;
}

/**
 * Drops every cached key.
 *
 * Settings → "clear cached roll". Note this touches ONLY `roll:cache:*` — the
 * user-edited overlay (`roll:overlay:*`) and the sync queue (`roll:queue`) are
 * untouched, because clearing the downloaded roll must never discard fieldwork.
 */
export async function clearCache(storage: CacheStorage): Promise<void> {
  // Memory first, or the mirror would repopulate from disk on the very next
  // read and the "clear" would appear to do nothing until a restart.
  wardsMemory = null;
  wardMemory.clear();
  try {
    const keys = await storage.getAllKeys();
    const ours = keys.filter((key) => key.startsWith(`roll:cache:`));
    if (ours.length) await storage.multiRemove(ours);
  } catch {
    // Nothing to recover from — a failed clear leaves a stale cache, which the
    // background refetch overwrites anyway.
  }
}

/**
 * Cached timestamps per ward, for the "roll cached at" line in Settings.
 *
 * Reads only the small `savedAt` fields, but the values live in the same blobs
 * as the voters, so this still parses every ward. It exists so Settings does
 * not have to load 6,855 voters to answer "how fresh is this?".
 */
export async function cacheTimestamps(
  storage: CacheStorage,
  wards: readonly WardMeta[]
): Promise<Map<number, number>> {
  const stamps = new Map<number, number>();
  const all = await readAll(storage, wards);
  for (const [wardNo, entry] of all) stamps.set(wardNo, entry.savedAt);
  return stamps;
}

/** The newest `savedAt` across `wards`, or `null` if nothing is cached. */
export async function cacheAge(
  storage: CacheStorage,
  wards: readonly WardMeta[]
): Promise<number | null> {
  const stamps = await cacheTimestamps(storage, wards);
  if (!stamps.size) return null;
  return Math.max(...stamps.values());
}