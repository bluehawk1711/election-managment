/**
 * A durable cache for Firestore *query* results — everything `useCollection`
 * reads: the campaign profile, the geography, the booths, the roster, and the
 * task/issue/event/expense lists.
 *
 * ## Why not just let Firestore do it
 *
 * `initializeFirestore` is configured with `persistentLocalCache()`, but on
 * React Native that cache is IndexedDB-backed and React Native has no
 * IndexedDB. The JS SDK therefore degrades to a *per-session memory* cache:
 * kill the app on the platform and every one of those collections has to be
 * re-downloaded. In practice that is six `Listen` streams — campaign, wards,
 * areas, booths, constituencies, team — plus the per-screen lists, all of
 * which report `loading: true` until they land. So the app opens on skeletons
 * every single time, on whatever connection the karykarta happens to have.
 *
 * ## Why a memory mirror, not just AsyncStorage
 *
 * AsyncStorage is async, and an async read is exactly what produces the
 * loading flash we are trying to remove. So there are two layers:
 *
 *   - **memory** (`Map`) — read *synchronously* by `useCollection`'s state
 *     initialiser, so a warm cache renders on the very first frame with
 *     `loading: false` and no await anywhere in the render path;
 *   - **AsyncStorage** — survives the process being killed, and is drained
 *     into memory by `prewarm()`.
 *
 * `prewarm()` is called once from the app root, before sign-in, so by the time
 * the user authenticates and `(tabs)` mounts, the reference data is already in
 * memory. That is what lets the first frame after login show real content
 * instead of skeletons: the network fetch is still running, but it is a
 * *refinement*, not a gate.
 *
 * The roll has its own cache in `lib/roll/cache.ts` — per-ward, because a ward
 * is the unit the user navigates by and a single 6,855-row blob would be
 * rewritten on every fetch. Nothing is duplicated between the two modules.
 *
 * The cache is a *hint*, never a source of truth: every read is shape-checked,
 * and anything that fails is dropped rather than served.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase/firestore';

/**
 * Bumped when the stored document shape changes. Old keys are then never read,
 * and the storage is reclaimed as each is rewritten.
 */
const VERSION = 'v1';
const PREFIX = `cache:${VERSION}:`;

const storage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  getAllKeys: () => AsyncStorage.getAllKeys(),
  multiRemove: (keys: string[]) => AsyncStorage.multiRemove(keys),
};

/** One document, flattened to the two things the SDK's mapper ever reads. */
export interface CachedDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface CacheEntry {
  /** When this copy was written — the "as of" the UI can honestly claim. */
  savedAt: number;
  docs: CachedDoc[];
}

/** Collections warmed at startup. Reference data, not user data. */
export const PREWARM_KEYS = [
  'campaigns:active',
  'constituencies',
  'wards',
  'areas',
  'booths',
  'teamMembers',
] as const;

const memory = new Map<string, CacheEntry>();

const storageKey = (name: string): string => `${PREFIX}${name}`;

function isEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<CacheEntry>;
  return (
    Array.isArray(entry.docs) &&
    typeof entry.savedAt === 'number' &&
    entry.docs.every((doc) => typeof doc?.id === 'string')
  );
}

/**
 * The cached copy of a query, or `null`. **Synchronous** — this is the whole
 * point of the module, and it is only ever safe because `prewarm()` has
 * already drained AsyncStorage by the time anything reads it.
 */
export function peek(name: string): CacheEntry | null {
  return memory.get(name) ?? null;
}

/** True when `name` has a copy, whether or not it is empty. */
export function isWarm(name: string): boolean {
  return memory.has(name);
}

/**
 * Pulls persisted copies into memory. Safe to call more than once — the second
 * call is a no-op for anything already resident.
 *
 * Returns the same promise on every concurrent call so a burst of `prewarm()`
 * from several mounts cannot read AsyncStorage twice.
 */
let inFlight: Promise<void> | null = null;
export function prewarm(names: readonly string[] = PREWARM_KEYS): Promise<void> {
  inFlight ??= (async () => {
    await Promise.all(
      names.map(async (name) => {
        if (memory.has(name)) return;
        let raw: string | null;
        try {
          raw = await storage.getItem(storageKey(name));
        } catch {
          // A storage read can fail on a full disk or during a Keychain
          // unlock. A cache miss is always recoverable; the network path that
          // follows is not blocked by throwing here.
          return;
        }
        if (!raw) return;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (isEntry(parsed)) {
            memory.set(name, parsed);
          } else {
            void storage.removeItem(storageKey(name));
          }
        } catch {
          // Truncated blob (killed mid-write) — drop it and re-fetch.
          void storage.removeItem(storageKey(name));
        }
      })
    );
  })();
  return inFlight;
}

/**
 * Serialises persistence writes.
 *
 * `save` is fire-and-forget by design, but that made `clearAll` racy: a write
 * started a tick earlier can land *after* the clear has read the key list, and
 * the entry survives a clear the user was told had succeeded — a stale
 * reference dataset that quietly reappears on the next launch. Chaining every
 * write lets `clearAll` wait for what is already in flight, both before and
 * after it removes the keys.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function trackWrite(promise: Promise<unknown>): void {
  writeChain = writeChain.then(() => promise).catch(() => {});
}

/**
 * Records the server's answer for a query and persists it.
 *
 * Memory is updated first and synchronously, so a screen that remounts in the
 * same tick already sees the fresh rows. The AsyncStorage write is fire and
 * forget: a failed write costs a slower cold start next time, never a wrong
 * screen.
 */
export function save(name: string, docs: CachedDoc[]): void {
  const entry: CacheEntry = { savedAt: Date.now(), docs };
  memory.set(name, entry);
  trackWrite(storage.setItem(storageKey(name), JSON.stringify(entry)).catch(() => {}));
}

/** When this query's copy was written, or `null` if never cached. */
export function savedAt(name: string): number | null {
  return memory.get(name)?.savedAt ?? null;
}

/**
 * Rehydrates a cached document into the minimum surface the mappers touch.
 *
 * The mappers in `lib/mappers.ts` read `doc.id` and `doc.data()` and nothing
 * else — no `metadata()`, no `ref`. Rebuilding just that much is what lets this
 * module store *raw* document data rather than each mapper's output, so
 * changing a mapper does not require a cache version bump: the new mapper
 * simply runs over the same stored bytes.
 */
export function snapshotFrom(
  doc: CachedDoc
): QueryDocumentSnapshot<DocumentData> {
  return {
    id: doc.id,
    exists: () => true,
    data: () => doc.data,
  } as unknown as QueryDocumentSnapshot<DocumentData>;
}

/** Drops every cached query. Settings → "clear cached data".
 *
 * Only `cache:*` keys are touched. The downloaded roll (`roll:cache:*`) and
 * the user-edited overlay plus its sync queue (`roll:overlay:*`, `roll:queue`)
 * are untouched — clearing downloaded reference data must never discard
 * fieldwork.
 */
export async function clearAll(): Promise<void> {
  memory.clear();
  // Wait out writes already in flight, or one can land after the removal below
  // and resurrect the entry the user just asked us to drop.
  await writeChain.catch(() => {});
  try {
    const keys = await storage.getAllKeys();
    const ours = keys.filter((key) => key.startsWith('cache:'));
    if (ours.length) await storage.multiRemove(ours);
  } catch {
    // A failed clear leaves a stale cache, which the next refetch overwrites.
  }
  // Anything that started while we were removing keys.
  await writeChain.catch(() => {});
  // `inFlight` resolved against keys that are now gone; allow a fresh warm-up.
  inFlight = null;
}