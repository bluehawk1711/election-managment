/**
 * The panel's Realtime Database access layer — its one door to RTDB.
 *
 * ## Why an adapter rather than scattered `firebase/database` calls
 *
 * The Firestore→RTDB port changes every read and write in the panel, and the
 * two SDKs disagree in ways that are easy to get silently wrong:
 *
 *  - **there is no document/collection type.** RTDB hands back a tree of
 *    `DataSnapshot`s; the mappers in `lib/mappers.ts` want `{ id, data() }`.
 *    Without this module that shim would be rebuilt, subtly differently, in a
 *    dozen files.
 *  - **`set()` replaces a whole node** where `setDoc` merged by default in
 *    some call sites, and **`update()` creates a node that does not exist**
 *    where `updateDoc` threw. Both differences lose data if they are
 *    rediscovered per call site.
 *  - **queries are shape-constrained.** RTDB can order by one child and cap
 *    the result, but not "order by an arbitrary field, then limit" — which is
 *    what every list in this panel asks for.
 *
 * Centralising those facts here means each ported file changes its import
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
 *
 * ## The snapshot shape
 *
 * `DbSnapshot` is deliberately the shape the mappers ALREADY accept:
 * `{ id, data() }`. `lib/mappers.ts` types its input as
 * `Pick<QueryDocumentSnapshot<DocumentData>, 'id' | 'data'>` — structural, never
 * an `instanceof` check — precisely so it can be handed a stand-in. This
 * module is that stand-in, arrived at from the other direction: the
 * Realtime Database has no snapshot type of its own that looks like
 * Firestore's, so the panel defines the one it wants and every read is
 * adapted into it. The mappers themselves do not change.
 */
import {
  get,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type DataSnapshot as RtdbSnapshot,
  type DatabaseReference,
} from 'firebase/database';
import { realtime } from '@/lib/firebase';

/** Re-exported so callers import every RTDB primitive from this module. */
export { serverTimestamp };

/** A node's fields. `null` children are treated as absent — see `setDoc`. */
export type DbData = Record<string, unknown>;

/**
 * The stand-in snapshot the panel's mappers consume.
 *
 * `exists()` is load-bearing: `profileFromDoc` and the team roster mapper
 * both branch on it, and a missing RTDB node arrives as `val() === null`,
 * which would otherwise read as "a document whose fields are all missing".
 */
export interface DbSnapshot {
  /** The last path segment — the RTDB key. */
  readonly id: string;
  /** The full path this snapshot describes, e.g. `tasks/abc123`. */
  readonly path: string;
  exists(): boolean;
  /** `{}` when the node is absent, so mappers never see `null`. */
  data(): DbData;
}

/** A node's children, filtered and ordered in memory. */
export interface QuerySpec {
  /** A single equality filter, applied client-side. */
  where?: { field: string; value: unknown } | null;
  orderBy?: { field: string; direction?: 'asc' | 'desc' } | null;
  limit?: number;
}

// ------------------------------------------------------- connection state --

let connected = false;
let watchStarted = false;
let detachWatch: (() => void) | null = null;
const connectionListeners = new Set<(connected: boolean) => void>();

/**
 * Subscribes to `.info/connected`, the RTDB connection indicator.
 *
 * Shared rather than per-subscriber: it is a single server-side fact about
 * the browser, and one listener is cheaper than one per open read. Reference
 * counted so a page that mounts and unmounts does not leak the socket.
 */
export function onConnection(next: (connected: boolean) => void): () => void {
  connectionListeners.add(next);

  if (!watchStarted) {
    watchStarted = true;
    // Started lazily rather than at import: `realtime()` throws when the
    // database URL is unset, and a module-level call would put that failure
    // back at panel boot, which is exactly what `lib/firebase.ts` avoids.
    detachWatch = onValue(ref(realtime(), '.info/connected'), (snapshot) => {
      connected = snapshot.val() === true;
      for (const listener of connectionListeners) listener(connected);
    });
  } else {
    // Late subscribers get the value already known, or `false` if the socket
    // has not answered yet — the same "cached until proven live" starting
    // point the panel had before the port.
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

const isRecord = (value: unknown): value is DbData =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function snapshotOf(path: string, key: string, value: unknown): DbSnapshot {
  return {
    id: key,
    path,
    // A primitive at a node the panel expects to be an object still
    // "exists" — it is malformed data, not absent data, and hiding that
    // would be worse.
    exists: () => value !== null && value !== undefined,
    data: () => (isRecord(value) ? value : {}),
  };
}

function nodeOf(path: string, snapshot: RtdbSnapshot): DbSnapshot {
  return snapshotOf(path, snapshot.key ?? lastSegment(path), snapshot.val());
}

// ------------------------------------------------------------ predicates --

/**
 * Firestore's `==` comparison, in one place.
 *
 * The one deliberate difference: `null` and a missing field are the same
 * thing in RTDB (a `null` child is not stored at all), so they compare equal
 * here. Firestore treats `where(x, '==', null)` the same way.
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
 *    orderBy field, which is the failure mode the panel already works around
 *    by sorting in memory — silently losing rows is never the better failure.
 *  - **the comparator is stable and total**: equal values fall back to key
 *    order, so two renders of the same data produce the same order.
 */
const keyOrder = (a: DbSnapshot, b: DbSnapshot): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function byField(
  field: string,
  direction: 'asc' | 'desc'
): (a: DbSnapshot, b: DbSnapshot) => number {
  const sign = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    const left = a.data()[field];
    const right = b.data()[field];
    const leftMissing = left === undefined || left === null;
    const rightMissing = right === undefined || right === null;

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) return keyOrder(a, b);
      return leftMissing ? 1 : -1;
    }

    if (typeof left === 'string' && typeof right === 'string') {
      return left === right ? keyOrder(a, b) : sign * left.localeCompare(right);
    }
    if (left === right) return keyOrder(a, b);
    return sign * (left < right ? -1 : 1);
  };
}

