'use client';

/**
 * Voter changes — "which voter data did each user change", the audit
 * surface behind the widened `voterEdits` read rule (`database.rules`:
 * owner or `accountView`).
 *
 * The overlay IS the change record: `lib/roll/sync.ts::remotePayload`
 * mirrors an account's local edits into `users/{uid}/voterEdits/{voterId}`
 * with every key the user actually touched (plus `wardNo`/`updatedAt`/
 * `updatedBy` bookkeeping), and nothing else ever writes there. So:
 *
 *   changed fields = read the document's keys minus the three bookkeeping
 *   values        = the current (effective) values of those fields
 *   when           = `updatedAt`, sorted newest-first
 *   whose          = the selected roster account, by construction
 *
 * Base-roll names are resolved client-side: voter ids are `w{ward}-{serial}`,
 * and the roll is sharded per ward (`votersByWard/{wardNo}`), so one read per
 * involved ward turns ids into names without per-row round-trips — see
 * `resolveNames` for the two strategies and the cap that keeps a big audit
 * from quietly pulling the whole roll. Unresolved ids render as the id —
 * honest (the row may be from a ward not in the roll) and never a spinner
 * that never ends.
 *
 * Gated by `canViewAccounts` exactly like the roster: admins audits people
 * they work with; karykarta never reach this page (their own edits are
 * their own business, on their own devices).
 */
