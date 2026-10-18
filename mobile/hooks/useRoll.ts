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
import { bundledVoters, bundledWards } from '@/lib/roll/bundled';
import {
  cacheStorage,
  peekWard,
  peekWards,
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
import { syncVoterEdits } from '@/lib/roll/sync';
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
  /**
   * Loads the next batch of wards. Only meaningful when `wardNo` is `null`
   * (the "all wards" selection); opening a single ward has nothing more to
   * page through. Wire this to `FlatList`'s `onEndReached`.
   */
  loadMore: () => void;
  /** True while a further batch exists. */
  hasMore: boolean;
  /** True while a `loadMore` batch is in flight. */
  loadingMore: boolean;
  retry: () => void;
  /** Re-reads the overlay from storage (after an edit lands). */
  refresh: () => void;
  /** Finds one voter by id in the currently loaded set. */
  find: (voterId: string) => VoterView | undefined;
}

/**
 * How many wards the "all wards" selection fetches at a time.
 *
 * The roll is 6,855 rows across 13 wards. Fetching all of it up front meant a
 * single `getDocs` of every document, a `mergeVoter` pass and a full search
 * index build before the first row could paint — on a mid-range Android over
 * mobile data that is many seconds of nothing. Wards are the natural unit: each
 * is already its own cache key and its own navigation target, and a karykarta
 * looking one person up only ever needs the ward that person is in.
 */
const WARD_BATCH = 3;

