'use client';

/**
 * Roll import — the panel's door onto `scripts/seed-roll.mjs`.
 *
 * Two things a data owner needs after reparsing the PDF:
 *
 *  1. **Verify** what is actually IN Firestore now: per-ward document counts
 *     against the seeded `voters` summary, plus the areas the roll is
 *     categorised under (`area → ward → voter`, one shipped: Veernagar).
 *     Counts come from `getCountFromServer` — a server-side count, not a
 *     `getDocs` pulling 6,855 documents over the wire to add them up.
 *
 *  2. **Re-import** the UPDATED roll (the fixed `house_no` pass and any later
 *     extraction work) through `/api/roll/seed`, which shells out to the same
 *     Admin-SDK script the CLI uses, with its summary-vs-CSV validation
 *     intact. `--dry-run` parses and validates without writing — the button
 *     to press FIRST.
 *
 * `voters` is read-only from clients by design (firestore.rules), so this is
 * the only write surface the roll ever sees — and it is `dataTools`
 * (developer), exactly like every other place `lib/roles.ts` grants that
 * word. The route itself re-checks `NODE_ENV !== 'production'`.
 */
import { Database, Download, Loader2, PlayCircle, ShieldCheck } from 'lucide-react';
import {
  collection,
  getCountFromServer,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { buildWardsQuery } from '@/lib/api';
import { exportBackup } from '@/lib/backup';
import { db } from '@/lib/firebase';
import { wardFromDoc } from '@/lib/mappers';
import { can } from '@/lib/roles';
import type { WardMeta } from '@/lib/types';
import { messageFor, toast } from '@/stores/toast';
import { useSession } from '@/stores/session';
import { MotionPage } from '@/components/shell/motion-page';
import {
  Button,
  EmptyState,
  Panel,
  Skeleton,
} from '@/components/ui/kit';

interface WardCheck {
  wardNo: number;
  /** What the seeded `wards` doc claims (from wards-summary.csv). */
  expected: number;
  /** How many `voters` documents actually exist for that ward. */
  actual: number;
}

interface AreaRow {
  id: string;
  name: string;
  constituencyId: string;
  wardId: string;
}

interface CheckState {
  wards: WardCheck[];
  total: number;
  /** Grand total the ward summaries claim. */
  expectedTotal: number;
  areas: AreaRow[];
  at: number;
}

export default function RollImportPage() {
  const role = useSession((s) => s.role);
  const allowed = can(role, 'dataTools');

  const wards = useLiveQuery<WardMeta[]>({
    key: ['wards'],
    enabled: allowed,
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildWardsQuery(), wardFromDoc, emit, fail),
  });

  const [check, setCheck] = useState<CheckState | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState<'import' | 'dry' | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [log, setLog] = useState<{ ok: boolean; output: string } | null>(null);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const meta = wards.data ?? [];
      const wardStats: WardCheck[] = [];
      for (const ward of meta) {
        const counted = await getCountFromServer(
          query(collection(db, 'voters'), where('wardNo', '==', ward.wardNo))
        );
        wardStats.push({
          wardNo: ward.wardNo,
          expected: ward.voterCount,
          actual: counted.data().count,
        });
      }
      const totalSnapshot = await getCountFromServer(collection(db, 'voters'));
      const areasSnapshot = await getDocs(collection(db, 'areas'));
      setCheck({
        wards: wardStats.sort((a, b) => a.wardNo - b.wardNo),
        total: totalSnapshot.data().count,
        expectedTotal: meta.reduce((sum, ward) => sum + ward.voterCount, 0),
        areas: areasSnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            name: typeof data.name === 'string' ? data.name : '',
            constituencyId:
              typeof data.constituencyId === 'string' ? data.constituencyId : '',
            wardId: typeof data.wardId === 'string' ? data.wardId : '',
          };
        }),
        at: Date.now(),
      });
    } catch (caught) {
      toast.error('Verification failed', messageFor(caught));
    } finally {
      setChecking(false);
    }
  }, [wards.data]);

  useEffect(() => {
    if (!(allowed && wards.data && wards.data.length > 0 && !check)) return;
    // Deferred through a timer rather than called synchronously: runCheck's
    // first act is a setState, and a setState in the effect body itself is a
    // cascading render (the rule the rest of this file must keep). One macrotask
    // later the check still runs — nobody can tell.
    const timer = setTimeout(() => void runCheck(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, wards.data]);

  /** Everything, as one JSON file — see lib/backup.ts for the scope. */
  const backup = async () => {
    setBackingUp(true);
    try {
      const outcome = await exportBackup();
      const total = Object.values(outcome.counts).reduce((sum, n) => sum + n, 0);
      toast.success(
        'Backup downloaded',
        `${outcome.name} — ${total} documents across ${Object.keys(outcome.counts).length} collections (${(outcome.bytes / 1024).toFixed(0)} KB).`
      );
    } catch (caught) {
      toast.error('Backup failed', messageFor(caught));
    } finally {
      setBackingUp(false);
    }
  };

  const seed = async (dryRun: boolean) => {
    setRunning(dryRun ? 'dry' : 'import');
    setLog(null);
    try {
      const response = await fetch('/api/roll/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const payload = (await response.json()) as { ok?: boolean; output?: string; error?: string };
      const ok = payload.ok === true;
      setLog({ ok, output: payload.output ?? payload.error ?? '(no output)' });
      if (ok) {
        toast.success(
          dryRun ? 'Dry run passed' : 'Roll imported',
          dryRun
            ? 'CSV parsed and validated against wards-summary.csv — nothing was written.'
            : 'Firestore now holds the updated voter roll. Verifying per-ward counts…'
        );
        setCheck(null);
      } else {
        toast.error('Import failed', payload.output ?? payload.error ?? 'Unknown error');
      }
    } catch (caught) {
      toast.error('Import failed', messageFor(caught));
    } finally {
      setRunning(null);
    }
  };

  if (!allowed) {
    return (
      <MotionPage>
        <Panel>
          <EmptyState
            icon={<ShieldCheck className='size-5' />}
            title='Roll import is developer-only'
            detail='Re-writing voters/wards needs the Admin SDK — lib/roles.ts `dataTools` and the route behind this page both refuse anyone else.'
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

  const mismatched = check?.wards.filter((ward) => ward.expected !== ward.actual) ?? [];
  const rollAreas = check?.areas.filter(
    (area) => area.constituencyId === 'cons-jodhpur-jhanwar' || area.id === 'veernagar'
  );
  const orphanAreas = check
    ? check.areas.filter(
        (area) =>
          !(rollAreas ?? []).some((roll) => roll.id === area.id)
      )
    : [];

  return (
    <MotionPage className='space-y-5'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h2 className='text-xl font-semibold tracking-tight text-mist-50'>Roll import</h2>
          <p className='text-sm text-mist-400'>
            Verify what Firestore holds, then re-import the extracted CSVs with the Admin SDK
            ({check ? `checked ${new Date(check.at).toLocaleTimeString('en-IN')}` : 'not checked yet'}).
          </p>
        </div>
        <div className='flex items-center gap-2.5'>
          <Button variant='secondary' onClick={() => void runCheck()} disabled={checking}>
            {checking ? <Loader2 className='size-4 animate-spin' /> : null}
            {checking ? 'Verifying…' : 'Verify counts'}
          </Button>
          <Button
            variant='secondary'
            onClick={() => void backup()}
            disabled={backingUp || running !== null}
            title='Download every collection (incl. voter edits, vault, config) as JSON'
          >
            {backingUp ? <Loader2 className='size-4 animate-spin' /> : <Download className='size-4' />}
            {backingUp ? 'Exporting…' : 'Backup'}
          </Button>
          <Button
            variant='secondary'
            onClick={() => void seed(true)}
            disabled={running !== null}
            title='Parse + validate the CSVs without writing'
          >
            {running === 'dry' ? <Loader2 className='size-4 animate-spin' /> : <PlayCircle className='size-4' />}
            Dry run
          </Button>
          <Button
            variant='primary'
            onClick={() => void seed(false)}
            disabled={running !== null}
            title='Delete voters/wards and re-import the extracted roll'
          >
            {running === 'import' ? <Loader2 className='size-4 animate-spin' /> : <Database className='size-4' />}
            {running === 'import' ? 'Importing…' : 'Import updated roll'}
          </Button>
        </div>
      </div>

      {log ? (
        <Panel>
          <div className='mb-2 flex items-center justify-between gap-3'>
            <p className={`text-sm font-medium ${log.ok ? 'text-signal-emerald' : 'text-signal-rose'}`}>
              {log.ok ? 'Script exited 0' : 'Script failed'}
            </p>
            <span className='text-[11px] text-mist-600'>tail of the seed-roll.mjs output</span>
          </div>
          <pre className='max-h-72 overflow-auto rounded-lg border border-line bg-ink-900 p-3 text-[11px] leading-relaxed text-mist-400'>
            {log.output}
          </pre>
        </Panel>
      ) : null}

      <Panel className='overflow-hidden'>
        <div className='border-b border-line px-4 py-3'>
          <p className='text-sm font-medium text-mist-50'>Per-ward verification</p>
          <p className='text-xs text-mist-600'>
            Seeded summary (wards-summary.csv) vs actual `voters` documents — server-side counts.
          </p>
        </div>
        {!check || checking ? (
          <div className='space-y-3 p-5'>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className='h-8' />
            ))}
          </div>
        ) : (
          <div className='divide-y divide-line'>
            <div className='flex items-center gap-3 px-4 py-3 text-sm'>
              <span className='w-16 text-mist-600'>total</span>
              <span className='flex-1 text-mist-50'>
                {check.total.toLocaleString('en-IN')} documents in `voters`
              </span>
              <span
                className={
                  check.total === check.expectedTotal
                    ? 'text-signal-emerald'
                    : 'font-medium text-signal-rose'
                }
              >
                expected {check.expectedTotal.toLocaleString('en-IN')}
              </span>
            </div>
            {check.wards.map((ward) => (
              <div key={ward.wardNo} className='flex items-center gap-3 px-4 py-2.5 text-sm'>
                <span className='w-16 text-mist-600'>ward {ward.wardNo}</span>
                <span className='flex-1 text-mist-400'>
                  {ward.actual.toLocaleString('en-IN')} document{ward.actual === 1 ? '' : 's'}
                </span>
                <span
                  className={
                    ward.expected === ward.actual
                      ? 'text-mist-600'
                      : 'font-medium text-signal-rose'
                  }
                >
                  {ward.expected === ward.actual
                    ? '✓ matches summary'
                    : `summary says ${ward.expected}`}
                </span>
              </div>
            ))}
            {mismatched.length === 0 ? (
              <div className='px-4 py-3 text-xs text-signal-emerald'>
                Every ward matches its cover-page summary — the import is complete.
              </div>
            ) : (
              <div className='px-4 py-3 text-xs text-signal-rose'>
                {mismatched.length} ward{mismatched.length === 1 ? '' : 's'} disagree — re-run the
                import (it clears `voters` first with --force).
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel className='overflow-hidden'>
        <div className='border-b border-line px-4 py-3'>
          <p className='text-sm font-medium text-mist-50'>Areas</p>
          <p className='text-xs text-mist-600'>
            The roll is categorised under area → ward → voter. Seeded by
            scripts/seed-roll.mjs; the app’s area selector reads these.
          </p>
        </div>
        {!check || checking ? (
          <div className='space-y-3 p-5'>
            <Skeleton className='h-8' />
          </div>
        ) : (rollAreas ?? []).length === 0 ? (
          <EmptyState
            icon={<Database className='size-5' />}
            title='No roll area yet'
            detail='Run the import — it writes `areas/veernagar` covering every ward.'
          />
        ) : (
          <div className='divide-y divide-line'>
            {(rollAreas ?? []).map((area) => (
              <div key={area.id} className='flex items-center gap-3 px-4 py-3 text-sm'>
                <span className='w-32 truncate text-mist-50'>{area.name}</span>
                <span className='text-xs text-mist-600'>
                  id {area.id} · covers {check.wards.length} wards
                </span>
              </div>
            ))}
            {orphanAreas.length > 0 ? (
              <div className='px-4 py-2.5 text-[11px] text-mist-600'>
                {orphanAreas.length} campaign/demo area document{orphanAreas.length === 1 ? '' : 's'}{' '}
                also live in `areas` (seed.mjs) — ignored by the roll selector.
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </MotionPage>
  );
}