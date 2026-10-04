/**
 * The never-throw contract, and the paths that keep a session alive
 * (`lib/large-secure-store.ts`).
 *
 * The shipped bug this pins: Firebase Auth's restore path turns *any*
 * storage rejection into a silent sign-out — `PersistenceUserManager.create`
 * probes with `setItem` + `removeItem` and falls back to in-memory
 * persistence on failure, and `initializeCurrentUser` catches a read failure
 * by calling `directlySetCurrentUser(null)`. So "the store threw once" and
 * "the app forgot me" are the same event, and these tests exist so the two
 * can never be linked again.
 *
 * The `mock` prefix on every controllable binding is required, not
 * stylistic: jest hoists `jest.mock` above the imports, and only
 * `mock`-prefixed names may be referenced from a factory.
 */
const mockSecureStore = new Map<string, string>();
const mockAsyncStorage = new Map<string, string>();

/** Failure switches, flipped per test. */
const mockFail = {
  secureGet: false,
  secureSet: false,
  secureDelete: false,
  asyncGet: false,
  /** The backup slot (`<key>.lsk`) alone — ciphertext readable, keys not. */
  backupGet: false,
  digest: false,
  random: false,
};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockFail.secureSet) throw new Error('keystore unavailable');
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => {
    if (mockFail.secureGet) throw new Error('keystore unavailable');
    return mockSecureStore.get(key) ?? null;
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (mockFail.secureDelete) throw new Error('keystore unavailable');
    mockSecureStore.delete(key);
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (key: string, value: string) => {
      mockAsyncStorage.set(key, value);
    }),
    getItem: jest.fn(async (key: string) => {
      if (mockFail.asyncGet) throw new Error('storage read failed');
      if (mockFail.backupGet && key.endsWith('.lsk')) {
        throw new Error('backup slot unreadable');
      }
      return mockAsyncStorage.get(key) ?? null;
    }),
    removeItem: jest.fn(async (key: string) => {
      mockAsyncStorage.delete(key);
    }),
  },
}));

jest.mock('expo-crypto', () => ({
  getRandomValues: (array: Uint8Array) => {
    if (mockFail.random) throw new Error('CSPRNG unavailable');
    for (let i = 0; i < array.length; i++) array[i] = (i * 7 + 13) % 256;
    return array;
  },
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, input: string) => {
    if (mockFail.digest) throw new Error('digest unavailable');
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i) + i;
      hash = Math.imul(hash, 16777619);
    }
    return hash.toString(16).padStart(8, '0').repeat(8);
  }),
}));

import { LargeSecureStore } from '@/lib/large-secure-store';

