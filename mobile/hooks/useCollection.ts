import { DEFAULT_LIMIT } from '@/lib/collections';
import { messageFor } from '@/lib/errors';
import { db } from '@/lib/firebase';
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
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
 * A live Firestore listener over one collection, mapped to plain objects.
 *
 * Contract:
 * - one `onSnapshot`, no refetch, no optimistic bookkeeping (the SDK's local
 *   echo already does that and rolls back on rejection);
 * - listener errors are terminal, so `retry()` resubscribes;
 * - `connected` is `!snapshot.metadata.fromCache` — it reads "serving from the
 *   server" rather than "a socket is open";
 * - the returned view is *derived*, never cleared inside the effect: state is
 *   only ever written from the subscription callbacks, which is both the
 *   React-recommended shape and what keeps a query change from flashing the
 *   previous query's rows while the new one loads.
 */
export function useCollection<T>(
  name: string,
  mapDoc: (doc: QueryDocumentSnapshot<DocumentData>) => T,
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

  // Object identities change every render; serialise the query shape instead.
  const whereKey = whereFilter
    ? `${whereFilter.field}:${JSON.stringify(whereFilter.value)}`
    : '';
  const orderKey = order ? `${order.field}:${order.direction ?? 'asc'}` : '';
  const queryKey = `${name}|${whereKey}|${orderKey}|${cap}|${attempt}`;

  useEffect(() => {
    if (!enabled) return;

    const constraints: QueryConstraint[] = [];
    if (whereFilter) {
      constraints.push(where(whereFilter.field, '==', whereFilter.value));
    }
    if (order) {
      constraints.push(orderBy(order.field, order.direction ?? 'asc'));
    }
    constraints.push(fsLimit(cap));

    const key = queryKey;
    return onSnapshot(
      query(collection(db, name), ...constraints),
      { includeMetadataChanges: true },
      (snapshot) => {
        setSnapshot({
          key,
          docs: snapshot.docs.map(mapDoc),
          connected: !snapshot.metadata.fromCache,
        });
        setError(null);
      },
      (caught) => {
        setError(messageFor(caught));
        setSnapshot(null);
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
