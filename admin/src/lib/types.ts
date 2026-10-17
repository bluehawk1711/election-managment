/**
 * Data shapes the panel shares across pages — ports of the mobile models
 * (`mobile/lib/roll/types.ts`, `mobile/lib/models.ts`) trimmed to what a web
 * admin surface renders, with the field vocabulary kept byte-identical where
 * `firestore.rules` validates against it (enums, key lists).
 */

// ---------------------------------------------------------------- rolls ----

export type Gender = 'male' | 'female' | 'other';
export type Relation = 'father' | 'husband' | 'mother' | 'other';

/** One `voters/{id}` document — the imported roll, READ-ONLY everywhere. */
export interface VoterRow {
  /** `{wardNo}`'s sub: `w{wardNo}-{serialNo}` (`scripts/seed-roll.mjs`). */
  id: string;
  wardNo: number;
  serialNo: number;
  epicId: string;
  name: string;
  relation: Relation;
  relationLabel: string;
  fatherOrHusbandName: string;
  /** Free-form on the roll: `0`, `44`, `33 बी`, `मकान 84`, … */
  houseNo: string;
  age: number;
  gender: Gender;
  locality: string;
  pdfPage: number;
}

/** `wards/{wardNo}` — seeded cover data from `wards-summary.csv`. */
export interface WardMeta {
  wardNo: number;
  voterCount: number;
  male: number;
  female: number;
  thirdGender: number;
  delimitation: string;
  boothNo: number;
  roomNo: number;
  boothAddress: string;
  pdfPages: string;
}

// -------------------------------------------------------------- overlay ----

export type VotedStatus = 'unknown' | 'voted' | 'notVoted';

export type Leaning =
  | 'unknown'
  | 'right'
  | 'centerRight'
  | 'center'
  | 'centerLeft'
  | 'left';

/**
 * The account-private edit document `users/{uid}/voterEdits/{voterId}`.
 *
 * `support` deliberately does not exist here even though the mobile overlay
 * has it: `firestore.rules`' political-profiling banlist rejects it on every
 * client-writable path, so what the panel can never write, the panel's types
 * never offer.
 */
export interface VoterOverlay {
  name?: string;
  fatherOrHusbandName?: string;
  houseNo?: string;
  age?: number;
  gender?: Gender;
  locality?: string;
  phone?: string;
  jati?: string;
  voted?: VotedStatus;
  leaning?: Leaning;
  leaningNote?: string;
  note?: string;

  wardNo?: number;
  updatedAt: number;
  updatedBy: string;
}

/** What the edit drawer may send — overlay minus bookkeeping. */
export type VoterPatch = Omit<
  VoterOverlay,
  'updatedAt' | 'updatedBy' | 'wardNo'
>;

/** `VoterRow` ⨯ `VoterOverlay` — what the drawer renders. */
export interface VoterView extends VoterRow {
  overlay: VoterOverlay;
  effective: {
    name: string;
    fatherOrHusbandName: string;
    houseNo: string;
    age: number;
    gender: Gender;
    locality: string;
    phone: string;
    jati: string;
  };
  voted: VotedStatus;
  leaning: Leaning;
  note: string;
  edited: boolean;
}

/** Merges a patch over a base row — overlay wins, absent keys fall through. */
export function viewOf(row: VoterRow, overlay: VoterOverlay | null): VoterView {
  const o = overlay ?? ({} as VoterOverlay);
  return {
    ...row,
    overlay: o,
    effective: {
      name: o.name ?? row.name,
      fatherOrHusbandName: o.fatherOrHusbandName ?? row.fatherOrHusbandName,
      houseNo: o.houseNo ?? row.houseNo,
      age: o.age ?? row.age,
      gender: o.gender ?? row.gender,
      locality: o.locality ?? row.locality,
      phone: o.phone ?? '',
      jati: o.jati ?? '',
    },
    voted: o.voted ?? 'unknown',
    leaning: o.leaning ?? 'unknown',
    note: o.note ?? '',
    edited: overlay != null,
  };
}

// --------------------------------------------------------------- people ----

/** A `users/{uid}` profile document (plus the uid, which lives in the path). */
export interface Profile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  onboarded: boolean;
  role: string | null;
  /** Present only for karykarta — absence and null mean "unrestricted". */
  wardNo?: number | null;
  /** Firestore Timestamp or null on fresh docs. */
  createdAt?: unknown;
}

// ---------------------------------------------------------------- tasks ----

export const TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'issue',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  areaId: string;
  boothId: string;
  /** Due date as epoch millis, or null. */
  dueDate: number | null;
  status: TaskStatus;
  report: string;
  createdBy: string;
  createdAt: number | null;
  updatedAt: number | null;
}