/**
 * Snapshot → plain object for every document the panel reads.
 *
 * Mirrors `mobile/lib/mappers.ts`'s defensive style — untrusted Firestore
 * data with closed-vocabulary enums funnelled through `enumOf` so a typo'd
 * field degrades to a legal fallback instead of poisoning a render. The
 * legal fallbacks are the SAME lists `firestore.rules` validates, so what
 * the panel shows is always something the rules already agreed to.
 */
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import {
  TASK_STATUSES,
  type Task,
  type Profile,
  type TaskStatus,
  type DeviceBinding,
  type TeamRoster,
} from '@/lib/types';
import type { VoterRow, WardMeta, Gender, Relation } from '@/lib/types';
import type {
  FinalizedContact,
  PhoneProposal,
} from '@/lib/contacts';

type AnyDoc = Pick<QueryDocumentSnapshot<DocumentData>, 'id' | 'data'>;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function enumOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Epoch millis from a number, a Timestamp-like, or null — never NaN. */
export function millisOf(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

// ----------------------------------------------------------------- roll ----

const GENDERS: readonly Gender[] = ['male', 'female', 'other'];
const RELATIONS: readonly Relation[] = ['father', 'husband', 'mother', 'other'];

export const voterFromDoc = (doc: AnyDoc): VoterRow => {
  const data = doc.data();
  return {
    id: doc.id,
    wardNo: num(data.wardNo, 1),
    serialNo: num(data.serialNo),
    epicId: str(data.epicId),
    name: str(data.name),
    relation: enumOf<Relation>(data.relation, RELATIONS, 'other'),
    relationLabel: str(data.relationLabel),
    fatherOrHusbandName: str(data.fatherOrHusbandName),
    houseNo: str(data.houseNo),
    age: num(data.age),
    gender: enumOf<Gender>(data.gender, GENDERS, 'other'),
    locality: str(data.locality),
    pdfPage: num(data.pdfPage),
  };
};

export const wardFromDoc = (doc: AnyDoc): WardMeta => {
  const data = doc.data();
  return {
    wardNo: num(data.wardNo, Number(doc.id)),
    voterCount: num(data.voterCount),
    male: num(data.male),
    female: num(data.female),
    thirdGender: num(data.thirdGender),
    delimitation: str(data.delimitation),
    boothNo: num(data.boothNo),
    roomNo: num(data.roomNo),
    boothAddress: str(data.boothAddress),
    pdfPages: str(data.pdfPages),
  };
};

// --------------------------------------------------------------- people ----

/**
 * `teams/{teamId}` → the roster the Teams dialog renders.
 *
 * The members map is walked rather than cast: rules cap it at 50 entries and
 * cannot type-check individual values, so anything that is not a non-empty
 * uid→name pair is dropped here instead of rendering as "undefined" in a
 * member list.
 */
export const teamFromDoc = (doc: AnyDoc): TeamRoster => {
  const raw = doc.data().members;
  const members: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [uid, name] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof name === 'string' && name !== '') members[uid] = name;
    }
  }
  return { id: doc.id, members };
};

export const profileFromDoc = (doc: AnyDoc): Profile => {
  const data = doc.data();
  return {
    uid: doc.id,
    email: str(data.email),
    displayName: str(data.displayName),
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
    onboarded: data.onboarded === true,
    role: typeof data.role === 'string' ? data.role : null,
    wardNo: typeof data.wardNo === 'number' ? data.wardNo : null,
    createdAt: data.createdAt ?? null,
    device: parseDeviceBinding(data.device),
    locked: data.locked === true,
    lockedReason:
      data.lockedReason === 'device_change' || data.lockedReason === 'admin'
        ? data.lockedReason
        : null,
    lockedAt: typeof data.lockedAt === 'number' ? data.lockedAt : null,
    lockedBy: typeof data.lockedBy === 'string' ? data.lockedBy : null,
    multiDevice: data.multiDevice === true,
    multiDeviceBy: typeof data.multiDeviceBy === 'string' ? data.multiDeviceBy : null,
    teamId: typeof data.teamId === 'string' && data.teamId !== '' ? data.teamId : null,
  };
};

/**
 * Defensive read of `users/{uid}.device` — same contract as `enumOf`:
 * anything malformed reads as "no binding" (the first-bind state) rather
 * than crashing the row that renders it.
 */
const parseDeviceBinding = (value: unknown): DeviceBinding | null => {
  if (!value || typeof value !== 'object') return null;
  const map = value as Record<string, unknown>;
  if (typeof map.id !== 'string' || !map.id) return null;
  return {
    id: map.id,
    name: typeof map.name === 'string' ? map.name : '',
    platform: typeof map.platform === 'string' ? map.platform : '',
    lastActiveAt: typeof map.lastActiveAt === 'number' ? map.lastActiveAt : 0,
  };
};

// ---------------------------------------------------------------- tasks ----

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
    status: enumOf<TaskStatus>(data.status, TASK_STATUSES, 'pending'),
    report: str(data.report),
    createdBy: str(data.createdBy),
    createdAt: millisOf(data.createdAt),
    updatedAt: millisOf(data.updatedAt),
  };
};

// ------------------------------------------------------------ phone board --

export const boardFromDoc = (doc: AnyDoc): FinalizedContact => {
  const data = doc.data();
  return {
    wardNo: num(data.wardNo),
    finalPhone: str(data.finalPhone),
    finalizedBy: str(data.finalizedBy),
    finalizedName: str(data.finalizedName),
    finalizedAt: millisOf(data.finalizedAt),
  };
};

export const proposalFromDoc = (doc: AnyDoc): PhoneProposal => {
  const data = doc.data();
  return {
    uid: doc.id,
    phone: str(data.phone),
    authorName: str(data.authorName, 'Unknown'),
    wardNo: num(data.wardNo),
    updatedAt: num(data.updatedAt),
  };
};