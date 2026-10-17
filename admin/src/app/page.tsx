'use client';

/**
 * Overview — the landing dashboard.
 *
 * Everything here is DERIVED from the same query keys the feature pages use
 * (`['wards']`, `['users']`, `['tasks']`), so the first visit pays for data
 * the Voter roll and Tasks pages will then read from cache: one snapshot
 * listener per collection, shared across the whole panel. No composite
 * indexes, no aggregate count() calls — prototype-scale collections read
 * whole and counted in memory, the documented trade from the mobile rules
 * file applied consistently here.
 *
 * The roll total comes from `wards/{n}.voterCount` (the imported cover sheet)
 * rather than from reading `voters` — the dashboard should render before
 * ninety thousand voter rows cross the wire, and the number it shows is the
 * OFFICIAL tally, not a client-side recount.
 */
import {
  ClipboardList,
  Hash,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { taskFromDoc, wardFromDoc, profileFromDoc } from '@/lib/mappers';
import {
  buildTasksQuery,
  buildUsersQuery,
  buildWardsQuery,
} from '@/lib/api';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { roleLabel } from '@/lib/roles';
import { formatAgo, cn } from '@/lib/util';
import { APP_ROLES } from '@/lib/roles';
import type { Profile, Task, WardMeta } from '@/lib/types';
import { MotionPage, Stagger, StaggerItem } from '@/components/shell/motion-page';
import {
  EmptyState,
  Initials,
  Panel,
  RoleBadge,
  Skeleton,
  StatusBadge,
} from '@/components/ui/kit';
import { useSession } from '@/stores/session';

/* ------------------------------------------------------------- stat card */

function StatCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  caption: string;
  tone: string;
}) {
  return (
    <Panel className="relative p-5">
      <div className="flex items-start justify-between">
        <div
          className="grid size-10 place-items-center rounded-xl border border-line"
          style={{ background: `${tone}14`, color: tone }}
        >
          {icon}
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-mist-600">
          {label}
        </span>
      </div>
      <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight text-mist-50">
        {value}
      </p>
      <p className="mt-1 text-xs text-mist-600">{caption}</p>
    </Panel>
  );
}

/* ---------------------------------------------------------------- page --- */