describe('LargeSecureStore hardening', () => {
  let store: LargeSecureStore;

  beforeEach(() => {
    mockSecureStore.clear();
    mockAsyncStorage.clear();
    mockFail.secureGet = false;
    mockFail.secureSet = false;
    mockFail.secureDelete = false;
    mockFail.asyncGet = false;
    mockFail.backupGet = false;
    mockFail.digest = false;
    mockFail.random = false;
    store = new LargeSecureStore();
  });

  const AUTH_KEY = 'firebase:authUser:AIzaSyTest:[DEFAULT]';

  it('round-trips while every keystore call fails', async () => {
    // A device whose Keychain / EncryptedSharedPreferences is momentarily
    // unusable must still persist the session — in the backup slot, at
    // app-sandbox protection, rather than not at all.
    mockFail.secureSet = true;
    mockFail.secureGet = true;

    await store.setItem(AUTH_KEY, 'session-record');

    expect(await store.getItem(AUTH_KEY)).toBe('session-record');
    // The key found a home in the backup slot…
    expect([...mockAsyncStorage.keys()].some((k) => k.endsWith('.lsk'))).toBe(
      true
    );
    // …and the ciphertext is still not plain text.
    expect(mockAsyncStorage.get(AUTH_KEY)).not.toBe('session-record');
  });

  it('keeps the record when the keystore read errors transiently', async () => {
    await store.setItem(AUTH_KEY, 'session-record');

    // The keystore worked at write time (key only there — no backup slot)
    // and fails at read time: no reachable key means null for this launch…
    mockFail.secureGet = true;
    expect(await store.getItem(AUTH_KEY)).toBeNull();

    // …but the record must survive the error, or the *next* launch is a
    // permanent sign-out rather than a transient blank one.
    expect(mockAsyncStorage.has(AUTH_KEY)).toBe(true);

    mockFail.secureGet = false;
    expect(await store.getItem(AUTH_KEY)).toBe('session-record');
  });

  it('keeps the record when every key source errors, instead of wiping it', async () => {
    await store.setItem(AUTH_KEY, 'session-record');

    // Ciphertext read OK, but both key slots *error* (not "empty"): a
    // transient failure must not be mistaken for an orphaned ciphertext.
    mockFail.secureGet = true;
    mockFail.backupGet = true;
    expect(await store.getItem(AUTH_KEY)).toBeNull();

    // The ciphertext is still there — the next launch can recover.
    expect(mockAsyncStorage.has(AUTH_KEY)).toBe(true);

    // …and once the transient failure clears, the session comes back.
    mockFail.secureGet = false;
    mockFail.backupGet = false;
    expect(await store.getItem(AUTH_KEY)).toBe('session-record');
  });

  it('wipes the record only when both key slots are genuinely empty', async () => {
    await store.setItem(AUTH_KEY, 'session-record');
    for (const key of [...mockSecureStore.keys()]) mockSecureStore.delete(key);
    // No error involved — the keys are simply gone.

    expect(await store.getItem(AUTH_KEY)).toBeNull();
    expect(mockAsyncStorage.has(AUTH_KEY)).toBe(false);
  });

  it('stores a degraded plain record when crypto itself is unusable', async () => {
    mockFail.random = true;
    mockFail.digest = true;

    await store.setItem(AUTH_KEY, 'session-record');

    // Not storing at all would sign the user out on every launch; a plain
    // record restores the session with degraded at-rest protection.
    expect(await store.getItem(AUTH_KEY)).toBe('session-record');
    expect(mockAsyncStorage.get(AUTH_KEY)).toBe('p1:session-record');
  });

  it('never rejects getItem, even when AsyncStorage itself is down', async () => {
    await store.setItem(AUTH_KEY, 'session-record');
    mockFail.asyncGet = true;

    // Returning null leaves Firebase without a user for this launch — bad,
    // but a rejection would wipe the record and make it permanent.
    await expect(store.getItem(AUTH_KEY)).resolves.toBeNull();
  });

  it('runs the Firebase availability probe (setItem + removeItem) without throwing', async () => {
    // This probe's success is what keeps persistence from silently degrading
    // to in-memory — i.e. what keeps the user logged in tomorrow.
    mockFail.secureSet = true;
    mockFail.secureDelete = true;

    await expect(
      (async () => {
        await store.setItem(AUTH_KEY, 'probe');
        await store.removeItem(AUTH_KEY);
      })()
    ).resolves.toBeUndefined();
    expect(mockAsyncStorage.has(AUTH_KEY)).toBe(false);
  });

  it('removes both halves including the backup slot', async () => {
    mockFail.secureSet = true; // forces the backup slot into use
    await store.setItem(AUTH_KEY, 'session-record');
    expect(
      [...mockAsyncStorage.keys()].some((k) => k.endsWith('.lsk'))
    ).toBe(true);

    mockFail.secureSet = false;
    await store.removeItem(AUTH_KEY);

    expect(mockAsyncStorage.size).toBe(0);
    expect(mockSecureStore.size).toBe(0);
    expect(await store.getItem(AUTH_KEY)).toBeNull();
  });

  it('reuses one stable key across many token-refresh writes', async () => {
    // A re-minted key per write has a skew window: SecureStore first,
    // AsyncStorage second, process death between them → undecryptable
    // record → guaranteed sign-out. Stable key = ciphertext writes only.
    await store.setItem(AUTH_KEY, 'v1');
    const keysAfterFirst = mockSecureStore.size;
    await store.setItem(AUTH_KEY, 'v2');
    await store.setItem(AUTH_KEY, 'v3');

    expect(mockSecureStore.size).toBe(keysAfterFirst);
    expect(await store.getItem(AUTH_KEY)).toBe('v3');
  });

  it('serialises concurrent writes to the same key', async () => {
    // Two racing token-refresh writes must not each mint a key — whoever
    // wins SecureStore could disagree with whoever wins AsyncStorage.
    await Promise.all([
      store.setItem(AUTH_KEY, 'first'),
      store.setItem(AUTH_KEY, 'second'),
      store.setItem(AUTH_KEY, 'third'),
    ]);

    expect(await store.getItem(AUTH_KEY)).toBe('third');
    expect(mockSecureStore.size).toBe(1);
  });
});
