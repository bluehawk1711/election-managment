'use client';

/**
 * Accounts — the roster a super admin (or developer) manages, readable by
 * plain admins too. Guarded three ways, layered:
 *
 *  - `can(role, 'accountView')` gates the PAGE (karykarta never see the
 *    roster — Firestore's `list` rule would deny the query anyway; the local
 *    check only spares the permission-denied toast);
 *  - `can(role, 'accountManage')` gates create / vault / lock / delete, and
 *    `can(role, 'roleGrant')` — admin and up, the exact caller set the rules
 *    allow to write `role`/`wardNo`/`wardNos` — gates the role-and-ward
 *    dialog: an admin can assign a karykarta's wards while every destructive
 *    or credential control stays super-admin-only, so widened visibility can
 *    never widen power beyond what the rules already allow;
 *  - `firestore.rules` re-checks everything with the caller's profile — the
 *    `uid != request.auth.uid` invariants mean this UI can refuse to offer
 *    self-promotion or self-deletion, but a curl that ignores it gets denied
 *    server-side regardless.
 *
 * Role edits are `updateDoc({role, wardNo?, wardNos?})` — affected keys only:
 * `database.rules` evaluates each CHILD of `users/{uid}` against its own
 * rule, so granting a karykarta writes `role` plus the ward pair (wardNo =
 * first ward, wardNos = the full set), while leaving karykarta writes
 * `wardNo: null, wardNos: null` — RTDB stores no `null` children, so writing
 * null REMOVES the key, which is exactly the "absent" state the
 * non-karykarta rule demands.
 */
import {
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Lock,
  MonitorSmartphone,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  buildAssignedTasksQuery,
  buildTeamsQuery,
  buildUsersQuery,
  changeAccountPassword,
  deleteAccount,
  fetchAccountDetail,
  fetchCollectionOnce,
  grantRole,
  lockAccount,
  readVault,
  setMultiDevice,
  setTeam,
  unlockAccount,
  updateVaultPassword,
} from '@/lib/api';
import { isVaultHash, vaultMatches } from '@/lib/vault';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { profileFromDoc, teamFromDoc } from '@/lib/mappers';
import { APP_ROLES, can, roleLabel, type AppRole } from '@/lib/roles';
import { formatWhen } from '@/lib/util';
import type { AccountVault, AuthAccountDetail, Profile, TeamRoster } from '@/lib/types';
import { messageFor, toast } from '@/stores/toast';
import { useSession } from '@/stores/session';
import { MotionPage } from '@/components/shell/motion-page';
import { TeamsDialog } from '@/components/accounts/teams-dialog';
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

