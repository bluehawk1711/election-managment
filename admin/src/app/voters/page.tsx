'use client';

/**
 * The voter roll — the panel's copy of the field app's list screen, over the
 * SAME bundled artefact and the SAME search stack:
 *
 *   data     `public/roll/*.json` + `public/photos/ward-NN/*.jpg`, copied
 *            from `mobile/assets/` (see `lib/roll/bundled.ts` for why static
 *            files instead of Firestore — the rules have no collection-level
 *            roll read, which is what forced the old redirect to /changes)
 *   search   `lib/roll/search.ts` + `translit.ts`, byte-identical ports of
 *            mobile's: token-AND over a per-scope key, native + phonetic +
 *            English-substring, ranked so exact and word-start hits lead.
 *            The scope chips (name / father / locality / other) are the
 *            mobile list's own badge row, same toggle rule: at least one.
 *   rows     photo, Hindi name with its English copy underneath, father,
 *            ward/serial chips, EPIC, house, age/gender, locality — the
 *            mobile card's "labelled slots, not a run-on sentence" layout,
 *            in the panel's dark idiom.
 *   slip     one tap opens `VoterSlipModal` — the printable मतदाता पर्ची
 *            (mock: `public/clipboard-image.png`).
 *   select   tick rows (or Select page) to drive the two bulk actions:
 *            `VoterSlipsBatchModal` tiles compact slips 3 × 7 per A4 sheet,
 *            and `BulkPhoneModal` is mobile's one-number-fills-all editor.
 *   overlay  the signed-in account's `users/{uid}/voterEdits` is merged over
 *            the bundled rows, so a bulk-saved number and a phone-side
 *            correction appear live without a reload.
 *
 * Bilingual by construction: the bundled rows carry both scripts (`nameEn`
 * & co. generated beside their Hindi source), so the list shows both and
 * the index covers both — a Latin query finds Devanagari rows and vice
 * versa, which is the whole point of shipping the English copies.
 *
 * Karykarta see only their own ward (`visibleWards`), the same scope the
 * mobile app applies; the ward selector offers exactly the allowed wards.
 */
import { Check, FileText, Phone, Printer, Search, Users } from 'lucide-react';
import { MotionPage } from '@/components/shell/motion-page';
import { Button, Chip, EmptyState, Input, Panel, Select, Skeleton } from '@/components/ui/kit';
import { BulkPhoneModal } from '@/components/voters/bulk-phone-modal';
import { VoterSlipModal } from '@/components/voters/voter-slip';
import { VoterSlipsBatchModal, type BatchSlipItem } from '@/components/voters/voter-slips-batch';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { useSession } from '@/stores/session';
import { useUi } from '@/stores/ui';
import { buildMyEditsQuery } from '@/lib/api';
import { can, visibleWards } from '@/lib/roles';
import { getAllVoters, getWards, photoUrlFor } from '@/lib/roll/bundled';
import {
  buildIndex,
  searchVoters,
  SEARCH_SCOPES,
  type SearchScope,
  type SearchIndex,
} from '@/lib/roll/search';
import { buildSlipData } from '@/lib/roll/slip';
import type {
  RollVoter,
  VoterOverlay,
  VoterView,
  WardMeta,
  WardsBundle,
} from '@/lib/roll/types';
import { viewOf } from '@/lib/roll/types';
import { cn } from '@/lib/util';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** The scope chips' labels — same four groups the mobile list exposes. */
const SCOPE_LABELS: Record<SearchScope, string> = {
  name: 'नाम / Name',
  father: 'पिता / Father',
  locality: 'मोहल्ला / Locality',
  other: 'अन्य / Other',
};

/** How many rows one page of the list renders — the rest wait for "more". */
const PAGE_SIZE = 60;

