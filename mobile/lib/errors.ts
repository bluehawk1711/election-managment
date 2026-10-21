/**
 * Firebase error codes, in words a user can act on.
 *
 * Pure and free of any runtime `firebase/*` import, so it is unit-testable and
 * usable from anywhere. `FirebaseError` is duck-typed rather than imported for
 * the same reason — the shape is stable and the import is not worth it.
 */

interface CodedError {
  code?: unknown;
  message?: unknown;
}

const MESSAGES: Record<string, string> = {
  // ── Auth ──────────────────────────────────────────────────────────────
  // Firebase collapses "wrong password" and "no such account" into one code
  // when email enumeration protection is on — the default for projects created
  // since September 2023. That is a feature: it stops the sign-in form being
  // used to discover who has an account. Say something that is true either way.
  'invalid-credential': 'That email and password do not match an account.',
  'invalid-email': 'That does not look like an email address.',
  'user-disabled': 'That account has been disabled.',
  'email-already-in-use': 'An account already exists for that email.',
  'weak-password': 'That password is too weak. Use at least six characters.',
  'requires-recent-login':
    'For security, sign in again before making this change.',
  'too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'network-request-failed':
    'Could not reach Firebase. Check your connection and try again.',
  'invalid-action-code':
    'That link has already been used or has expired. Request a new one.',
  'expired-action-code': 'That link has expired. Request a new one.',
  'account-exists-with-different-credential':
    'You already have an account with that email, created with a different sign-in method.',
  'operation-not-allowed':
    'That sign-in method is not enabled. Turn it on under Authentication → Sign-in method.',
  'popup-closed-by-user': 'Sign-in was cancelled.',
  'unauthorized-domain':
    'This domain is not authorized. Add it under Authentication → Settings → Authorized domains.',

  // ── Data ──────────────────────────────────────────────────────────────
  // Realtime Database codes first, because that is where reads and writes go
  // now. Firestore's spellings are kept below them: the old database is still
  // a read-only backup, and error messages are the worst place to lose a case
  // just because the product moved.
  //
  // This matters more than it looks. RTDB reports a dropped connection as
  // `database/network-error`, not `unavailable`; without the entry below the
  // user saw the raw SDK text "Connection failed." — which tells them nothing
  // and looks like a bug in the app rather than in their signal.
  'permission-denied':
    'Your security rules rejected that. Access is checked at the node you asked for, so an unscoped list read fails outright rather than returning fewer rows.',
  unauthenticated: 'You need to be signed in for that.',
  'network-error':
    'Could not reach Firebase. Check your connection and try again.',
  timeout: 'That took too long. Check your connection and retry.',
  'too-many-retries':
    'The connection kept failing. Check your connection and try again.',
  'limit-exceeded': 'That request asked for more data than is allowed at once.',
  'operation-failed': 'The database rejected that. Try again.',
  'write-canceled': 'That save was cancelled.',
  'invalid-url':
    'The database URL is missing or malformed. Check EXPO_PUBLIC_FIREBASE_DATABASE_URL.',
  'invalid-configuration':
    'The database is not configured. Check EXPO_PUBLIC_FIREBASE_DATABASE_URL.',
  unavailable: 'Could not reach Firebase. Check your connection and try again.',
  'deadline-exceeded': 'That took too long. Check your connection and retry.',
  'not-found': 'That record no longer exists.',
  'already-exists': 'That record already exists.',
  'resource-exhausted':
    'You have hit a Firestore quota. Check usage in the Firebase console.',
  cancelled: 'That request was cancelled.',
  'invalid-argument':
    'Firebase rejected the data. A common cause is an undefined value — write null instead.',

  // ── Storage ───────────────────────────────────────────────────────────
  unauthorized:
    'Your storage rules rejected that. Check that the path starts with your own uid.',
  'object-not-found': 'That file does not exist in storage.',
  'quota-exceeded': 'Your storage quota is full.',
  canceled: 'The upload was cancelled.',
  'retry-limit-exceeded':
    'The upload kept failing. Check your connection and try again.',
};

/** `auth/invalid-email` and bare `permission-denied` both resolve here. */
function codeOf(error: unknown): string | null {
  const code = (error as CodedError)?.code;
  if (typeof code !== 'string') return null;
  const slash = code.indexOf('/');
  return slash === -1 ? code : code.slice(slash + 1);
}

/**
 * A missing composite index is the one error worth passing through verbatim.
 *
 * Firestore puts a console URL in the message that creates exactly the index
 * the failed query needs. Replacing that with friendly prose throws away the
 * single most useful thing the SDK ever tells you.
 */
function isMissingIndex(error: unknown): boolean {
  const message = (error as CodedError)?.message;
  return (
    codeOf(error) === 'failed-precondition' &&
    typeof message === 'string' &&
    message.includes('index')
  );
}

export function messageFor(error: unknown): string {
  if (isMissingIndex(error)) {
    return (
      'This query needs a composite index. Firestore generated one for you:\n\n' +
      String((error as CodedError).message) +
      '\n\nAdd it to firestore.indexes.json and run `npm run deploy:indexes` so it lives in your repo.'
    );
  }

  const code = codeOf(error);
  if (code && MESSAGES[code]) return MESSAGES[code];

  const message = (error as CodedError)?.message;
  if (typeof message === 'string' && message) return message;

  return 'Something went wrong.';
}
