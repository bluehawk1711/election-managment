import {
  __resetTeamOverlayCache,
  loadTeamOverlay,
  replaceTeamOverlay,
  subscribeTeamOverlay,
  type OverlayStorage,
} from '@/lib/roll/team-overlay';
import type { TeamOverlayEntry, VoterOverlay } from '@/lib/roll/types';

/**
 * The read-only team layer's store (plan-voters.md §4).
 *
 * The invariants under test are the ones that keep a teammate's fieldwork
 * from ever being mistaken for the caller's own: whole-set replacement (a
 * member removed from the team disappears on the next pull), corruption
 * tolerance (a half-written key must not brick the layer), and the listener
 * contract `useRoll` re-renders on.
 */

/** In-memory stand-in for AsyncStorage. */
function memoryStorage(initial: Record<string, string> = {}): OverlayStorage & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
    removeItem: async (key) => {
      delete data[key];
    },
  };
}

const overlay: VoterOverlay = {
  phone: '9876543210',
  updatedAt: 1_770_000_000_000,
  updatedBy: 'uid-teammate',
};

const entry: TeamOverlayEntry = {
  overlay,
  authorUid: 'uid-teammate',
  authorName: 'Ramesh',
};

beforeEach(() => __resetTeamOverlayCache());

describe('team overlay store', () => {
  it('returns an empty layer before the first pull', async () => {
    const storage = memoryStorage();
    await expect(loadTeamOverlay(storage)).resolves.toEqual({});
  });

  it('round-trips a pull through storage', async () => {
    const storage = memoryStorage();

    await replaceTeamOverlay(storage, { 'w3-1': entry });

    // A second reader (fresh cache) must see the same map — the memory
    // cache is a mirror, not the source of truth.
    __resetTeamOverlayCache();
    await expect(loadTeamOverlay(storage)).resolves.toEqual({ 'w3-1': entry });
  });

  it('replaces the whole layer rather than merging', async () => {
    const storage = memoryStorage();
    await replaceTeamOverlay(storage, {
      'w3-1': entry,
      'w3-2': { ...entry, authorUid: 'uid-other', authorName: 'Sunita' },
    });

    // A member removed from the team must disappear on the next pull — a
    // last-writer-wins merge could never express that.
    await replaceTeamOverlay(storage, { 'w3-1': entry });

    __resetTeamOverlayCache();
    const loaded = await loadTeamOverlay(storage);
    expect(Object.keys(loaded)).toEqual(['w3-1']);
  });

  it('notifies subscribers exactly once per replace, and stops after unsubscribe', async () => {
    const storage = memoryStorage();
    let calls = 0;
    const unsubscribe = subscribeTeamOverlay(() => {
      calls += 1;
    });

    await replaceTeamOverlay(storage, { 'w3-1': entry });
    expect(calls).toBe(1);

    unsubscribe();
    await replaceTeamOverlay(storage, {});
    expect(calls).toBe(1);
  });

  it('treats a corrupt stored value as empty rather than bricking', async () => {
    const storage = memoryStorage({ 'roll:teamOverlay': '{not json' });
    await expect(loadTeamOverlay(storage)).resolves.toEqual({});
  });
});