export default function VotersPage() {
  const role = useSession((s) => s.role);
  const wardNo = useSession((s) => s.wardNo);
  const uid = useSession((s) => s.uid);

  const [bundle, setBundle] = useState<WardsBundle | null>(null);
  const [rows, setRows] = useState<RollVoter[] | null>(null);
  const [failed, setFailed] = useState(false);

  const [ward, setWard] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [scopes, setScopes] = useState<SearchScope[]>(['name']);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [slip, setSlip] = useState<VoterView | null>(null);

  /**
   * Ticked voters, shared by the two bulk actions: `Print slips` tiles their
   * papers on A4, and `Bulk phone` opens mobile's phone-update screen. Ids,
   * not row objects — a live overlay update replaces the row while the
   * selection must survive.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkPhoneOpen, setBulkPhoneOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const allowed = useMemo(
    () => (bundle ? visibleWards(role, { wardNo }, bundle.wards.map((w) => w.wardNo)) : null),
    [role, wardNo, bundle]
  );

  const mayRead = can(role, 'voterRead');

  /**
   * The signed-in account's private overlay — the same `voterEdits` documents
   * the mobile sync pushes and the single-voter drawer writes. The bundled
   * roll stays the base; this subscription only overlays the rows this
   * account has edited, so a bulk-saved phone number is visible immediately
   * and a number saved on the phone appears here without a reload.
   */
  const editsQuery = useLiveQuery<Array<{ id: string; overlay: VoterOverlay }>>({
    key: ['my-voter-edits', uid ?? '-'],
    enabled: mayRead && uid != null,
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(
        buildMyEditsQuery(uid ?? '-'),
        (entry) => ({ id: entry.id, overlay: entry.data() as VoterOverlay }),
        emit,
        fail
      ),
  });

  const overlayById = useMemo(
    () =>
      new Map(
        (editsQuery.data ?? []).map((entry) => [entry.id, entry.overlay])
      ),
    [editsQuery.data]
  );

  /** Bundled rows with this account's overlay applied — what the page renders. */
  const viewRows = useMemo(
    () =>
      rows
        ? rows.map((voter) => viewOf(voter, overlayById.get(voter.id)))
        : null,
    [rows, overlayById]
  );

  // One load of the whole bundled roll — 3.8 MB of static JSON, cached by
  // the browser and by `bundled.ts` for the session after that.
  useEffect(() => {
    if (!mayRead) return;
    let cancelled = false;
    Promise.all([getWards(), getAllVoters()])
      .then(([wards, voters]) => {
        if (cancelled) return;
        setBundle(wards);
        setRows(voters);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mayRead]);

  /** The ward selector's own list — already narrowed to the role. */
  const wardOptions = useMemo(() => {
    if (!bundle) return [];
    const all = bundle.wards.map((meta: WardMeta) => meta.wardNo);
    return allowed === null ? all : allowed;
  }, [bundle, allowed]);

  /**
   * A karykarta's one ward IS their scope — derived, not stored, so a
   * profile snapshot arriving late cannot leave `ward` pointing outside
   * `allowed` (the stale-selection bug an effect-driven `setWard` had).
   */
  const activeWard = useMemo(
    () => (allowed && allowed.length === 1 ? allowed[0] : ward),
    [allowed, ward]
  );

  /** Ward-scoped rows — the list never shows a ward the role cannot read. */
  const scoped = useMemo(() => {
    if (!viewRows) return null;
    const visible =
      allowed === null
        ? viewRows
        : viewRows.filter((row) => allowed.includes(row.wardNo));
    return activeWard === 'all'
      ? visible
      : visible.filter((row) => row.wardNo === activeWard);
  }, [viewRows, allowed, activeWard]);

  /** The search index — built once per loaded row set, never per keystroke. */
  const index = useMemo<SearchIndex>(
    () => (scoped ? buildIndex(scoped) : new Map()),
    [scoped]
  );

  /** Mobile's own ranking: exact and word-start hits lead, stable order. */
  const filtered = useMemo(
    () => (scoped ? searchVoters(scoped, index, query, scopes) : null),
    [scoped, index, query, scopes]
  );

  const toggleScope = (scope: SearchScope) => {
    setScopes((current) => {
      if (!current.includes(scope)) return [...current, scope];
      // The mobile rule: at least one scope always stays on.
      return current.length > 1 ? current.filter((item) => item !== scope) : current;
    });
  };

  const wardMeta = useMemo(
    () => new Map((bundle?.wards ?? []).map((meta: WardMeta) => [meta.wardNo, meta])),
    [bundle]
  );

  /**
   * Everything the role may touch, not just the current search/ward slice.
   * Selection deliberately survives a search or ward change: the operator
   * ticks voters while scanning, then prints the whole stack.
   */
  const selectableRows = useMemo(() => {
    if (!viewRows) return [];
    return allowed === null
      ? viewRows
      : viewRows.filter((row) => allowed.includes(row.wardNo));
  }, [viewRows, allowed]);

  const selectedRows = useMemo(
    () => selectableRows.filter((row) => selectedIds.has(row.id)),
    [selectableRows, selectedIds]
  );

  const toggleSelected = (voterId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(voterId)) next.delete(voterId);
      else next.add(voterId);
      return next;
    });
  };

  /** Tick the current page — the fast path to a 21-slip A4 sheet. */
  const selectShown = () => {
    if (!filtered) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const row of filtered.slice(0, shown)) next.add(row.id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const batchItems = useMemo<BatchSlipItem[]>(
    () =>
      selectedRows.map((row) => ({
        id: row.id,
        data: buildSlipData({
          voter: row,
          ward: wardMeta.get(row.wardNo),
          photoUrl: photoUrlFor(row.id, row.wardNo),
        }),
      })),
    [selectedRows, wardMeta]
  );

  const openSlip = (row: VoterView) => {
    setSlip(row);
  };

  const slipPayload = useMemo(() => {
    if (!slip) return null;
    return buildSlipData({
      voter: slip,
      ward: wardMeta.get(slip.wardNo),
      photoUrl: photoUrlFor(slip.id, slip.wardNo),
    });
  }, [slip, wardMeta]);

  /* ------------------------------------------------------------------ gates */

  if (!mayRead) {
    return (
      <MotionPage>
        <EmptyState
          icon={<Users className='size-5' />}
          title='No access'
          detail='This account has no voter-read capability — ask an admin for a role.'
        />
      </MotionPage>
    );
  }

  return (
    <MotionPage
      className={cn('space-y-5', selectedRows.length > 0 && 'pb-24')}
    >
      {/* ── header + controls ─────────────────────────────────────── */}
      <Panel className='flex flex-col gap-3 p-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='text-lg font-semibold text-mist-50'>Voter roll</h1>
          {filtered ? (
            <span className='text-xs text-mist-600'>
              {filtered.length.toLocaleString()} / {(bundle?.total ?? 0).toLocaleString()} voters
            </span>
          ) : null}
          <div className='ml-auto w-64'>
          <Select
            value={activeWard === 'all' ? 'all' : String(activeWard)}
              onChange={(event) =>
                setWard(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
              aria-label='वार्ड'
            >
              <option value='all'>सभी वार्ड / All wards</option>
              {wardOptions.map((no) => (
                <option key={no} value={no}>
                  वार्ड {no}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className='relative'>
          <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-600' />
          <Input
            className='pl-9'
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE_SIZE);
            }}
            placeholder='नाम, EPIC, मकान, मोहल्ला खोजें… (राम / ramesh)'
            aria-label='मतदाता खोजें'
          />
        </div>

        {/* The mobile badge row: which fields the query covers. Always at
            least one chip on, so "search found nothing" can never mean
            "you were searching the wrong field". */}
        <div className='flex flex-wrap gap-2'>
          {SEARCH_SCOPES.map((scope) => (
            <Chip
              key={scope}
              active={scopes.includes(scope)}
              onClick={() => toggleScope(scope)}
            >
              {SCOPE_LABELS[scope]}
            </Chip>
          ))}
        </div>

        {/* Selection survives a scroll: the actions themselves live in the
            floating bar below, so a tick 40 rows down is still one press from
            printing. This row only starts the selection. */}
        <div className='flex flex-wrap items-center gap-2 border-t border-line pt-3'>
          <span className='text-xs text-mist-600'>
            {selectedRows.length > 0
              ? `${selectedRows.length.toLocaleString()} selected · use the action bar below`
              : 'Select voters to print slips or update phone numbers in bulk.'}
          </span>
          <Button
            variant='ghost'
            className='ml-auto'
            onClick={selectShown}
            disabled={!filtered || filtered.length === 0}
          >
            Select page (
            {filtered ? Math.min(shown, filtered.length).toLocaleString() : 0})
          </Button>
        </div>
      </Panel>

      {/* ── states ────────────────────────────────────────────────── */}
      {failed ? (
        <EmptyState
          icon={<FileText className='size-5' />}
          title='Roll data unavailable'
          detail='public/roll/ could not be loaded. Re-copy mobile/assets/roll into admin/public/roll and reload.'
        />
      ) : !filtered ? (
        <Panel className='space-y-3 p-4'>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className='h-20 w-full' />
          ))}
        </Panel>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className='size-5' />}
          title='कोई मतदाता नहीं मिला'
          detail={
            query.trim()
              ? `No voter matches “${query.trim()}” in the selected fields. Try another scope chip, or All wards.`
              : 'This ward has no rows in the bundled roll.'
          }
        />
      ) : (
        /* ── the list ──────────────────────────────────────────────── */
        <div className='space-y-3'>
          {filtered.slice(0, shown).map((row) => (
            <RollRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              onToggle={() => toggleSelected(row.id)}
              onOpen={() => openSlip(row)}
            />
          ))}
          {filtered.length > shown ? (
            <Panel className='p-3 text-center'>
              <Button variant='secondary' onClick={() => setShown((n) => n + PAGE_SIZE)}>
                और दिखाएँ / Show more ({(filtered.length - shown).toLocaleString()} left)
              </Button>
            </Panel>
          ) : null}
        </div>
      )}

      {/* ── the selection bar (portalled: the page animates with a transform,
             and a fixed child of that transform would scroll with the page) ── */}
      {selectedRows.length > 0 ? (
        <SelectionBar
          count={selectedRows.length}
          onBulkPhone={() => setBulkPhoneOpen(true)}
          onPrint={() => setBatchOpen(true)}
          onClear={clearSelection}
        />
      ) : null}

      {/* ── the slip ───────────────────────────────────────────────── */}
      {slip && slipPayload ? (
        <VoterSlipModal
          // Remount per voter: the modal's phone/rang/photo state is
          // seeded lazily per mount, so the key IS the reset mechanism.
          key={slip.id}
          data={slipPayload}
          voterId={slip.id}
          onClose={() => setSlip(null)}
        />
      ) : null}

      {/* ── the batch sheet ────────────────────────────────────────── */}
      {batchOpen && batchItems.length > 0 ? (
        <VoterSlipsBatchModal
          items={batchItems}
          onClose={() => setBatchOpen(false)}
        />
      ) : null}

      {/* ── bulk phone, the mobile screen ──────────────────────────── */}
      {bulkPhoneOpen && selectedRows.length > 0 ? (
        <BulkPhoneModal
          voters={selectedRows}
          onSaved={clearSelection}
          onClose={() => setBulkPhoneOpen(false)}
        />
      ) : null}
    </MotionPage>
  );
}

