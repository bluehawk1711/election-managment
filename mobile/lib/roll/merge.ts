/**
 * Base ⨯ overlay merge (plan-voters.md §4).
 *
 * Pure and synchronous: given a roll row, its overlay (or nothing) and whether
 * it is still queued, produce the `VoterView` every screen renders. The base
 * object is never mutated — the merge copies — which is what keeps the
 * "base roll is read-only" invariant true even for a careless caller.
 */
import type {
  Gender,
  Leaning,
  RollVoter,
  SupportCategory,
  TeamOverlayEntry,
  VotedStatus,
  VoterOverlay,
  VoterView,
} from '@/lib/roll/types';

const EMPTY: VoterOverlay = {} as VoterOverlay;

/** Overrides a base value only when the overlay carries a usable value. */
function override(base: string, value: string | undefined): string {
  return value !== undefined && value !== '' ? value : base;
}

/**
 * Merges a base row with the caller's own overlay and (optionally) a
 * teammate's overlay, and returns the `VoterView` every screen renders.
 *
 * The two overlays layer own-over-team: every field the own overlay carries
 * wins, and the team layer only fills the gaps. That ordering is the whole
 * point of the split documented in `types.ts::VoterView.team` — a teammate's
 * phone number becomes visible here, but never lands in `overlay`, so the
 * edit sheet's save diff (against `effective`) cannot re-attribute it.
 *
 * The base object is never mutated — the merge copies — which is what keeps
 * the "base roll is read-only" invariant true even for a careless caller.
 */
export function mergeVoter(
  base: RollVoter,
  overlay: VoterOverlay | undefined,
  pending = false,
  team?: TeamOverlayEntry
): VoterView {
  // Own overlay first, then the team's copy of the same fields beneath it.
  // The spread is safe with `undefined` (spreading it is a no-op), and an
  // own-overlay key holding `''` still wins — "the owner cleared this field"
  // is a value, not an absence, and must not resurrect the teammate's copy.
  const o = { ...team?.overlay, ...(overlay ?? EMPTY) } as VoterOverlay;
  const own = overlay ?? EMPTY;

  // Age arrives from the form as a string that has to be a real number; an
  // unparseable one would silently show as 0, so keep the base instead.
  const age =
    typeof o.age === 'number' && Number.isFinite(o.age) && o.age > 0
      ? o.age
      : base.age;

  const gender: Gender = o.gender ?? base.gender;
  const leaning: Leaning = o.leaning ?? 'unknown';
  const support: SupportCategory = o.support ?? 'unknown';
  const voted: VotedStatus = o.voted ?? 'unknown';

  const view: VoterView = {
    ...base,
    overlay: own,
    effective: {
      name: override(base.name, o.name),
      fatherOrHusbandName: override(base.fatherOrHusbandName, o.fatherOrHusbandName),
      houseNo: override(base.houseNo, o.houseNo),
      age,
      gender,
      locality: override(base.locality, o.locality),
      phone: o.phone ?? '',
      jati: o.jati ?? '',
    },
    voted,
    leaning,
    support,
    photoUrl: o.photoUrl ?? null,
    location: o.location ?? null,
    pending,
  };

  // Surface the team entry only when it actually contributes something the
  // base row and own overlay did not already carry. Two conditions, both
  // needed:
  //
  //  - the teammate's doc must hold a CONTENT field, not just bookkeeping.
  //    Every pushed doc carries `wardNo`/`updatedAt`/`updatedBy` by rules
  //    (`hasAll`), so `isEdited` — which only excludes the two timestamps —
  //    would call a bookkeeping-only doc "edited". Hence the explicit
  //    bookkeeping set below.
  //  - that content must include at least one key the own overlay does not
  //    carry, i.e. the teammate is telling this user something they do not
  //    already know. The badge means "there is more here than your own
  //    edits", not "someone else also touched this row".
  const BOOKKEEPING = new Set(['updatedAt', 'updatedBy', 'wardNo']);
  const contentKeys = (data: VoterOverlay): string[] =>
    Object.keys(data).filter(
      (key) => !BOOKKEEPING.has(key) && data[key as keyof VoterOverlay] !== undefined
    );

  if (team) {
    const teamContent = contentKeys(team.overlay);
    const ownKeys = new Set(contentKeys(own));
    if (teamContent.some((key) => !ownKeys.has(key))) view.team = team;
  }

  return view;
}

/** `true` when anything at all was written over this voter's base row. */
export function isEdited(overlay: VoterOverlay | undefined): boolean {
  if (!overlay) return false;
  return Object.keys(overlay).some(
    (key) => key !== 'updatedAt' && key !== 'updatedBy'
  );
}
