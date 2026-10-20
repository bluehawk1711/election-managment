'use client';

/**
 * Teams — create one, put accounts on it, take them off, delete it.
 *
 * A team is a label shared by a set of accounts (`users/{uid}.teamId`), and
 * the ONLY thing it changes is who may read whose fieldwork in the mobile
 * app: two accounts on the same non-empty team read each other's
 * `voterEdits` (firestore.rules `sameTeam`). That makes it the one account
 * setting with a visible consequence two screens away, so it gets its own
 * surface rather than hiding behind the per-row label input — which stays,
 * because moving ONE account is still a one-row job.
 *
 * Three documents, one invariant. For each membership:
 *
 *   users/{uid}.teamId   membership — what the rules actually read
 *   teams/{label}.members  uid → name, what the app pulls to DISCOVER
 *                          teammates and attribute their edits by name
 *
 * Both are written by `setTeam` in one batch, so the app can never observe
 * `teamId` pointing at a roster that does not list its member yet. Deleting
 * a team clears every `teamId` BEFORE the roster goes, for the mirror reason:
 * a roster that vanished while profiles still pointed at it would share
 * edits the panel could no longer explain.
 *
 * Members cannot see this dialog's query (rules gate `/teams` list on
 * `canManageAccounts`) and cannot read `/users` at all — which is exactly
 * why the roster doc exists.
 */
import {
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  addTeamMembers,
  buildTeamsQuery,
  createTeam,
  deleteTeam,
  setTeam,
} from '@/lib/api';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { teamFromDoc } from '@/lib/mappers';
import { messageFor, toast } from '@/stores/toast';
import type { Profile, TeamRoster } from '@/lib/types';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Button, EmptyState, Field, Input, Skeleton } from '@/components/ui/kit';