export function useRoll(
  initialWard: number | null = null,
  options: { eager?: boolean; wardScope?: readonly number[] | null } = {}
): RollState {
  const source = useMemo(() => getRollSource(), []);

  // Mirroring edits to the account (push queued + pull remote) is part of
  // opening the roll, not a separate screen: every consumer of `useRoll`
  // wants the rows as they exist on the account, including this device's
  // own queued saves. Throttled/single-flighted inside `syncVoterEdits`, so
  // list + sheet + report mounting together do not triple the round-trips.
  useEffect(() => {
    void syncVoterEdits();
  }, []);

  /**
   * Aggregate screens pass `eager: true` and get every ward immediately.
   *
   * The booth report is the reason this exists: it tallies voted / photos /
   * edits across *all* wards, so a partial set of wards would report confident,
   * wrong numbers. Being honest about that matters more than being fast on the
   * one screen whose entire job is a total.
   */
  const eager = options.eager ?? false;
  /**
   * Which wards this account may READ, when the caller knows (`null` =
   * unrestricted, the admin case).
   *
   * The rules layer answers a query for a ward outside the caller's scope
   * with PERMISSION_DENIED, not an empty result — and because the "all
   * wards" selection runs one query per ward under `Promise.all`, a SINGLE
   * denied ward rejects the whole batch and the screen shows nothing but an
   * error. That is what happened to a karykarta on open: wardNo starts `null`
   * ("all"), the first batch is wards 1–3, and unless they happen to own one
   * of those three every fetch fails until they narrow the selector to their
   * own ward. Scoping `inScope` here means the queries that leave the device
   * are only ever the ones rules will answer — the client mirror of
   * `visibleWards` rather than a second opinion about it.
   */
  const wardScope = options.wardScope ?? null;
  // Content key for the effect deps below: callers build the scope array in
  // render, so a bare identity dep would refetch on every render forever, and
  // skipping a change would miss the moment the profile (and with it the
  // scope) lands. Same-content arrays share a key → no refetch; a changed
  // membership → one refetch.
  const wardScopeKey = wardScope == null ? '' : wardScope.join(',');

  const [wards, setWards] = useState<WardsBundle | null>(() => peekWards());
  const [rows, setRows] = useState<RollVoter[]>([]);
  const [overlays, setOverlays] = useState<Record<string, VoterOverlay>>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * Whether the screen has nothing at all to show.
   *
   * Starts `true` because that is genuinely the case on a first-ever launch —
   * but a warm memory mirror seeds `rows` during this same render pass (below),
   * which flips it back before anything paints. Starting it `false` instead
   * would be a lie on a genuinely cold cache, and would swap the skeleton for
   * an empty-state flash, which is worse: "no voters" is a statement about the
   * data and "still loading" is not.
   */
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [wardNo, setWardNo] = useState<number | null>(initialWard);
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  /** How many wards the "all wards" selection has pulled in so far. */
  const [visibleWards, setVisibleWards] = useState(WARD_BATCH);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Which `seedKey` has already been used to seed, so this runs once. */
  const [seeded, setSeeded] = useState<string | null>(null);

  // Guards against a stale response when the ward changes mid-flight. Bumped
  // by every load that starts, so only the newest one may commit.
  const requestRef = useRef(0);

  /**
   * The rows as of the last commit, for the effect below.
   *
   * Read through a ref rather than a dependency because the effect both
   * *reads* "is anything already on screen" and *writes* rows — putting
   * `rows` in its dependency array would re-run it on its own writes.
   */
  const rowsRef = useRef(rows);
  // Written from an effect, not during render: `react-hooks/refs` (the
  // Compiler rule) rejects render-phase ref writes, and effect bodies run in
  // declaration order — the consumer effect below is declared after this one
  // and still sees this commit's `rows`. The initial `useRef(rows)` covers
  // the first pass, where nothing has run yet.
  useEffect(() => {
    rowsRef.current = rows;
  });

  /**
   * Synchronous cache seed.
   *
   * The skeleton this replaces was not a slow network: it was one `await` on
   * AsyncStorage that resolved a frame or two after mount, while the rows were
   * already on disk. Every visit to the list — including coming back from a
   * voter's detail screen — paid it.
   *
   * Run during render rather than in an effect on purpose. An effect runs
   * *after* the first paint, so it would leave exactly the skeleton flash we are
   * removing. React's documented "adjust state when a prop changes" pattern
   * re-renders immediately without committing the intermediate frame, which is
   * what makes the skeleton never appear.
   *
   * Guarded on the ward selection, so switching wards seeds from the new
   * selection rather than showing the previous ward's rows under the new label.
   */
  const seedKey = `${wardNo ?? 'all'}:${visibleWards}:${eager}`;
  if (rows.length === 0 && !error && seeded !== seedKey) {
    const resident: RollVoter[] = [];
    let newest: number | null = null;
    let fromCache = false;

    if (wardNo != null) {
      const entry = peekWard(wardNo);
      if (entry) {
        resident.push(...entry.voters);
        newest = entry.savedAt;
        fromCache = true;
      } else {
        // First-ever launch: the ward's copy ships inside the APK
        // (`assets/roll/*.json`). Reading it here, during render, is what
        // makes the very first frame real rows — no skeleton, no fetch.
        const bundled = bundledVoters(wardNo);
        if (bundled) resident.push(...bundled);
      }
    } else {
      // The "all wards" selection seeds from the wards already resident —
      // whichever they are, in ward order, up to the visible slice. The
      // bundle's metadata is the fallback so a cold start can seed wards
      // that have never been fetched.
      const meta =
        wards?.wards ??
        peekWards()?.wards ??
        bundledWards()?.wards ??
        [];
      for (const ward of meta.slice(0, eager ? meta.length : visibleWards)) {
        const entry = peekWard(ward.wardNo);
        if (entry) {
          resident.push(...entry.voters);
          newest = newest === null ? entry.savedAt : Math.max(newest, entry.savedAt);
          fromCache = true;
          continue;
        }
        const bundled = bundledVoters(ward.wardNo);
        if (bundled) resident.push(...bundled);
      }
    }

    if (resident.length) {
      setRows(resident);
      setSeeded(seedKey);
      setLoading(false);
      // Only cache rows are "stale": the bundled copy is the shipped source
      // of truth, exactly as fresh as a fetch would have been.
      if (fromCache) {
        setStale(true);
        setRefreshedAt(newest);
      }
    }
  }

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
  //
  // `wardNo === null` means "all wards", and that is a *paged* selection: only
  // the first `visibleWards` wards are fetched, and the screen asks for more as
  // the user scrolls. `eager` opts out, for the screens that must be complete.
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

      // The wards this pass covers. A single ward is just that ward; "all" is
      // the first slice of the bundle, or all of it when `eager` — each then
      // narrowed to `wardScope`, so no query outside the account's scope is
      // ever issued (see `wardScope` above: a denied row fails the whole
      // `Promise.all`, it does not come back empty).
      const scopedToRole = (nos: readonly number[]): readonly number[] =>
        wardScope == null ? nos : nos.filter((no) => wardScope.includes(no));
      const inScope: readonly number[] =
        wardNo != null
          ? scopedToRole([wardNo])
          : scopedToRole(
              eager || !wards
                ? (wards?.wards ?? []).map((ward) => ward.wardNo)
                : wards.wards.slice(0, visibleWards).map((ward) => ward.wardNo)
            );

      // --- Overlay + queue: local, fast, and the reason a cached row can show
      // its own edits without any network at all.
      const overlay =
        inScope.length === 1
          ? await loadWardOverlay(overlayStorage, inScope[0])
          : // More than one ward, so every ward's overlay has to come with it —
            // otherwise edits vanish the moment the selector is set to "All".
            // Still scoped to `inScope`: loading overlays for wards whose rows
            // have not been fetched is work with nothing to attach them to.
            (await Promise.all(
              inScope.map((ward) => loadWardOverlay(overlayStorage, ward))
            )).reduce<Record<string, VoterOverlay>>(
              (acc, wardOverlay) => Object.assign(acc, wardOverlay),
              {}
            );
      const queue = await loadQueue(overlayStorage);
      if (!commit(setOverlays, overlay)) return;
      commit(setPendingIds, new Set(queue.map((entry) => entry.voterId)));

      // --- Cache pass: render what the device already has, immediately.
      //
      // `haveRows` starts from what is *already on screen* (the bundled
      // seed above), not only from what this pass reads: a cache miss must
      // not flip `loading` on over rows the render just painted.
      let haveRows = rowsRef.current.length > 0;
      if (inScope.length === 1) {
        const cached = await readWard(cacheStorage, inScope[0]);
        if (cancelled || token !== requestRef.current) return;
        // `cached.voters.length` matters, not just `cached`: a cache entry
        // written empty (a failed fetch that still persisted its result) used
        // to pass `if (cached)` and commit an empty array — which replaced the
        // rows the bundled seed had just painted, with `loading` already false.
        // That is the "renders a few rows then empty" report exactly.
        if (cached && cached.voters.length > 0) {
          haveRows = commit(setRows, cached.voters);
          if (haveRows) {
            commit(setStale, true);
            commit(setRefreshedAt, cached.savedAt);
          }
        }
      } else if (inScope.length) {
        // Several wards: stitch together whichever per-ward copies exist. Wards
        // with no copy are simply missing from the first paint and arrive with
        // the network result.
        const wanted = new Set(inScope);
        const cachedByWard = await readAll(
          cacheStorage,
          (wards?.wards ?? []).filter((ward) => wanted.has(ward.wardNo))
        );
        if (cancelled || token !== requestRef.current) return;
        const stitched = [...cachedByWard.values()].flatMap((entry) => entry.voters);
        if (stitched.length > 0) {
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
        // One query per ward, in parallel. A single `where wardNo == n` is
        // ~500 documents — small enough that three of them at once is a much
        // shorter wait than one query for all 6,855, and each result is its own
        // cache entry either way.
        const byWard = await Promise.all(
          inScope.map(async (scope) => ({
            wardNo: scope,
            voters: await source.getVoters(scope),
          }))
        );
        const voters = byWard.flatMap((entry) => entry.voters);
        if (inScope.length === 0 || voters.length === 0) {
          // Two ways a pass can come back with nothing: ward metadata has not
          // arrived yet (empty scope), or every scoped fetch returned empty
          // (bad ward number, rules regression). Committing that would blank
          // rows the seed or a previous fetch already painted — an empty
          // *result* must never replace non-empty *state*. The effect re-runs
          // the moment `wards` lands and loads the real scope.
        } else {
          if (!commit(setRows, voters)) return;
          commit(setStale, false);
          commit(setConnected, true);
          commit(setError, null);
          const now = Date.now();
          commit(setRefreshedAt, now);
        }

        // Persist per ward so the *next* cold start is a cache hit. Each ward
        // gets its own key rather than one giant blob rewritten on every fetch.
        // Empty results are skipped: overwriting a good cache entry with an
        // empty one would manufacture the blank-list bug on the next launch.
        await Promise.all(
          byWard
            .filter((entry) => entry.voters.length > 0)
            .map((entry) => writeWard(cacheStorage, entry.wardNo, entry.voters))
        );
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
          // Cleared here rather than by a separate effect: only the newest
          // request knows it finished, so a superseded batch cannot switch the
          // footer spinner off while its rows are still on the way.
          setLoadingMore(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, wardNo, attempt, wards, revision, visibleWards, eager, wardScopeKey]);

  // Switching ward starts the paging over. Without this, choosing "All" after
  // reading deep into the list would leave the previously-loaded slice in place
  // and silently show a different set of wards than the label claims.
  //
  // React's documented "adjust state when a prop changes" render-phase
  // pattern rather than an effect calling setState — `react-hooks/set-state-
  // in-effect` rejects the effect version (cascading render), while the
  // guarded render-phase version commits the reset in the same render pass
  // and cannot loop: the guard makes the second evaluation a no-op.
  const wardResetKey = `${String(wardNo)}:${attempt}`;
  const [prevWardResetKey, setPrevWardResetKey] = useState(wardResetKey);
  if (prevWardResetKey !== wardResetKey) {
    setPrevWardResetKey(wardResetKey);
    setVisibleWards(WARD_BATCH);
  }

  const totalWards = wards?.wards.length ?? 0;
  const hasMore = wardNo === null && !eager && visibleWards < totalWards;

  const loadMore = useCallback(() => {
    if (wardNo !== null || eager) return;
    setLoadingMore(true);
    setVisibleWards((count) => Math.min(count + WARD_BATCH, Math.max(totalWards, count)));
  }, [wardNo, eager, totalWards]);

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
    loadMore,
    hasMore,
    loadingMore,
    retry,
    refresh,
    find,
  };
}