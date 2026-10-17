'use client';

/**
 * Tasks — the shared campaign queue, live.
 *
 * Status transitions are `updateDoc({status, updatedAt: serverTimestamp()})`
 * and nothing else: the update rule demands `exactKeys` on the RESULT and
 * `createdAt == resource.data.createdAt`, so a two-field partial write is
 * exactly legal while a "save the whole task" rewrite would fight the rule
 * over unmodifiable fields. That asymmetry (partial = legal, replace =
 * fragile) is deliberate — it keeps server-assigned timestamps untouchable.
 *
 * Creation is open to every role that reads the roll (`canEditCampaign()` is
 * `canReadVoters()` in rules — karykarta included: the people in the field
 * file the work). Deletion shares the same gate; confirmations are the
 * shared `ConfirmDialog` so a stray click never destroys a task.
 */
import {
  CalendarClock,
  ClipboardList,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  createTask,
  buildTasksQuery,
  deleteTask,
  setTaskStatus,
} from '@/lib/api';
import { subscribeCollectionOf, useLiveQuery } from '@/hooks/use-live';
import { taskFromDoc } from '@/lib/mappers';
import { TASK_STATUSES, type Task, type TaskStatus } from '@/lib/types';
import { dateInputToMillis, formatWhen, cn } from '@/lib/util';
import { messageFor, toast } from '@/stores/toast';
import { MotionPage } from '@/components/shell/motion-page';
import { ConfirmDialog } from '@/components/ui/confirm';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  Panel,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
} from '@/components/ui/kit';
import { useSession } from '@/stores/session';

const FILTERS: Array<TaskStatus | 'all'> = ['all', ...TASK_STATUSES];

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  issue: 'Issue',
};

