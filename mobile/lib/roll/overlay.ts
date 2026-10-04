/**
 * The local overlay store (plan-voters.md §4).
 *
 * Every user edit — field corrections, photo, location, voted flag, leaning —
 * lands here, keyed by ward, so the base roll is never written. Sync comes
 * later and will read the queue this file maintains.
 *
 * Storage is injected so the merge/queue logic is unit-testable without
 * AsyncStorage; `overlayStore` is the production instance wired to it.
 *
 * Layout (two AsyncStorage keys per ward, one global queue):
 *   `roll:overlay:{wardNo}`  → `{ [voterId]: VoterOverlay }`
 *   `roll:queue`             → `SyncQueueEntry[]`
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  SyncQueueEntry,
  VoterOverlay,
  VoterPatch,
} from '@/lib/roll/types';

/** The minimal storage surface this module needs (AsyncStorage satisfies it). */
export interface OverlayStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const OVERLAY_PREFIX = 'roll:overlay:';
export const QUEUE_KEY = 'roll:queue';

/** Ward overlays in memory, keyed by ward — read once, written through. */
const cache = new Map<number, Record<string, VoterOverlay>>();
let queue: SyncQueueEntry[] | null = null;
const listeners = new Set<() => void>();

function overlayKey(wardNo: number): string {
  return `${OVERLAY_PREFIX}${wardNo}`;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribes to any change; returns an unsubscribe function. */
export function subscribeOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readJson<T>(storage: OverlayStorage, key: string, fallback: T): Promise<T> {
  const raw = await storage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A half-written key (killed mid-save) must not brick the ward forever.
    return fallback;
  }
}

export async function loadWardOverlay(
  storage: OverlayStorage,
  wardNo: number
): Promise<Record<string, VoterOverlay>> {
  const cached = cache.get(wardNo);
  if (cached) return cached;
  const value = await readJson<Record<string, VoterOverlay>>(
    storage,
    overlayKey(wardNo),
    {}
  );
  cache.set(wardNo, value);
  return value;
}

export async function loadQueue(storage: OverlayStorage): Promise<SyncQueueEntry[]> {
  queue ??= await readJson<SyncQueueEntry[]>(storage, QUEUE_KEY, []);
  return queue;
}

/**
 * Writes a patch onto one voter's overlay and queues it for sync.
 *
 * A patch that reduces to "no change at all" is a no-op: no write, no queue
 * entry. Empty strings mean "clear this field", which is a real edit — only an
 * `undefined` value is ignored, matching how the edit form builds its patch.
 */
export async function patchVoter(
  storage: OverlayStorage,
  args: {
    voterId: string;
    wardNo: number;
    patch: VoterPatch;
    now?: number;
    uid: string;
  }
): Promise<VoterOverlay | null> {
  const { voterId, wardNo, patch, uid } = args;
  const now = args.now ?? Date.now();

  const ward = { ...(await loadWardOverlay(storage, wardNo)) };
  const previous = ward[voterId];
  const incoming = stripUndefined(patch) as Record<string, unknown>;

  // "No change" is decided against the existing overlay: resubmitting the
  // form untouched must not create a queue entry. `undefined` is ignored
  // (the form omits fields it did not touch); an empty string is a real edit.
  const changedKeys = Object.keys(incoming).filter((key) => {
    const before = previous as unknown as Record<string, unknown> | undefined;
    return before?.[key] !== incoming[key];
  });

  if (!changedKeys.length) return previous ?? null;

  const next: VoterOverlay = {
    ...previous,
    ...incoming,
    updatedAt: now,
    updatedBy: uid,
  };
  ward[voterId] = next;
  cache.set(wardNo, ward);
  await storage.setItem(overlayKey(wardNo), JSON.stringify(ward));

  await enqueue(storage, {
    voterId,
    wardNo,
    keys: changedKeys,
    updatedAt: now,
    updatedBy: uid,
  });

  notify();
  return next;
}

/** Location/photo are written through this same path with their own shape. */
export async function putOverlay(
  storage: OverlayStorage,
  args: {
    voterId: string;
    wardNo: number;
    overlay: Partial<VoterOverlay>;
    now?: number;
    uid: string;
  }
): Promise<VoterOverlay> {
  const { voterId, wardNo, overlay, uid } = args;
  const now = args.now ?? Date.now();

  const ward = { ...(await loadWardOverlay(storage, wardNo)) };
  const previous = ward[voterId];
  const incoming = stripUndefined(overlay);

  // "Nothing changed" must be a no-op, exactly as in `patchVoter` above.
  // Without this, tapping the already-selected Voted/Leaning/Support chip on
  // the detail screen re-wrote the overlay and pushed a queue entry for keys
  // that had not moved — which is why the "pending sync" badge could appear
  // on a voter the user believed they had never edited. Shallow compare is
  // deliberate: primitives (`voted`, `leaning`, photo URLs) are caught by
  // value; a freshly-captured `location`/`photo` object is a new reference and
  // counts as a change, which is also what the user intended by tapping it.
  const changedKeys = Object.keys(incoming).filter((key) => {
    const before = previous as unknown as Record<string, unknown> | undefined;
    return before?.[key] !== (incoming as Record<string, unknown>)[key];
  });
  if (!changedKeys.length) return previous ?? null;

  const next: VoterOverlay = {
    ...previous,
    ...incoming,
    updatedAt: now,
    updatedBy: uid,
  };
  ward[voterId] = next;
  cache.set(wardNo, ward);
  await storage.setItem(overlayKey(wardNo), JSON.stringify(ward));

  await enqueue(storage, {
    voterId,
    wardNo,
    keys: changedKeys,
    updatedAt: now,
    updatedBy: uid,
  });

  notify();
  return next;
}

/** Merges a queue entry, collapsing repeat edits of the same voter. */
async function enqueue(storage: OverlayStorage, entry: SyncQueueEntry): Promise<void> {
  const current = await loadQueue(storage);
  const previous = current.find((item) => item.voterId === entry.voterId);
  const without = current.filter((item) => item.voterId !== entry.voterId);
  const merged: SyncQueueEntry = {
    ...entry,
    // Accumulate: a voter edited twice before sync keeps both key sets, so the
    // eventual push knows every field that moved.
    keys: [...new Set([...(previous?.keys ?? []), ...entry.keys])],
  };
  queue = [...without, merged];
  await storage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Drops keys whose value is `undefined` — the form omits untouched fields. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      (out as Record<string, unknown>)[key] = item;
    }
  }
  return out;
}

/** Drops every edit and queued change — Settings → “reset local edits”. */
export async function clearOverlay(storage: OverlayStorage): Promise<void> {
  const keys = await storage.getItem(QUEUE_KEY);
  const wards = new Set<number>();
  for (const entry of (queue ?? (keys ? (JSON.parse(keys) as SyncQueueEntry[]) : []))) {
    wards.add(entry.wardNo);
  }
  // Also clear wards whose overlay is resident in memory.
  for (const wardNo of cache.keys()) wards.add(wardNo);
  for (const wardNo of wards) {
    await storage.removeItem(overlayKey(wardNo));
  }
  await storage.removeItem(QUEUE_KEY);
  cache.clear();
  queue = null;
  notify();
}

/** The production store, wired to AsyncStorage. */
export const overlayStorage: OverlayStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/** Test seam: forget every cached ward/queue between cases. */
export function __resetOverlayCache(): void {
  cache.clear();
  queue = null;
}
