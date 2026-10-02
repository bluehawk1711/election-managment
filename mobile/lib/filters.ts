import type {
  CampaignEvent,
  CivicIssue,
  ComplianceItem,
  Expense,
  Gender,
  Task,
  TaskStatus,
  Voter,
} from './models';

/**
 * Pure, in-memory filtering + sorting.
 *
 * The app deliberately queries Firestore with equality filters only (or no
 * filter at all) and does the multi-criteria work here. That keeps
 * `firestore.indexes.json` empty — combining `where` with `orderBy` on a
 * different field is exactly what forces composite indexes, and a filter panel
 * with 6 dimensions would otherwise need a index per combination.
 */

export interface BaseFilters {
  search?: string;
  wardId?: string | null;
  areaId?: string | null;
  boothId?: string | null;
}

function searchMatch(
  record: Record<string, unknown>,
  fields: string[],
  search?: string
): boolean {
  const term = search?.trim().toLowerCase();
  if (!term) return true;

  return fields.some((field) => {
    const value = record[field];
    return (
      typeof value === 'string' && value.toLowerCase().includes(term)
    );
  });
}

const asRecord = (item: object): Record<string, unknown> =>
  item as unknown as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskSort = 'due' | 'newest' | 'oldest' | 'title';

export interface TaskFilters extends BaseFilters {
  status?: TaskStatus[];
  assigneeId?: string | null;
  sort?: TaskSort;
  /** Only tasks whose due date has passed and are not completed. */
  overdueOnly?: boolean;
}

export function isOverdue(task: Task, now = Date.now()): boolean {
  if (task.status === 'completed') return false;
  if (task.dueDate == null) return false;
  return task.dueDate < now;
}

function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const list = [...tasks];
  switch (sort) {
    case 'newest':
      return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    case 'oldest':
      return list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'due':
    default:
      return list.sort((a, b) => {
        if (a.dueDate == null) return b.dueDate == null ? 0 : 1;
        if (b.dueDate == null) return -1;
        return a.dueDate - b.dueDate;
      });
  }
}

export function filterTasks(
  tasks: Task[],
  filters: TaskFilters,
  now = Date.now()
): Task[] {
  const filtered = tasks.filter(
    (task) =>
      (!filters.status?.length || filters.status.includes(task.status)) &&
      (!filters.assigneeId || task.assigneeId === filters.assigneeId) &&
      (!filters.areaId || task.areaId === filters.areaId) &&
      (!filters.boothId || task.boothId === filters.boothId) &&
      (!filters.overdueOnly || isOverdue(task, now)) &&
      searchMatch(asRecord(task), ['title', 'description'], filters.search)
  );

  return sortTasks(filtered, filters.sort ?? 'due');
}

// ---------------------------------------------------------------------------
// Civic issues
// ---------------------------------------------------------------------------

export type IssueSort = 'newest' | 'oldest' | 'title';

export interface IssueFilters extends BaseFilters {
  status?: string[];
  category?: string[];
  sort?: IssueSort;
}

export function filterIssues(
  issues: CivicIssue[],
  filters: IssueFilters
): CivicIssue[] {
  const filtered = issues.filter(
    (issue) =>
      (!filters.status?.length || filters.status.includes(issue.status)) &&
      (!filters.category?.length || filters.category.includes(issue.category)) &&
      (!filters.areaId || issue.areaId === filters.areaId) &&
      searchMatch(asRecord(issue), ['title', 'description'], filters.search)
  );

  const direction =
    filters.sort === 'oldest' ? 1 : filters.sort === 'title' ? 0 : -1;

  if (direction === 0) {
    return filtered.sort((a, b) => a.title.localeCompare(b.title));
  }

  return filtered.sort(
    (a, b) =>
      direction * ((a.reportedAt ?? 0) - (b.reportedAt ?? 0))
  );
}

// ---------------------------------------------------------------------------
// Voters
// ---------------------------------------------------------------------------

export type VoterSort = 'name' | 'age' | 'rollId';

