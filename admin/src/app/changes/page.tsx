'use client';

/**
 * Voter changes — "which voter data did each user change", the audit
 * surface behind the widened `voterEdits` read rule (firestore.rules:
 * `isOwner(userId) || canViewAccounts()`).
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
 * and the panel may read every ward, so one `documentId() IN (…)` query per
 * 15 ids turns ids into names without per-row round-trips. Unresolved ids
 * render as the id — honest (the row may be from a ward not in the roll) and
 * never a spinner that never ends.
 *
 * Gated by `canViewAccounts` exactly like the roster: admins audits people
 * they work with; karykarta never reach this page (their own edits are
 * their own business, on their own devices).
 */
import { History, Loader2 } from 'lucide-react';
import Link from 'next/link';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { buildUsersQuery } from '@/lib/api';
import { db } from '@/lib/firebase';
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

/** Resolves voter ids to roll rows in chunks of 15 (`in` caps at 30). */
interface VoterName {
  name: string;
  wardNo: number;
  serialNo: number;
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
        collection(db, 'users', activeUid ?? '-', 'voterEdits'),
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

  /* ---- voter-id → name resolution (chunked `documentId() IN` reads) ---- */
  const [names, setNames] = useState<Record<string, VoterName>>({});
  // Derived, not state: true while ANY row's id is unresolved — which covers
  // the in-flight fetch AND a failed one (the id keeps rendering as-is
  // either way, so a spinner-state would either lie or spin forever).
  const namesPending = rows.some((entry) => !(entry.id in names));

  useEffect(() => {
    const ids = rows
      .map((entry) => entry.id)
      .filter((id) => !(id in names));
    if (ids.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const next: Record<string, VoterName> = {};
        for (let i = 0; i < ids.length; i += 15) {
          const chunk = ids.slice(i, i + 15);
          const snapshot = await getDocs(
            query(
              collection(db, 'voters'),
              where(documentId(), 'in', chunk)
            )
          );
          for (const doc of snapshot.docs) {
            const data = doc.data();
            next[doc.id] = {
              name: typeof data.name === 'string' ? data.name : doc.id,
              wardNo: typeof data.wardNo === 'number' ? data.wardNo : 0,
              serialNo: typeof data.serialNo === 'number' ? data.serialNo : 0,
            };
          }
        }
        if (!cancelled) setNames((previous) => ({ ...previous, ...next }));
      } catch (caught) {
        // A partial resolve is not a page failure — the affected rows keep
        // showing their voter id (voterId → w{ward}-{serial} is itself
        // informative), and the rest render normally.
        console.error('[changes] voter name resolve failed', caught);
      }
    })();

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