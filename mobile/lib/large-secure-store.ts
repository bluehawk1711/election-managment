import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import aesjs from 'aes-js';

/**
 * Marker for the degraded (unencrypted) record format. `:` is not a hex
 * digit, so a real ciphertext can never start with it.
 */
const PLAIN_PREFIX = 'p1:';

/**
 * The storage adapter Firebase Auth uses to persist a user on device.
 *
 * Passed to `getReactNativePersistence` in `lib/firebase.ts`. Its interface —
 * `getItem` / `setItem` / `removeItem`, all promise-returning — is exactly
 * Firebase's `ReactNativeAsyncStorage`, so no adapter sits between them.
 *
 * ## Why it exists at all
 *
 * `expo-secure-store` refuses values larger than 2048 bytes, and the record
 * Firebase writes is comfortably past that (uid, providerData, and an
 * `stsTokenManager` carrying both tokens — 1.5 KB bare, past the ceiling once
 * a Google photoURL joins `providerData`). So the record lives in
 * `AsyncStorage` as AES-CTR ciphertext, and the 256-bit key lives in
 * SecureStore — Keychain on iOS, EncryptedSharedPreferences-backed Keystore on
 * Android. Reading the ciphertext without the key is useless.
 *
 * ## Why every method is written to never throw (the actual bug this fixed)
 *
 * Users were being signed out on **every app launch**. Firebase's restore
 * path has two silent fallbacks that turn a storage exception into a
 * logged-out session with only a `console.warn`:
 *
 * - `PersistenceUserManager.create` calls `_isAvailable()`, which probes by
 *   `setItem(...)` + `removeItem(...)`. Any rejection there drops the whole
 *   persistence to **in-memory** — session gone on next launch, no error
 *   surfaced anywhere in the app.
 * - `initializeCurrentUser` catches any throw from the user read and calls
 *   `directlySetCurrentUser(null)` — signed out, record wiped.
 *
 * So a single transient failure from SecureStore / expo-crypto reads as
 * "the app forgot me". The rules below exist so that cannot happen:
 *
 * - **Stable key per storage entry.** The AES key is minted once and reused,
 *   not re-minted on every token refresh as before. A fresh key per write has
 *   a skew window: SecureStore is written first, AsyncStorage second, and a
 *   process death between the two leaves a new key beside an old ciphertext —
 *   undecryptable, i.e. a guaranteed sign-out next launch. With the key
 *   stable, ciphertext writes are the only writes after the first.
 * - **Two key slots.** SecureStore first; an AsyncStorage backup slot
 *   (`<key>.lsk`) is written only when the SecureStore write failed. A device
 *   where SecureStore is broken (or flaky) still restores the session at
 *   app-sandbox security instead of never persisting at all — while healthy
 *   devices keep the key out of AsyncStorage entirely, which is the whole
 *   point of the SecureStore half. Keys are also serialized per entry so two
 *   concurrent token-refresh writes can never mint divergent keys.
 * - **A plain marker as the last resort** (`p1:` prefix): if expo-crypto or
 *   aes-js itself is unusable, the value is stored unencrypted rather than
 *   not at all. Hex ciphertext can never carry that prefix (`:` is not a hex
 *   digit), so the two formats cannot collide. Degraded at-rest protection is
 *   the right trade against a session that evaporates every launch; losing
 *   SecureStore does not happen silently on a healthy device.
 * - **Reads return `null` instead of rejecting.** A transient read failure
 *   must not trip Firebase's "failed to initialize current user" sign-out.
 *   The record is only dropped when decryption is genuinely impossible —
 *   both key slots empty — never on a transient error.
 *
 * Two Firebase-specific notes that still hold:
 *
 * - Firebase rewrites the user entry on every token refresh, roughly hourly.
 *   With the stable key that is now a single AsyncStorage write.
 * - The orphaned-ciphertext branch in `getItem` matters: an unrecoverable
 *   read leaves `initializeAuth` with no user, and the route guards would
 *   otherwise strand a returning user on a spinner rather than showing them
 *   the sign-in screen.
 */
