/**
 * Pure dashboard derivations — counts, series and derived lists.
 *
 * Everything takes `now` explicitly (render code can't call Date.now —
 * react-hooks/purity) and stays free of React/Firebase so tests can import
 * it directly.
 */
import { daysBetween, startOfDay } from './dates';
import type { Booth, CampaignEvent, CivicIssue, Expense, IssueCategory, Task } from './models';

/** Items per day over the last `days` days; index 0 = oldest, last = today. */
export function dailyCounts(dates: (number | null | undefined)[], days: number, now: number): number[] {
  const today = startOfDay(now);
  const buckets = new Array<number>(days).fill(0);
  for (const date of dates) {
    if (date == null) continue;
    const age = daysBetween(startOfDay(date), today);
    if (age >= 0 && age < days) buckets[days - 1 - age] += 1;
  }
  return buckets;
}

export function openTaskCount(tasks: Task[]): number {
  return tasks.filter((task) => task.status !== 'completed').length;
}

export function pendingTaskCount(tasks: Task[]): number {
  return tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress').length;
}

export function openIssueCount(issues: CivicIssue[]): number {
  return issues.filter((issue) => issue.status !== 'resolved').length;
}

export function eventsThisWeek(events: CampaignEvent[], now: number): number {
  const start = startOfDay(now);
  const end = start + 7 * 86_400_000;
  return events.filter((event) => event.startsAt >= start && event.startsAt < end).length;
}

export function completedToday(tasks: Task[], now: number): number {
  const start = startOfDay(now);
  return tasks.filter(
    (task) => task.status === 'completed' && (task.updatedAt ?? 0) >= start
  ).length;
}

export function sumExpenses(expenses: Expense[]): number {
  return expenses.reduce((total, expense) => total + expense.amount, 0);
}

export function boothCoverageRatio(booths: Booth[]): number {
  if (booths.length === 0) return 0;
  const staffed = booths.filter((booth) => booth.coordinatorId !== '').length;
  return staffed / booths.length;
}

export function completionRate(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  return tasks.filter((task) => task.status === 'completed').length / tasks.length;
}

export function resolutionRate(issues: CivicIssue[]): number {
  if (issues.length === 0) return 0;
  return issues.filter((issue) => issue.status === 'resolved').length / issues.length;
}

/** 0–100 weighted readiness: coverage 50%, tasks 30%, issues 20%. */
export function readinessIndex(input: {
  coverage: number;
  taskRate: number;
  issueRate: number;
}): number {
  const score =
    input.coverage * 0.5 + input.taskRate * 0.3 + input.issueRate * 0.2;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Percent change of tasks completed this week vs last week; null when flat baseline. */
export function weeklyCompletionDelta(tasks: Task[], now: number): number | null {
  const today = startOfDay(now);
  const weekStart = today - 6 * 86_400_000;
  const lastStart = today - 13 * 86_400_000;
  let thisWeek = 0;
  let lastWeek = 0;
  for (const task of tasks) {
    if (task.status !== 'completed' || task.updatedAt == null) continue;
    if (task.updatedAt >= weekStart) thisWeek += 1;
    else if (task.updatedAt >= lastStart) lastWeek += 1;
  }
  if (lastWeek === 0) return thisWeek > 0 ? 100 : null;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
}

export type AttentionKind = 'booth' | 'task' | 'issue';

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  refId: string;
  action: 'assign' | 'nudge' | 'escalate';
  at: number | null;
  /** Task/issue title; booths rely on refId. */
  title: string;
};

/** Overdue tasks + unstaffed booths + open issues — dashboard "Needs attention". */
export function attentionItems(input: {
  tasks: Task[];
  booths: Booth[];
  issues: CivicIssue[];
  now: number;
  limit?: number;
}): AttentionItem[] {
  const limit = input.limit ?? 3;
  const today = startOfDay(input.now);
  const items: AttentionItem[] = [];

  for (const booth of input.booths) {
    if (booth.coordinatorId === '') {
      items.push({
        id: `booth-${booth.id}`,
        kind: 'booth',
        refId: booth.id,
        action: 'assign',
        at: null,
        title: '',
      });
    }
  }

  for (const task of input.tasks) {
    if (
      task.dueDate != null &&
      task.dueDate < today &&
      (task.status === 'pending' || task.status === 'in_progress')
    ) {
      items.push({
        id: `task-${task.id}`,
        kind: 'task',
        refId: task.id,
        action: 'nudge',
        at: task.dueDate,
        title: task.title,
      });
    }
  }

  for (const issue of input.issues) {
    if (issue.status === 'open') {
      items.push({
        id: `issue-${issue.id}`,
        kind: 'issue',
        refId: issue.id,
        action: 'escalate',
        at: issue.reportedAt,
        title: issue.title,
      });
    }
  }

  const taskBooths = items.filter((i) => i.kind === 'task');
  const boothsLeft = items.filter((i) => i.kind === 'booth');
  const issueItems = items.filter((i) => i.kind === 'issue');

  taskBooths.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  boothsLeft.sort((a, b) => a.refId.localeCompare(b.refId));
  issueItems.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  return [...boothsLeft, ...taskBooths, ...issueItems].slice(0, limit);
}

export function upcomingEvents(events: CampaignEvent[], now: number, limit = 3): CampaignEvent[] {
  const start = startOfDay(now);
  return events
    .filter((event) => event.startsAt >= start)
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, limit);
}

export type ActivityKind = 'task' | 'expense' | 'issue';

export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  at: number;
  actorId: string;
  title: string;
  areaId: string;
  /** Expenses carry an amount instead of a title. */
  amount?: number;
};

/** Merged recent mutations across tasks, expenses and issues. */
export function activityFeed(input: {
  tasks: Task[];
  expenses: Expense[];
  issues: CivicIssue[];
  limit?: number;
}): ActivityEntry[] {
  const limit = input.limit ?? 5;
  const entries: ActivityEntry[] = [];

  for (const task of input.tasks) {
    if (task.updatedAt == null) continue;
    entries.push({
      id: `task-${task.id}`,
      kind: 'task',
      at: task.updatedAt,
      actorId: task.assigneeId || task.createdBy,
      title: task.title,
      areaId: task.areaId,
    });
  }

  for (const expense of input.expenses) {
    entries.push({
      id: `expense-${expense.id}`,
      kind: 'expense',
      at: expense.createdAt ?? expense.date,
      actorId: expense.createdBy,
      title: expense.category,
      areaId: '',
      amount: expense.amount,
    });
  }

  for (const issue of input.issues) {
    entries.push({
      id: `issue-${issue.id}`,
      kind: 'issue',
      at: issue.updatedAt ?? issue.reportedAt ?? 0,
      actorId: issue.reportedBy,
      title: issue.title,
      areaId: issue.areaId,
    });
  }

  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function issueBreakdown(issues: CivicIssue[]): { category: IssueCategory; count: number }[] {
  const counts = new Map<IssueCategory, number>();
  for (const issue of issues) {
    counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