export default function OverviewPage() {
  const displayName = useSession((s) => s.displayName);

  const wards = useLiveQuery<WardMeta[]>({
    key: ['wards'],
    subscribe: ({ emit, fail }) =>
      buildWardsSnapshot(emit, fail),
  });
  const users = useLiveQuery<Profile[]>({
    key: ['users'],
    subscribe: ({ emit, fail }) => usersSnapshot(emit, fail),
  });
  const tasks = useLiveQuery<Task[]>({
    key: ['tasks'],
    subscribe: ({ emit, fail }) => tasksSnapshot(emit, fail),
  });

  const validWards = useMemo(
    () => (wards.data ?? []).filter((ward) => Number.isFinite(ward.wardNo) && ward.voterCount > 0),
    [wards.data]
  );

  const totals = useMemo(() => {
    const roll = validWards.reduce((sum, ward) => sum + ward.voterCount, 0);
    const male = validWards.reduce((sum, ward) => sum + ward.male, 0);
    const female = validWards.reduce((sum, ward) => sum + ward.female, 0);
    const open = (tasks.data ?? []).filter(
      (task) => task.status === 'pending' || task.status === 'in_progress'
    ).length;
    const withRole = (users.data ?? []).filter((user) => user.role).length;
    return { roll, male, female, open, withRole };
  }, [validWards, tasks.data, users.data]);

  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      issue: 0,
    };
    for (const task of tasks.data ?? []) counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, [tasks.data]);

  const recentTasks = useMemo(
    () =>
      [...(tasks.data ?? [])]
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, 5),
    [tasks.data]
  );

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of users.data ?? []) {
      const role = profile.role ?? '';
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    return counts;
  }, [users.data]);

  const loading = wards.isLoading || users.isLoading || tasks.isLoading;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <MotionPage className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-mist-50">
          {greeting}
          {displayName ? `, ${displayName.split(' ')[0]}` : ''}
        </h2>
        <p className="mt-1 text-sm text-mist-400">
          The campaign at a glance — live from Firestore.
        </p>
      </div>

      {/* Stat cards */}
      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            icon={<Users className="size-5" />}
            label="Roll"
            value={loading ? '—' : totals.roll.toLocaleString('en-IN')}
            caption={`across ${validWards.length || '—'} wards · official tally`}
            tone="#818cf8"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<Hash className="size-5" />}
            label="Booths"
            value={loading ? '—' : validWards.length}
            caption="wards with imported cover sheets"
            tone="#38bdf8"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<UserCog className="size-5" />}
            label="Team"
            value={loading ? '—' : totals.withRole}
            caption={`${(users.data ?? []).length} accounts on file`}
            tone="#a78bfa"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<ClipboardList className="size-5" />}
            label="Open tasks"
            value={loading ? '—' : totals.open}
            caption={`${taskCounts.completed ?? 0} completed · ${taskCounts.issue ?? 0} flagged`}
            tone="#fbbf24"
          />
        </StaggerItem>
      </Stagger>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Ward breakdown */}
        <Panel className="xl:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-mist-50">Ward breakdown</h3>
              <p className="text-xs text-mist-600">Imported roll, cover-sheet counts</p>
            </div>
            <span className="text-xs tabular-nums text-mist-600">
              {loading ? '' : `${totals.male.toLocaleString('en-IN')} M · ${totals.female.toLocaleString('en-IN')} F`}
            </span>
          </div>

          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-9" />
              ))}
            </div>
          ) : validWards.length === 0 ? (
            <EmptyState
              title="No ward cover sheets yet"
              detail="Run scripts/seed-roll.mjs so wards/ and voters/ carry the imported roll — the dashboard counts from there."
            />
          ) : (
            <div className="scroll max-h-[420px] overflow-y-auto px-3 py-2">
              <Stagger step={0.03}>
                {[...validWards]
                  .sort((a, b) => a.wardNo - b.wardNo)
                  .map((ward) => {
                    const total = Math.max(ward.male + ward.female + ward.thirdGender, 1);
                    return (
                      <StaggerItem key={ward.wardNo}>
                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.03]">
                          <span className="w-7 text-center text-xs font-semibold tabular-nums text-mist-400">
                            {ward.wardNo}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-xs text-mist-200">
                                {ward.boothAddress || `Booth ${ward.boothNo}`}
                              </span>
                              <span className="text-[11px] tabular-nums text-mist-600">
                                {ward.voterCount.toLocaleString('en-IN')}
                              </span>
                            </div>
                            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                              <span
                                className="rounded-full bg-brand-500/80"
                                style={{ width: `${(ward.male / total) * 100}%` }}
                              />
                              <span
                                className="rounded-full bg-violet-400/70"
                                style={{ width: `${(ward.female / total) * 100}%` }}
                              />
                              <span
                                className="rounded-full bg-signal-sky/70"
                                style={{ width: `${(ward.thirdGender / total) * 100}%` }}
                              />
                            </div>
                          </div>
                          <span className="w-16 text-right text-[10px] tabular-nums text-mist-600">
                            pp. {ward.pdfPages || '—'}
                          </span>
                        </div>
                      </StaggerItem>
                    );
                  })}
              </Stagger>
            </div>
          )}
        </Panel>

        {/* Right column: tasks + role mix */}
        <div className="space-y-6 xl:col-span-2">
          <Panel>
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold text-mist-50">Task rundown</h3>
            </div>
            <div className="grid grid-cols-4 gap-px bg-line">
              {(['pending', 'in_progress', 'completed', 'issue'] as const).map((status) => (
                <div key={status} className="bg-ink-850 px-2 py-3 text-center">
                  <p className="text-lg font-semibold tabular-nums text-mist-50">
                    {taskCounts[status] ?? 0}
                  </p>
                  <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-mist-600">
                    {status.replace('_', ' ')}
                  </p>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {recentTasks.length === 0 ? (
                <li className="px-5 py-6 text-center text-xs text-mist-600">
                  No tasks yet — create one from the Tasks page.
                </li>
              ) : (
                recentTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-mist-200">{task.title}</p>
                      <p className="mt-0.5 text-[10px] text-mist-600">
                        {task.assigneeId ? `→ ${task.assigneeId} · ` : ''}{formatAgo(task.updatedAt ?? task.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={task.status} />
                  </li>
                ))
              )}
            </ul>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold text-mist-50">Role mix</h3>
              <ShieldCheck className="size-4 text-mist-600" />
            </div>
            <div className="space-y-3 p-5">
              {loading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-7" />
                  ))
                : APP_ROLES.map((role) => {
                    const count = roleCounts.get(role) ?? 0;
                    const max = Math.max(1, ...APP_ROLES.map((r) => roleCounts.get(r) ?? 0));
                    return (
                      <div key={role} className="flex items-center gap-3">
                        <span className="w-28 shrink-0">
                          <RoleBadge role={role} />
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              count > 0 ? 'brand-gradient' : 'bg-white/[0.04]'
                            )}
                            style={{ width: `${(count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-6 text-right text-xs tabular-nums text-mist-400">
                          {count}
                        </span>
                      </div>
                    );
                  })}
              <p className="pt-1 text-[11px] text-mist-600">
                Roleless accounts hold no capabilities — the rules deny them everything until a
                super admin grants a role.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {/* Team pulse */}
      {recentTasks.length > 0 || (users.data ?? []).length > 0 ? (
        <Panel>
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-sm font-semibold text-mist-50">Accounts on file</h3>
          </div>
          <div className="flex flex-wrap gap-3 p-5">
            {(users.data ?? []).slice(0, 12).map((profile) => (
              <div
                key={profile.uid}
                className="flex items-center gap-2.5 rounded-xl border border-line bg-white/[0.02] px-3 py-2"
              >
                <Initials name={profile.displayName || profile.email} size="sm" />
                <div className="leading-tight">
                  <p className="text-xs font-medium text-mist-200">
                    {profile.displayName || profile.email}
                  </p>
                  <p className="text-[10px] text-mist-600">
                    {profile.role ? roleLabel(profile.role) : 'no role yet'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </MotionPage>
  );
}

/* --------------------------------------------------------------- wiring --
 * subscribe closures: query builder + mapper, paired once per live query. */

function buildWardsSnapshot(
  emit: (data: WardMeta[]) => void,
  fail: (error: unknown) => void
): () => void {
  return subscribeCollectionOf(buildWardsQuery(), wardFromDoc, emit, fail);
}

function usersSnapshot(
  emit: (data: Profile[]) => void,
  fail: (error: unknown) => void
): () => void {
  return subscribeCollectionOf(buildUsersQuery(), profileFromDoc, emit, fail);
}

function tasksSnapshot(
  emit: (data: Task[]) => void,
  fail: (error: unknown) => void
): () => void {
  return subscribeCollectionOf(buildTasksQuery(), taskFromDoc, emit, fail);
}