/** One label/value line in the detail dialog. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="shrink-0 text-mist-600">{label}</dt>
      <dd className="min-w-0 text-mist-200">{value}</dd>
    </>
  );
}

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
  /**
   * The role-and-ward dialog's gate — admin, superAdmin and developer, the
   * exact caller set `database.rules` puts on the `role`/`wardNo`/`wardNos`
   * profile children (and that /api/account/claims accepts). Separate from
   * `canManage` so assigning a karykarta's wards is available to an admin
   * while create/vault/lock/delete stay super-admin-only.
   */
  const canGrant = can(role, 'roleGrant');
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
  // ---- team assignment ----
  // Teams are a free-form label: two accounts with the same non-empty `teamId`
  // read each other's fieldwork overlay (firestore.rules `sameTeam`). Kept out
  // of the role dialog because it is a DIFFERENT rules path (its own allow-list
  // `['teamId','updatedAt']`), so coupling them would force two unrelated
  // writes through one submit.
  //
  // Assigning also maintains `teams/{label}.members` (the uid → name roster
  // the app pulls to discover teammates) — see `setTeam`, which batches both.
  const [teamTarget, setTeamTarget] = useState<Profile | null>(null);
  const [nextTeam, setNextTeam] = useState('');
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  /**
   * The team management surface — create a team, put accounts on it, take
   * them off, delete it (`components/accounts/teams-dialog.tsx`).
   *
   * Same `canManageAccounts` gate as every write inside it: `/teams` list is
   * denied below super admin in rules, so the query is gated here only to
   * spare the permission-denied toast — enforcement stays in rules.
   */
  const [teamsOpen, setTeamsOpen] = useState(false);

  const teams = useLiveQuery<TeamRoster[]>({
    key: ['teams'],
    enabled: can(role, 'accountManage'),
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildTeamsQuery(), teamFromDoc, emit, fail),
  });

  /**
   * Existing labels, offered as suggestions in the assign dialog below. A
   * typed label and a suggested one must not differ by a stray space or case
   * — two "same-looking" teams share nothing, and the symptom (nobody sees
   * anyone's notes) is three screens away from the cause.
   */
  const teamLabels = useMemo(
    () => [...(teams.data ?? [])].map((team) => team.id).sort(),
    [teams.data]
  );

  const teamById = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team])),
    [teams.data]
  );

  const openTeamDialog = (profile: Profile) => {
    setTeamTarget(profile);
    setNextTeam(profile.teamId ?? '');
    setTeamError(null);
  };

  const submitTeam = async () => {
    if (!teamTarget) return;
    const label = nextTeam.trim();
    if (label.length > 64) {
      setTeamError('Team label must be 64 characters or fewer.');
      return;
    }
    setTeamBusy(true);
    setTeamError(null);
    try {
      await setTeam(
        teamTarget.uid,
        label,
        teamTarget.displayName || teamTarget.email
      );
      toast.success(
        label ? 'Team assigned' : 'Team cleared',
        label
          ? `${teamTarget.displayName || teamTarget.email} is on team "${label}" — members of that team can now see each other's field notes.`
          : `${teamTarget.displayName || teamTarget.email} is on no team — their field notes are private again.`
      );
      setTeamTarget(null);
    } catch (caught) {
      setTeamError(messageFor(caught));
      toast.error('Team change refused', messageFor(caught));
    } finally {
      setTeamBusy(false);
    }
  };

  const [roleTarget, setRoleTarget] = useState<Profile | null>(null);
  const [nextRole, setNextRole] = useState<AppRole>('karykarta');
  const [nextWards, setNextWards] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const openRoleDialog = (profile: Profile) => {
    setRoleTarget(profile);
    setNextRole((profile.role as AppRole | null) ?? 'karykarta');
    // Pre-fill the FULL assigned set — `profile.wardNos` is already the
    // complete scope (mappers.ts falls back to the single legacy wardNo).
    setNextWards((profile.wardNos ?? []).join(', '));
    setRoleError(null);
  };

  /**
   * The ward field in this dialog: one or more ward numbers separated by
   * commas, spaces or any other non-digit — deduped, validated against the
   * rules' 1..999 ceiling, sorted ascending (the shape grantRole
   * normalises and stores as wardNo + wardNos).
   */
  const parseWards = (text: string): number[] =>
    [
      ...new Set(
        text
          .split(/[^\d]+/)
          .filter(Boolean)
          .map(Number)
          .filter((wardNo) => wardNo >= 1 && wardNo <= 999)
      ),
    ].sort((a, b) => a - b);

  const submitRole = async () => {
    if (!roleTarget) return;
    const wards = parseWards(nextWards);
    if (nextRole === 'karykarta' && wards.length === 0) {
      setRoleError('A karykarta needs at least one ward number above 0.');
      return;
    }
    setRoleBusy(true);
    setRoleError(null);
    try {
      await grantRole({
        targetUid: roleTarget.uid,
        role: nextRole,
        wardNos: nextRole === 'karykarta' ? wards : null,
        profile: roleTarget,
      });
      toast.success(
        'Role updated',
        `${roleTarget.displayName || roleTarget.email} is now ${roleLabel(nextRole)}${
          nextRole === 'karykarta'
            ? ` (ward${wards.length > 1 ? 's' : ''} ${wards.join(', ')})`
            : ''
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

  /* ---- lock / unlock ---- */
  const [lockTarget, setLockTarget] = useState<Profile | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  const submitLock = async () => {
    if (!lockTarget || !myUid) return;
    setLockBusy(true);
    try {
      await lockAccount(lockTarget.uid, myUid);
      toast.success(
        'Account locked',
        `${lockTarget.displayName || lockTarget.email} is locked out everywhere — every device signed in as this account loses access on its next snapshot, and only a super admin can unlock it.`
      );
      setLockTarget(null);
    } catch (caught) {
      toast.error('Lock refused', messageFor(caught));
    } finally {
      setLockBusy(false);
    }
  };

  const submitUnlock = async (target: Profile) => {
    try {
      await unlockAccount(target.uid);
      toast.success(
        'Account unlocked',
        `${target.displayName || target.email} can sign in again — the device binding was cleared, so the next sign-in (from the rightful device) re-binds it.`
      );
    } catch (caught) {
      toast.error('Unlock refused', messageFor(caught));
    }
  };

  /* ---- multi-device exemption ---- */
  const submitMultiDevice = async (target: Profile, value: boolean) => {
    if (!myUid) return;
    try {
      await setMultiDevice(target.uid, value, myUid);
      toast.success(
        value ? 'Multi-device granted' : 'Multi-device revoked',
        value
          ? `${target.displayName || target.email} can now sign in from any number of devices — the single-device lock no longer applies to this account.`
          : `${target.displayName || target.email} is back to one device — a sign-in from any other device will lock the account.`
      );
    } catch (caught) {
      toast.error('Multi-device change refused', messageFor(caught));
    }
  };

  /* ---- detail dialog ---- */
  const [detailTarget, setDetailTarget] = useState<Profile | null>(null);
  // The dialog follows the LIVE profile from the roster query (a lock or a
  // role grant elsewhere updates it in place) and augments it with the two
  // sources the roster does not carry: the Firebase Auth record (Admin-SDK
  // route — `null` when unavailable), the password vault (managers only) and
  // the account's assigned-task load.
  const detailProfile = detailTarget
    ? ((users.data ?? []).find((entry) => entry.uid === detailTarget.uid) ?? detailTarget)
    : null;
  const [detailAuth, setDetailAuth] = useState<AuthAccountDetail | null | 'loading'>('loading');
  const [detailVault, setDetailVault] = useState<AccountVault | null | 'loading'>('loading');
  const [detailTasks, setDetailTasks] = useState<{ open: number; total: number } | null | 'loading'>('loading');

  useEffect(() => {
    if (!detailTarget) return;
    let alive = true;
    setDetailAuth('loading');
    setDetailVault('loading');
    setDetailTasks('loading');

    void fetchAccountDetail(detailTarget.uid)
      .then((value) => {
        if (alive) setDetailAuth(value);
      })
      .catch(() => {
        if (alive) setDetailAuth(null);
      });

    if (canManage) {
      void readVault(detailTarget.uid)
        .then((value) => {
          if (alive) setDetailVault(value);
        })
        .catch(() => {
          if (alive) setDetailVault(null);
        });
    } else {
      setDetailVault(null); // rules would deny the read anyway — don't ask
    }

    void fetchCollectionOnce(buildAssignedTasksQuery(detailTarget.uid), (entry) => entry.data())
      .then((tasks) => {
        if (!alive) return;
        const open = tasks.filter((task) => task.status !== 'completed').length;
        setDetailTasks({ open, total: tasks.length });
      })
      .catch(() => {
        if (alive) setDetailTasks(null);
      });

    return () => {
      alive = false;
    };
  }, [detailTarget, canManage]);

  // Escape closes — the dialog is informational, nothing to confirm.
  useEffect(() => {
    if (!detailTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailTarget(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailTarget]);

  /* ---- password vault: reveal + quick rotate ---- */
  const [vaultTarget, setVaultTarget] = useState<Profile | null>(null);
  const [vault, setVault] = useState<AccountVault | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyResult, setVerifyResult] = useState<'match' | 'no' | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  const openVault = async (target: Profile) => {
    setVaultTarget(target);
    setVault(null);
    setVaultLoading(true);
    setVaultError(null);
    setVerifyInput('');
    setVerifyResult(null);
    setNewPass('');
    setConfirmPass('');
    try {
      setVault(await readVault(target.uid));
    } catch (caught) {
      setVaultError(messageFor(caught));
    } finally {
      setVaultLoading(false);
    }
  };

  const submitRotate = async () => {
    if (!vaultTarget || !myUid) return;
    if (newPass.length < 6) {
      setVaultError('New passwords must be at least 6 characters (Firebase Auth’s floor).');
      return;
    }
    if (newPass !== confirmPass) {
      setVaultError('The two new passwords do not match.');
      return;
    }
    setVaultBusy(true);
    setVaultError(null);
    try {
      // No current-password step: the LOCAL API route uses the Admin SDK
      // (`updateUser(uid, {password})`), which has no re-auth requirement —
      // the whole reason a super admin can rotate a password without ever
      // knowing the old one. The vault is then re-saved with the HASH of
      // this value (lib/vault.ts).
      await changeAccountPassword({
        targetUid: vaultTarget.uid,
        email: vaultTarget.email,
        newPassword: newPass,
        managerUid: myUid,
      });
      setVault(await readVault(vaultTarget.uid).catch(() => null));
      setNewPass('');
      setConfirmPass('');
      setVerifyInput('');
      setVerifyResult(null);
      toast.success(
        'Password changed',
        `${vaultTarget.email} can now sign in with the new password — no old password was needed, and the vault holds only its hash.`
      );
    } catch (caught) {
      setVaultError(messageFor(caught));
    } finally {
      setVaultBusy(false);
    }
  };

  /**
   * "Check the password" without revealing it — the vault stores
   * `sha256(value + key)`, so a candidate is hashed the same way and
   * compared. A match against a LEGACY plaintext entry also re-saves that
   * entry hashed: the check proves the value, and nothing readable should
   * keep holding it.
   */
  const submitVerify = async () => {
    if (!vault?.password || !verifyInput || !vaultTarget || !myUid) return;
    setVerifying(true);
    setVaultError(null);
    try {
      const matched = await vaultMatches(vault.password, verifyInput);
      setVerifyResult(matched ? 'match' : 'no');
      if (matched && !isVaultHash(vault.password)) {
        await updateVaultPassword({
          targetUid: vaultTarget.uid,
          email: vault.email || vaultTarget.email,
          newPassword: verifyInput,
          managerUid: myUid,
        });
        setVault(await readVault(vaultTarget.uid).catch(() => null));
      }
    } catch (caught) {
      setVaultError(messageFor(caught));
    } finally {
      setVerifying(false);
    }
  };

  /* ---- delete submit (below) ---- */

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
            {users.isLoading ? 'Loading roster…' : `${rows.length} of ${(users.data ?? []).length} on file`}                    {canManage
                      ? ''
                      : canGrant
                        ? ' · can change roles & wards'
                        : ' · read-only for your role'}
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
            <>
              <Button
                variant='ghost'
                onClick={() => setTeamsOpen(true)}
                title='Create a team and put accounts on it — members of a team read each other’s field notes in the app.'
              >
                <Users className='size-4' /> Teams
              </Button>
              <Link href="/users/new">
                <Button variant="primary">
                  <Plus className="size-4" /> New account
                </Button>
              </Link>
            </>
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
                    {/* Device binding + lock state — the "which device is
                        this account on" column. One line, second row of the
                        identity block: the binding is an attribute of the
                        account, not an action, so it sits with the email. */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {profile.device ? (
                        <span
                          title={`Bound from this device ${formatWhen(profile.device.lastActiveAt)} — one account, one device; a sign-in anywhere else locks it.`}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-mist-500"
                        >
                          <Smartphone className="size-3 shrink-0" />
                          <span className="truncate">
                            {profile.device.name || 'Unknown device'} · {profile.device.platform}
                          </span>
                        </span>
                      ) : (
                        <span
                          title="This account has never bound a device — the next sign-in (from an app or the web) will bind it."
                          className="rounded-md border border-line bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-mist-600"
                        >
                          no device yet
                        </span>
                      )}
                      {profile.locked ? (
                        <span
                          title={`Locked ${formatWhen(profile.lockedAt)} by ${
                            profile.lockedBy === 'system'
                              ? 'a foreign-device sign-in (automatic)'
                              : profile.lockedBy || 'an administrator'
                          } — only a super admin can unlock.`}
                          className="inline-flex items-center gap-1 rounded-md border border-signal-rose/35 bg-signal-rose/10 px-1.5 py-0.5 text-[10px] font-medium text-signal-rose"
                        >
                          <Lock className="size-3" />
                          {profile.lockedReason === 'device_change'
                            ? 'locked · other device'
                            : 'locked'}
                        </span>
                      ) : null}
                      {profile.multiDevice ? (
                        <span
                          title={`Multi-device access — this account may sign in from any number of devices and never self-locks. ${
                            profile.multiDeviceBy
                              ? `Granted by admin ${profile.multiDeviceBy}.`
                              : ''
                          }`}
                          className="inline-flex items-center gap-1 rounded-md border border-signal-emerald/35 bg-signal-emerald/10 px-1.5 py-0.5 text-[10px] font-medium text-signal-emerald"
                        >
                          <MonitorSmartphone className="size-3" />
                          multi-device
                        </span>
                      ) : null}
                      {profile.teamId ? (
                        <span
                          title={`Team "${profile.teamId}" — members of this team can see each other's field notes in the app.`}
                          className="inline-flex items-center gap-1 rounded-md border border-brand-400/35 bg-brand-400/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-300"
                        >
                          <Users className="size-3" />
                          {profile.teamId}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <RoleBadge role={profile.role} />
                    {profile.role === 'karykarta' && profile.wardNo ? (
                      <span className="rounded-md border border-line bg-white/[0.03] px-2 py-0.5 text-[11px] tabular-nums text-mist-400">
                        ward {profile.wardNos?.join(', ') ?? profile.wardNo}
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

                  <div className="flex shrink-0 items-center justify-end gap-1.5">
                    {/* The whole account in one dialog — profile, Auth
                        record, vault state, task load — openable by every
                        role that can see the roster, not just managers. */}
                    <button
                      onClick={() => setDetailTarget(profile)}
                      title="All details"
                      aria-label={`Details for ${profile.email}`}
                      className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-brand-500/10 hover:text-brand-400"
                    >
                      <Info className="size-4" />
                    </button>
                    {/* Role grant — `roleGrant` (admin and up), one level wider
                        than the manager-only buttons beside it: an admin can
                        assign a karykarta's wards without getting the vault,
                        lock or delete controls. Self-grant was always blocked
                        (the rules refuse `auth.uid === $uid` on `role`), and
                        the button stays absent rather than disabled for it. */}
                    {canGrant && !isSelf ? (
                      <button
                        onClick={() => openRoleDialog(profile)}
                        title="Change role & wards"
                        aria-label={`Change role & wards for ${profile.email}`}
                        className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-brand-500/10 hover:text-brand-400"
                      >
                        <KeyRound className="size-4" />
                      </button>
                    ) : null}
                    {canManage ? (
                      <>
                      {/* Check / change the password — the vault dialog. */}
                      <button
                        onClick={() => void openVault(profile)}
                        title="Check / change password"
                        aria-label={`Password for ${profile.email}`}
                        className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-brand-500/10 hover:text-brand-400"
                      >
                        <Eye className="size-4" />
                      </button>
                      {/* Multi-device — lifts the single-device lock for THIS
                          account so it can sign in anywhere. Same
                          canManageAccounts gate as lock/unlock. */}
                      <button
                        onClick={() => void submitMultiDevice(profile, !profile.multiDevice)}
                        disabled={isSelf}
                        title={
                          isSelf
                            ? 'You cannot change your own multi-device setting'
                            : profile.multiDevice
                              ? 'Revoke multi-device — back to one device'
                              : 'Allow this account on multiple devices'
                        }
                        aria-label={
                          profile.multiDevice ? 'Revoke multi-device' : 'Allow multi-device'
                        }
                        className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                          profile.multiDevice
                            ? 'bg-signal-emerald/10 text-signal-emerald hover:bg-signal-emerald/20'
                            : 'text-mist-600 hover:bg-brand-500/10 hover:text-brand-400'
                        }`}
                      >
                        <MonitorSmartphone className="size-4" />
                      </button>
                      {/* Lock / unlock — unlock only exists on a locked row,
                          and both funnel through canManageAccounts on the
                          rules side: only super admin + developer. */}
                      {profile.locked ? (
                        <button
                          onClick={() => void submitUnlock(profile)}
                          disabled={isSelf}
                          title={
                            isSelf
                              ? 'You cannot unlock your own locked account — ask another super admin'
                              : 'Unlock account and clear its device binding'
                          }
                          aria-label="Unlock account"
                          className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-signal-emerald/10 hover:text-signal-emerald disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Unlock className="size-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setLockTarget(profile)}
                          disabled={isSelf}
                          title={
                            isSelf
                              ? 'You cannot lock your own account from here'
                              : 'Lock this account (all devices)'
                          }
                          aria-label="Lock account"
                          className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-signal-amber/10 hover:text-signal-amber disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Lock className="size-4" />
                        </button>
                      )}
                      {/* Team assignment — free-form label; same-label
                          accounts read each other's field notes. Same
                          canManageAccounts gate. */}
                      <button
                        onClick={() => openTeamDialog(profile)}
                        disabled={isSelf}
                        title={
                          isSelf
                            ? 'You cannot change your own team'
                            : profile.teamId
                              ? `On team "${profile.teamId}" — change or clear`
                              : 'Assign to a team'
                        }
                        aria-label="Assign team"
                        className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                          profile.teamId
                            ? 'bg-signal-amber/10 text-signal-amber hover:bg-signal-amber/20'
                            : 'text-mist-600 hover:bg-brand-500/10 hover:text-brand-400'
                        }`}
                      >
                        <Users className="size-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(profile)}
                        disabled={isSelf}
                        title={isSelf ? 'You cannot delete your own profile' : 'Delete profile'}
                        className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-signal-rose/10 hover:text-signal-rose disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        <Trash2 className="size-4" />
                      </button>
                      </>
                    ) : (
                      <span className="w-24 text-right text-[11px] text-mist-600">
                        view only
                      </span>
                    )}
                  </div>
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
                        label="Wards"
                        hint="One or more, comma-separated — e.g. 3, 5, 7. A karykarta with no ward reads nothing, by design."
                      >
                        <Input
                          value={nextWards}
                          onChange={(event) => {
                            setNextWards(event.target.value);
                            setRoleError(null);
                          }}
                          placeholder="e.g. 3, 5, 7"
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

      {/* Team assignment dialog */}
      <AnimatePresence>
        {teamTarget ? (
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
                if (!teamBusy) setTeamTarget(null);
              }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Assign team"
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="panel edge-lit relative w-full max-w-[440px] p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <span className="brand-gradient grid size-10 place-items-center rounded-xl">
                  <Users className="size-5 text-white" />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-mist-50">Assign team</h2>
                  <p className="text-xs text-mist-600">
                    {teamTarget.displayName || teamTarget.email}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <Field
                  label="Team label"
                  hint="Two accounts with the same label can read each other's field notes in the app. Leave empty to keep this account private."
                >
                  <Input
                    value={nextTeam}
                    onChange={(event) => {
                      setNextTeam(event.target.value);
                      setTeamError(null);
                    }}
                    maxLength={64}
                    placeholder="e.g. ward-3-sweep"
                  />
                </Field>

                {/* Existing labels, one tap each. Typing the same team twice
                    creates two teams that share nothing — the suggestion is
                    the fix, and it is also how someone discovers the team a
                    colleague already made. */}
                {teamLabels.length > 0 ? (
                  <div className="space-y-1.5">
                    <span className="block text-[11px] uppercase tracking-[0.08em] text-mist-600">
                      Existing teams
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {teamLabels.map((label) => (
                        <button
                          key={label}
                          onClick={() => {
                            setNextTeam(label);
                            setTeamError(null);
                          }}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            nextTeam.trim() === label
                              ? 'border-brand-400/60 bg-brand-500/15 text-brand-300'
                              : 'border-line-strong bg-white/[0.03] text-mist-300 hover:border-brand-400/50 hover:text-mist-50'
                          }`}
                        >
                          {label}
                          <span className="ml-1.5 opacity-60">
                            {teamById.get(label)
                              ? Object.keys(teamById.get(label)!.members).length
                              : 0}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {teamError ? (
                  <p className="rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose">
                    {teamError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2.5 pt-1">
                  <Button variant="ghost" onClick={() => setTeamTarget(null)} disabled={teamBusy}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => void submitTeam()} disabled={teamBusy}>
                    {teamBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    {nextTeam.trim() ? 'Assign' : 'Clear team'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Team management — the make-a-team surface behind the header button. */}
      <TeamsDialog
        open={teamsOpen}
        onClose={() => setTeamsOpen(false)}
        profiles={users.data ?? []}
        myUid={myUid}
      />

      {/* Password vault: reveal the stored password + quick rotate */}
      <AnimatePresence>
        {vaultTarget ? (
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
                if (!vaultBusy) setVaultTarget(null);
              }}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Password and access"
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="panel edge-lit relative w-full max-w-[480px] p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <span className="brand-gradient grid size-10 place-items-center rounded-xl">
                  <Eye className="size-5 text-white" />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-mist-50">Password & access</h2>
                  <p className="text-xs text-mist-600">{vaultTarget.displayName || vaultTarget.email}</p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <Field
                  label="Check a password"
                  hint="The vault keeps only a SHA-256 hash of each password (pepper in the code) — verify a value without the panel ever showing one."
                >
                  {vaultLoading ? (
                    <Skeleton className="h-10" />
                  ) : !vault?.password ? (
                    <p className="rounded-lg border border-signal-amber/30 bg-signal-amber/10 px-3 py-2 text-[11px] leading-relaxed text-signal-amber">
                      No vault entry for this account yet — nothing to check against. Change the
                      password below and the vault starts with the hash of the new one.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        autoComplete="off"
                        placeholder="Type a password to verify"
                        value={verifyInput}
                        onChange={(event) => {
                          setVerifyInput(event.target.value);
                          setVerifyResult(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void submitVerify();
                          }
                        }}
                      />
                      <Button
                        variant="secondary"
                        className="shrink-0 px-3"
                        onClick={() => void submitVerify()}
                        disabled={verifying || !verifyInput}
                      >
                        {verifying ? <Loader2 className="size-4 animate-spin" /> : 'Check'}
                      </Button>
                      {verifyResult === 'match' ? (
                        <span className="inline-flex shrink-0 items-center rounded-lg border border-signal-emerald/35 bg-signal-emerald/10 px-2.5 text-xs font-medium text-signal-emerald">
                          matches
                        </span>
                      ) : verifyResult === 'no' ? (
                        <span className="inline-flex shrink-0 items-center rounded-lg border border-signal-rose/35 bg-signal-rose/10 px-2.5 text-xs font-medium text-signal-rose">
                          no match
                        </span>
                      ) : null}
                    </div>
                  )}
                </Field>
                {vault ? (
                  <p className="text-[11px] text-mist-600">
                    Vault entry written {formatWhen(vault.updatedAt)}.
                  </p>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="New password">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 6 characters"
                      value={newPass}
                      onChange={(event) => setNewPass(event.target.value)}
                    />
                  </Field>
                  <Field label="Repeat new password">
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Same once more"
                      value={confirmPass}
                      onChange={(event) => setConfirmPass(event.target.value)}
                    />
                  </Field>
                </div>

                {vaultError ? (
                  <p className="rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs leading-relaxed text-signal-rose">
                    {vaultError}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2.5 pt-1">
                  <Button variant="ghost" onClick={() => setVaultTarget(null)} disabled={vaultBusy}>
                    Close
                  </Button>
                  <Button variant="primary" onClick={() => void submitRotate()} disabled={vaultBusy || vaultLoading}>
                    {vaultBusy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    Change password
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Detail dialog — the whole account in one place */}
      <AnimatePresence>
        {detailTarget && detailProfile ? (
          <motion.div
            className="fixed inset-0 z-[70] grid place-items-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div
              className="absolute inset-0 bg-black/65 backdrop-blur-sm"
              onClick={() => setDetailTarget(null)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Account details"
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="panel edge-lit relative max-h-[86vh] w-full max-w-[520px] overflow-y-auto p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-3.5">
                <Initials name={detailProfile.displayName || detailProfile.email} size="lg" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-mist-50">
                    {detailProfile.displayName || '—'}
                  </h2>
                  <p className="truncate text-xs text-mist-600">{detailProfile.email}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <RoleBadge role={detailProfile.role} />
                    {detailProfile.wardNo != null ? (
                      <span className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 text-[10px] tabular-nums text-mist-400">
                        ward {detailProfile.wardNos?.join(', ') ?? detailProfile.wardNo}
                      </span>
                    ) : null}
                    {detailProfile.locked ? (
                      <span className="rounded-md border border-signal-rose/35 bg-signal-rose/10 px-1.5 py-0.5 text-[10px] font-medium text-signal-rose">
                        locked
                      </span>
                    ) : null}
                    {detailAuth && detailAuth !== 'loading' && detailAuth.disabled ? (
                      <span className="rounded-md border border-signal-rose/35 bg-signal-rose/10 px-1.5 py-0.5 text-[10px] font-medium text-signal-rose">
                        auth disabled
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  onClick={() => setDetailTarget(null)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-mist-600 transition-colors hover:bg-white/5 hover:text-mist-200"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-5 space-y-4 text-xs">
                {/* Profile — everything the users/{uid} document carries. */}
                <section className="rounded-xl border border-line bg-white/[0.02] p-3.5">
                  <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-600">
                    Profile
                  </h3>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5">
                    <DetailRow
                      label="User ID"
                      value={<span className="font-mono break-all">{detailProfile.uid}</span>}
                    />
                    <DetailRow
                      label="Role"
                      value={
                        roleLabel(detailProfile.role) +
                        (detailProfile.role === 'karykarta' && detailProfile.wardNo != null
                          ? ` · ward ${detailProfile.wardNos?.join(', ') ?? detailProfile.wardNo}`
                          : '')
                      }
                    />
                    <DetailRow
                      label="Onboarded"
                      value={detailProfile.onboarded ? 'yes' : 'not yet'}
                    />
                    <DetailRow
                      label="Profile created"
                      value={formatWhen(detailProfile.createdAt)}
                    />
                    <DetailRow
                      label="Device"
                      value={
                        detailProfile.device
                          ? `${detailProfile.device.name || 'Unknown device'} · ${detailProfile.device.platform} — last active ${formatWhen(detailProfile.device.lastActiveAt)}`
                          : 'never bound a device'}
                    />
                    {detailProfile.locked ? (
                      <DetailRow
                        label="Lock"
                        value={`${formatWhen(detailProfile.lockedAt)} — ${
                          detailProfile.lockedReason === 'device_change'
                            ? 'foreign-device sign-in (automatic)'
                            : 'locked by an admin'
                        }, by ${detailProfile.lockedBy || 'unknown'}`}
                      />
                    ) : null}
                  </dl>
                </section>

                {/* Login record — the Firebase Auth side, via the local
                    Admin-SDK route. */}
                <section className="rounded-xl border border-line bg-white/[0.02] p-3.5">
                  <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-600">
                    Login record (Firebase Auth)
                  </h3>
                  {detailAuth === 'loading' ? (
                    <Skeleton className="h-12" />
                  ) : detailAuth ? (
                    <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5">
                      <DetailRow
                        label="Created"
                        value={formatWhen(detailAuth.createdAt)}
                      />
                      <DetailRow
                        label="Last sign-in"
                        value={
                          detailAuth.lastSignInAt != null
                            ? formatWhen(detailAuth.lastSignInAt)
                            : 'never signed in'
                        }
                      />
                      <DetailRow
                        label="E-mail verified"
                        value={detailAuth.emailVerified ? 'yes' : 'no'}
                      />
                      <DetailRow
                        label="Providers"
                        value={detailAuth.providers.join(', ') || '—'}
                      />
                      <DetailRow
                        label="Auth phone"
                        value={detailAuth.phone || '—'}
                      />
                    </dl>
                  ) : (
                    <p className="leading-relaxed text-mist-600">
                      Not available — the Auth lookup runs through a local-only
                      Admin-SDK route (<code>/api/account/detail</code>), which needs
                      the <code>FIREBASE_ADMIN_*</code> env vars in{' '}
                      <code>admin/.env.local</code> and a dev server. The profile
                      facts above are unaffected.
                    </p>
                  )}
                </section>

                {/* Password vault — managers only; the rules would deny the
                    read for anyone else, so the section is not even asked. */}
                {canManage ? (
                  <section className="rounded-xl border border-line bg-white/[0.02] p-3.5">
                    <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-600">
                      Password vault
                    </h3>
                    {detailVault === 'loading' ? (
                      <Skeleton className="h-10" />
                    ) : detailVault ? (
                      <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1.5">
                        <DetailRow
                          label="Stored"
                          value={
                            isVaultHash(detailVault.password) ? (
                              'SHA-256 hash (peppered) — check a value with the key icon'
                            ) : (
                              <span className="text-signal-amber">
                                legacy plaintext entry — verify a candidate to migrate it
                              </span>
                            )
                          }
                        />
                        <DetailRow
                          label="Updated"
                          value={`${formatWhen(detailVault.updatedAt)} by ${detailVault.updatedBy}`}
                        />
                      </dl>
                    ) : (
                      <p className="leading-relaxed text-mist-600">
                        No vault entry yet — set the password from the row's key icon
                        and one is created (stored as a hash).
                      </p>
                    )}
                  </section>
                ) : null}

                {/* Current load — assigned tasks, one-shot read. */}
                <section className="rounded-xl border border-line bg-white/[0.02] p-3.5">
                  <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mist-600">
                    Current load
                  </h3>
                  {detailTasks === 'loading' ? (
                    <Skeleton className="h-6" />
                  ) : detailTasks ? (
                    <p className="text-mist-200">
                      {detailTasks.open} open of {detailTasks.total} assigned{' '}
                      {detailTasks.total === 1 ? 'task' : 'tasks'}
                    </p>
                  ) : (
                    <p className="text-mist-600">Task list unavailable.</p>
                  )}
                </section>

                {/* Role grant needs only `roleGrant` (admin and up) — the
                    exact caller set the rules put on the profile's
                    `role`/`wardNo`/`wardNos` children — so an admin sees this
                    button while everything below it stays super-admin-only. */}
                {canGrant ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="secondary"
                      disabled={detailProfile.uid === myUid}
                      onClick={() => {
                        const target = detailProfile;
                        setDetailTarget(null);
                        openRoleDialog(target);
                      }}
                    >
                      <UserCog className="size-4" /> Change role
                    </Button>
                  </div>
                ) : null}

                {/* Password vault, lock and delete — `accountManage`, i.e.
                    super admin + developer; the rules refuse an admin the
                    profile delete and the lock writes, so the panel does too. */}
                {canManage ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const target = detailProfile;
                        setDetailTarget(null);
                        void openVault(target);
                      }}
                    >
                      <KeyRound className="size-4" /> Password
                    </Button>
                    {detailProfile.locked ? (
                      <Button
                        variant="secondary"
                        disabled={detailProfile.uid === myUid}
                        onClick={() => {
                          const target = detailProfile;
                          setDetailTarget(null);
                          void submitUnlock(target);
                        }}
                      >
                        <Unlock className="size-4" /> Unlock
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={detailProfile.uid === myUid}
                        onClick={() => {
                          const target = detailProfile;
                          setDetailTarget(null);
                          setLockTarget(target);
                        }}
                      >
                        <Lock className="size-4" /> Lock
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={detailProfile.uid === myUid}
                      onClick={() => {
                        const target = detailProfile;
                        setDetailTarget(null);
                        setDeleteTarget(target);
                      }}
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={!!lockTarget}
        title="Lock this account?"
        detail={
          <>
            <strong>{lockTarget?.displayName || lockTarget?.email}</strong> is signed out
            everywhere: every device sees the lock on its next profile snapshot, and
            voter data, tasks and the roster all stop at the rules gate. The account
            stays locked — and cannot free itself — until a super admin unlocks it,
            which also clears its device binding for a clean re-bind.
          </>
        }
        confirmLabel="Lock account"
        busy={lockBusy}
        onConfirm={() => void submitLock()}
        onCancel={() => setLockTarget(null)}
      />

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