export class LargeSecureStore {
  /**
   * Per-entry write queue. `setItem` for the same key must not interleave:
   * two racing token-refresh writes could otherwise each mint a key, with the
   * winner of SecureStore disagreeing with the winner of AsyncStorage.
   */
  private queues = new Map<string, Promise<unknown>>();

  /**
   * Maps an arbitrary storage key onto a SecureStore-legal one.
   *
   * This indirection is not optional. SecureStore accepts only
   * `[A-Za-z0-9._-]` in a key, and the one caller here — Firebase Auth's
   * `getReactNativePersistence` — uses keys like
   * `firebase:authUser:AIza…:[DEFAULT]`, which contain `:` and `[`. Passing
   * that straight through makes every read and write throw
   * `Invalid key provided to SecureStore`, which Auth surfaces as
   * `auth/internal-error: Failed to initialize current user` — the session
   * silently never restores and every launch looks like a sign-out.
   *
   * Hashed rather than sanitised: replacing the illegal characters would map
   * distinct keys onto the same entry (`a:b` and `a-b` collide), and one
   * record decrypting with another record's key is exactly the failure this
   * class exists to prevent.
   */
  private async _secureKey(key: string): Promise<string> {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      key
    );
    // Prefix carries the derivation version, so changing this scheme later
    // orphans old entries instead of failing to read them.
    return `ls1.${digest}`;
  }

  /** The AsyncStorage slot that backs up the key when SecureStore is down. */
  private _backupKey(key: string): string {
    return `${key}.lsk`;
  }

  private _encryptWith(keyHex: string, value: string): string {
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(keyHex),
      new aesjs.Counter(1)
    );
    return aesjs.utils.hex.fromBytes(
      cipher.encrypt(aesjs.utils.utf8.toBytes(value))
    );
  }

  private _decryptWith(keyHex: string, cipherText: string): string {
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(keyHex),
      new aesjs.Counter(1)
    );
    return aesjs.utils.utf8.fromBytes(
      cipher.decrypt(aesjs.utils.hex.toBytes(cipherText))
    );
  }

  private static _freshKeyHex(): string {
    return aesjs.utils.hex.fromBytes(Crypto.getRandomValues(new Uint8Array(32)));
  }

  /**
   * The key for this entry, resolving SecureStore → backup → mint.
   *
   * Never throws unless even the backup slot is unwritable, which means
   * AsyncStorage itself is down (see `setItem`). On a SecureStore failure the
   * minted key is parked in the backup slot so the entry stays readable.
   */
  private async _resolveKey(key: string): Promise<string> {
    let secureKey: string | null = null;
    try {
      secureKey = await this._secureKey(key);
      const existing = await SecureStore.getItemAsync(secureKey);
      if (existing) return existing;
    } catch {
      // SecureStore or the digest is unavailable — the backup path below
      // still gives this entry a home.
      secureKey = null;
    }

    try {
      const backup = await AsyncStorage.getItem(this._backupKey(key));
      if (backup) {
        // The key already proved it can decrypt (it was written when
        // SecureStore failed). Try to move it back into the keystore; a
        // failure just leaves the backup as the source of truth.
        if (secureKey) {
          await SecureStore.setItemAsync(secureKey, backup).catch(() => {});
        }
        return backup;
      }
    } catch {
      // fall through to minting
    }

    const fresh = LargeSecureStore._freshKeyHex();
    if (secureKey) {
      try {
        await SecureStore.setItemAsync(secureKey, fresh);
        return fresh;
      } catch {
        // SecureStore rejected the write — park the key in the backup slot
        // so this session survives relaunch at sandbox-level protection.
      }
    }
    await AsyncStorage.setItem(this._backupKey(key), fresh);
    return fresh;
  }

  /** Serializes writes per storage key; see `queues`. */
  private _enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    // The stored link always resolves (its rejection is absorbed below), so
    // the next enqueued task runs regardless of how the previous one ended —
    // a failed write must not wedge the queue for that key.
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    this.queues.set(key, run.catch(() => {}));
    return run;
  }

  async getItem(key: string): Promise<string | null> {
    let cipherText: string | null = null;
    try {
      cipherText = await AsyncStorage.getItem(key);
    } catch {
      // Transient read failure. Returning null signs the user out for this
      // session anyway (Firebase holds no user), but throwing would also let
      // Firebase wipe the record as "failed to initialize current user" —
      // the session could then never come back. Leave the record alone.
      return null;
    }
    if (!cipherText) return null;

    // Degraded-mode record: crypto was unavailable at write time, so the
    // value is stored as-is behind a marker hex can never produce.
    if (cipherText.startsWith(PLAIN_PREFIX)) {
      return cipherText.slice(PLAIN_PREFIX.length);
    }

    const candidates: { keyHex: string; fromBackup: boolean }[] = [];
    // A key source that *errored* is not the same as one that is empty: an
    // error may be transient (keystore momentarily unavailable), and wiping
    // the record over it would sign the user out permanently. Only an
    // all-empty result proves the ciphertext is an orphan.
    let keySourceFailed = false;
    try {
      const keyHex = await SecureStore.getItemAsync(await this._secureKey(key));
      if (keyHex) candidates.push({ keyHex, fromBackup: false });
    } catch {
      // SecureStore unreadable — the backup slot may still hold the key.
      keySourceFailed = true;
    }
    try {
      const keyHex = await AsyncStorage.getItem(this._backupKey(key));
      if (keyHex) candidates.push({ keyHex, fromBackup: true });
    } catch {
      // no further source to try
      keySourceFailed = true;
    }

    for (const candidate of candidates) {
      try {
        const value = this._decryptWith(candidate.keyHex, cipherText);
        if (candidate.fromBackup) {
          // Self-heal: put the working key back into the keystore so the
          // next launch reads it from there again. Best effort.
          try {
            const secureKey = await this._secureKey(key);
            await SecureStore.setItemAsync(secureKey, candidate.keyHex);
          } catch {
            // stays on the backup path
          }
        }
        return value;
      } catch {
        // Wrong key or corrupt ciphertext — try the next candidate.
      }
    }

    if (keySourceFailed) {
      // At least one key source errored rather than reporting empty. The
      // record may be perfectly good — keep it so a later launch (or a later
      // read in this session) can still recover the session.
      return null;
    }

    // Genuinely unrecoverable: ciphertext with no usable key anywhere.
    // Drop it so the next read is not a second failure and the user lands on
    // the sign-in screen rather than an infinite loading state.
    try {
      await this.removeItem(key);
    } catch {
      // Nothing further we can do; the record stays but is harmless.
    }
    return null;
  }

  async setItem(key: string, value: string): Promise<void> {
    return this._enqueue(key, async () => {
      // Last resort first: if crypto itself cannot run, persist unencrypted
      // rather than not at all (see the header). `AsyncStorage` failures are
      // deliberately NOT caught here — if the real storage is down, Firebase
      // should see the failure and report the persistence as unavailable.
      let cipherText: string;
      try {
        const keyHex = await this._resolveKey(key);
        cipherText = this._encryptWith(keyHex, value);
      } catch {
        cipherText = PLAIN_PREFIX + value;
      }
      await AsyncStorage.setItem(key, cipherText);
    });
  }

  async removeItem(key: string): Promise<void> {
    // SecureStore's delete is best-effort: Firebase's availability probe is
    // `setItem` + `removeItem`, and letting a keystore error escape here
    // flips persistence to in-memory for the whole app. AsyncStorage errors
    // still propagate — that probe SHOULD fail if the real storage is gone.
    await AsyncStorage.removeItem(key);
    await AsyncStorage.removeItem(this._backupKey(key)).catch(() => {});
    try {
      await SecureStore.deleteItemAsync(await this._secureKey(key));
    } catch {
      // already-gone or unavailable — both fine for a delete
    }
  }
}
