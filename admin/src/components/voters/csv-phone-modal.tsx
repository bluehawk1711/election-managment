'use client';

/**
 * Bulk mobile-number import from the roll's own CSV export.
 *
 * The dialog is intentionally a preview-first flow: choose a file, see exactly
 * which voters matched, which numbers will change and which rows were skipped,
 * then press save. Nothing is written while parsing.
 *
 * The write path is the same one the bulk phone editor and the single-voter
 * drawer use — `saveVoterPatch` into the signed-in account's private overlay,
 * plus a best-effort proposal to the shared phone board. That means a CSV
 * import never needs a new capability, a Cloud Function or a collection-wide
 * write: an `admin` can use it exactly like a super admin.
 */
import {
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  Save,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Panel } from '@/components/ui/kit';
import { proposePhone, saveVoterPatch } from '@/lib/api';
import {
  parsePhoneCsv,
  type PhoneCsvParse,
  type PhoneCsvTarget,
} from '@/lib/roll/csv';
import type { VoterView } from '@/lib/roll/types';
import { cn } from '@/lib/util';
import { useSession } from '@/stores/session';
import { messageFor, toast } from '@/stores/toast';

interface Props {
  /** The role-scoped roll — a CSV can only match voters in this list. */
  voters: VoterView[];
  onClose: () => void;
  /** Runs after at least one successful write, so the page can clear selection. */
  onSaved?: () => void;
}

const PREVIEW_ROWS = 12;
const ISSUE_ROWS = 8;
const SAVE_CONCURRENCY = 6;

