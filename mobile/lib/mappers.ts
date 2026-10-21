import type { DbDoc } from '@/lib/db/types';

import { millisOf } from './documents';
import type {
  Area,
  Booth,
  Campaign,
  CampaignEvent,
  CivicIssue,
  ComplianceItem,
  Constituency,
  Expense,
  Task,
  TeamMember,
  Voter,
  Ward,
} from './models';

/**
 * Snapshot → plain object for every campaign entity.
 *
 * Pure: structural `DbDoc` inputs only (`{ id, exists(), data() }`), so no
 * SDK runtime import — which is what keeps these unit-testable without mocks,
 * and what lets the same mapper serve a live read and a cache replay.
 * All timestamps go through `millisOf`, which tolerates the local `null`
 * echo of `serverTimestamp()` — see lib/documents.ts.
 */

type AnyDoc = DbDoc;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : fallback;

const optionalStr = (value: unknown): string =>
  typeof value === 'string' ? value : '';

function enumOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function campaignFromDoc(snapshot: DbDoc): Campaign | null {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: str(data.name, 'Campaign'),
    candidateName: str(data.candidateName),
    constituencyName: str(data.constituencyName),
    electionDate: millisOf(data.electionDate),
    tagline: str(data.tagline),
    startDate: millisOf(data.startDate),
    updatedAt: millisOf(data.updatedAt),
  };
}

export const constituencyFromDoc = (doc: AnyDoc): Constituency => {
  const data = doc.data();
  return {
    id: doc.id,
    name: str(data.name),
    code: str(data.code),
  };
};

export const wardFromDoc = (doc: AnyDoc): Ward => {
  const data = doc.data();
  return {
    id: doc.id,
    name: str(data.name),
    constituencyId: str(data.constituencyId),
  };
};

export const areaFromDoc = (doc: AnyDoc): Area => {
  const data = doc.data();
  return {
    id: doc.id,
    name: str(data.name),
    wardId: str(data.wardId),
    constituencyId: str(data.constituencyId),
  };
};

export const boothFromDoc = (doc: AnyDoc): Booth => {
  const data = doc.data();
  return {
    id: doc.id,
    number: num(data.number),
    name: str(data.name),
    address: str(data.address),
    areaId: str(data.areaId),
    wardId: str(data.wardId),
    constituencyId: str(data.constituencyId),
    estimatedVoters: num(data.estimatedVoters),
    coordinatorId: str(data.coordinatorId),
  };
};

export const voterFromDoc = (doc: AnyDoc): Voter => {
  const data = doc.data();
  return {
    id: doc.id,
    rollId: str(data.rollId),
    name: str(data.name),
    gender: enumOf(data.gender, ['male', 'female', 'other'], 'other'),
    age: num(data.age),
    houseNo: str(data.houseNo),
    mobile: str(data.mobile),
    boothId: str(data.boothId),
    areaId: str(data.areaId),
    wardId: str(data.wardId),
    constituencyId: str(data.constituencyId),
  };
};

export const teamMemberFromDoc = (doc: AnyDoc): TeamMember => {
  const data = doc.data();
  return {
    id: doc.id,
    name: str(data.name),
    phone: str(data.phone),
    role: enumOf(data.role, ['coordinator', 'worker'], 'worker'),
    status: enumOf(data.status, ['active', 'inactive'], 'active'),
    areaId: str(data.areaId),
    boothId: str(data.boothId),
  };
};

export const taskFromDoc = (doc: AnyDoc): Task => {
  const data = doc.data();
  return {
    id: doc.id,
    title: str(data.title),
    description: str(data.description),
    assigneeId: str(data.assigneeId),
    areaId: str(data.areaId),
    boothId: str(data.boothId),
    dueDate: millisOf(data.dueDate),
    status: enumOf(
      data.status,
      ['pending', 'in_progress', 'completed', 'issue'],
      'pending'
    ),
    report: str(data.report),
    createdBy: str(data.createdBy),
    createdAt: millisOf(data.createdAt),
    updatedAt: millisOf(data.updatedAt),
  };
};

export const issueFromDoc = (doc: AnyDoc): CivicIssue => {
  const data = doc.data();
  return {
    id: doc.id,
    category: enumOf(
      data.category,
      ['road', 'water', 'electricity', 'drainage', 'streetlight', 'sanitation'],
      'road'
    ),
    title: str(data.title),
    description: str(data.description),
    areaId: str(data.areaId),
    photoUrl: optionalStr(data.photoUrl),
    status: enumOf(data.status, ['open', 'in_progress', 'resolved'], 'open'),
    reportedBy: str(data.reportedBy),
    reportedAt: millisOf(data.reportedAt),
    updatedAt: millisOf(data.updatedAt),
  };
};

export const eventFromDoc = (doc: AnyDoc): CampaignEvent => {
  const data = doc.data();
  return {
    id: doc.id,
    title: str(data.title),
    type: enumOf(data.type, ['meeting', 'training', 'public', 'deadline'], 'meeting'),
    startsAt: millisOf(data.startsAt) ?? 0,
    endsAt: millisOf(data.endsAt),
    location: str(data.location),
    description: str(data.description),
    createdAt: millisOf(data.createdAt),
  };
};

export const expenseFromDoc = (doc: AnyDoc): Expense => {
  const data = doc.data();
  return {
    id: doc.id,
    date: millisOf(data.date) ?? 0,
    category: enumOf(
      data.category,
      ['travel', 'fuel', 'materials', 'printing', 'food', 'venue', 'other'],
      'other'
    ),
    amount: num(data.amount),
    description: str(data.description),
    receiptUrl: optionalStr(data.receiptUrl),
    status: enumOf(data.status, ['pending', 'approved', 'rejected'], 'pending'),
    createdBy: str(data.createdBy),
    createdAt: millisOf(data.createdAt),
  };
};

export const complianceFromDoc = (doc: AnyDoc): ComplianceItem => {
  const data = doc.data();
  return {
    id: doc.id,
    title: str(data.title),
    category: str(data.category),
    status: enumOf(data.status, ['done', 'pending', 'attention'], 'pending'),
    dueDate: millisOf(data.dueDate),
    notes: str(data.notes),
    updatedAt: millisOf(data.updatedAt),
  };
};

// `listFromSnapshot` used to live here: it unwrapped a Firestore
// `QuerySnapshot.docs` for a caller that no longer exists anywhere in the app
// (search: nothing). With `lib/db` returning an already-mapped, ordered array,
// there is no `.docs` to unwrap, so porting it would have meant inventing a
// caller for it.
