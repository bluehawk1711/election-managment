'use client';

/**
 * Accounts — the roster a super admin (or developer) manages, readable by
 * plain admins too. Guarded three ways, layered:
 *
 *  - `can(role, 'accountView')` gates the PAGE (karykarta never see the
 *    roster — Firestore's `list` rule would deny the query anyway; the local
 *    check only spares the permission-denied toast);
 *  - `can(role, 'accountManage')` gates every WRITE control (create, role
 *    grant, delete) — same split as rules' `canViewAccounts` /
 *    `canManageAccounts`, so widened visibility can never widen power;
 *  - `firestore.rules` re-checks everything with the caller's profile — the
 *    `uid != request.auth.uid` invariants mean this UI can refuse to offer
 *    self-promotion or self-deletion, but a curl that ignores it gets denied
 *    server-side regardless.
 *
 * Role edits are `updateDoc({role, wardNo?})` — affected keys only, because
 * that is literally the rules' `hasOnly(['role', 'wardNo'])` list. Leaving
 * karykarta sends `deleteField()` for wardNo: the RESULT must not carry a
 * ward for a non-scoped role, and only a sentinel removes a key.
 */
import { KeyRound, Loader2, Plus, Search, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { buildUsersQuery, deleteAccount, grantRole } from '@/lib/api';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { profileFromDoc } from '@/lib/mappers';
import { APP_ROLES, can, roleLabel, type AppRole } from '@/lib/roles';
import { formatWhen } from '@/lib/util';
import type { Profile } from '@/lib/types';
import { messageFor, toast } from '@/stores/toast';
import { useSession } from '@/stores/session';
import { MotionPage } from '@/components/shell/motion-page';
import { ConfirmDialog } from '@/components/ui/confirm';
import {
  Button,
  EmptyState,
  Field,
  Initials,
  Input,
  Panel,
  RoleBadge,
  Select,
  Skeleton,
} from '@/components/ui/kit';
import { AnimatePresence, motion } from 'motion/react';

export default function AccountsPage() {
  const role = useSession((s) => s.role);
  const myUid = useSession((s) => s.uid);

  const users = useLiveQuery<Profile[]>({
    key: ['users'],
    enabled: can(role, 'accountView'),
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildUsersQuery(), profileFromDoc, emit, fail),
  });

  const canManage = can(role, 'accountManage');
  const canView = can(role, 'accountView');

  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = [...(users.data ?? [])].sort((a, b) => {
      // Roleless last — the actionable accounts float up.
      const rank = (profile: Profile) =>
        profile.role === 'developer' ? 0 : profile.role === 'superAdmin' ? 1 : profile.role === 'admin' ? 2 : profile.role ? 3 : 4;
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      return (a.displayName || a.email).localeCompare(b.displayName || b.email);
    });
    return needle
      ? list.filter((profile) =>
          `${profile.displayName} ${profile.email} ${profile.role ?? ''}`
            .toLowerCase()
            .includes(needle)
        )
      : list;
  }, [users.data, search]);

  /* ---- role dialog ---- */
  const [roleTarget, setRoleTarget] = useState<Profile | null>(null);
  const [nextRole, setNextRole] = useState<AppRole>('karykarta');
  const [nextWard, setNextWard] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const openRoleDialog = (profile: Profile) => {
    setRoleTarget(profile);
    setNextRole((profile.role as AppRole | null) ?? 'karykarta');
    setNextWard(
      profile.wardNo != null && profile.wardNo > 0 ? String(profile.wardNo) : ''
    );
    setRoleError(null);
  };

  const submitRole = async () => {
    if (!roleTarget) return;
    if (nextRole === 'karykarta' && !/^[1-9][0-9]{0,2}$/.test(nextWard)) {
      setRoleError('A karykarta needs a ward number above 0.');
      return;
    }
    setRoleBusy(true);
    setRoleError(null);
    try {
      await grantRole({
        targetUid: roleTarget.uid,
        role: nextRole,
        wardNo: nextRole === 'karykarta' ? Number(nextWard) : null,
        profile: roleTarget,
      });
      toast.success(
        'Role updated',
        `${roleTarget.displayName || roleTarget.email} is now ${roleLabel(nextRole)}${
          nextRole === 'karykarta' ? ` (ward ${nextWard})` : ''
        }.`
      );
      setRoleTarget(null);
    } catch (caught) {
      setRoleError(messageFor(caught));
      toast.error('Role change refused', messageFor(caught));
    } finally {
      setRoleBusy(false);
    }
  };

  /* ---- delete ---- */
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteAccount(deleteTarget.uid);
      toast.success(
        'Profile removed',
        `${deleteTarget.email} lost panel access. The Auth login record itself stays until it is removed from the Firebase console.`
      );
      setDeleteTarget(null);
    } catch (caught) {
      toast.error('Delete refused', messageFor(caught));
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!canView) {
    return (
      <MotionPage>
        <Panel>
          <EmptyState
            icon={<ShieldCheck className="size-5" />}
            title="The roster is not visible to your role"
            detail="Accounts need admin, super admin or developer — the same split firestore.rules enforces on the users list."
            action={
              <Link href="/" className="text-xs text-brand-400 underline-offset-4 hover:underline">
                Back to overview
              </Link>
            }
          />
        </Panel>
      </MotionPage>
    );
  }

  return (
    <MotionPage className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-mist-50">Accounts</h2>
          <p className="text-sm text-mist-400">
            {users.isLoading ? 'Loading roster…' : `${rows.length} of ${(users.data ?? []).length} on file`}
            {!canManage ? ' · read-only for your role' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mist-600" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email, role…"
              className="w-full pl-9 sm:w-64"
              aria-label="Search accounts"
            />
          </div>
          {canManage ? (
            <Link href="/users/new">
              <Button variant="primary">
                <Plus className="size-4" /> New account
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <Panel className="overflow-hidden">
        {users.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={search ? 'No account matches' : 'No accounts yet'}
            detail={
              search
                ? 'Try part of a name, an email, or a role word.'
                : canManage
                  ? 'Create the first one — email, password, role, done.'
                  : undefined
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {rows.map((profile) => {
              const isSelf = profile.uid === myUid;
              return (
                <div
                  key={profile.uid}
                  className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.02] md:flex-nowrap"
                >
                  <Initials name={profile.displayName || profile.email} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-mist-50">
                      {profile.displayName || '—'}
                      {isSelf ? (
                        <span className="text-[10px] font-normal text-mist-600">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-mist-600">{profile.email}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <RoleBadge role={profile.role} />
                    {profile.role === 'karykarta' && profile.wardNo ? (
                      <span className="rounded-md border border-line bg-white/[0.03] px-2 py-0.5 text-[11px] tabular-nums text-mist-400">
                        ward {profile.wardNo}
                      </span>
                    ) : null}
                    {!profile.role ? (
                      <span className="rounded-md border border-signal-amber/30 bg-signal-amber/10 px-2 py-0.5 text-[11px] text-signal-amber">
                        role needed
                      </span>
                    ) : null}
                  </div>

                  <span className="hidden w-32 text-right text-[11px] text-mist-600 md:block">
                    {formatWhen(profile.createdAt)}
                  </span>

                  {canManage ? (
                    <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
                      <button
                        onClick={() => openRoleDialog(profile)}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot change your own role' : 'Change role & ward'}
                        className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-brand-500/10 hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <KeyRound className="size-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(profile)}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot delete your own profile' : 'Delete profile'}
                        className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-signal-rose/10 hover:text-signal-rose disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="w-24 text-right text-[11px] text-mist-600">
                      view only
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Role grant dialog */}
      <AnimatePresence>
        {roleTarget ? (
          <motion.div
            className="fixed inset-0 z-[70] grid place-items-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div
              className="absolute inset-0 bg-black/65 backdrop-blur-sm"
              onClick={() => {
                if (!roleBusy) setRoleTarget(null);
              }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Change role"
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="panel edge-lit relative w-full max-w-[440px] p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <span className="brand-gradient grid size-10 place-items-center rounded-xl">
                  <UserCog className="size-5 text-white" />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-mist-50">Change role</h2>
                  <p className="text-xs text-mist-600">
                    {roleTarget.displayName || roleTarget.email}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <Field
                  label="Role"
                  hint="Rules read this from users/{uid} on every write — the grant takes effect instantly, including on their open sessions."
                >
                  <Select
                    value={nextRole}
                    onChange={(event) => setNextRole(event.target.value as AppRole)}
                  >
                    {APP_ROLES.map((value) => (
                      <option key={value} value={value}>
                        {roleLabel(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <AnimatePresence initial={false}>
                  {nextRole === 'karykarta' ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <Field
                        label="Ward number"
                        hint="Required — a karykarta with no ward reads nothing, by design."
                      >
                        <Input
                          value={nextWard}
                          onChange={(event) => {
                            setNextWard(event.target.value.replace(/\D/g, ''));
                            setRoleError(null);
                          }}
                          inputMode="numeric"
                          placeholder="e.g. 3"
                        />
                      </Field>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {roleError ? (
                  <p className="rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose">
                    {roleError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2.5 pt-1">
                  <Button variant="ghost" onClick={() => setRoleTarget(null)} disabled={roleBusy}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => void submitRole()} disabled={roleBusy}>
                    {roleBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Apply role
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove this profile?"
        detail={
          <>
            <strong>{deleteTarget?.displayName || deleteTarget?.email}</strong> loses every
            panel capability: their <code>users/</code> document is deleted, so rules deny
            them all reads. The Firebase Auth login record stays (this panel cannot delete
            Auth users — only their own), so the email can be re-onboarded later.
          </>
        }
        confirmLabel="Remove profile"
        busy={deleteBusy}
        onConfirm={() => void submitDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </MotionPage>
  );
}