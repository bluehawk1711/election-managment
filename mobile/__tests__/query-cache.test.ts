import {
  clearAll,
  isWarm,
  peek,
  prewarm,
  save,
  savedAt,
  snapshotFrom,
} from '@/lib/cache/query-cache';

/**
 * The cache exists for one reason: a warm start must render real rows on the
 * first frame instead of skeletons. That only works if `peek` is synchronous,
 * so several of these tests are specifically about that — an async read here
 * would put the loading state straight back.
 *
 * `mock` prefix required: jest hoists `jest.mock` above the imports.
 */
const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
    getAllKeys: jest.fn(async () => [...mockStore.keys()]),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStore.delete(key));
    }),
  },
}));

const KEY = 'wards||asc|500';

describe('query cache', () => {
  beforeEach(async () => {
    mockStore.clear();
    // `clearAll` resets the memory mirror and the in-flight prewarm guard, and
    // it awaits writes already in flight so a save from the previous test
    // cannot land in this one.
    await clearAll();
  });

  it('reads from memory synchronously', () => {
    save(KEY, [{ id: 'a', data: { name: 'Ward 1' } }]);

    // No `await` — this is the property `useCollection`'s state initialiser
    // depends on.
    expect(peek(KEY)?.docs).toHaveLength(1);
    expect(peek(KEY)?.docs[0].id).toBe('a');
    expect(isWarm(KEY)).toBe(true);
    expect(savedAt(KEY)).toEqual(expect.any(Number));
  });

  it('misses cleanly for a query it has never seen', () => {
    expect(peek('never-queried')).toBeNull();
    expect(isWarm('never-queried')).toBe(false);
    expect(savedAt('never-queried')).toBeNull();
  });

  /**
 * Loads a pristine copy of the module.
 *
 * The memory mirror is module-level state, so the only honest way to simulate
 * "the app was killed and relaunched" is to re-require it. Clearing the cache
 * through the public API would not do: `clearAll` deletes the persisted copy
 * too, which is the opposite of what a cold start does.
 */
function coldStart(): typeof import('@/lib/cache/query-cache') {
  jest.resetModules();
  // `await import()` would need --experimental-vm-modules; `require` is what
  // jest's CommonJS runtime wants here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/lib/cache/query-cache');
}

  it('survives a process restart by rehydrating from storage', async () => {
    save(KEY, [{ id: 'a', data: { name: 'Ward 1' } }]);

    // A relaunch: new module instance, empty memory mirror, storage intact.
    const fresh = coldStart();
    expect(fresh.peek(KEY)).toBeNull();

    await fresh.prewarm([KEY]);

    expect(fresh.peek(KEY)?.docs).toHaveLength(1);
    expect(fresh.peek(KEY)?.docs[0].data.name).toBe('Ward 1');
  });

  it('keeps two queries apart', async () => {
    save('wards', [{ id: '1', data: {} }]);
    save('booths', [{ id: 'b1', data: {} }]);

    expect(peek('wards')?.docs).toHaveLength(1);
    expect(peek('booths')?.docs).toHaveLength(1);
  });

  it('treats an empty result as worth caching', async () => {
    // A collection that is genuinely empty must not be re-read on every single
    // launch, so an empty array is a valid cached value — unlike the roll's
    // per-ward cache, where an empty array is indistinguishable from a failed
    // write.
    save('empty', []);

    const fresh = coldStart();
    await fresh.prewarm(['empty']);

    expect(fresh.peek('empty')).not.toBeNull();
    expect(fresh.peek('empty')?.docs).toEqual([]);
  });

  it('discards a corrupt or half-written blob rather than serving it', async () => {
    mockStore.set('cache:v1:corrupt', '{not json');

    await prewarm(['corrupt']);

    expect(peek('corrupt')).toBeNull();
    // And it is deleted, so the next prewarm does not pay to re-parse it.
    expect(mockStore.has('cache:v1:corrupt')).toBe(false);
  });

  it('discards a well-formed blob of the wrong shape', async () => {
    mockStore.set(
      'cache:v1:wrongshape',
      JSON.stringify({ savedAt: 1, docs: [{ nope: true }] })
    );

    await prewarm(['wrongshape']);

    expect(peek('wrongshape')).toBeNull();
    expect(mockStore.has('cache:v1:wrongshape')).toBe(false);
  });

  it('clears both the memory mirror and the persisted keys', async () => {
    save('wards', [{ id: '1', data: {} }]);
    expect(mockStore.size).toBe(1);

    await clearAll();

    expect(peek('wards')).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  it('coalesces concurrent prewarm calls', async () => {
    mockStore.set(
      'cache:v1:wards',
      JSON.stringify({ savedAt: 1, docs: [{ id: '1', data: {} }] })
    );

    // `prewarm` memoises its promise; two callers must not read storage twice.
    const first = prewarm(['wards']);
    const second = prewarm(['wards']);
    expect(first).toBe(second);

    await first;
    expect(peek('wards')?.docs).toHaveLength(1);
  });

  it('rebuilds a snapshot surface the mappers can read', () => {
    const snapshot = snapshotFrom({ id: 'w1', data: { name: 'Ward 1', voters: 42 } });

    expect(snapshot.id).toBe('w1');
    expect(snapshot.exists()).toBe(true);
    expect(snapshot.data()).toEqual({ name: 'Ward 1', voters: 42 });
  });
});