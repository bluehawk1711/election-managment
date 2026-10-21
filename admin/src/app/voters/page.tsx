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
 *
 * Bilingual by construction: the bundled rows carry both scripts (`nameEn`
 * & co. generated beside their Hindi source), so the list shows both and
 * the index covers both — a Latin query finds Devanagari rows and vice
 * versa, which is the whole point of shipping the English copies.
 *
 * Karykarta see only their own ward (`visibleWards`), the same scope the
 * mobile app applies; the ward selector offers exactly the allowed wards.
 */
import { FileText, Search, Users } from 'lucide-react';
import { MotionPage } from '@/components/shell/motion-page';
import { Button, Chip, EmptyState, Input, Panel, Select, Skeleton } from '@/components/ui/kit';
import { VoterSlipModal } from '@/components/voters/voter-slip';
import { useSession } from '@/stores/session';
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
import type { RollVoter, VoterView, WardMeta, WardsBundle } from '@/lib/roll/types';
import { viewOf } from '@/lib/roll/types';
import { cn } from '@/lib/util';
import { useEffect, useMemo, useState } from 'react';

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

  const [bundle, setBundle] = useState<WardsBundle | null>(null);
  const [rows, setRows] = useState<VoterView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const [ward, setWard] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const [scopes, setScopes] = useState<SearchScope[]>(['name']);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [slip, setSlip] = useState<VoterView | null>(null);

  const allowed = useMemo(
    () => (bundle ? visibleWards(role, { wardNo }, bundle.wards.map((w) => w.wardNo)) : null),
    [role, wardNo, bundle]
  );

  const mayRead = can(role, 'voterRead');

  // One load of the whole bundled roll — 3.8 MB of static JSON, cached by
  // the browser and by `bundled.ts` for the session after that.
  useEffect(() => {
    if (!mayRead) return;
    let cancelled = false;
    Promise.all([getWards(), getAllVoters()])
      .then(([wards, voters]) => {
        if (cancelled) return;
        setBundle(wards);
        setRows(voters.map((voter: RollVoter) => viewOf(voter)));
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
    if (!rows) return null;
    const visible =
      allowed === null ? rows : rows.filter((row) => allowed.includes(row.wardNo));
    return activeWard === 'all'
      ? visible
      : visible.filter((row) => row.wardNo === activeWard);
  }, [rows, allowed, activeWard]);

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
    <MotionPage className='space-y-5'>
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
            <RollRow key={row.id} row={row} onOpen={() => openSlip(row)} />
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
function RollRow({ row, onOpen }: { row: VoterView; onOpen: () => void }) {
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
      <Panel className='flex items-start gap-4 p-4 transition-colors hover:border-brand-400/40'>
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