export default function TasksPage() {
  const uid = useSession((s) => s.uid);

  const tasks = useLiveQuery<Task[]>({
    key: ['tasks'],
    subscribe: ({ emit, fail }) =>
      subscribeCollectionOf(buildTasksQuery(), taskFromDoc, emit, fail),
  });

  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: (tasks.data ?? []).length };
    for (const status of TASK_STATUSES) map[status] = 0;
    for (const task of tasks.data ?? []) map[task.status] = (map[task.status] ?? 0) + 1;
    return map;
  }, [tasks.data]);

  const rows = useMemo(() => {
    const list = [...(tasks.data ?? [])].sort((a, b) => {
      // Open first (by due date), then completed history by recency.
      const openA = a.status === 'completed' ? 1 : 0;
      const openB = b.status === 'completed' ? 1 : 0;
      if (openA !== openB) return openA - openB;
      if (openA === 0) return (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER);
      return (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0);
    });
    return filter === 'all' ? list : list.filter((task) => task.status === filter);
  }, [tasks.data, filter]);

  /* ---- create ---- */
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const submitCreate = async () => {
    if (creating) return;
    if (!title.trim()) {
      setCreateError('A task needs a title.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createTask(
        {
          title: title.trim(),
          description: description.trim(),
          assigneeId: assignee.trim(),
          areaId: '',
          boothId: '',
          dueDate: dateInputToMillis(dueDate),
          status: 'pending',
          report: '',
        },
        uid ?? ''
      );
      toast.success('Task created', title.trim());
      setTitle('');
      setDescription('');
      setAssignee('');
      setDueDate('');
      setComposerOpen(false);
    } catch (caught) {
      setCreateError(messageFor(caught));
      toast.error('Create failed', messageFor(caught));
    } finally {
      setCreating(false);
    }
  };

  /* ---- transitions ---- */
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const changeStatus = async (task: Task, status: TaskStatus) => {
    if (transitioning) return;
    setTransitioning(task.id + status);
    try {
      await setTaskStatus(task.id, status);
      toast.success(`“${task.title}” → ${STATUS_LABEL[status]}`);
    } catch (caught) {
      toast.error('Status change refused', messageFor(caught));
    } finally {
      setTransitioning(null);
    }
  };

  /* ---- delete ---- */
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteTask(deleteTarget.id);
      toast.success('Task deleted', deleteTarget.title);
      setDeleteTarget(null);
    } catch (caught) {
      toast.error('Delete refused', messageFor(caught));
    } finally {
      setDeleteBusy(false);
    }
  };

  const now = Date.now();

  return (
    <MotionPage className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-mist-50">Tasks</h2>
          <p className="text-sm text-mist-400">
            {tasks.isLoading
              ? 'Loading the queue…'
              : `${counts.all} total · ${counts.pending ?? 0} pending · ${counts.in_progress ?? 0} in progress`}
          </p>
        </div>
        <Button variant="primary" onClick={() => setComposerOpen((open) => !open)}>
          <Plus className={cn('size-4 transition-transform', composerOpen && 'rotate-45')} />
          {composerOpen ? 'Close' : 'New task'}
        </Button>
      </div>

      {/* Composer */}
      <AnimatePresence initial={false}>
        {composerOpen ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <Panel className="p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Title" className="md:col-span-2">
                  <Input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder="Door-to-door survey of booth 118's second half"
                  />
                </Field>
                <Field label="Description" className="md:col-span-2">
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Context the assignee needs — addresses, contacts, sequencing."
                  />
                </Field>
                <Field label="Assignee (team member id)" hint="Optional text — rules only bound its length.">
                  <Input
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                    placeholder="member-ravi"
                  />
                </Field>
                <Field label="Due date">
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </Field>
              </div>

              {createError ? (
                <p className="mt-3 rounded-lg border border-signal-rose/30 bg-signal-rose/10 px-3 py-2 text-xs text-signal-rose">
                  {createError}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2.5">
                <Button variant="ghost" onClick={() => setComposerOpen(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void submitCreate()} disabled={creating}>
                  {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Create task
                </Button>
              </div>
            </Panel>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Filters */}
      <div className="scroll flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((status) => (
          <Chip
            key={status}
            active={filter === status}
            onClick={() => setFilter(status)}
            className="shrink-0"
          >
            {status === 'all' ? 'All' : STATUS_LABEL[status as TaskStatus]}
            <span className="ml-1.5 text-[10px] tabular-nums opacity-70">
              {counts[status] ?? 0}
            </span>
          </Chip>
        ))}
      </div>

      {/* List */}
      <Panel className="overflow-hidden">
        {tasks.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title={filter === 'all' ? 'No tasks yet' : `No ${STATUS_LABEL[filter as TaskStatus].toLowerCase()} tasks`}
            detail={
              filter === 'all'
                ? 'Field work, follow-ups, booth cover — file the first one above.'
                : 'Switch filters to see the rest of the queue.'
            }
            action={
              filter !== 'all' ? (
                <Button variant="secondary" onClick={() => setFilter('all')}>
                  <RotateCcw className="size-4" /> Show all
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {rows.map((task) => {
              const overdue =
                task.dueDate != null &&
                task.dueDate < now &&
                task.status !== 'completed';
              const busy = transitioning?.startsWith(task.id);
              return (
                <div
                  key={task.id}
                  className="flex flex-wrap items-start gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.02] lg:flex-nowrap"
                >
                  <div className="min-w-0 flex-1 basis-full lg:basis-auto">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={cn(
                          'text-sm font-medium',
                          task.status === 'completed' ? 'text-mist-600 line-through' : 'text-mist-50'
                        )}
                      >
                        {task.title}
                      </p>
                      <StatusBadge status={task.status} />
                      {overdue ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-signal-rose/30 bg-signal-rose/10 px-1.5 py-0.5 text-[10px] font-medium text-signal-rose">
                          <CalendarClock className="size-3" /> overdue
                        </span>
                      ) : null}
                    </div>
                    {task.description ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-mist-600">
                        {task.description}
                      </p>
                    ) : null}
                    <p className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-mist-600">
                      {task.assigneeId ? <span>→ {task.assigneeId}</span> : null}
                      {task.dueDate != null ? <span>due {formatWhen(task.dueDate)}</span> : null}
                      <span>updated {formatWhen(task.updatedAt ?? task.createdAt)}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      value={task.status}
                      onChange={(event) =>
                        void changeStatus(task, event.target.value as TaskStatus)
                      }
                      disabled={busy}
                      aria-label={`Status of ${task.title}`}
                      className="w-[140px] py-1.5 text-xs"
                    >
                      {TASK_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABEL[status]}
                        </option>
                      ))}
                    </Select>
                    <button
                      onClick={() => setDeleteTarget(task)}
                      aria-label={`Delete ${task.title}`}
                      className="rounded-lg p-2 text-mist-600 transition-colors hover:bg-signal-rose/10 hover:text-signal-rose"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this task?"
        detail={
          <>
            <strong>{deleteTarget?.title}</strong> disappears for everyone on the team —
            Firestore delete, no recycle bin.
          </>
        }
        confirmLabel="Delete task"
        busy={deleteBusy}
        onConfirm={() => void submitDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </MotionPage>
  );
}