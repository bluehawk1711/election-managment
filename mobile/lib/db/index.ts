/**
 * The Realtime Database access layer — the app's one door to RTDB.
 *
 * ## Why an adapter rather than 200 scattered `firebase/database` calls
 *
 * The Firestore→RTDB port has to change every read and write in the app, and
 * the two SDKs disagree in ways that are easy to get silently wrong:
 *
 *  - **there is no document/collection type.** RTDB hands back a tree of
 *    `DataSnapshot`s; the mappers want `{ id, data() }`. Without this module
 *    that shim would be rebuilt, subtly differently, in a dozen files.
 *  - **`set()` replaces a whole node** where `setDoc` merged by default in
 *    some call sites, and **`update()` creates a node that does not exist**
 *    where `updateDoc` threw. Both differences lose data if they are
 *    rediscovered per call site.
 *  - **there is no optimistic-concurrency `set`.** The one place the app
 *    needs "fail if it changed" has to use `runTransaction`.
 *  - **queries are server-side and shape-constrained.** RTDB can order by one
 *    child and cap the result, but not "order by an arbitrary field, then
 *    limit" — which is what every list in this app asks for.
 *
 * Centralising those five facts here means each ported file changes its import
 * line and nothing about its shape, and the next reader finds the divergence
 * documented once, in prose, instead of scattered across call sites.
 *
 * ## What this layer deliberately does NOT do
 *
 * It is not a second Firestore. It does not emulate transactions, batches,
 * collection-group queries or `where` clauses beyond one equality filter, and
 * it never pretends to. Where the Firestore API would have hidden a real
 * difference, this file makes the difference explicit in its signature or its
 * doc comment.
 */
import {
  type DataSnapshot as RtdbSnapshot,
  get,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  update,
  set,
  type DatabaseReference,
} from 'firebase/database';
import { realtime } from '@/lib/firebase';
import { childrenOf, dataOf } from '@/lib/db/decode';
import type { DbData, DbMetadata, DbSnapshot, QuerySpec } from '@/lib/db/types';

export type { DbData, DbMetadata, DbSnapshot, QuerySpec } from '@/lib/db/types';

/** Re-exported so callers import every RTDB primitive from this module. */
export { serverTimestamp };

/** Paths with an outstanding local write, for `metadata.hasPendingWrites`. */
const pendingWrites = new Map<string, number>();

function beginWrite(path: string): void {
  pendingWrites.set(path, (pendingWrites.get(path) ?? 0) + 1);
}

function endWrite(path: string): void {
  const next = (pendingWrites.get(path) ?? 0) - 1;
  if (next > 0) pendingWrites.set(path, next);
  else pendingWrites.delete(path);
}

// ------------------------------------------------------- connection state --

let connected = false;
let watchStarted = false;
let detachWatch: (() => void) | null = null;
const connectionListeners = new Set<(connected: boolean) => void>();

/**
 * Subscribes to `.info/connected`, the RTDB connection indicator.
 *
 * Shared rather than per-subscriber: it is a single server-side fact about the
 * device, and one listener is cheaper than one per open read. Reference
 * counted so a screen that mounts and unmounts does not leak the socket.
 */
export function onConnection(next: (connected: boolean) => void): () => void {
  connectionListeners.add(next);

  if (!watchStarted) {
    watchStarted = true;
    // Started lazily rather than at import: `realtime()` throws when the
    // database URL is unset, and a module-level call would put that failure
    // back at app launch, which is exactly what `lib/firebase.ts` avoids.
    detachWatch = onValue(ref(realtime(), '.info/connected'), (snapshot) => {
      connected = snapshot.val() === true;
      for (const listener of connectionListeners) listener(connected);
    });
  } else {
    // Late subscribers get the value already known, or `false` if the socket
    // has not answered yet — the same "cached until proven live" starting
    // point `useCollection` had before the port.
    next(connected);
  }

  return () => {
    connectionListeners.delete(next);
    if (connectionListeners.size === 0) {
      detachWatch?.();
      detachWatch = null;
      watchStarted = false;
    }
  };
}

/** Reports the connection state once, without holding a subscription open. */
export function isConnected(): boolean {
  return connected;
}

// ------------------------------------------------------------- snapshots --

const lastSegment = (path: string): string =>
  path.slice(path.lastIndexOf('/') + 1);

function metadataFor(path: string): DbMetadata {
  return {
    fromCache: !connected,
    hasPendingWrites: (pendingWrites.get(path) ?? 0) > 0,
  };
}

