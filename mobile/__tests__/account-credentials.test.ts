import {
  getAccountCredential,
  saveAccountCredential,
} from '@/lib/account-credentials';

/**
 * The password of an account exists exactly twice for a moment: in the admin's
 * hands, and in what `useCreateAccount` files here. Firebase Auth keeps a hash,
 * so if this write silently fails the Accounts dialog's only honest answer is
 * "not stored" — and if this *read* ever returns a stale or foreign record the
 * dialog would print a password that is not the one that works. Both sides of
 * that promise are what these tests hold.
 *
 * The `mock` prefix is required: jest hoists `jest.mock` above the imports,
 * and only `mock`-prefixed names may be referenced from the factory.
 */
const mockSecureStore = new Map<string, string>();
let mockFailure: Error | null = null;

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockFailure) throw mockFailure;
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => {
    if (mockFailure) throw mockFailure;
    return mockSecureStore.get(key) ?? null;
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

describe('account-credentials', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockFailure = null;
  });

  it('round-trips a credential', async () => {
    const saved = await saveAccountCredential({
      uid: 'abc123',
      email: 'sunita@example.com',
      password: 'chai-tea-2026',
    });

    expect(saved).toBe(true);
    await expect(getAccountCredential('abc123')).resolves.toEqual({
      uid: 'abc123',
      email: 'sunita@example.com',
      password: 'chai-tea-2026',
    });
  });

  it('files each account under its own key, so two accounts never collide', async () => {
    await saveAccountCredential({
      uid: 'one',
      email: 'one@example.com',
      password: 'first-pass',
    });
    await saveAccountCredential({
      uid: 'two',
      email: 'two@example.com',
      password: 'second-pass',
    });

    await expect(getAccountCredential('one')).resolves.toMatchObject({
      email: 'one@example.com',
      password: 'first-pass',
    });
    await expect(getAccountCredential('two')).resolves.toMatchObject({
      email: 'two@example.com',
      password: 'second-pass',
    });
    expect(mockSecureStore.size).toBe(2);
  });

  it('uses a key SecureStore will accept verbatim', async () => {
    // A uid is `[A-Za-z0-9._-]`, the whole character set SecureStore allows —
    // but that is a property of Firebase's uid, not of this module, and the
    // moment someone files under a composite key (`${uid}:${field}`) every
    // read and write starts throwing `Invalid key provided to SecureStore`.
    await saveAccountCredential({
      uid: 'Abc-123_x.y',
      email: 'a@example.com',
      password: 'secret-pass',
    });

    const [key] = [...mockSecureStore.keys()];
    expect(key).toBe('account-credential-Abc-123_x.y');
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('reports an account this device never created as not stored', async () => {
    await expect(getAccountCredential('stranger')).resolves.toBeNull();
  });

  it('reports "not stored" rather than throwing when the keystore is unavailable', async () => {
    mockFailure = new Error('Keystore temporarily unavailable');

    // `save` runs *after* an Auth user and a `users` document already exist —
    // a keystore outage must read as a failed save, never as a failed
    // creation that rolls back a live account.
    await expect(
      saveAccountCredential({
        uid: 'abc123',
        email: 'sunita@example.com',
        password: 'secret-pass',
      })
    ).resolves.toBe(false);
    await expect(getAccountCredential('abc123')).resolves.toBeNull();
  });

  it('refuses a record that is not a credential', async () => {
    // Corrupt JSON, a record filed under the wrong uid, and a payload whose
    // password never made it — each must read as "not stored", because the
    // dialog renders whatever comes back and `undefined` would be printed and
    // copied as the literal string.
    const cases = [
      'not json',
      JSON.stringify({ uid: 'other', email: 'a@b.c', password: 'x' }),
      JSON.stringify({ uid: 'abc123', email: 'a@b.c' }),
      JSON.stringify({ uid: 'abc123', email: 'a@b.c', password: '' }),
      JSON.stringify({ uid: 'abc123', password: 'x' }),
    ];

    for (const value of cases) {
      mockSecureStore.set('account-credential-abc123', value);
      await expect(getAccountCredential('abc123')).resolves.toBeNull();
    }
  });
});
