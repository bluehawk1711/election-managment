import {
  __resetOverlayCache,
  loadQueue,
  loadWardOverlay,
  patchVoter,
  putOverlay,
  type OverlayStorage,
} from '@/lib/roll/overlay';

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

beforeEach(() => __resetOverlayCache());

describe('overlay store', () => {
  it('writes a patch and records it in the sync queue', async () => {
    const storage = memoryStorage();

    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { phone: '9876543210' },
      uid: 'u1',
      now: 1000,
    });

    const overlay = await loadWardOverlay(storage, 1);
    expect(overlay['w1-1'].phone).toBe('9876543210');
    expect(overlay['w1-1'].updatedBy).toBe('u1');

    const queue = await loadQueue(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ voterId: 'w1-1', wardNo: 1, keys: ['phone'] });
  });

  it('is a no-op when the patch changes nothing', async () => {
    const storage = memoryStorage();

    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { phone: '9876543210' },
      uid: 'u1',
      now: 1000,
    });
    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { phone: '9876543210' },
      uid: 'u1',
      now: 2000,
    });

    expect(await loadQueue(storage)).toHaveLength(1);
    expect((await loadWardOverlay(storage, 1))['w1-1'].updatedAt).toBe(1000);
  });

  it('ignores undefined fields — an untouched form field is not an edit', async () => {
    const storage = memoryStorage();

    const result = await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { name: undefined, phone: undefined },
      uid: 'u1',
      now: 1000,
    });

    // Nothing was submitted, so no overlay and no queue entry.
    expect(result).toBeNull();
    expect(await loadQueue(storage)).toHaveLength(0);
    expect(await loadWardOverlay(storage, 1)).toEqual({});
  });

  it('treats an empty string as a deliberate clear', async () => {
    const storage = memoryStorage();

    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { name: 'corrected' },
      uid: 'u1',
      now: 1,
    });
    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { name: '' },
      uid: 'u1',
      now: 2,
    });

    expect((await loadWardOverlay(storage, 1))['w1-1'].name).toBe('');
    expect(await loadQueue(storage)).toHaveLength(1);
  });

  it('merges repeated edits into one queue entry with all keys', async () => {
    const storage = memoryStorage();

    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { phone: '111' },
      uid: 'u1',
      now: 1,
    });
    await patchVoter(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      patch: { houseNo: '44' },
      uid: 'u1',
      now: 2,
    });

    const queue = await loadQueue(storage);
    expect(queue).toHaveLength(1);
    expect(queue[0].keys.sort()).toEqual(['houseNo', 'phone']);
    expect(queue[0].updatedAt).toBe(2);
  });

  it('keeps base fields intact — only submitted keys are present', async () => {
    const storage = memoryStorage();

    await putOverlay(storage, {
      voterId: 'w1-1',
      wardNo: 1,
      overlay: { voted: 'voted' },
      uid: 'u1',
      now: 5,
    });

    const overlay = (await loadWardOverlay(storage, 1))['w1-1'];
    expect(Object.keys(overlay).sort()).toEqual([
      'updatedAt',
      'updatedBy',
      'voted',
    ]);
  });

  it('survives a corrupt stored value instead of bricking the ward', async () => {
    const storage = memoryStorage({ 'roll:overlay:3': '{not json' });

    expect(await loadWardOverlay(storage, 3)).toEqual({});
  });
});
