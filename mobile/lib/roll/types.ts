/**
 * Types shared by the voter-roll data layer (plan-voters.md §4).
 *
 * The roll splits into two halves that are deliberately never mixed:
 *
 * - **base** — the imported roll. Read-only, byte-identical to the CSVs that
 *   `EXTRACTION.md` produced. Nothing in the app writes it back.
 * - **overlay** — everything a user may add or change (photo, location, voted
 *   flag, leaning, corrections). Local first, syncable later.
 *
 * A screen reads `VoterView`, which is the two merged. Writing goes through
 * `OverlayStore` only, so the base roll can never be mutated by accident — the
 * invariant `plan-voters.md` §11 asks the tests to assert.
 */

/** One row of `ward-NN.csv`, as imported. Field names mirror the CSV. */
export interface RollVoter {
  /** `w{wardNo}-{serialNo}` — stable, human-debuggable. */
  id: string;
  wardNo: number;
  /** The roll's printed serial, 1..N within the ward. */
  serialNo: number;
  /** EPIC / elector id exactly as printed. */
  epicId: string;
  name: string;
  relation: Relation;
  /** The label as printed (`पिता` / `पति` / …), kept for traceability. */
  relationLabel: string;
  fatherOrHusbandName: string;
  /** Free-form on the roll: `0`, `44`, `33 बी`, `मकान 84`, … */
  houseNo: string;
  age: number;
  gender: Gender;
  locality: string;
  /** The PDF page this row came from — lets anyone open the source. */
  pdfPage: number;
}

export type Gender = 'male' | 'female' | 'other';
export type Relation = 'father' | 'husband' | 'mother' | 'other';

/** One entry of `wards-summary.csv`. */
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
  /** Record-page range as printed on the cover, e.g. `3-28`. */
  pdfPages: string;
}

/** The shape of the wards collection document group. */
export interface WardsBundle {
  generatedAt: string;
  source: string;
  total: number;
  tally: { male: number; female: number; other: number };
  wards: WardMeta[];
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

/** Whether the voter has voted. `unknown` is the default for every row. */
export type VotedStatus = 'unknown' | 'voted' | 'notVoted';

/**
 * The 5-point spectrum (plan-voters.md §2) plus `unknown`, which is what the
 * roll carries until someone records an opinion.
 */
export type Leaning =
  | 'unknown'
  | 'right'
  | 'centerRight'
  | 'center'
  | 'centerLeft'
  | 'left';

export interface VoterLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  address?: string;
  updatedAt: number;
}

/** Everything a user may write about one voter. Never touches the base row. */
export interface VoterOverlay {
  /** Corrections to roll fields — present only when edited. */
  name?: string;
  fatherOrHusbandName?: string;
  houseNo?: string;
  age?: number;
  gender?: Gender;
  locality?: string;
  /** The roll carries no phone numbers; this is user-entered. */
  phone?: string;

  location?: VoterLocation;
  photoUrl?: string;
  photoPublicId?: string;

  voted?: VotedStatus;
  leaning?: Leaning;
  leaningNote?: string;
  note?: string;

  updatedAt: number;
  /** The uid that made the edit — survives the future sync as provenance. */
  updatedBy: string;
}

/** The fields an edit form may write, i.e. `VoterOverlay` minus bookkeeping. */
export type VoterPatch = Partial<
  Omit<VoterOverlay, 'updatedAt' | 'updatedBy' | 'location' | 'photoUrl' | 'photoPublicId'>
>;

/** `RollVoter` ⨯ `VoterOverlay` — what every screen actually renders. */
export interface VoterView extends RollVoter {
  /** The overlay in effect (empty object when nothing was edited). */
  overlay: VoterOverlay;
  /** Effective values: overlay wins over the base row. */
  effective: {
    name: string;
    fatherOrHusbandName: string;
    houseNo: string;
    age: number;
    gender: Gender;
    locality: string;
    phone: string;
  };
  voted: VotedStatus;
  leaning: Leaning;
  photoUrl: string | null;
  location: VoterLocation | null;
  /** True when the overlay is newer than the last sync (queue non-empty). */
  pending: boolean;
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/**
 * What a screen needs from the roll, regardless of where it comes from.
 *
 * One implementation: Firestore (`wards` + `voters`, seeded by
 * `scripts/seed-roll.mjs`). Screens depend on this interface only, so the
 * storage behind it can change without touching a single screen.
 */
export interface RollSource {
  readonly kind: 'firestore';
  /** Ward metadata, for the selector + report headers. */
  getWards(): Promise<WardsBundle>;
  /**
   * Voters of one ward. `wardNo: null` means every ward — the Firestore
   * source pages through the whole collection.
   */
  getVoters(wardNo: number | null): Promise<RollVoter[]>;
}

/** One queued change, awaiting the future sync (plan-voters.md §4). */
export interface SyncQueueEntry {
  voterId: string;
  wardNo: number;
  /** Overlay keys touched, so a later push can diff without re-deriving. */
  keys: string[];
  updatedAt: number;
  updatedBy: string;
}
