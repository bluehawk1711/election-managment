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
  VotedStatus,
  VoterOverlay,
  VoterView,
} from '@/lib/roll/types';

const EMPTY: VoterOverlay = {} as VoterOverlay;

/** Overrides a base value only when the overlay carries a usable value. */
function override(base: string, value: string | undefined): string {
  return value !== undefined && value !== '' ? value : base;
}

export function mergeVoter(
  base: RollVoter,
  overlay: VoterOverlay | undefined,
  pending = false
): VoterView {
  const o = overlay ?? EMPTY;

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

  return {
    ...base,
    overlay: o,
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
}

/** `true` when anything at all was written over this voter's base row. */
export function isEdited(overlay: VoterOverlay | undefined): boolean {
  if (!overlay) return false;
  return Object.keys(overlay).some(
    (key) => key !== 'updatedAt' && key !== 'updatedBy'
  );
}
