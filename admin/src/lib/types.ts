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
  /**
   * The account's bound device — one per account, written by that device's
   * first sign-in and only ever changed by a super-admin unlock (which drops
   * it). `null` = never bound from a device yet.
   */
  device: DeviceBinding | null;
  /** Account lock. `true` zeroes every capability in firestore.rules. */
  locked: boolean;
  /** `'device_change'` (self-locked by a foreign sign-in) or `'admin'`. */
  lockedReason: 'device_change' | 'admin' | null;
  /** Epoch millis of the lock, or null when unlocked. */
  lockedAt: number | null;
  /** The super admin who locked it, or `'system'` for a device lock. */
  lockedBy: string | null;
  /**
   * Multi-device exemption (firestore.rules §users). `true` lifts the
   * single-device lock for THIS account: it may sign in from any number of
   * installs and never self-locks on a foreign one. `false` (default) keeps
   * the normal one-device lock. Toggled by super admin/developer from the
   * roster — the same gate as every other account-management write.
   */
  multiDevice: boolean;
  /** The super admin/developer uid who granted `multiDevice`, or null. */
  multiDeviceBy: string | null;
}

/**
 * The FIREBASE AUTH side of an account — fetched live from
 * `/api/account/detail` (Admin SDK `getUser`) for the details dialog.
 *
 * Everything here is unreachable from Firestore by design: the profile
 * document holds the app's own facts (role, device, lock), while the login
 * record holds creation/sign-in timestamps, verification, the disabled flag
 * and providers. The dialog joins the two.
 */
export interface AuthAccountDetail {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  disabled: boolean;
  /** Epoch millis of the Auth record's creation. */
  createdAt: number | null;
  /** Epoch millis of the most recent sign-in, null if never. */
  lastSignInAt: number | null;
  phone: string | null;
  /** e.g. `['password']`. */
  providers: string[];
}

/** What the panel renders under "Device" — mirrors `users/{uid}.device`. */
export interface DeviceBinding {
  id: string;
  name: string;
  platform: string;
  lastActiveAt: number;
}

/**
 * `accountSecrets/{uid}` — the password vault.
 *
 * Firebase Auth stores only a scrypt hash, so a password an admin set can
 * never be read back out of it; this document (readable only by
 * `canManageAccounts` — super admin + developer) is what makes "does this
 * password match" and "rotate it right now" answerable from the panel.
 *
 * `password` is a SHA-256 HASH (peppered — lib/vault.ts), never plaintext:
 * the panel checks a typed candidate against the hash instead of showing a
 * credential, and a super-admin rotation needs no old password at all (the
 * local Admin-SDK route sets the new one directly).
 */
export interface AccountVault {
  /** The target uid — mirrors the Auth record, not the caller. */
  uid: string;
  email: string;
  password: string;
  /** Epoch millis. */
  updatedAt: number;
  /** The account manager who last wrote it. */
  updatedBy: string;
}

// ------------------------------------------------------------ app config ----

/**
 * `appConfig/general` — the release gate the mobile app reads on launch.
 *
 * `requiredVersion` is the hard line: a build whose own `expoConfig.version`
 * compares BELOW it is locked behind the update modal (wa.me link pointed at
 * `supportPhone`). `latestVersion` is informational — shown in this panel
 * and offered as "an update exists" to newer-but-not-newest builds.
 */
export interface AppConfig {
  /** Newest published app version, e.g. `1.2.0`. */
  latestVersion: string;
  /** Oldest build still allowed to work, e.g. `1.1.0`. */
  requiredVersion: string;
  /** WhatsApp support line, digits only (country code, no `+`), `''` = unset. */
  supportPhone: string;
  /** Epoch millis of the last save. */
  updatedAt: number;
  /** Who saved it. */
  updatedBy: string;
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