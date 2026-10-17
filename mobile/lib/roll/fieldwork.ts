/**
 * Fieldwork roll-up — "how much of the roll has actually been worked?"
 * (user demand #6: dashboard pe filled edit dikhna chahiye).
 *
 * Pure and sync so `dash/fieldwork-card` renders from it directly and tests
 * can import it without React, AsyncStorage or Firebase. One input: the set
 * of per-ward overlays (the account's edits, after sync) plus the roll's
 * total voter count for the denominator.
 *
 * The counts are deliberately **voter counts, not key counts**: one voter
 * with two phone numbers edits the "phones" stat by one, because the unit a
 * field team cares about is people covered, not fields touched.
 */
import { isEdited } from '@/lib/roll/merge';
import type { VoterOverlay } from '@/lib/roll/types';

export interface FieldworkStats {
  /** Voters with any edit at all (anything a merge would change). */
  edited: number;
  /** Voters carrying a non-empty phone number. */
  phones: number;
  /** Voters with a photo (bundled photos don't count — this is work done). */
  photos: number;
  /** Voters with a captured location. */
  locations: number;
  /** Voters marked voted *or* explicitly not-voted (a recorded answer). */
  voted: number;
  /** Denominator: every voter in the roll (13 ward CSVs). */
  totalVoters: number;
}

/** `edited / total`, 0–1. Division by zero yields 0, not NaN. */
export function editRatio(stats: Pick<FieldworkStats, 'edited' | 'totalVoters'>): number {
  if (stats.totalVoters <= 0) return 0;
  return Math.min(1, stats.edited / stats.totalVoters);
}

/**
 * Folds every ward's overlay map into the stats above.
 *
 * `overlays` is an array rather than a merged object because that is the
 * storage shape (`roll:overlay:{wardNo}` per ward) — merging 13 objects of
 * ~500 keys first would allocate for nothing.
 */
export function fieldworkStats(
  overlays: Record<string, VoterOverlay>[],
  totalVoters: number
): FieldworkStats {
  const stats: FieldworkStats = {
    edited: 0,
    phones: 0,
    photos: 0,
    locations: 0,
    voted: 0,
    totalVoters,
  };

  for (const ward of overlays) {
    for (const overlay of Object.values(ward)) {
      if (isEdited(overlay)) stats.edited += 1;
      if (overlay.phone != null && overlay.phone.trim() !== '') stats.phones += 1;
      if (overlay.photoUrl != null && overlay.photoUrl !== '') stats.photos += 1;
      if (overlay.location != null) stats.locations += 1;
      if (overlay.voted != null && overlay.voted !== 'unknown') stats.voted += 1;
    }
  }

  return stats;
}