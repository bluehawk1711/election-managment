import { DEFAULT_LIMIT } from '@/lib/collections';
import {
  peek as peekCache,
  save as saveCache,
  snapshotFrom,
} from '@/lib/cache/query-cache';
import { onDocs, type DbSnapshot, type QuerySpec } from '@/lib/db';
import { messageFor } from '@/lib/errors';
import { useCallback, useEffect, useState } from 'react';

export interface EqualityFilter {
  field: string;
  value: unknown;
}

export interface UseCollectionOptions {
  /**
   * A single equality filter. Deliberately never combined with `orderBy` —
   * equality + orderBy on a *different* field requires a composite index, and
   * the filter UI is built to sort in memory instead (see lib/filters.ts).
   */
  where?: EqualityFilter | null;
  orderBy?: { field: string; direction?: 'asc' | 'desc' } | null;
  limit?: number;
  /** Hold the subscription until the caller is ready (defaults to on). */
  enabled?: boolean;
}

export interface CollectionState<T> {
  docs: T[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  retry: () => void;
}

interface Snapshot<T> {
  /** The query this data belongs to — staleness check for the derived read. */
  key: string;
  docs: T[];
  connected: boolean;
}

/**
 * A live listener over one node's children, mapped to plain objects, with a
 * durable cache underneath it.
 *
 * Contract:
 * - one subscription, no refetch, no optimistic bookkeeping (RTDB echoes a
 *   write locally before the server acknowledges it, and rolls back on
 *   rejection, so the first delivery already includes it);
 * - listener errors are terminal, so `retry()` resubscribes;
 * - `connected` is `.info/connected` at delivery time — it reads "serving from
 *   the server" rather than "a socket is open". Rows replayed from our cache
 *   report `false`, which is what makes the dashboard's live/cached pill
 *   honest;
 * - the returned view is *derived*, never cleared inside the effect: state is
 *   only ever written from the subscription callbacks, which is both the
 *   React-recommended shape and what keeps a query change from flashing the
 *   previous query's rows while the new one loads.
 *
 * ## The cache-first part
 *
 * On mount the hook seeds its state from `lib/cache/query-cache` **synchronously**
 * if a copy exists, so a warm cache renders on the first frame and `loading` is
 * already `false`. The subscription still runs; it just upgrades what is on
 * screen instead of gating it. That is the difference between "the app is
 * usable immediately and quietly catches up" and "the app shows skeletons on
 * every launch because the platform has no IndexedDB".
 *
 * The seed is deliberately a render-phase adjustment (React's documented
 * "adjust state when a prop changes" pattern) rather than an effect: an effect
 * would run *after* the first paint, which is precisely the frame we are trying
 * to avoid showing a spinner on.
 */
export function useCollection<T>(
  name: string,
  mapDoc: (doc: DbSnapshot) => T,
  options: UseCollectionOptions = {}
): CollectionState<T> {
  const {
    where: whereFilter,
    orderBy: order,
    limit: cap = DEFAULT_LIMIT,
    enabled = true,
  } = options;

  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Which `cacheName` has already been used to seed, so this runs once. */
  const [seeded, setSeeded] = useState<string | null>(null);

  // Object identities change every render; serialise the query shape instead.
  const whereKey = whereFilter
    ? `${whereFilter.field}:${JSON.stringify(whereFilter.value)}`
    : '';
  const orderKey = order ? `${order.field}:${order.direction ?? 'asc'}` : '';
  const queryKey = `${name}|${whereKey}|${orderKey}|${cap}|${attempt}`;
  // The cache is keyed by the query's *identity*, not by its attempt number —
  // otherwise every retry would miss and fall back to a skeleton.
  const cacheName = `${name}|${whereKey}|${orderKey}|${cap}`;

  // Render-phase seed. Guarded on `seeded` so it cannot loop, and skipped while
  // an error is showing so a failed query does not get papered over by stale
  // rows from a previous visit.
  if (enabled && snapshot === null && error === null && seeded !== cacheName) {
    const cached = peekCache(cacheName);
    if (cached) {
      setSnapshot({
        key: queryKey,
        docs: cached.docs.map((doc) => mapDoc(snapshotFrom(doc))),
        connected: false,
      });
      setSeeded(cacheName);
    }
  }

  useEffect(() => {
    if (!enabled) return;

    // `lib/db` applies where/orderBy/limit itself, in memory. RTDB can order by
    // one named child and cap the result, but cannot express "sort by an
    // arbitrary field, then take the first N" — which is what every caller here
    // asks for (`orderBy('startsAt')`, `orderBy('createdAt', 'desc')`,
    // `orderBy('dueDate')` on collections with no index). See `selectRows`.
    const spec: QuerySpec = {
      where: whereFilter ? { field: whereFilter.field, value: whereFilter.value } : null,
      orderBy: order ? { field: order.field, direction: order.direction ?? 'asc' } : null,
      limit: cap,
    };

    const key = queryKey;
    return onDocs(
      name,
      spec,
      (rows, serverConnected) => {
        setSnapshot({
          key,
          docs: rows.map(mapDoc),
          connected: serverConnected,
        });
        setError(null);
        // Persist only once the server has actually answered. React Native has
        // no persistent cache for either backend, so a delivery here means the
        // socket was up; writing it before that would persist nothing useful
        // and, worse, would stamp a fresh `savedAt` onto unconfirmed data.
        if (serverConnected) {
          saveCache(
            cacheName,
            rows.map((doc) => ({ id: doc.id, data: doc.data() }))
          );
        }
      },
      (caught) => {
        setError(messageFor(caught));
        // Deliberately *not* `setSnapshot(null)`: clearing here would throw
        // away the cached rows and put the skeleton back on screen for a
        // connection blip, which is the opposite of what the cache is for.
      }
    );
    // mapDoc is a module-level mapper in every caller — identity is stable;
    // whereFilter/order/cap are encoded in queryKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, enabled, mapDoc]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const current = enabled && snapshot?.key === queryKey ? snapshot : null;

  return {
    docs: current?.docs ?? [],
    // A new key (fresh mount, changed query, retry) with nothing delivered yet
    // reads as loading; a disabled hook reads as idle.
    loading: enabled && !current && !error,
    error: enabled ? error : null,
    connected: current?.connected ?? false,
    retry,
  };
}