/** Adapts one RTDB node into the shape the app's mappers already accept. */
function snapshotOf(path: string, key: string, value: unknown): DbSnapshot {
  return {
    id: key,
    path,
    // A primitive at a node the app expects to be an object still "exists" —
    // it is malformed data, not absent data, and hiding that would be worse.
    exists: () => value !== null && value !== undefined,
    data: () => dataOf(value),
    metadata: metadataFor(path),
  };
}

function nodeOf(path: string, snapshot: RtdbSnapshot): DbSnapshot {
  return snapshotOf(path, snapshot.key ?? lastSegment(path), snapshot.val());
}

// ------------------------------------------------------------ predicates --

/**
 * Firestore's `==` comparison, in one place.
 *
 * The one deliberate difference: `null` and a missing field are the same thing
 * in RTDB (a `null` child is not stored at all), so they compare equal here.
 * Firestore treats `where(x, '==', null)` the same way, so this matches the
 * behaviour callers are porting away from.
 */
function looseEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;
  return l === r;
}

/**
 * Sorts children the way Firestore would have, with two documented
 * divergences:
 *
 *  - **missing values sort last in both directions** rather than the document
 *    being dropped. Firestore silently hides any document that lacks the
 *    orderBy field, which is the failure mode `users/index.tsx` already
 *    works around by sorting in memory — silently losing rows is never the
 *    better failure.
 *  - **the comparator is stable and total**: equal values fall back to key
 *    order, so two renders of the same data produce the same order.
 */
function byField(field: string, direction: 'asc' | 'desc'): (a: DbSnapshot, b: DbSnapshot) => number {
  const sign = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    const left = a.data()[field];
    const right = b.data()[field];
    const leftMissing = left === undefined || left === null;
    const rightMissing = right === undefined || right === null;

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return leftMissing ? 1 : -1;
    }

    if (typeof left === 'string' && typeof right === 'string') {
      return left === right ? keyOrder(a, b) : sign * left.localeCompare(right);
    }
    if (left === right) return keyOrder(a, b);
    return sign * (left < right ? -1 : 1);
  };
}

