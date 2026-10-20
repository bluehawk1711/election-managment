/**
 * Teammates' overlays — a READ-ONLY second layer under the roll (plan-voters.md §4).
 *
 * Two accounts sharing a non-empty `teamId` may read each other's
 * `voterEdits` (firestore.rules `sameTeam`). Those pulled documents land HERE,
 * keyed `voterId → { overlay, author }`, and deliberately do NOT touch
 * `lib/roll/overlay.ts`'s ward map:
 *
 *   The owner's ward overlay is the PUSH source — `pushEdits` reads
 *   `loadWardOverlay` and uploads every queued entry back to
 *   `users/{uid}/voterEdits`. Folding a teammate's overlay into that map would
 *   make the next sync re-upload their field notes as if they were the caller's
 *   own, destroying the authorship `updatedBy` records and violating the
 *   owner-only write rule (the rules would reject the write, but the local
 *   state would already be lying). So the two layers stay separate and are
 *   combined only at render, in `useRoll`.
 *
 * Read-only by construction: this module exposes a setter and a getter, and
 * nothing that enqueues, patches or pushes. A teammate's data is never
 * writable from this device — `firestore.rules` keeps `create`/`update`/
 * `delete` on `voterEdits` owner-only, and this store has no path that could
 * even try.
 *
 * Storage is injected, matching `overlay.ts`, so the logic is unit-testable
 * without AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OverlayStorage } from '@/lib/roll/overlay';
import type { TeamOverlayEntry } from '@/lib/roll/types';

export type { TeamOverlayEntry } from '@/lib/roll/types';
/** Re-exported so a test (or a caller injecting storage) needs one import. */
export type { OverlayStorage } from '@/lib/roll/overlay';

/** `voterId → entry` for the whole pull, across every ward. */
export type TeamOverlayMap = Record<string, TeamOverlayEntry>;

const STORAGE_KEY = 'roll:teamOverlay';

let cache: TeamOverlayMap | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribes to any change; returns an unsubscribe function. */
export function subscribeTeamOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current teammate overlays, keyed by voter id. `{}` before the first pull. */
export async function loadTeamOverlay(
  storage: OverlayStorage
): Promise<TeamOverlayMap> {
  if (cache) return cache;
  const raw = await storage.getItem(STORAGE_KEY);
  let parsed: TeamOverlayMap = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as TeamOverlayMap;
    } catch {
      // A half-written key must not brick the layer forever — treat as empty.
      parsed = {};
    }
  }
  cache = parsed;
  return cache;
}

/**
 * Replaces the whole teammate layer with this pull's result.
 *
 * Whole-set replace, not merge: the layer is a cache of a server query, and
 * the server is the authority on which teammates' docs are visible right now.
 * A member removed from the team disappears on the next pull, which a
 * last-writer-wins merge could not express.
 *
 * `authorUid` is the map key's document owner (the `users/{uid}` the doc lives
 * under), taken from the pull loop — not a field on the document, because a
 * client could forge a field but cannot forge the path its doc lives under.
 */
export async function replaceTeamOverlay(
  storage: OverlayStorage,
  entries: TeamOverlayMap
): Promise<void> {
  cache = entries;
  await storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  notify();
}

/** The production store, wired to AsyncStorage. */
export const teamOverlayStorage: OverlayStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/** Test seam: forget the cached layer between cases. */
export function __resetTeamOverlayCache(): void {
  cache = null;
}
