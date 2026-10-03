/**
 * `useRoll` — the read side of the voter roll (plan-voters.md §4, V1).
 *
 * Loads ward metadata once, the selected ward's rows on demand, merges each
 * row with its local overlay, and rebuilds the search index when either side
 * changes. Screens consume this and never touch a `RollSource` directly.
 *
 * ## Cache-first, refetch in background
 *
 * The read path is two independent loads, and each is ordered cache-then-
 * network:
 *
 *   1. `wards` — from `lib/roll/cache.ts`, then Firestore.
 *   2. the selected ward's voters — from the same cache, then Firestore.
 *
 * Whichever the cache satisfies renders immediately; the network result
 * replaces it when it lands. The user never sees a spinner for data the device
 * already holds, which matters more than usual here: the roll is 6,855
 * Hindi-language rows and a karykarta opens this standing in a lane on a
 * phone that has been in a pocket, not on wifi.
 *
 * The consequence to be aware of when reading the state flags below:
 *
 * - `loading` is `true` only while there is *nothing at all* to show. Once any
 *   rows are present it goes `false` even if the network fetch is still in
 *   flight; `refreshing` covers that window.
 * - `stale` means "these rows came from the device, not from this session's
 *   fetch". It is informational, not an error — the data is correct as of
 *   `refreshedAt`, which is what the offline banner shows.
 * - `connected` is the last known result of a network fetch. `null` before the
 *   first one completes; it does **not** mean the app is offline, because a
 *   cache hit with no network attempt yet is a perfectly good state.
 *
 * Re-renders on an overlay edit come from `subscribeOverlay`, so a save in the
 * edit sheet shows up in a still-mounted list without any refetch. That
 * subscription bumps `revision` alongside the cache `savedAt`, so an overlay
 * write re-reads local state but never re-downloads the base roll — the base
 * roll does not change because someone edited a phone number.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cacheStorage,
  readAll,
  readWard,
  readWards,
  writeWard,
  writeWards,
} from '@/lib/roll/cache';
import { mergeVoter } from '@/lib/roll/merge';
import {
  loadQueue,
  loadWardOverlay,
  overlayStorage,
  subscribeOverlay,
} from '@/lib/roll/overlay';
import { buildIndex, type SearchIndex } from '@/lib/roll/search';
import { getRollSource } from '@/lib/roll/source';
import type {
  RollVoter,
  VoterOverlay,
  VoterView,
  WardsBundle,
} from '@/lib/roll/types';

export interface RollState {
  wards: WardsBundle | null;
  voters: VoterView[];
  index: SearchIndex;
  /** True only until there is something to render. */
  loading: boolean;
  /** A network fetch is in flight over already-visible rows. */
  refreshing: boolean;
  error: string | null;
  /**
   * `null` until the first network fetch resolves, then the last known
   * outcome. Not an offline flag — see the note at the top.
   */
  connected: boolean | null;
  /** True when the visible rows came from the device cache, not this fetch. */
  stale: boolean;
  /** When the visible rows were last written to the cache. */
  refreshedAt: number | null;
  /** `null` = every ward loaded. */
  wardNo: number | null;
  setWard: (wardNo: number | null) => void;
  retry: () => void;
  /** Re-reads the overlay from storage (after an edit lands). */
  refresh: () => void;
  /** Finds one voter by id in the currently loaded set. */
  find: (voterId: string) => VoterView | undefined;
}