export function TeamsDialog({
  open,
  onClose,
  profiles,
  myUid,
}: {
  open: boolean;
  onClose: () => void;
  /** The already-loaded roster of accounts — names, emails, current team. */
  profiles: Profile[];
  /** The signed-in super admin. Never offered as a target of their own rules. */
  myUid: string | null;
}) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The team whose member picker is open, or null. */
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<TeamRoster | null>(null);

  const teams = useLiveQuery<TeamRoster[]>({
    key: ['teams'],
    enabled: open,
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildTeamsQuery(), teamFromDoc, emit, fail),
  });

  const list = useMemo(
    () => [...(teams.data ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    [teams.data]
  );

  /** A member's display name, from the roster, falling back to the profile. */
  const nameOf = (uid: string, fallback: string) =>
    profiles.find((profile) => profile.uid === uid)?.displayName || fallback;

  const labelOk = label.trim().length > 0 && label.trim().length <= 64;

  const submitCreate = async () => {
    const value = label.trim();
    if (!labelOk) {
      setError('A team label is 1–64 characters.');
      return;
    }
    setBusy('create');
    setError(null);
    try {
      await createTeam(value);
      toast.success('Team created', `Add accounts to "${value}" to start sharing.`);
      setLabel('');
      setAddingTo(value);
      setPicked(new Set());
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitAdd = async (team: TeamRoster) => {
    const chosen = profiles.filter((profile) => picked.has(profile.uid));
    if (chosen.length === 0) return;
    setBusy(`add:${team.id}`);
    setError(null);
    try {
      await addTeamMembers(
        team.id,
        chosen.map((profile) => ({
          uid: profile.uid,
          displayName: profile.displayName || profile.email,
        }))
      );
      toast.success(
        `${chosen.length} account${chosen.length === 1 ? '' : 's'} on "${team.id}"`,
        'They now read each other’s field notes in the app.'
      );
      setPicked(new Set());
      setAddingTo(null);
    } catch (caught) {
      setError(messageFor(caught));
      toast.error('Could not add', messageFor(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitRemove = async (teamId: string, profile: Profile) => {
    setBusy(`remove:${profile.uid}`);
    try {
      await setTeam(profile.uid, '', profile.displayName || profile.email);
      toast.success('Removed from team', `${profile.displayName || profile.email} keeps nothing shared.`);
    } catch (caught) {
      toast.error('Could not remove', messageFor(caught));
    } finally {
      setBusy(null);
    }
  };

  const submitDelete = async () => {
    const team = deleteTarget;
    if (!team) return;
    setBusy(`delete:${team.id}`);
    try {
      await deleteTeam(
        team.id,
        Object.entries(team.members).map(([uid, displayName]) => ({
          uid,
          displayName,
        }))
      );
      toast.success(
        'Team deleted',
        Object.keys(team.members).length
          ? `Its ${Object.keys(team.members).length} member(s) keep their own edits and share nothing any more.`
          : 'Nothing was shared by it.'
      );
      setDeleteTarget(null);
    } catch (caught) {
      toast.error('Could not delete team', messageFor(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className='fixed inset-0 z-[70] grid place-items-center p-4'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <div className='absolute inset-0 bg-black/65 backdrop-blur-sm' onClick={onClose} />
          <motion.div
            role='dialog'
            aria-modal='true'
            aria-label='Teams'
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className='panel edge-lit relative flex max-h-[85vh] w-full max-w-[640px] flex-col p-6'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='flex items-center gap-3'>
              <span className='brand-gradient grid size-10 place-items-center rounded-xl'>
                <Users className='size-5 text-white' />
              </span>
              <div className='min-w-0 flex-1'>
                <h2 className='text-[15px] font-semibold text-mist-50'>Teams</h2>
                <p className='text-xs text-mist-600'>
                  Members of a team read each other’s field notes in the app.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label='Close'
                className='rounded-lg p-2 text-mist-600 transition-colors hover:bg-white/[0.06] hover:text-mist-200'
              >
                <X className='size-4' />
              </button>
            </div>

            <div className='scroll mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1'>
              {/* ---- create ---- */}
              <div className='flex items-end gap-2.5'>
                <Field label='New team' className='flex-1'>
                  <Input
                    value={label}
                    onChange={(event) => {
                      setLabel(event.target.value);
                      setError(null);
                    }}
                    maxLength={64}
                    placeholder='e.g. ward-3-sweep'
                    aria-label='New team label'
                  />
                </Field>
                <Button
                  variant='primary'
                  disabled={busy !== null || !labelOk}
                  onClick={() => void submitCreate()}
                >
                  {busy === 'create' ? (
                    <Loader2 className='size-4 animate-spin' />
                  ) : (
                    <Plus className='size-4' />
                  )}
                  Create team
                </Button>
              </div>

              {error ? (
                <p className='rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose'>
                  {error}
                </p>
              ) : null}

              {/* ---- existing teams ---- */}
              {teams.isLoading ? (
                <div className='space-y-2'>
                  {Array.from({ length: 2 }).map((_, index) => (
                    <Skeleton key={index} className='h-20' />
                  ))}
                </div>
              ) : list.length === 0 ? (
                <EmptyState
                  icon={<Users className='size-5' />}
                  title='No teams yet'
                  detail='A team is a label shared by its members. Create one above, then add the accounts that should see each other’s work.'
                />
              ) : (
                list.map((team) => {
                  const uids = Object.keys(team.members);
                  const candidates = profiles.filter(
                    (profile) => !uids.includes(profile.uid)
                  );
                  const adding = addingTo === team.id;
                  return (
                    <div key={team.id} className='rounded-xl border border-line bg-white/[0.02] p-3.5'>
                      <div className='flex items-center gap-2'>
                        <span className='inline-flex items-center gap-1.5 rounded-md border border-brand-400/35 bg-brand-400/10 px-2 py-0.5 text-xs font-medium text-brand-300'>
                          <Users className='size-3.5' />
                          {team.id}
                        </span>
                        <span className='text-xs text-mist-600'>
                          {uids.length} member{uids.length === 1 ? '' : 's'}
                        </span>
                        <span className='flex-1' />
                        <button
                          onClick={() => {
                            setAddingTo(adding ? null : team.id);
                            setPicked(new Set());
                            setError(null);
                          }}
                          className='inline-flex items-center gap-1 rounded-lg border border-line-strong bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-mist-200 transition-colors hover:border-brand-400/50 hover:text-mist-50'
                        >
                          <UserPlus className='size-3.5' /> Add
                        </button>
                        <button
                          onClick={() => setDeleteTarget(team)}
                          title='Delete this team and clear every member’s assignment'
                          className='rounded-lg p-1.5 text-mist-600 transition-colors hover:bg-signal-rose/10 hover:text-signal-rose'
                        >
                          <Trash2 className='size-4' />
                        </button>
                      </div>

                      {uids.length > 0 ? (
                        <div className='mt-2.5 flex flex-wrap gap-1.5'>
                          {uids.map((uid) => (
                            <span
                              key={uid}
                              className='inline-flex items-center gap-1 rounded-md border border-line bg-ink-900/60 py-0.5 pl-2 pr-1 text-[11px] text-mist-200'
                            >
                              {nameOf(uid, team.members[uid] ?? uid)}
                              <button
                                onClick={() => {
                                  const profile = profiles.find((p) => p.uid === uid);
                                  if (profile) void submitRemove(team.id, profile);
                                }}
                                disabled={busy !== null || uid === myUid}
                                title={
                                  uid === myUid
                                    ? 'You cannot change your own team'
                                    : `Remove from ${team.id}`
                                }
                                aria-label={`Remove ${nameOf(uid, uid)} from ${team.id}`}
                                className='rounded p-0.5 text-mist-600 transition-colors hover:bg-white/[0.06] hover:text-signal-rose disabled:cursor-not-allowed disabled:opacity-35'
                              >
                                <X className='size-3' />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className='mt-2 text-xs text-mist-600'>
                          Nobody on this team yet — it shares nothing until someone joins.
                        </p>
                      )}

                      {adding ? (
                        <div className='mt-3 rounded-lg border border-line bg-ink-900/50 p-3'>
                          <p className='text-xs font-medium text-mist-200'>
                            Add accounts to {team.id}
                          </p>
                          {candidates.length === 0 ? (
                            <p className='mt-1.5 text-xs text-mist-600'>
                              Every account is already on this team.
                            </p>
                          ) : (
                            <>
                              <div className='scroll mt-2 max-h-44 space-y-1 overflow-y-auto pr-1'>
                                {candidates.map((profile) => {
                                  const on = picked.has(profile.uid);
                                  return (
                                    <button
                                      key={profile.uid}
                                      onClick={() =>
                                        setPicked((previous) => {
                                          const next = new Set(previous);
                                          if (on) next.delete(profile.uid);
                                          else next.add(profile.uid);
                                          return next;
                                        })
                                      }
                                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                                        on
                                          ? 'bg-brand-500/15 text-mist-50'
                                          : 'text-mist-400 hover:bg-white/[0.04]'
                                      }`}
                                    >
                                      <span
                                        className={`grid size-4 shrink-0 place-items-center rounded border ${
                                          on
                                            ? 'border-brand-400 bg-brand-500/30'
                                            : 'border-line-strong'
                                        }`}
                                      >
                                        {on ? <span className='size-1.5 rounded-full bg-brand-300' /> : null}
                                      </span>
                                      <span className='min-w-0 flex-1 truncate'>
                                        {profile.displayName || profile.email}
                                        {profile.teamId ? (
                                          <span className='ml-1.5 text-[10px] text-mist-600'>
                                            (on {profile.teamId})
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div className='mt-2.5 flex justify-end gap-2'>
                                <Button
                                  variant='ghost'
                                  onClick={() => setAddingTo(null)}
                                  disabled={busy !== null}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant='primary'
                                  disabled={busy !== null || picked.size === 0}
                                  onClick={() => void submitAdd(team)}
                                >
                                  {busy === `add:${team.id}` ? (
                                    <Loader2 className='size-4 animate-spin' />
                                  ) : null}
                                  Add {picked.size || ''}
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>

          <ConfirmDialog
            open={deleteTarget !== null}
            title={deleteTarget ? `Delete team "${deleteTarget.id}"?` : ''}
            detail={
              deleteTarget && Object.keys(deleteTarget.members).length > 0
                ? `${Object.keys(deleteTarget.members).length} account(s) go back to being private — their field notes stay on their own accounts but stop being shared.`
                : 'The roster is empty, so nothing is shared by it.'
            }
            confirmLabel='Delete team'
            busy={busy?.startsWith('delete:') ?? false}
            onConfirm={() => void submitDelete()}
            onCancel={() => setDeleteTarget(null)}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