export interface VoterFilters extends BaseFilters {
  gender?: Gender | null;
  minAge?: number | null;
  maxAge?: number | null;
  sort?: VoterSort;
}

export function filterVoters(
  voters: Voter[],
  filters: VoterFilters
): Voter[] {
  const filtered = voters.filter(
    (voter) =>
      (!filters.gender || voter.gender === filters.gender) &&
      (filters.minAge == null || voter.age >= filters.minAge) &&
      (filters.maxAge == null || voter.age <= filters.maxAge) &&
      (!filters.areaId || voter.areaId === filters.areaId) &&
      (!filters.boothId || voter.boothId === filters.boothId) &&
      (!filters.wardId ||
        votersWardMatches(voter, filters.wardId)) &&
      searchMatch(
        asRecord(voter),
        ['name', 'rollId', 'houseNo', 'mobile'],
        filters.search
      )
  );

  switch (filters.sort) {
    case 'age':
      return filtered.sort((a, b) => a.age - b.age);
    case 'rollId':
      return filtered.sort((a, b) => a.rollId.localeCompare(b.rollId));
    case 'name':
    default:
      return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
}

// Ward membership travels with the voter document (denormalised), so the
// ward filter does not need the ward chain to resolve.
function votersWardMatches(voter: Voter, wardId: string): boolean {
  return voter.wardId === wardId;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventSort = 'soonest' | 'latest';

export interface EventFilters {
  search?: string;
  type?: string[];
  /** Inclusive epoch-ms window on `startsAt`. */
  from?: number | null;
  to?: number | null;
  sort?: EventSort;
}

export function filterEvents(
  events: CampaignEvent[],
  filters: EventFilters
): CampaignEvent[] {
  const filtered = events.filter(
    (event) =>
      (!filters.type?.length || filters.type.includes(event.type)) &&
      (filters.from == null || event.startsAt >= filters.from) &&
      (filters.to == null || event.startsAt <= filters.to) &&
      searchMatch(asRecord(event), ['title', 'location', 'description'], filters.search)
  );

  const direction = filters.sort === 'latest' ? -1 : 1;
  return filtered.sort((a, b) => direction * (a.startsAt - b.startsAt));
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseSort = 'newest' | 'oldest' | 'amountDesc' | 'amountAsc';

export interface ExpenseFilters extends BaseFilters {
  status?: string[];
  category?: string[];
  from?: number | null;
  to?: number | null;
  sort?: ExpenseSort;
}

export function filterExpenses(
  expenses: Expense[],
  filters: ExpenseFilters
): Expense[] {
  const filtered = expenses.filter(
    (expense) =>
      (!filters.status?.length || filters.status.includes(expense.status)) &&
      (!filters.category?.length || filters.category.includes(expense.category)) &&
      (filters.from == null || expense.date >= filters.from) &&
      (filters.to == null || expense.date <= filters.to) &&
      searchMatch(asRecord(expense), ['description'], filters.search)
  );

  switch (filters.sort) {
    case 'oldest':
      return filtered.sort((a, b) => a.date - b.date);
    case 'amountDesc':
      return filtered.sort((a, b) => b.amount - a.amount);
    case 'amountAsc':
      return filtered.sort((a, b) => a.amount - b.amount);
    case 'newest':
    default:
      return filtered.sort((a, b) => b.date - a.date);
  }
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

export interface ComplianceFilters {
  search?: string;
  status?: string[];
}

export function filterCompliance(
  items: ComplianceItem[],
  filters: ComplianceFilters
): ComplianceItem[] {
  return items
    .filter(
      (item) =>
        (!filters.status?.length || filters.status.includes(item.status)) &&
        searchMatch(asRecord(item), ['title', 'category', 'notes'], filters.search)
    )
    .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity));
}

// ---------------------------------------------------------------------------
// Aggregations used by the dashboard
// ---------------------------------------------------------------------------

export function countBy<T extends { status: string }>(
  items: T[],
  status: T['status']
): number {
  return items.reduce((total, item) => (item.status === status ? total + 1 : total), 0);
}

export function groupCountBy<T, K extends keyof T>(
  items: T[],
  key: K
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}
