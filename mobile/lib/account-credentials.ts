import * as SecureStore from 'expo-secure-store';

/**
 * What this device typed when it created an account, kept so the admin who
 * created it can read it back later.
 *
 * ## Why it exists
 *
 * Firebase Auth stores only a password *hash*, so the password is unrecoverable
 * the moment `createUserWithEmailAndPassword` resolves — which is what the
 * create screen's own hint used to say: "the password is never shown again".
 * Accounts in this app are created to be handed to a karykarta in person, and a
 * hand-off that has to finish inside the few seconds between "created" and
 * "navigated back" is a hand-off that usually does not happen. The admin opens
 * the account a minute later and the only way forward is a password reset —
 * for a password they just made up.
 *
 * ## What it is, and what it is not
 *
 * - **Device-local, keystore-protected.** One `expo-secure-store` entry per
 *   account — Keychain on iOS, EncryptedSharedPreferences-backed Keystore on
 *   Android. It is never written to Firestore, so no rule can be mis-written
 *   into exposing it, and no other device can read it: an account created on
 *   the super admin's phone is simply "not stored here" on the admin's tablet.
 * - **A copy, not a source of truth.** Auth owns the password; this only
 *   remembers what was typed at creation. A reset from the Firebase console
 *   makes this stale, which is exactly why it is written once, at creation,
 *   where the two cannot have diverged yet.
 * - **Reads never throw and never return a partial record.** An unavailable
 *   keystore, a corrupt entry, or a value past SecureStore's 2048-byte ceiling
 *   all read as "not stored". The Accounts screen then says so in words rather
 *   than offering a password that is no longer the one that works — a plausible-
 *   looking wrong password is strictly worse than a blank.
 *
 * ## Why one entry per account
 *
 * SecureStore caps a *value* at 2048 bytes. A single JSON blob holding every
 * credential hits that after roughly a dozen accounts, and the failure would
 * land on the next account created — the save that most needs to work. Per-uid
 * keys have no such ceiling; the count of accounts is bounded by how many items
 * the keystore will hold, not by the size of one. The uid is `[A-Za-z0-9._-]`,
 * which is precisely the character set SecureStore accepts in a key.
 */

export interface AccountCredential {
  /** `users/{uid}` — the account this record is filed under. */
  uid: string;
  email: string;
  password: string;
}

const keyFor = (uid: string): string => `account-credential-${uid}`;

/**
 * Files a credential. Best-effort by contract: it returns `false` rather than
 * rejecting, so a locked keystore can never be mistaken for a failed account
 * creation (the caller has already committed an Auth user and a `users`
 * document by this point — see `useCreateAccount`).
 */
export async function saveAccountCredential(
  credential: AccountCredential
): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(
      keyFor(credential.uid),
      JSON.stringify(credential)
    );
    return true;
  } catch {
    // Keystore unavailable, or the record is past SecureStore's ceiling.
    return false;
  }
}

/**
 * The credential for `uid`, or `null` when this device has none.
 *
 * Shape-checked rather than cast: a truncated or hand-edited entry must read
 * as "not stored" rather than as `{ password: undefined }`, which the modal
 * would happily render as "undefined" and the copy button would put on the
 * clipboard.
 */
export async function getAccountCredential(
  uid: string
): Promise<AccountCredential | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(uid));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AccountCredential>;
    if (
      parsed.uid !== uid ||
      typeof parsed.email !== 'string' ||
      typeof parsed.password !== 'string' ||
      parsed.password.length === 0
    ) {
      return null;
    }

    return { uid, email: parsed.email, password: parsed.password };
  } catch {
    // Missing, unreadable, or corrupt — all the same answer to the reader.
    return null;
  }
}
