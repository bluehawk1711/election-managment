/**
 * The diff behind "Save to my account" — which teammate fields this account
 * copies as its own (`components/roll/team-take-card.tsx` renders it).
 *
 * Pure on purpose: the merge that decides what a teammate CONTRIBUTES
 * (`merge.ts`) and the patch this file computes from it are the two halves
 * of one rule — "their fields fill my gaps, never overwrite me" — and both
 * halves are unit-tested against the same fixtures. It lives here rather
 * than in the component so the test can import it without pulling
 * `lucide-react-native` through the component tree.
 */
import type { VoterPatch, VoterView } from '@/lib/roll/types';

/**
 * The fields a take may copy, in the order they are listed on the card.
 *
 * Every one of them is in `PUSHED_KEYS` (`lib/roll/sync.ts`) — a field that
 * cannot be pushed would be copied locally and then quietly dropped by the
 * next sync, which is the worst outcome available here. `support` is absent
 * for the same reason from the other end: it is political profiling, which
 * rules reject on every writable collection.
 */
export const TAKE_KEYS = [
  'phone',
  'name',
  'fatherOrHusbandName',
  'houseNo',
  'age',
  'gender',
  'locality',
  'jati',
  'voted',
  'leaning',
  'leaningNote',
  'note',
] as const satisfies readonly (keyof VoterPatch)[];

export type TakeKey = (typeof TAKE_KEYS)[number];

/**
 * The teammate's fields this account does NOT already carry — the same
 * difference `mergeVoter` used to decide that there was something to show.
 *
 * Three rules, all inherited from the merge so the card can never promise
 * something the screen behind it does not do:
 *
 *  - a teammate's empty value is skipped — `''` there means "I removed
 *    this", not an instruction to clear this account's copy;
 *  - an OWN value wins even when it is `''` — "I deliberately cleared it" is
 *    a value, and taking over it would resurrect what the merge already
 *    decided to keep hidden (`roll-merge.test.ts` pins that ordering);
 *  - `support` is not in `TAKE_KEYS` at all — see above.
 *
 * Returns `{}` when there is nothing to copy, which is also the state where
 * `voter.team` is unset.
 */
export function takenPatch(voter: VoterView): VoterPatch {
  const team = voter.team?.overlay;
  if (!team) return {};

  const own = voter.overlay;
  const patch: Record<string, unknown> = {};
  for (const key of TAKE_KEYS) {
    const theirs = team[key];
    if (theirs === undefined || theirs === null || theirs === '') continue;
    const mine = own[key];
    if (mine !== undefined && mine !== null) continue;
    patch[key] = theirs;
  }
  return patch as VoterPatch;
}