import { History, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { buildMyEditsQuery, buildUsersQuery } from '@/lib/api';
import { getChildren, getDoc } from '@/lib/db';
import { profileFromDoc } from '@/lib/mappers';
import { can } from '@/lib/roles';
import { formatWhen } from '@/lib/util';
import type { Profile } from '@/lib/types';
import { useSession } from '@/stores/session';
import { MotionPage } from '@/components/shell/motion-page';
import {
  Button,
  EmptyState,
  Field,
  Initials,
  Panel,
  RoleBadge,
  Select,
  Skeleton,
} from '@/components/ui/kit';

/** One `users/{uid}/voterEdits/{voterId}` document, raw. */
interface EditEntry {
  id: string;
  data: Record<string, unknown>;
}

/** The keys sync.ts adds on every push — not something the user "changed". */
const BOOKKEEPING = new Set(['wardNo', 'updatedAt', 'updatedBy']);

const str = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : value == null
        ? ''
        : JSON.stringify(value);

/** Field → value pairs the user actually touched, in document key order. */
function changedFields(entry: EditEntry): [string, string][] {
  return Object.keys(entry.data)
    .filter((key) => !BOOKKEEPING.has(key))
    .map((key) => [key, str(entry.data[key])] as [string, string]);
}

/** Resolves voter ids to roll rows — see `resolveNames` for the strategy. */
interface VoterName {
  name: string;
  wardNo: number;
  serialNo: number;
}

/**
 * Above this many unresolved ids the resolver switches from one read PER
 * VOTER to one read PER WARD.
 *
 * Below it, single-node reads are cheaper (a voter is ~200 bytes) and do not
 * drag a ward a user never asked about across the wire. Above it, N round
 * trips would dominate — and the roll is already sharded exactly so a caller
 * can read a ward at a time. The cap exists because RTDB bills bandwidth and
 * the panel has no business re-downloading 6 855 rows to label 300 of them:
 * even the bulk path reads only the wards that actually appear in the audit.
 */
const WHOLE_WARD_THRESHOLD = 20;

/** At most this many reads in flight — the SDK is fine with more, latency is not. */
const READ_CONCURRENCY = 4;

/** `w{wardNo}-{serialNo}` → ward number; anything else reads as `0` (unknown). */
function wardOfId(id: string, fallback: unknown): number {
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  const match = /^w(\d+)-/.exec(id);
  return match ? Number(match[1]) : 0;
}

function nameOf(id: string, data: Record<string, unknown>): VoterName {
  return {
    name: typeof data.name === 'string' ? data.name : id,
    wardNo: typeof data.wardNo === 'number' ? data.wardNo : 0,
    serialNo: typeof data.serialNo === 'number' ? data.serialNo : 0,
  };
}

/**
 * Runs `task` over `items` with a bounded number in flight.
 *
 * A plain `Promise.all` over 300 ids would open 300 sockets' worth of REST
 * calls at once; this keeps the queue moving without the thundering herd.
 */
async function pooled<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(READ_CONCURRENCY, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * Turns voter ids into names, in whichever of the two shapes is cheaper.
 *
 * RTDB has no `where(documentId(), 'in', […])` — a read is one path. So the
 * resolver either (a) reads each named voter node directly, or (b) reads each
 * involved ward once and picks the ids it was asked about, chosen by
 * `WHOLE_WARD_THRESHOLD` above. Ids the roll does not contain are simply
 * absent from the result, which the caller renders as the raw id.
 */
async function resolveNames(
  ids: readonly { id: string; wardNo: number }[]
): Promise<Record<string, VoterName>> {
  const next: Record<string, VoterName> = {};

  if (ids.length <= WHOLE_WARD_THRESHOLD) {
    await pooled(ids, async ({ id, wardNo }) => {
      const ward = wardOfId(id, wardNo);
      if (!ward) return;
      const snapshot = await getDoc(`votersByWard/${ward}/${id}`);
      if (snapshot.exists()) next[id] = nameOf(id, snapshot.data());
    });
    return next;
  }

  const byWard = new Map<number, Set<string>>();
  for (const { id, wardNo } of ids) {
    const ward = wardOfId(id, wardNo);
    if (!ward) continue;
    const set = byWard.get(ward) ?? new Set<string>();
    set.add(id);
    byWard.set(ward, set);
  }

  await pooled([...byWard.entries()], async ([ward, wanted]) => {
    const rows = await getChildren(`votersByWard/${ward}`);
    for (const row of rows) {
      if (wanted.has(row.id)) next[row.id] = nameOf(row.id, row.data());
    }
  });

  return next;
}

export default function VoterChangesPage() {
  const role = useSession((s) => s.role);
  const canView = can(role, 'accountView');

  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const users = useLiveQuery<Profile[]>({
    key: ['users'],
    enabled: canView,
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildUsersQuery(), profileFromDoc, emit, fail),
  });

  const roster = useMemo(() => [...(users.data ?? [])], [users.data]);

  // The account under audit — a default WITHOUT an effect (setState-in-effect
  // is a cascading render waiting to happen): an explicit pick wins, else
  // the first roster entry once it lands. Select + query both read this.
  const activeUid = selectedUid ?? roster[0]?.uid ?? null;

  const edits = useLiveQuery<EditEntry[]>({
    key: ['user-edits', activeUid ?? '-'],
    enabled: canView && activeUid != null,
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(
        buildMyEditsQuery(activeUid ?? '-'),
        (entry) => ({ id: entry.id, data: entry.data() }),
        emit,
        fail
      ),
  });

  const rows = useMemo(
    () =>
      [...(edits.data ?? [])].sort(
        (a, b) =>
          (typeof b.data.updatedAt === 'number' ? b.data.updatedAt : 0) -
          (typeof a.data.updatedAt === 'number' ? a.data.updatedAt : 0)
      ),
    [edits.data]
  );

  /* ---- voter-id → name resolution (ward-sharded reads, see resolveNames) ---- */
  const [names, setNames] = useState<Record<string, VoterName>>({});
  // Derived, not state: true while ANY row's id is unresolved — which covers
  // the in-flight fetch AND a failed one (the id keeps rendering as-is
  // either way, so a spinner-state would either lie or spin forever).
  const namesPending = rows.some((entry) => !(entry.id in names));

  useEffect(() => {
    const wanted = rows
      .filter((entry) => !(entry.id in names))
      .map((entry) => ({
        id: entry.id,
        wardNo: wardOfId(entry.id, entry.data.wardNo),
      }));
    if (wanted.length === 0) return;

    let cancelled = false;

    resolveNames(wanted)
      .then((next) => {
        if (!cancelled && Object.keys(next).length > 0) {
          setNames((previous) => ({ ...previous, ...next }));
        }
      })
      .catch((caught: unknown) => {
        // A partial resolve is not a page failure — the affected rows keep
        // showing their voter id (voterId → w{ward}-{serial} is itself
        // informative), and the rest render normally.
        console.error('[changes] voter name resolve failed', caught);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const target = roster.find((entry) => entry.uid === activeUid) ?? null;
  const lastTouched = rows[0]?.data.updatedAt;

  if (!canView) {
    return (
      <MotionPage>
        <Panel>
          <EmptyState
            icon={<History className='size-5' />}
            title='Voter-change history needs admin'
            detail='The audit reads each account’s private voterEdits overlay — the same roster tier firestore.rules uses. Admin, super admin or developer only.'
            action={
              <Link href='/' className='text-xs text-brand-400 underline-offset-4 hover:underline'>
                Back to overview
              </Link>
            }
          />
        </Panel>
      </MotionPage>
    );
  }

  return (
    <MotionPage className='space-y-5'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h2 className='text-xl font-semibold tracking-tight text-mist-50'>Voter changes</h2>
          <p className='text-sm text-mist-400'>
            Every voter-edited field per account, newest first —
            {' the overlay each user’s devices push to their voterEdits collection.'}
          </p>
        </div>

        <div className='flex items-end gap-2.5'>
          <div className='min-w-[240px]'>
            <Field label='Account'>
              <Select
                value={activeUid ?? ''}
                onChange={(event) => setSelectedUid(event.target.value || null)}
              >
                {roster.length === 0 ? <option value=''>Loading…</option> : null}
                {roster.map((entry) => (
                  <option key={entry.uid} value={entry.uid}>
                    {entry.displayName || entry.email}
                    {entry.role ? ` — ${entry.role}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            variant='ghost'
            onClick={() => void edits.refetch()}
            disabled={edits.isFetching && !edits.data}
            title='Re-read the list'
          >
            {edits.isFetching && !edits.data ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              'Refresh'
            )}
          </Button>
        </div>
      </div>

      <Panel className='overflow-hidden'>
        {edits.isLoading ? (
          <div className='space-y-3 p-5'>
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className='h-14' />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<History className='size-5' />}
            title='No voter edits yet'
            detail={
              target
                ? `${target.displayName || target.email} has not edited a single voter — their fieldwork lives on their devices until they save.`
                : undefined
            }
          />
        ) : (
          <>
            <div className='flex flex-wrap items-center gap-3 border-b border-line px-4 py-3'>
              {target ? <Initials name={target.displayName || target.email} /> : null}
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium text-mist-50'>
                  {target?.displayName || target?.email || '—'}
                </p>
                <p className='truncate text-xs text-mist-600'>
                  {rows.length} voter{rows.length === 1 ? '' : 's'} edited
                  {typeof lastTouched === 'number'
                    ? ` · last change ${formatWhen(lastTouched)}`
                    : ''}
                  {namesPending ? ' · resolving names…' : ''}
                </p>
              </div>
              {target ? <RoleBadge role={target.role} /> : null}
            </div>

            <div className='divide-y divide-line'>
              {rows.slice(0, 300).map((entry) => {
                const name = names[entry.id];
                const fields = changedFields(entry);
                const updated =
                  typeof entry.data.updatedAt === 'number'
                    ? entry.data.updatedAt
                    : null;
                return (
                  <div
                    key={entry.id}
                    className='flex flex-wrap items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]'
                  >
                    <div className='min-w-0 flex-1 basis-52'>
                      <p className='truncate text-sm text-mist-50'>
                        {name ? name.name : entry.id}
                      </p>
                      <p className='truncate text-[11px] text-mist-600'>
                        {name
                          ? `serial ${name.serialNo}${
                              name.wardNo ? ` · ward ${name.wardNo}` : ''
                            }`
                          : 'voter id not present in the loaded roll — raw id shown above'}
                      </p>
                    </div>

                    <div className='flex min-w-0 flex-1 basis-64 flex-wrap gap-1.5'>
                      {fields.length === 0 ? (
                        <span className='text-[11px] text-mist-600'>
                          bookkeeping only (no fields changed)
                        </span>
                      ) : (
                        fields.map(([key, value]) => (
                          <span
                            key={key}
                            title={value}
                            className='max-w-[220px] truncate rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-mist-400'
                          >
                            <span className='text-mist-600'>{key}:</span> {value || '—'}
                          </span>
                        ))
                      )}
                    </div>

                    <span className='w-32 shrink-0 text-right text-[11px] text-mist-600'>
                      {updated != null ? formatWhen(updated) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            {rows.length > 300 ? (
              <div className='border-t border-line px-4 py-3 text-xs text-mist-600'>
                Showing the 300 most recent of {rows.length} edited voters.
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </MotionPage>
  );
}