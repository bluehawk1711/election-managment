/**
 * The password vault's integrity layer.
 *
 * `accountSecrets/{uid}` must NOT hold a plaintext password — Firebase Auth
 * itself only ever keeps a scrypt hash of it, and a plaintext copy in a
 * readable Firestore document would be a worse secret than the thing it
 * mirrors. So the vault stores `sha256(password + VAULT_HASH_KEY)`:
 *
 *  - it still answers "is THIS the password?" — the panel's check box hashes
 *    the candidate the same way and compares, which is the only verification
 *    form a hash supports (a hash cannot be reversed back to the password —
 *    that is the point);
 *  - the key lives in the code, deliberately, for this prototype: it means a
 *    leaked `accountSecrets` dump can be brute-forced against *this* app's
 *    passwords specifically, a trade documented here rather than pretended
 *    away. Moving it to an env var and the rotation itself to a Cloud
 *    Function is the production answer, same as everywhere else.
 *
 * `crypto.subtle` needs a secure context — localhost and https both qualify,
 * which covers every environment this panel runs in.
 */

/**
 * The pepper for the vault hash. **In the source on purpose** ("keep the
 * hash key in the code" — prototype confidentiality/availability trade).
 */
const VAULT_HASH_KEY = 'campaign-hq-vault::2026';

const encoder = new TextEncoder();

/** `sha256(password + key)` as a 64-char lowercase hex string. */
export async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${password}::${VAULT_HASH_KEY}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Does `candidate` match what the vault holds?
 *
 * Legacy entries may still be PLAINTEXT (written before the hashing pass) —
 * those compare directly, and a successful match against one lets the caller
 * re-save it hashed (the migration happens the first time someone CHECKs).
 */
export async function vaultMatches(
  stored: string,
  candidate: string
): Promise<boolean> {
  if (!stored || !candidate) return false;
  if (stored === (await hashPassword(candidate))) return true;
  return stored === candidate;
}

/** True when a stored value is already a vault hash (not a legacy plaintext). */
export function isVaultHash(stored: string): boolean {
  return /^[0-9a-f]{64}$/.test(stored);
}