const keyOrder = (a: DbSnapshot, b: DbSnapshot): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Applies `where` → `orderBy` → `limit` to a node's children, in memory.
 *
 * **Why in memory at all.** RTDB's own query primitives can order by one named
 * child and cap the result, but cannot express "sort by an arbitrary field,
 * then take the first N" — which is precisely what `useCollection` asks for
 * (`orderBy('startsAt')`, `orderBy('createdAt', 'desc')`, `orderBy('dueDate')`
 * on collections that have no index). Pushing it server-side would mean one
 * `.indexOn` rule per collection per field and a client that still could not
 * ask for a field that is missing.
 *
 * **What it costs, honestly.** This downloads every child of the node. For
 * this app that is fine and deliberate — `DEFAULT_LIMIT` is 500 and the
 * collections are campaign-scale, as the codebase already says ("prototypes
 * are not warehouses"). RTDB bills bandwidth, so if a node ever grows past
 * ~1 000 rows the right fix is an index node, not a bigger `limit`. The `limit`
 * is still applied, and applied last, so the returned size is identical to
 * Firestore's.
 */
function selectRows(path: string, snapshot: RtdbSnapshot, spec?: QuerySpec): DbSnapshot[] {
  // `childrenOf` and not `isRecord`: see it for the `/wards` case, where the
  // node is an array on arrival and a `!isRecord` guard reads as "empty list".
  let rows = childrenOf(snapshot.val()).map(([key, value]) =>
    snapshotOf(`${path}/${key}`, key, value)
  );

  if (spec?.where) {
    const { field, value } = spec.where;
    rows = rows.filter((row) => looseEqual(row.data()[field], value));
  }

  if (spec?.orderBy) {
    const { field, direction } = spec.orderBy;
    rows.sort(byField(field, direction ?? 'asc'));
  }

  if (spec?.limit != null && rows.length > spec.limit) {
    rows = rows.slice(0, spec.limit);
  }

  return rows;
}

// ------------------------------------------------------------------ reads --

/** Subscribes to one node. `next` fires with `{}` for a node that is absent. */
export function onDoc(
  path: string,
  next: (snapshot: DbSnapshot) => void,
  error?: (caught: unknown) => void
): () => void {
  return onValue(
    ref(realtime(), path),
    (snapshot) => next(nodeOf(path, snapshot)),
    error
  );
}

/** Reads one node once. Never rejects for "absent" — that is `exists()`. */
export async function getDoc(path: string): Promise<DbSnapshot> {
  return nodeOf(path, await get(ref(realtime(), path)));
}

/**
 * Subscribes to every child of a node.
 *
 * `connected` arrives alongside the rows rather than inside each snapshot,
 * because it is one fact about the delivery, not one per row — and the cache
 * it feeds (`lib/cache/query-cache.ts`) persists only rows the server
 * confirmed.
 */
export function onDocs(
  path: string,
  spec: QuerySpec | undefined,
  next: (rows: DbSnapshot[], connected: boolean) => void,
  error?: (caught: unknown) => void
): () => void {
  return onValue(
    ref(realtime(), path),
    (snapshot) => next(selectRows(path, snapshot, spec), connected),
    error
  );
}

/** Reads every child of a node once, filtered and ordered in memory. */
export async function getDocs(path: string, spec?: QuerySpec): Promise<DbSnapshot[]> {
  return selectRows(path, await get(ref(realtime(), path)), spec);
}

// ----------------------------------------------------------------- writes --

/**
 * Writes a node.
 *
 * `{ merge: true }` maps to RTDB's `update()`, which merges **one level
 * deep** — the same as Firestore's merge for the single app call site that
 * uses it (`reference-provider`'s flat campaign fields). Callers merging a
 * nested map should write the whole map.
 *
 * `null` children are dropped rather than stored: that is RTDB's model, not a
 * filter, and it is why "clear a field" works but "store an explicit null"
 * does not reach the server. `lib/documents.ts`'s `millisOf` and every mapper
 * in `lib/mappers.ts` already read a missing key and a `null` the same way.
 */
export async function setDoc(
  path: string,
  data: DbData,
  options?: { merge?: boolean }
): Promise<void> {
  const node = ref(realtime(), path);
  beginWrite(path);
  try {
    if (options?.merge) await update(node, data);
    else await set(node, data);
  } finally {
    endWrite(path);
  }
}

/**
 * Patches an existing node's children.
 *
 * **The one behaviour that is not Firestore's.** RTDB's `update()` *creates*
 * the node when it does not exist, where `updateDoc` threw
 * `NOT_FOUND`. Nothing here depends on that difference — every caller patches
 * a document that already exists — but the rules that ship with this
 * migration require an existing node before a patch is accepted, which
 * restores the old failure from the server side instead of the client.
 */
export async function updateDoc(path: string, data: DbData): Promise<void> {
  beginWrite(path);
  try {
    await update(ref(realtime(), path), data);
  } finally {
    endWrite(path);
  }
}

export async function deleteDoc(path: string): Promise<void> {
  beginWrite(path);
  try {
    await remove(ref(realtime(), path));
  } finally {
    endWrite(path);
  }
}

/**
 * Creates a child with a `push()` key and returns it.
 *
 * `push()` is used only to mint the key, not to write: getting the key first
 * lets the caller learn the id from the promise, and keeps the write itself in
 * `setDoc` so it is covered by the same pending-write bookkeeping as every
 * other write. Push keys sort by creation time, which is what lets a
 * "newest first" list order by key instead of by a field.
 */
export async function addDoc(collectionPath: string, data: DbData): Promise<string> {
  const collection = ref(realtime(), collectionPath);
  const key = push(collection).key;
  if (!key) {
    throw new Error(`Could not mint a key under ${collectionPath}.`);
  }
  await setDoc(`${collectionPath}/${key}`, data);
  return key;
}

/**
 * Writes only if the node has not changed since this device last read it.
 *
 * RTDB's `set()` has no conditional variant — the SDK happily overwrites
 * whatever is there — so the "fail rather than clobber a newer value" write in
 * `lib/roll/sync.ts` has to go through `runTransaction`, which is the one
 * primitive the SDK does give us for this. The update function may run more
 * than once and receives `null` when the node is absent; returning
 * `undefined` aborts.
 */
export async function writeIfUnchanged(
  path: string,
  build: (current: DbData | null) => DbData | null
): Promise<boolean> {
  const node: DatabaseReference = ref(realtime(), path);
  beginWrite(path);
  try {
    const result = await runTransaction(node, (current) => {
      // `dataOf`, not `isRecord`: an integer-keyed node transacts as an array
      // (see `childrenOf`), and handing `build` `null` for it would make a
      // conditional write believe the node was absent.
      const next = build(current == null ? null : dataOf(current));
      return next === null ? undefined : next;
    });
    return result.committed;
  } finally {
    endWrite(path);
  }
}
