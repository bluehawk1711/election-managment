import { getApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useCallback, useState } from 'react';
import { saveAccountCredential } from '@/lib/account-credentials';
import { messageFor } from '@/lib/errors';
import { db } from '@/lib/firebase';
import type { AppRole } from '@/lib/roles';

/**
 * Creates an account and assigns it a role (plan-voters.md §6.5).
 *
 * ## Why a second Firebase app
 *
 * `createUserWithEmailAndPassword(auth, …)` on the app's own `auth` instance
 * signs the *creating user in as the new account*. That is the SDK's documented
 * behaviour, not a quirk, and in a super-admin screen it is bad: the admin
 * adding five karykarta gets logged out of their own session — and straight into
 * the role they just granted — on the first one.
 *
 * A second app instance with the same config has its own `Auth`, so signing in
 * on it does not touch the primary session. Memoised because `initializeApp`
 * throws `app/duplicate-app` on a second call, and more than one screen can
 * reach this.
 *
 * ## Why this is not a security hole
 *
 * It is not a bypass — `firestore.rules` authorises every write, and the client's
 * Firebase config is public by design. Without `accountManage` the `users`
 * write below is denied by the same rules that gate the Accounts list. The
 * `can()` check on the screen is a convenience; the rules are the boundary.
 *
 * The properly-scoped version of this is a Cloud Function using the Admin SDK,
 * which creates users with no client session involved at all. That needs the
 * Blaze plan, which is out of scope for this prototype — noted here because it
 * is the right answer for production, not because it is blocked.
 */
let secondaryAuth: Auth | null = null;

function accountsAuth(): Auth {
  if (secondaryAuth) return secondaryAuth;

  const primary: FirebaseApp = getApp();
  secondaryAuth = getAuth(
    initializeApp(
      // `app.options` rather than a re-declared config object: this cannot
      // drift from `lib/firebase.ts` the way a copy would.
      primary.options,
      'accounts'
    )
  );
  return secondaryAuth;
}

export interface NewAccount {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
  /** Required for a karykarta; ignored for every other role. */
  wardNo: number | null;
}

/**
 * Creates the account and its profile.
 *
 * Two writes, and the second can fail — so the first is rolled back when it
 * does. The alternative leaves an Auth record with no `users` document, which
 * the Accounts screen cannot show (it reads `users`) and the app cannot recover
 * from: a retry then fails with `auth/email-already-in-use` and the only way
 * forward is the Firebase console. Rolling back means a retry just works.
 */
export function useCreateAccount() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (input: NewAccount): Promise<boolean> => {
    setCreating(true);
    setError(null);

    // Held so the rollback can delete exactly the account that was just made,
    // rather than relying on `currentUser` (which is null here — nobody is
    // signed in on the secondary app).
    let created: User | null = null;

    try {
      const credential = await createUserWithEmailAndPassword(
        accountsAuth(),
        input.email,
        input.password
      );
      created = credential.user;

      // `users/{uid}` is written by the admin, not by the new user: nobody is
      // signed in on the secondary app, so the provider's self-healing
      // `ensureProfile` never runs for them. `onboarded: true` because this is
      // the one path that skips onboarding — the admin is setting the account
      // up, not the account owner.
      //
      // Writing `role` from the client is deliberate and is what
      // react-doctor's `firebase-client-owned-authz-field` rule flags. There is
      // no trusted server to delegate to here — Cloud Functions need the paid
      // Blaze plan — so authorisation lives in `firestore.rules` instead: the
      // create path allows a `role` write only when the caller is
      // superAdmin/developer, and `rules-tests/firestore.test.ts` asserts both
      // that a super admin can and that a karykarta cannot. The client asking is
      // not the client deciding.
      // eslint-disable-next-line react-doctor/firebase-client-owned-authz-field
      await setDoc(doc(db, 'users', created.uid), {
        email: input.email,
        displayName: input.displayName,
        photoURL: null,
        onboarded: true,
        role: input.role,
        // Only karykarta are ward-scoped. Storing `wardNo: null` for everyone
        // else would be harmless but misleading, and `Profile.wardNo` reads an
        // explicit null as "unrestricted" — so absence and null mean the same
        // thing here, and absence is what the seeded data looks like.
        ...(input.role === 'karykarta' && input.wardNo != null
          ? { wardNo: input.wardNo }
          : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Remember what was just typed so the admin can read it back from the
      // Accounts list later — Firebase Auth keeps only a hash, so this is the
      // one moment the password exists anywhere. After the profile write and
      // best-effort: it is a convenience layered on an account that already
      // exists, so a keystore that is locked must not roll back an Auth user
      // and a `users` document that are both perfectly good. On failure the
      // screen's old promise is what holds — `accounts.createdHint` then tells
      // the admin the password cannot be read back, which is the truth for an
      // account this device could not file (`lib/account-credentials.ts`).
      await saveAccountCredential({
        uid: created.uid,
        email: input.email,
        password: input.password,
      });

      return true;
    } catch (caught) {
      // Undo the Auth record so a retry starts clean. Without this, a second
      // attempt fails with `auth/email-already-in-use` and the admin has no way
      // forward from inside the app.
      if (created) await deleteUser(created).catch(() => undefined);
      setError(messageFor(caught));
      return false;
    } finally {
      setCreating(false);
    }
  }, []);

  return { create, creating, error };
}