/* -------------------------------------------------------------------- row */

/**
 * One voter in the list — the mobile `VoterCard`'s slot layout in the
 * panel's idiom: photo, the Hindi name with its English copy under it, the
 * labelled data slots, and the slip button. Clicking the row opens the slip;
 * the EPIC stays selectable text (people copy it constantly).
 */
function RollRow({
  row,
  selected,
  onToggle,
  onOpen,
}: {
  row: VoterView;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const e = row.effective;
  const photo = photoUrlFor(row.id, row.wardNo);

  return (
    <div
      className='cursor-pointer'
      onClick={onOpen}
      role='button'
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <Panel
        className={cn(
          'flex items-start gap-3 p-4 transition-colors hover:border-brand-400/40',
          selected && 'border-brand-400/60 bg-brand-500/[0.06]'
        )}
      >
      {/* The tick is what "select these for the batch" means; it sits before
          the photo so a scanned column of ticks reads as one stack. */}
      <button
        type='button'
        role='checkbox'
        aria-checked={selected}
        aria-label={`Select ${e.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          'mt-5 grid size-5 shrink-0 place-items-center rounded border transition-colors',
          selected
            ? 'border-brand-400 bg-brand-500 text-white'
            : 'border-line-strong bg-white/[0.03] text-transparent hover:border-brand-400/60'
        )}
      >
        <Check className='size-3.5' strokeWidth={3} />
      </button>

      {/* Photo — placeholder box when the bundle has no portrait for this
          id, exactly the mobile precedence minus the user-captured layer. */}
      {photo && !photoFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt={e.name}
          onError={() => setPhotoFailed(true)}
          className='size-16 shrink-0 rounded-lg border border-line object-cover'
        />
      ) : (
        <div className='grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-line text-[10px] text-mist-600'>
          फोटो
        </div>
      )}

      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
          {/* Both scripts, Hindi leading — the row answers "who" in the
              language it is spoken and in the one it is typed. */}
          <span className='truncate text-[15px] font-semibold text-mist-50'>
            {e.name}
          </span>
          {row.nameEn ? (
            <span className='truncate text-xs text-mist-600'>{row.nameEn}</span>
          ) : null}
        </div>

        <div className='mt-0.5 truncate text-xs text-mist-400'>
          {row.relationLabel} {e.fatherOrHusbandName}
          {row.fatherOrHusbandNameEn ? ` · ${row.fatherOrHusbandNameEn}` : ''}
        </div>

        <div className='mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
          <Slot label='वार्ड' value={String(row.wardNo).padStart(2, '0')} />
          <Slot label='क्रमांक' value={String(row.serialNo)} />
          <Slot label='EPIC' value={row.epicId} mono />
          {e.phone ? <Slot label='मोबाइल' value={e.phone} mono /> : null}
          <Slot label='मकान' value={e.houseNo || '—'} />
          <Slot label='आयु/लिंग' value={`${row.age} / ${row.gender === 'female' ? 'महिला' : row.gender === 'male' ? 'पुरुष' : 'अन्य'}`} />
          {e.locality ? (
            <span className='truncate text-mist-400'>
              <span className='text-mist-600'>मोहल्ला: </span>
              {e.locality}
              {row.localityEn ? <span className='text-mist-600'> · {row.localityEn}</span> : null}
            </span>
          ) : null}
        </div>
      </div>

      <Button
        variant='secondary'
        className='shrink-0'
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <FileText className='size-3.5' />
        पर्ची
      </Button>
      </Panel>
    </div>
  );
}

/** `label: value` — one fixed slot, the mobile card's inline pair. */
function Slot({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span className='whitespace-nowrap'>
      <span className='text-mist-600'>{label}: </span>
      <span className={cn('font-medium text-mist-200', mono && 'font-mono')}>{value}</span>
    </span>
  );
}

/**
 * The two bulk actions, pinned to the viewport rather than left at the head of
 * a sixty-row page. Portalled to <body> because the routed page animates with
 * a transform, which would otherwise become the containing block for a
 * `position: fixed` child and make the bar scroll with the list.
 */
function SelectionBar({
  count,
  onBulkPhone,
  onPrint,
  onClear,
}: {
  count: number;
  onBulkPhone: () => void;
  onPrint: () => void;
  onClear: () => void;
}) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'fixed bottom-0 right-0 z-40 border-t border-line bg-ink-900/95 px-4 py-3 shadow-[0_-24px_50px_-30px_rgb(0_0_0/0.9)] backdrop-blur transition-[left] duration-200 sm:px-6',
        // Match the shell's content offset: the bar must not cover the rail.
        collapsed ? 'left-0 md:left-[84px]' : 'left-0 md:left-[264px]'
      )}
    >
      <div className='mx-auto flex max-w-6xl flex-wrap items-center gap-2'>
        <span className='text-xs font-semibold text-brand-400'>
          {count.toLocaleString()} selected
        </span>
        <span className='hidden text-xs text-mist-600 sm:inline'>
          · one A4 sheet holds 21 slips
        </span>
        <Button variant='secondary' className='ml-auto' onClick={onBulkPhone}>
          <Phone className='size-3.5' />
          Bulk phone
        </Button>
        <Button variant='primary' onClick={onPrint}>
          <Printer className='size-3.5' />
          Print slips ({count.toLocaleString()})
        </Button>
        <Button variant='ghost' onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>,
    document.body
  );
}