export function useRoll(initialWard: number | null = null): RollState {
  const source = useMemo(() => getRollSource(), []);

  const [wards, setWards] = useState<WardsBundle | null>(null);
  const [rows, setRows] = useState<RollVoter[]>([]);
  const [overlays, setOverlays] = useState<Record<string, VoterOverlay>>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [wardNo, setWardNo] = useState<number | null>(initialWard);
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);

  // Guards against a stale response when the ward changes mid-flight. Bumped
  // by every load that starts, so only the newest one may commit.
  const requestRef = useRef(0);

  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  // Any overlay write anywhere re-reads the loaded ward's overlays.
  useEffect(() => subscribeOverlay(() => setRevision((n) => n + 1)), []);

  // -------------------------------------------------------------------------
  // 1. Ward metadata. Loaded once per retry; changing ward does not refetch it.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await readWards(cacheStorage);
      if (cancelled) return;
      if (cached) setWards(cached);

      try {
        const fresh = await source.getWards();
        if (cancelled) return;
        setWards(fresh);
        setConnected(true);
        // Only a fresh fetch updates freshness; a cache hit must not claim to
        // have just synced.
        setRefreshedAt((previous) => previous ?? Date.now());
        await writeWards(cacheStorage, fresh);
      } catch (caught) {
        if (cancelled) return;
        // A cache hit plus a failed fetch is a normal offline state, not an
        // error worth blanking the screen for. Only surface the failure when
        // there is nothing cached to fall back on.
        setConnected(false);
        if (!cached) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, attempt]);

  // -------------------------------------------------------------------------
  // 2. The selected ward's rows, plus the local overlay and sync queue.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const token = (requestRef.current += 1);
    /** Commits a result only if this is still the newest request. */
    const commit = <T,>(apply: (value: T) => void, value: T): boolean => {
      if (cancelled || token !== requestRef.current) return false;
      apply(value);
      return true;
    };

    (async () => {
      setRefreshing(true);

      // --- Overlay + queue: local, fast, and the reason a cached row can show
      // its own edits without any network at all.
      const overlay =
        wardNo != null
          ? await loadWardOverlay(overlayStorage, wardNo)
          : // `wardNo === null` means every ward, so every ward's overlay has to
            // come with it — otherwise edits vanish the moment the selector is
            // set to "All".
            (await Promise.all(
              (wards?.wards ?? []).map((ward) =>
                loadWardOverlay(overlayStorage, ward.wardNo)
              )
            )).reduce<Record<string, VoterOverlay>>(
              (acc, wardOverlay) => Object.assign(acc, wardOverlay),
              {}
            );
      const queue = await loadQueue(overlayStorage);
      if (!commit(setOverlays, overlay)) return;
      commit(setPendingIds, new Set(queue.map((entry) => entry.voterId)));

      // --- Cache pass: render what the device already has, immediately.
      let haveRows = false;
      if (wardNo != null) {
        const cached = await readWard(cacheStorage, wardNo);
        if (cancelled || token !== requestRef.current) return;
        if (cached) {
          haveRows = commit(setRows, cached.voters);
          if (haveRows) {
            commit(setStale, true);
            commit(setRefreshedAt, cached.savedAt);
          }
        }
      } else if (wards) {
        // Every ward: stitch together whichever per-ward copies exist. Wards
        // with no copy are simply missing from the first paint and arrive with
        // the network result.
        const cachedByWard = await readAll(cacheStorage, wards.wards);
        if (cancelled || token !== requestRef.current) return;
        const stitched = [...cachedByWard.values()].flatMap((entry) => entry.voters);
        if (stitched.length) {
          haveRows = commit(setRows, stitched);
          if (haveRows) {
            commit(setStale, true);
            commit(
              setRefreshedAt,
              Math.max(...[...cachedByWard.values()].map((entry) => entry.savedAt))
            );
          }
        }
      }

      if (!haveRows) commit(setLoading, true);

      // --- Network pass: replaces the cache result when it lands.
      try {
        const voters = await source.getVoters(wardNo);
        if (!commit(setRows, voters)) return;
        commit(setStale, false);
        commit(setConnected, true);
        commit(setError, null);
        const now = Date.now();
        commit(setRefreshedAt, now);

        // Persist per ward so the *next* cold start is a cache hit. For the
        // "all wards" selection each ward gets its own key rather than one
        // giant blob rewritten on every fetch.
        if (wardNo != null) {
          await writeWard(cacheStorage, wardNo, voters);
        } else if (wards) {
          await Promise.all(
            wards.wards.map((ward) =>
              writeWard(
                cacheStorage,
                ward.wardNo,
                voters.filter((voter) => voter.wardNo === ward.wardNo)
              )
            )
          );
        }
      } catch (caught) {
        if (cancelled || token !== requestRef.current) return;
        commit(setConnected, false);
        // Same rule as above: cached rows plus a failed fetch is offline, not
        // an error. Blanking the screen would throw away data we already have.
        if (!haveRows) {
          commit(setError, caught instanceof Error ? caught.message : String(caught));
          commit(setRows, []);
        }
      } finally {
        if (!cancelled && token === requestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, wardNo, attempt, wards, revision]);

  const voters = useMemo(
    () => rows.map((row) => mergeVoter(row, overlays[row.id], pendingIds.has(row.id))),
    [rows, overlays, pendingIds]
  );

  const index = useMemo(() => buildIndex(voters), [voters]);

  const find = useCallback(
    (voterId: string) => voters.find((voter) => voter.id === voterId),
    [voters]
  );

  return {
    wards,
    voters,
    index,
    loading,
    refreshing,
    error,
    connected,
    stale,
    refreshedAt,
    wardNo,
    setWard: setWardNo,
    retry,
    refresh,
    find,
  };
}