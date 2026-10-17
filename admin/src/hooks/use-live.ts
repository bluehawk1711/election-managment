'use client';

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { onSnapshot, type Query } from 'firebase/firestore';
import { useRef } from 'react';

/** The two things a Firestore subscription is allowed to do. */
export interface LiveCtx<T> {
  /** Deliver a value now; later calls replace it in the query cache. */
  emit: (data: T) => void;
  /** Fail the query — only honoured before the first emit. */
  fail: (error: unknown) => void;
}

export interface LiveQueryOptions<T> {
  key: QueryKey;
  /**
   * Registers the subscription (typically an `onSnapshot`) and returns its
   * unsubscribe function. Called once per mounted query, re-creating stale
   * listeners cheaply through React Query's own keying.
   */
  subscribe: (ctx: LiveCtx<T>) => () => void;
  /** Skip the network entirely — gate auth-dependent reads on session state. */
  enabled?: boolean;
}

/**
 * A React Query cache backed by a live Firestore listener.
 *
 * Why not `useEffect` + `setState`: every subscription would then be outside
 * the cache, so two pages asking for the same collection would hold two
 * listeners and two copies, and navigating would refetch from scratch. The
 * query cache gives shared listeners (`staleTime: Infinity` below owns the
 * lifetime), instant back-navigation, and mutations invalidating a key
 * instead of threading `setState` through five components.
 *
 * Contract with React Query v5:
 * - the `queryFn` promise resolves on the FIRST `emit`; subsequent emits go
 *   straight to `client.setQueryData(key, …)` inside the same cache entry
 *   (React Query allows cache writes while a query is settled — which it is,
 *   after the first emit);
 * - an abort (unmount / key change / invalidate-and-refetch) unsubscribes the
 *   listener through the AbortSignal — `invalidate` therefore tears down and
 *   re-subscribes, which is exactly what a Firestore re-read is;
 * - errors before the first emit reject into `query.error`; a listener that
 *   dies later is exercised by its own terminal callback in most callers —
 *   for the prototype, a mid-flight listener error simply stops updating,
 *   and the next mount resubscribes. Firestore's terminal callback fires for
 *   permission errors and credential loss, which the session listener already
 *   surfaces by signing out.
 */
export function useLiveQuery<T>({ key, subscribe, enabled = true }: LiveQueryOptions<T>) {
  const client = useQueryClient();

  // The subscribe closure closes over render-scope values (form ids, ward
  // numbers). Re-binding per render while the effect-subscribed function stays
  // the first one would go stale — React Query passes `queryFn` through but
  // only re-runs it on key/abort changes — so the store reads `current`
  // instead. Keys carry the same values, so a change re-subscribes anyway.
  const current = useRef(subscribe);
  current.current = subscribe;
  const cache = useRef(client);
  cache.current = client;

  const query = useQuery<T>({
    queryKey: key,
    enabled,
    // Data is only ever stale after an invalidation — a live snapshot already
    // IS the freshest data. Invalidate (from a mutation) is the only refetch.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: ({ signal }) =>
      new Promise<T>((resolve, reject) => {
        let firstEmitted = false;

        const stop = current.current({
          emit: (data) => {
            if (!firstEmitted) {
              firstEmitted = true;
              resolve(data);
            }
            cache.current.setQueryData<T>(key, data);
          },
          fail: (error) => {
            if (!firstEmitted) reject(error);
          },
        });

        const onAbort = () => stop();
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort);
      }),
  });

  return query;
}

/**
 * `onSnapshot(collection)` → plain-object array, bridged into `LiveCtx`.
 *
 * Deliberately NOT a hook: pages pass it (via a one-line wrapper) as the
 * `subscribe` body of `useLiveQuery`, and keeping it a plain function means
 * mapper and query identities don't leak into hook dependency arrays.
 *
 * Empty/initial snapshots DO emit (count 0 is real data — a dashboard card
 * must render a zero, not a spinner); terminal listener errors route to
 * `fail`, which `useLiveQuery` only honours before the first emit.
 */
export function subscribeCollectionOf<T>(
  baseQuery: Query,
  map: (entry: { id: string; data: () => Record<string, unknown> }) => T,
  emit: (data: T[]) => void,
  fail: (error: unknown) => void
): () => void {
  return onSnapshot(
    baseQuery,
    (snapshot) =>
      emit(
        snapshot.docs.map((entry) =>
          map({ id: entry.id, data: () => entry.data() as Record<string, unknown> })
        )
      ),
    fail
  );
}