/**
 * Applies `where` → `orderBy` → `limit` to a node's children, in memory.
 *
 * **Why in memory at all.** RTDB's own query primitives can order by one
 * named child and cap the result, but cannot express "sort by an arbitrary
 * field, then take the first N" — which is precisely what the panel's
 * collection pages ask for. Pushing it server-side would mean one
 * `.indexOn` rule per collection per field and a client that still could not
 * ask for a field that is missing.
 *
 * **What it costs, honestly.** This downloads every child of the node. For
 * this panel that is fine and deliberate — the collections are
 * campaign-scale, as the codebase already says ("prototypes are not
 * warehouses"). RTDB bills bandwidth, so if a node ever grows past ~1 000 rows
 * the right fix is an index node, not a bigger `limit`. The `limit` is still
 * applied, and applied last, so the returned size is identical to Firestore's.
 */
function selectRows(
  path: string,
  snapshot: RtdbSnapshot,
  spec?: QuerySpec
): DbSnapshot[] {
  const raw = snapshot.val();
  if (!isRecord(raw)) return [];

  let rows = Object.entries(raw).map(([key, value]) =>
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
 * because it is one fact about the delivery, not one per row.
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
export async function getDocs(
  path: string,
  spec?: QuerySpec
): Promise<DbSnapshot[]> {
  return selectRows(path, await get(ref(realtime(), path)), spec);
}

/**
 * Reads every child of a node ONCE, as plain data.
 *
 * The one-shot counterpart of `onDocs` — used by the pages that want a
 * snapshot without holding a socket open (the roll counts, the export).
 */
export async function getChildren(path: string): Promise<DbSnapshot[]> {
  return selectRows(path, await get(ref(realtime(), path)));
}

// ----------------------------------------------------------------- writes --

/**
 * Writes a node.
 *
 * `{ merge: true }` maps to RTDB's `update()`, which merges **one level
 * deep** — the same as Firestore's merge for the single panel call site that
 * uses it. Callers merging a nested map should write the whole map.
 *
 * `null` children are dropped rather than stored: that is RTDB's model, not a
 * filter, and it is why "clear a field" works but "store an explicit null"
 * does not reach the server.
 */
export async function setDoc(
  path: string,
  data: DbData,
  options?: { merge?: boolean }
): Promise<void> {
  const node = ref(realtime(), path);
  if (options?.merge) await update(node, data);
  else await set(node, data);
}

/**
 * Patches an existing node's children.
 *
 * **The one behaviour that is not Firestore's.** RTDB's `update()` *creates*
 * the node when it does not exist, where `updateDoc` threw `NOT_FOUND`.
 * Nothing here depends on that difference — every caller patches a node that
 * already exists — but the rules that ship with this migration require an
 * existing node before a patch is accepted, which restores the old failure
 * from the server side instead of the client.
 */
export async function updateDoc(path: string, data: DbData): Promise<void> {
  await update(ref(realtime(), path), data);
}

export async function deleteDoc(path: string): Promise<void> {
  await remove(ref(realtime(), path));
}

/**
 * Creates a child with a `push()` key and returns it.
 *
 * `push()` is used only to mint the key, not to write: getting the key first
 * lets the caller learn the id from the promise, and keeps the write itself
 * in `setDoc`. Push keys sort by creation time, which is what lets a
 * "newest first" list order by key instead of by a field.
 */
export async function addDoc(
  collectionPath: string,
  data: DbData
): Promise<string> {
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
 * whatever is there — so a "fail rather than clobber a newer value" write
 * goes through `runTransaction`, which is the one primitive the SDK does give
 * us for this. The update function may run more than once and receives `null`
 * when the node is absent; returning `undefined` aborts.
 */
export async function writeIfUnchanged(
  path: string,
  build: (current: DbData | null) => DbData | null
): Promise<boolean> {
  const node: DatabaseReference = ref(realtime(), path);
  const result = await (await import('firebase/database')).runTransaction(
    node,
    (current) => {
      const next = build(isRecord(current) ? current : null);
      return next === null ? undefined : next;
    }
  );
  return result.committed;
}
