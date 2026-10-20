/**
 * The snapshot shape every mapper in this app consumes.
 *
 * `lib/mappers.ts` and `lib/documents.ts` take `Pick<QueryDocumentSnapshot,
 * 'id' | 'data'>` — structural, never an `instanceof Timestamp` — precisely so
 * they can be handed a stand-in. `lib/cache/query-cache.ts` already builds one
 * (`snapshotFrom`), and this is the same stand-in, arrived at from the other
 * direction: the Realtime Database has no snapshot type of its own that looks
 * like Firestore's, so this module defines the one the app wants and every
 * read is adapted into it.
 *
 * Three fields are load-bearing beyond `id`/`data()`:
 *
 *  - `exists()` — `profileFromDoc`, `campaignFromDoc` and `useVoterContacts`
 *    all branch on it, and a missing RTDB node arrives as `val() === null`,
 *    which would otherwise read as "a document whose fields are all missing".
 *  - `metadata.fromCache` — `useCollection`'s `connected` flag drives the
 *    dashboard's live/cached pill, and `reference-provider` refuses to blank
 *    the campaign name over a cache replay.
 *  - `metadata.hasPendingWrites` — `taskFromDoc` folds this into
 *    `Task.pending`, which is what renders the "…" badge on a task saved on a
 *    device that has not reached the server yet.
 *
 * Pure data, no SDK imports, so mappers stay unit-testable without mocks.
 */
export interface DbSnapshot {
  /** The last path segment — the RTDB key, which for `push()` keys is time-sortable. */
  readonly id: string;
  /** The full path this snapshot describes, e.g. `tasks/abc123`. */
  readonly path: string;
  exists(): boolean;
  /** `{}` when the node is absent, so mappers never see `null`. */
  data(): Record<string, unknown>;
  readonly metadata: DbMetadata;
}

export interface DbMetadata {
  /**
   * True when the value was served without a live server round trip.
   *
   * RTDB reports no per-snapshot cache flag the way Firestore does, so this is
   * the connection state at delivery time — see `onConnection`. That is
   * "serving from the server" rather than "a socket is open", which is the
   * same reading the Firestore version gave it, just sourced differently.
   */
  readonly fromCache: boolean;
  /**
   * True while a write this device issued to `path` is still in flight.
   *
   * RTDB echoes writes locally before the server acknowledges them — the same
   * optimistic behaviour as Firestore — but exposes no flag for it, so
   * `lib/db` counts the outstanding writes per path itself.
   */
  readonly hasPendingWrites: boolean;
}

/** A node's fields. `null` children are treated as absent — see `setDoc`. */
export type DbData = Record<string, unknown>;

export interface QuerySpec {
  /** A single equality filter, applied client-side — see `lib/db/index.ts`. */
  where?: { field: string; value: unknown } | null;
  orderBy?: { field: string; direction?: 'asc' | 'desc' } | null;
  limit?: number;
}
