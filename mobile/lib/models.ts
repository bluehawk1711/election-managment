/**
 * Campaign entity types + closed vocabularies.
 *
 * Dates are epoch milliseconds in app code (Firestore stores timestamps);
 * `lib/mappers.ts` does the conversion. Keep this file free of runtime
 * Firebase imports so `__tests__` can import it directly.
 */

// ---------------------------------------------------------------------------
// Closed vocabularies — rules validate against the same lists.
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'issue',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_CATEGORIES = [
  'road',
  'water',
  'electricity',
  'drainage',
  'streetlight',
  'sanitation',
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const EVENT_TYPES = ['meeting', 'training', 'public', 'deadline'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  'travel',
  'fuel',
  'materials',
  'printing',
  'food',
  'venue',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const COMPLIANCE_STATUSES = ['done', 'pending', 'attention'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const TEAM_ROLES = ['coordinator', 'worker'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_STATUSES = ['active', 'inactive'] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Campaign {
  id: string;
  name: string;
  candidateName: string;
  constituencyName: string;
  /** Election day as epoch millis, or null when not set. */
  electionDate: number | null;
  tagline: string;
  /** First day of the campaign, used for "Campaign Day N". */
  startDate: number | null;
  updatedAt: number | null;
}

export interface Constituency {
  id: string;
  name: string;
  code: string;
}

export interface Ward {
  id: string;
  name: string;
  constituencyId: string;
}

export interface Area {
  id: string;
  name: string;
  wardId: string;
  constituencyId: string;
}

export interface Booth {
  id: string;
  number: number;
  name: string;
  address: string;
  areaId: string;
  wardId: string;
  constituencyId: string;
  estimatedVoters: number;
  /** teamMembers id, or '' when unstaffed — drives "Needs attention". */
  coordinatorId: string;
}

export interface Voter {
  id: string;
  /** Elector roll / EPIC id — unique within the seeded roll. */
  rollId: string;
  name: string;
  gender: Gender;
  age: number;
  houseNo: string;
  mobile: string;
  boothId: string;
  areaId: string;
  wardId: string;
  constituencyId: string;
}

export interface TeamMember {
  id: string;
  name: string;
  phone: string;
  role: TeamRole;
  status: TeamStatus;
  areaId: string;
  boothId: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  /** teamMembers id. */
  assigneeId: string;
  areaId: string;
  boothId: string;
  /** Due date as epoch millis (midnight in the campaign's timezone). */
  dueDate: number | null;
  status: TaskStatus;
  report: string;
  createdBy: string;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CivicIssue {
  id: string;
  category: IssueCategory;
  title: string;
  description: string;
  areaId: string;
  photoUrl: string;
  status: IssueStatus;
  reportedBy: string;
  reportedAt: number | null;
  updatedAt: number | null;
}

export interface CampaignEvent {
  id: string;
  title: string;
  type: EventType;
  /** Epoch millis. */
  startsAt: number;
  endsAt: number | null;
  location: string;
  description: string;
  createdAt: number | null;
}

export interface Expense {
  id: string;
  /** Epoch millis of the expense date. */
  date: number;
  category: ExpenseCategory;
  amount: number;
  description: string;
  receiptUrl: string;
  status: ExpenseStatus;
  createdBy: string;
  createdAt: number | null;
}

export interface ComplianceItem {
  id: string;
  title: string;
  category: string;
  status: ComplianceStatus;
  dueDate: number | null;
  notes: string;
  updatedAt: number | null;
}
