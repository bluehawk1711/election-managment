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
  /**
   * `true` when `data/VeerNagar-photos.pdf` draws the diagonal **DELETED**
   * stamp over this record's cell — the roll's own marker that the voter was
   * struck (EXTRACTION.md §Step 8; the list lives in
   * `data/rajasthan/jodhpur/jhanwar/veernagar/deleted.json`).
   *
   * Bundled rows only, like the romanised copies below: absent (`undefined`)
   * means "not marked deleted". The card layers a big DELETED badge over
   * itself when this is set — it is base-roll data, never an overlay.
   */
  deleted?: boolean;
  /**
   * Romanised copies of the three Hindi fields, generated from the CSVs by
   * `scripts/generate-ward-bundles.ts` (via `lib/roll/romanize.ts`).
   *
   * Bundled rows only — the Firestore source predates them and leaves them
   * `undefined`, which every consumer treats as "absent", never "empty".
   * They exist so a Latin query matches by plain substring (`ramesh` finds
   * `Ramesh Kumar` exactly, ranked above phonetic hits) while `translit.ts`'s
   * skeleton stays the fuzzy fallback for both scripts.
   */
  nameEn?: string;
  fatherOrHusbandNameEn?: string;
  localityEn?: string;
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

/**
 * Whether the team counts this voter as with us or against us.
 *
 * Coarser than `Leaning` on purpose: a karykarta records a side in the field
 * in one tap, while the 5-point spectrum is an editorial judgement made
 * later. `unknown` is the default — the roll says nothing about it.
 */
export type SupportCategory = 'unknown' | 'supporter' | 'opponent';

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
  /** Caste — free text, because the roll's spellings are not controlled. */
  jati?: string;
  /** With us / against us — see `SupportCategory`. */
  support?: SupportCategory;

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

/**
 * One teammate's overlay for one voter — the read-only team layer
 * (plan-voters.md §4), pulled by `lib/roll/sync.ts::pullTeamEdits` and stored
 * in `lib/roll/team-overlay.ts`.
 *
 * Lives here rather than in `team-overlay.ts` so the render side (`mergeVoter`,
 * `VoterView`) can take the type without an import cycle back into types.ts.
 */
export interface TeamOverlayEntry {
  overlay: VoterOverlay;
  /** The uid of the teammate who wrote it — provenance, shown as "by X". */
  authorUid: string;
  /**
   * The teammate's display name at pull time, copied from the team roster
   * (`teams/{teamId}.members`). Stored rather than looked up at render
   * because `/users` is get-by-owner-only — a teammate's profile cannot be
   * read from this device, so the roster's copy is the only name available.
   * `null` when the roster somehow lacked one; UI falls back to "Team".
   */
  authorName: string | null;
}

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
    jati: string;
  };
  voted: VotedStatus;
  leaning: Leaning;
  support: SupportCategory;
  photoUrl: string | null;
  location: VoterLocation | null;
  /** True when the overlay is newer than the last sync (queue non-empty). */
  pending: boolean;
  /**
   * A teammate's overlay for this voter, merged UNDER the own overlay
   * (own values win every field they carry; the team layer only fills gaps).
   *
   * `undefined` when no teammate has touched this voter. The team layer never
   * lands in `overlay` — that stays this account's own edits, which is what
   * keeps the edit sheet's save diff (against `effective`) from silently
   * re-attributing a teammate's work as the saver's own.
   */
  team?: TeamOverlayEntry;
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

/**
 * What a screen needs from the roll, regardless of where it comes from.
 *
 * One implementation by default: the bundled JSONs `assets/roll/*.json`
 * (`scripts/generate-ward-bundles.ts`), which ship inside the APK — the
 * "0 latency" path, no network, no rules dependency for the base roll.
 * The Firestore source remains for re-seeding and comparison, but the app
 * never waits on it: edits are local overlays either way.
 */
export interface RollSource {
  readonly kind: 'bundled' | 'firestore';
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
