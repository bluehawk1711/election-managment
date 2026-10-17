'use client';

/**
 * The voter roll — browse one ward at a time, search it in memory, open a row
 * into the edit drawer.
 *
 * Why ward-at-a-time rather than "all wards": the roll is ~90k rows, and the
 * queries here deliberately stay inside Firestore's FREE tier shapes — a
 * single equality filter per read (automatic single-field index, zero
 * composite-index management, exactly the rule `firestore.indexes.json`
 * documents) and in-memory filtering for everything else. The search box,
 * gender/edited markers and pagination are all client-side consequences of
 * that one decision.
 *
 * Scope enforcement mirrors `mobile/lib/roles.ts`: `visibleWards` decides the
 * chip list (a karykarta sees exactly their ward, an unrestricted role sees
 * every ward), and the fact of FORKING from `wards/{n}.voterCount` means the
 * numbers under the chips are official, not recounted.
 *
 * The overlay map (`myEdits`) is the signed-in account's OWN edits — that is
 * the only overlay collection `firestore.rules` lets anyone read (fieldwork
 * is account-private by design). The dot on a row therefore means "I edited
 * this", and the drawer merges it over the base row before rendering.
 */
import { Search, Users, ChevronRight, Phone, PenLine, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { buildVotersQuery, buildWardsQuery, buildMyEditsQuery } from '@/lib/api';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { voterFromDoc, wardFromDoc } from '@/lib/mappers';
import { visibleWards } from '@/lib/roles';
import { cn } from '@/lib/util';
import type { VoterOverlay, VoterRow, WardMeta } from '@/lib/types';
import { VoterDrawer } from '@/components/voters/voter-drawer';
import { MotionPage } from '@/components/shell/motion-page';
import { Chip, EmptyState, Input, Panel, Skeleton } from '@/components/ui/kit';
import { useSession } from '@/stores/session';

const PAGE_STEP = 150;

export default function VotersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const uid = useSession((s) => s.uid);
  const role = useSession((s) => s.role);
  const myWard = useSession((s) => s.wardNo);

  /* ---- wards: shared cache key with the dashboard ---- */
  const wardQuery = useLiveQuery<WardMeta[]>({
    key: ['wards'],
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildWardsQuery(), wardFromDoc, emit, fail),
  });

  const wards = useMemo(
    () =>
      (wardQuery.data ?? [])
        .filter((ward) => Number.isFinite(ward.wardNo) && ward.voterCount > 0)
        .sort((a, b) => a.wardNo - b.wardNo),
    [wardQuery.data]
  );

  /* ---- scope: which chips exist at all ---- */
  const allowed = useMemo(
    () => visibleWards(role, { wardNo: myWard }, wards.map((ward) => ward.wardNo)),
    [role, myWard, wards]
  );
  const wardNumbers = useMemo(() => {
    const all = wards.map((ward) => ward.wardNo);
    return allowed === null ? all : all.filter((number) => allowed.includes(number));
  }, [allowed, wards]);

  const [selectedWard, setSelectedWard] = useState<number | null>(null);

  // Default to the first REACHABLE ward (karykarta lands on their own), and
  // re-seat whenever scope shrinks the current selection out of existence.
  useEffect(() => {
    if (wardNumbers.length === 0) return;
    if (selectedWard === null || !wardNumbers.includes(selectedWard)) {
      setSelectedWard(wardNumbers[0]);
    }
  }, [wardNumbers, selectedWard]);

  const wardAllowed =
    selectedWard !== null &&
    (allowed === null || allowed.includes(selectedWard));

  /* ---- the roll rows of the selected ward ---- */
  const votersQuery = useLiveQuery<VoterRow[]>({
    key: ['voters', selectedWard],
    enabled: wardAllowed,
    subscribe: ({ emit, fail }) => {
      const ward = selectedWard;
      if (ward === null) return () => {};
      return subscribeCollectionOf(buildVotersQuery(ward), voterFromDoc, emit, fail);
    },
  });

  /* ---- this account's overlays (edited markers + drawer merge) ---- */
  const overlayPairs = useLiveQuery<Array<{ id: string; overlay: VoterOverlay }>>({
    key: ['myEdits', uid ?? 'anon'],
    enabled: !!uid,
    subscribe: ({ emit, fail }) => {
      if (!uid) return () => {};
      return subscribeCollectionOf(buildMyEditsQuery(uid), (entry) => {
        const data = entry.data();
        return {
          id: entry.id,
          overlay: {
            ...(data as unknown as VoterOverlay),
            // Bookkeeping guarded per-field: an overlay doc always carries
            // them, but TS cannot narrow the same `.data()` expression twice.
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
            updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
          },
        };
      }, emit, fail);
    },
  });

  const overlays = useMemo(() => {
    const map = new Map<string, VoterOverlay>();
    for (const pair of overlayPairs.data ?? []) map.set(pair.id, pair.overlay);
    return map;
  }, [overlayPairs.data]);

  /* ---- search + pagination ---- */
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE_STEP);

  const matches = useMemo(() => {
    const rows = votersQuery.data ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) =>
          `${row.name} ${row.fatherOrHusbandName} ${row.houseNo} ${row.locality} ${row.epicId}`
            .toLowerCase()
            .includes(needle)
        )
      : rows;
    // Serial order first — the roll's own line order — then whatever else.
    return [...filtered].sort((a, b) => a.serialNo - b.serialNo);
  }, [votersQuery.data, search]);

  useEffect(() => setShown(PAGE_STEP), [search, selectedWard]);

  /* ---- drawer ---- */
  const [openId, setOpenId] = useState<string | null>(null);
  const openVoter = useMemo(
    () => (openId ? (votersQuery.data ?? []).find((row) => row.id === openId) ?? null : null),
    [openId, votersQuery.data]
  );

  // Deep-linkable: /voters#w3-1 mirrors the open drawer, so a row can be
  // linked in chat and lands with the sheet already up.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace('#', ''));
    if (hash && !openId) {
      const exists = (votersQuery.data ?? []).some((row) => row.id === hash);
      if (exists) setOpenId(hash);
    }
    // Only on first data arrival — later hash edits are ours to ignore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votersQuery.data]);

  const closeDrawer = () => {
    setOpenId(null);
    if (window.location.hash) {
      router.replace(pathname);
    }
  };

  const wardMeta = wards.find((ward) => ward.wardNo === selectedWard);
  const loadingWards = wardQuery.isLoading;
  const loadingVoters = votersQuery.isLoading;
  const noScope = wardNumbers.length === 0;

  return (
    <MotionPage className="space-y-5">
      {/* Header row: scope + search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-mist-50">Voter roll</h2>
          <p className="text-sm text-mist-400">
            {noScope
              ? 'No ward assigned to your account yet.'
              : wardMeta
                ? `Ward ${wardMeta.wardNo} · ${wardMeta.voterCount.toLocaleString('en-IN')} voters · booth ${wardMeta.boothNo || '—'}`
                : 'Select a ward.'}
          </p>
        </div>

        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mist-600" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, father/husband, house, locality, EPIC…"
            className="pl-10 pr-9"
            disabled={noScope || !wardAllowed}
            aria-label="Search within ward"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-mist-600 hover:text-mist-200"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Ward chips */}
      <div className="scroll flex gap-2 overflow-x-auto pb-1">
        {loadingWards ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-24 shrink-0 rounded-full" />
          ))
        ) : noScope ? (
          <p className="py-1 text-xs text-mist-600">
            A super admin must grant you a ward before the roll becomes readable — the same
            restriction `firestore.rules` enforces on every query here.
          </p>
        ) : (
          wardNumbers.map((wardNo) => {
            const meta = wards.find((ward) => ward.wardNo === wardNo);
            return (
              <Chip
                key={wardNo}
                active={selectedWard === wardNo}
                onClick={() => setSelectedWard(wardNo)}
                className="shrink-0"
              >
                Ward {wardNo}
                {meta ? (
                  <span className="ml-1.5 text-[10px] tabular-nums opacity-70">
                    {(meta.voterCount / 1000).toFixed(1)}k
                  </span>
                ) : null}
              </Chip>
            );
          })
        )}
      </div>

      {/* Table */}
      <Panel className="overflow-hidden">
        {loadingVoters ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
        ) : matches.length === 0 ? (
          <EmptyState
            icon={noScope ? <Users className="size-5" /> : <Search className="size-5" />}
            title={
              noScope
                ? 'Your account has no ward scope'
                : search
                  ? 'No voter matches this search'
                  : 'No voters in this ward'
            }
            detail={
              noScope
                ? undefined
                : search
                  ? 'Search runs inside the selected ward only — try fewer words, or a house number.'
                  : 'The ward exists in the cover sheet but no voter rows answered this query. Has the roll been seeded?'
            }
            action={
              search ? undefined : (
                <button onClick={() => setSearch('')} className="text-xs text-brand-400 underline-offset-4 hover:underline">
                  Clear the search
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="scroll max-h-[calc(100vh-320px)] overflow-y-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-ink-800/95 backdrop-blur">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-mist-600">
                    <th className="px-4 py-3 font-semibold">Serial</th>
                    <th className="px-4 py-3 font-semibold">Voter</th>
                    <th className="hidden px-4 py-3 font-semibold md:table-cell">
                      Father / husband
                    </th>
                    <th className="px-4 py-3 font-semibold">House</th>
                    <th className="hidden px-4 py-3 font-semibold lg:table-cell">Locality</th>
                    <th className="px-4 py-3 text-right font-semibold">Age · Sex</th>
                    <th className="w-16 px-4 py-3" aria-label="status" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {matches.slice(0, shown).map((row) => {
                    const overlay = overlays.get(row.id);
                    const name = overlay?.name ?? row.name;
                    const edited = !!overlay;
                    const hasPhone = !!overlay?.phone;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => {
                          setOpenId(row.id);
                          window.location.hash = row.id;
                        }}
                        className={cn(
                          'group cursor-pointer transition-colors hover:bg-brand-500/[0.06]',
                          openId === row.id && 'bg-brand-500/[0.09]'
                        )}
                      >
                        <td className="px-4 py-2.5 text-xs tabular-nums text-mist-600">
                          {row.serialNo}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-mist-50">{name}</span>
                            {edited ? (
                              <span
                                title="You have corrections on this voter"
                                className="inline-flex size-4 place-items-center rounded-full border border-brand-400/40 bg-brand-500/15"
                              >
                                <PenLine className="size-2.5 text-brand-400" />
                              </span>
                            ) : null}
                            {hasPhone ? (
                              <Phone className="size-3 text-signal-emerald" aria-label="phone on file" />
                            ) : null}
                          </div>
                          <span className="font-mono text-[10px] text-mist-600">
                            {row.epicId || '—'}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-mist-400 md:table-cell">
                          <span className="block max-w-[180px] truncate">
                            {(overlay?.fatherOrHusbandName ?? row.fatherOrHusbandName) || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-mist-200">
                          {(overlay?.houseNo ?? row.houseNo) || '—'}
                        </td>
                        <td className="hidden px-4 py-2.5 text-mist-400 lg:table-cell">
                          <span className="block max-w-[180px] truncate">
                            {(overlay?.locality ?? row.locality) || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums text-mist-400">
                          {overlay?.age ?? row.age} ·{' '}
                          <span className="uppercase">{(overlay?.gender ?? row.gender)[0]}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <ChevronRight className="inline size-4 text-mist-600 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-400" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Result bookkeeping */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <p className="text-xs text-mist-600">
                Showing {Math.min(shown, matches.length).toLocaleString('en-IN')} of{' '}
                {matches.length.toLocaleString('en-IN')}
                {search ? ' matching this search' : ''} in ward {selectedWard}.
              </p>
              {shown < matches.length ? (
                <button
                  onClick={() => setShown((count) => count + PAGE_STEP)}
                  className="rounded-lg border border-line-strong bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-mist-200 transition-colors hover:border-brand-400/50 hover:text-mist-50"
                >
                  Show {Math.min(PAGE_STEP, matches.length - shown)} more
                </button>
              ) : null}
            </div>
          </>
        )}
      </Panel>

      {/* Edit drawer */}
      <AnimatePresence>
        {openVoter ? (
          <VoterDrawer
            key={openVoter.id}
            row={openVoter}
            overlay={overlays.get(openVoter.id) ?? null}
            onClose={closeDrawer}
          />
        ) : null}
      </AnimatePresence>
    </MotionPage>
  );
}