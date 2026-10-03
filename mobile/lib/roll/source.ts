/**
 * `RollSource` selection (plan-voters.md §2).
 *
 * Firestore is the one source. The bundled `.rolljson` route was dropped on
 * the "skip local data files, we'll use db" call: the roll lives in the
 * `wards` + `voters` collections (seeded by `scripts/seed-roll.mjs`), so the
 * app ships the same bytes on every device and a corrected row is one seed
 * away instead of an app update.
 *
 * Reads are cache-first: Firestore's memory cache paints instantly on a warm
 * session and `useRoll` keeps a last-good copy in AsyncStorage, so a cold
 * start with no network still opens the roll. See `hooks/useRoll.ts`.
 */
import { firestoreSource } from '@/lib/roll/firestore-source';
import type { RollSource } from '@/lib/roll/types';

let active: RollSource | null = null;

/** The source every screen reads through. Memoised — one per session. */
export function getRollSource(): RollSource {
  active ??= firestoreSource;
  return active;
}