export function CsvPhoneModal({ voters, onClose, onSaved }: Props) {
  const uid = useSession((s) => s.uid);
  const displayName = useSession((s) => s.displayName);
  const email = useSession((s) => s.email);

  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<PhoneCsvParse | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;

    setFileName(file.name);
    setResult(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
    setReading(true);

    try {
      const text = await file.text();
      setResult(parsePhoneCsv(text, voters));
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    if (!uid || busy || reading || !result || result.error) return;
    const targets = result.targets;
    if (targets.length === 0) return;

    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: targets.length });

    const authorName = displayName || email.split('@')[0] || 'Unknown';
    const failures: string[] = [];
    let saved = 0;
    let done = 0;
    let next = 0;

    // Six in flight keeps a whole-ward import moving without opening a socket
    // per row. Each worker catches its own failure so one rejected write does
    // not discard the rest of the file.
    const worker = async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= targets.length) return;

        const target = targets[index];
        try {
          await saveVoterPatch(uid, target.voter, { phone: target.phone });
          saved += 1;

          // Best-effort, exactly like the bulk phone editor: the overlay above
          // is the save, and a rejected share must not fail the import.
          void proposePhone({
            uid,
            voter: target.voter,
            phone: target.phone,
            authorName,
          }).catch(() => undefined);
        } catch (caught) {
          failures.push(
            `${target.voter.effective.name}: ${messageFor(caught)}`
          );
        } finally {
          done += 1;
          if (done === targets.length || done % 5 === 0) {
            setProgress({ done, total: targets.length });
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SAVE_CONCURRENCY, targets.length) }, () =>
        worker()
      )
    );

    setProgress({ done: targets.length, total: targets.length });
    setBusy(false);

    if (failures.length > 0) {
      const first = failures.slice(0, 2).join(' · ');
      const detail = `${saved.toLocaleString()} saved, ${failures.length.toLocaleString()} failed. ${first}`;
      setError(detail);
      toast.error('CSV import incomplete', detail);
      if (saved > 0) onSaved?.();
      return;
    }

    toast.success(
      `${saved.toLocaleString()} mobile numbers saved`,
      'Saved to your account; valid numbers were also offered to the shared phone board.'
    );
    onSaved?.();
    onClose();
  };

  if (typeof document === 'undefined') return null;

  const problem = error ?? result?.error ?? null;
  const targetCount = result?.targets.length ?? 0;
  const percent =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return createPortal(
    <div
      className='fixed inset-0 z-[70] grid place-items-center p-3 sm:p-6'
      role='dialog'
      aria-modal='true'
      aria-label='Bulk update mobile numbers from CSV'
    >
      <div
        className='absolute inset-0 bg-black/70 backdrop-blur-sm'
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className='panel edge-lit relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden'>
        <header className='flex items-center gap-3 border-b border-line px-5 py-4'>
          <span className='grid size-10 shrink-0 place-items-center rounded-xl border border-brand-400/30 bg-brand-500/10 text-brand-400'>
            <FileSpreadsheet className='size-4.5' />
          </span>
          <div className='min-w-0 flex-1'>
            <h2 className='text-[15px] font-semibold text-mist-50'>
              Bulk update from CSV
            </h2>
            <p className='mt-0.5 text-xs text-mist-600'>
              {voters.length.toLocaleString()} voters available to match · saved
              to your account
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            disabled={busy}
            aria-label='Close CSV import'
            className='rounded-lg p-2 text-mist-600 transition-colors hover:bg-black/5 dark:hover:bg-white/5 hover:text-mist-50 disabled:opacity-40'
          >
            <X className='size-4.5' />
          </button>
        </header>

        <div className='scroll flex-1 space-y-4 overflow-y-auto px-5 py-5'>
          <Panel className='space-y-3 p-4'>
            <p className='text-sm font-medium text-mist-200'>How it works</p>
            <ol className='list-decimal space-y-1 pl-4 text-xs leading-relaxed text-mist-400'>
              <li>
                Export a ward or selected voters from the roll with{' '}
                <span className='text-mist-200'>Export ward CSV</span> /{' '}
                <span className='text-mist-200'>Export selected CSV</span>.
              </li>
              <li>
                Type the number in the{' '}
                <span className='text-mist-200'>Mobile Number</span> column. A
                blank cell skips that voter, and a number that already matches
                is left unchanged.
              </li>
              <li>
                Choose the file below, review the matched rows and problems,
                then save.
              </li>
            </ol>

            <input
              ref={inputRef}
              type='file'
              accept='.csv,text/csv'
              className='sr-only'
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset immediately so picking the same file again after a
                // correction still fires onChange.
                event.target.value = '';
                void handleFile(file);
              }}
            />

            <div className='flex flex-wrap items-center gap-3'>
              <Button
                variant='secondary'
                onClick={() => inputRef.current?.click()}
                disabled={busy || reading}
              >
                {reading ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <Upload className='size-4' />
                )}
                {reading ? 'Reading…' : 'Choose CSV file'}
              </Button>
              {fileName ? (
                <p className='min-w-0 truncate text-xs text-mist-600'>
                  Selected: <span className='text-mist-300'>{fileName}</span>
                </p>
              ) : null}
            </div>
          </Panel>

          {problem ? (
            <Panel className='flex items-start gap-2.5 border-signal-rose/30 bg-signal-rose/[0.05] p-4'>
              <AlertTriangle className='mt-0.5 size-4 shrink-0 text-signal-rose' />
              <div className='min-w-0'>
                <p className='text-sm font-medium text-signal-rose'>
                  Import problem
                </p>
                <p className='mt-1 text-xs leading-relaxed text-mist-400'>
                  {problem}
                </p>
              </div>
            </Panel>
          ) : null}

          {result && !result.error ? (
            <>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Stat label='CSV rows' value={result.rows} />
                <Stat
                  label='Ready to update'
                  value={result.targets.length}
                  tone={result.targets.length > 0 ? 'brand' : undefined}
                />
                <Stat label='Already same' value={result.unchanged} />
                <Stat
                  label='Need attention'
                  value={result.issues.length}
                  tone={result.issues.length > 0 ? 'rose' : undefined}
                />
              </div>

              {result.blank > 0 ? (
                <p className='text-xs leading-relaxed text-mist-600'>
                  {result.blank.toLocaleString()} blank mobile cell
                  {result.blank === 1 ? '' : 's'} skipped — blank means “leave
                  this voter alone”.
                </p>
              ) : null}

              {result.issues.length > 0 ? (
                <Panel className='space-y-2 border-signal-amber/25 bg-signal-amber/[0.04] p-4'>
                  <div className='flex items-center gap-2 text-xs font-medium text-signal-amber'>
                    <AlertTriangle className='size-3.5' />
                    Rows that will not be imported ({result.issues.length.toLocaleString()})
                  </div>
                  <ul className='space-y-1 text-xs leading-relaxed text-mist-400'>
                    {result.issues.slice(0, ISSUE_ROWS).map((issue, index) => (
                      <li key={`${issue.line}-${index}`}>
                        <span className='font-mono text-mist-600'>
                          Line {issue.line}
                        </span>{' '}
                        · {issue.message}
                      </li>
                    ))}
                  </ul>
                  {result.issues.length > ISSUE_ROWS ? (
                    <p className='text-xs text-mist-600'>
                      …and {(result.issues.length - ISSUE_ROWS).toLocaleString()}{' '}
                      more.
                    </p>
                  ) : null}
                </Panel>
              ) : null}

              {result.targets.length > 0 ? (
                <Panel className='overflow-hidden p-0' lit={false}>
                  <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3'>
                    <p className='text-sm font-medium text-mist-200'>
                      Ready to update
                    </p>
                    <p className='text-xs text-mist-600'>
                      Showing{' '}
                      {Math.min(PREVIEW_ROWS, result.targets.length).toLocaleString()}{' '}
                      of {result.targets.length.toLocaleString()} changed rows
                    </p>
                  </div>
                  <div className='max-h-64 overflow-auto'>
                    <table className='min-w-full text-left text-xs'>
                      <thead className='sticky top-0 bg-ink-900/95 text-[10px] uppercase tracking-[0.08em] text-mist-600 backdrop-blur'>
                        <tr>
                          <th className='px-4 py-2 font-medium'>Voter</th>
                          <th className='px-4 py-2 font-medium'>Current</th>
                          <th className='px-4 py-2 font-medium'>New</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.targets.slice(0, PREVIEW_ROWS).map((target) => (
                          <PreviewRow key={target.voter.id} target={target} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ) : (
                <Panel className='p-4 text-xs leading-relaxed text-mist-400'>
                  No new numbers to save in this file. Blank cells and numbers
                  that already match the roll are skipped.
                </Panel>
              )}
            </>
          ) : null}
        </div>

        <footer className='flex flex-wrap items-center gap-3 border-t border-line px-5 py-4'>
          {busy ? (
            <div className='min-w-0 flex-1'>
              <p className='text-xs text-mist-400'>
                Saving {progress.done.toLocaleString()} /{' '}
                {progress.total.toLocaleString()}…
              </p>
              <div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10'>
                <div
                  className='h-full rounded-full bg-brand-500 transition-all'
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : (
            <p className='min-w-0 flex-1 text-xs leading-relaxed text-mist-600'>
              Every number is saved to your account’s private overlay; valid
              numbers are also offered to the shared phone board.
            </p>
          )}
          <Button variant='ghost' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant='primary'
            onClick={() => void save()}
            disabled={busy || reading || targetCount === 0}
          >
            {busy ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            {busy
              ? 'Saving…'
              : `Save ${targetCount.toLocaleString()} number${targetCount === 1 ? '' : 's'}`}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'brand' | 'rose';
}) {
  return (
    <div className='rounded-xl border border-line bg-black/[0.02] dark:bg-white/[0.02] px-3 py-2.5'>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'brand'
            ? 'text-brand-400'
            : tone === 'rose'
              ? 'text-signal-rose'
              : 'text-mist-50'
        )}
      >
        {value.toLocaleString()}
      </p>
      <p className='mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-mist-600'>
        {label}
      </p>
    </div>
  );
}

function PreviewRow({ target }: { target: PhoneCsvTarget }) {
  const voter = target.voter;
  const nameDiffers = target.csvName !== voter.effective.name;

  return (
    <tr className='border-t border-line/70 align-top'>
      <td className='px-4 py-2.5'>
        <p className='font-medium text-mist-200'>{voter.effective.name}</p>
        <p className='mt-0.5 font-mono text-[10px] text-mist-600'>
          {voter.id}
          {voter.epicId ? ` · ${voter.epicId}` : ''}
        </p>
        {nameDiffers ? (
          <p className='mt-0.5 text-[10px] text-signal-amber'>
            CSV name: {target.csvName}
          </p>
        ) : null}
      </td>
      <td className='px-4 py-2.5 font-mono text-mist-600'>
        {voter.effective.phone || '—'}
      </td>
      <td className='px-4 py-2.5 font-mono font-medium text-brand-400'>
        {target.phone}
      </td>
    </tr>
  );
}
