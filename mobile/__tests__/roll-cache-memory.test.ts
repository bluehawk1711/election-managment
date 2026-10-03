import {
  cacheStorage,
  clearCache,
  isResident,
  peekWard,
  peekWards,
  prewarm,
  readWard,
  writeWard,
  writeWards,
} from '@/lib/roll/cache';
import type { RollVoter, WardsBundle } from '@/lib/roll/types';

/**
 * The memory mirror, not the persistence, is what removed the loading skeleton.
 *
 * `useRoll` seeds `rows` synchronously from `peekWard` during its first render.
 * Before this, every mount read AsyncStorage, which is async, so the screen
 * painted a skeleton for a frame or two and then threw it away for rows it
 * already had on disk — every time, including coming back from a voter's
 * detail screen. So these tests are mostly about `peek*` answering
 * synchronously and about the mirror staying in step with storage.
 *
 * The `mock` prefix on the store is required: jest hoists `jest.mock` above the
 * imports, and only `mock`-prefixed bindings may be read from a factory.
 */
const mockStore = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => mockStore.get(key) ?? null);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
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

const votersOf = (wardNo: number, count = 2): RollVoter[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `w${wardNo}-${i + 1}`,
    wardNo,
    serialNo: i + 1,
    epicId: `EPIC${wardNo}${i + 1}`,
    name: `नाम ${wardNo}-${i + 1}`,
    relation: 'father',
    relationLabel: 'पिता',
    fatherOrHusbandName: '',
    houseNo: '12',
    age: 30,
    gender: 'male',
    genderLabel: 'पुरूष',
    locality: '',
    pdfPage: 1,
  }));

const bundle = (): WardsBundle => ({
  generatedAt: '2026-01-01',
  source: 'wards',
  total: 26,
  tally: { male: 26, female: 0, other: 0 },
  wards: [1, 2].map((wardNo) => ({
    wardNo,
    voterCount: 13,
    male: 13,
    female: 0,
    thirdGender: 0,
    delimitation: '',
    boothNo: wardNo,
    roomNo: 1,
    boothAddress: '',
    pdfPages: '1-2',
  })),
});

beforeEach(async () => {
  mockStore.clear();
  mockGetItem.mockClear();
  // Also empties the module's memory mirror, so each test starts cold.
  await clearCache(cacheStorage);
});

describe('roll cache memory mirror', () => {
  it('answers a written ward synchronously, with no await', async () => {
    await writeWard(cacheStorage, 1, votersOf(1));

    // Synchronous by design — `useRoll`'s render-phase seed depends on it.
    expect(peekWard(1)?.voters).toHaveLength(2);
    expect(isResident(1)).toBe(true);
  });

  it('answers the written wards bundle synchronously', async () => {
    await writeWards(cacheStorage, bundle());

    expect(peekWards()?.wards).toHaveLength(2);
  });

  it('reports a clean miss for a ward it has never seen', () => {
    expect(peekWard(99)).toBeNull();
    expect(isResident(99)).toBe(false);
    expect(peekWards()).toBeNull();
  });

  it('rehydrates from storage so a relaunch still seeds synchronously', async () => {
    // Storage has a copy, memory does not — exactly what a cold start looks
    // like, since the mirror lives in module scope and is lost with the process.
    mockStore.set(
      'roll:cache:v1:ward:1',
      JSON.stringify({ savedAt: 1, voters: votersOf(1) })
    );
    mockStore.set('roll:cache:v1:wards', JSON.stringify(bundle()));
    expect(peekWard(1)).toBeNull();

    await prewarm(cacheStorage, [1]);

    expect(peekWard(1)?.voters).toHaveLength(2);
    expect(peekWards()?.wards).toHaveLength(2);
  });

  it('serves a second read from memory rather than going back to disk', async () => {
    await writeWard(cacheStorage, 2, votersOf(2));
    mockGetItem.mockClear();

    const first = await readWard(cacheStorage, 2);
    const second = await readWard(cacheStorage, 2);

    // Same object identity: the second call never left memory.
    expect(second).toBe(first);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('clears memory as well as storage', async () => {
    await writeWards(cacheStorage, bundle());
    await writeWard(cacheStorage, 1, votersOf(1));
    expect(isResident(1)).toBe(true);

    await clearCache(cacheStorage);

    // Otherwise the mirror repopulates from disk on the very next read and the
    // clear appears to do nothing until a restart.
    expect(peekWard(1)).toBeNull();
    expect(peekWards()).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  it('drops a corrupt blob instead of mirroring it', async () => {
    mockStore.set('roll:cache:v1:ward:3', '{not json');

    await prewarm(cacheStorage, [3]);

    expect(peekWard(3)).toBeNull();
    expect(mockStore.has('roll:cache:v1:ward:3')).toBe(false);
  });
});