import { getApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { useCallback, useState } from 'react';
import { adminApiBase, publishAccountClaims } from '@/lib/admin-api';
import { saveAccountCredential } from '@/lib/account-credentials';
import { deleteDoc, serverTimestamp, setDoc } from '@/lib/db';
import { messageFor } from '@/lib/errors';
import { auth } from '@/lib/firebase';
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
 * It is not a bypass — `database.rules.json` authorises every write, and the client's
 * Firebase config is public by design. Without `accountManage` the `users`
 * write below is denied by the same rules that gate the Accounts list. The
 * `can()` check on the screen is a convenience; the rules are the boundary.
 *
 * ## Why creation talks to Campaign HQ
 *
 * The profile write is not enough. Every rule reads the role from the Auth
 * custom claim (`auth.token.role`), and only the Admin SDK can write a claim.
 * So the last step calls the admin panel's `/api/account/claims` route, which
 * authenticates THIS manager, reads `users/{uid}` server-side, and mirrors the
 * profile onto the new login's token. The app never sends a role that the
 * server trusts — it sends only the uid.
 *
 * That step is not best-effort. If it fails, the Auth record and profile are
 * rolled back, because an account that can sign in but has no claim is an
 * account the database rules treat as having no role — it would look created
 * and do nothing. `EXPO_PUBLIC_ADMIN_API_URL` is the build-time origin of the
 * admin panel; without it this form refuses to start rather than leave a
 * broken login behind.
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

/** Signs the throwaway secondary session out without letting that mask a result. */
async function clearSecondarySession(): Promise<void> {
  try {
    await firebaseSignOut(accountsAuth());
  } catch {
    // Nothing to clear, or the secondary app never initialized.
  }
}

export interface NewAccount {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
  /**
   * The FULL assigned ward set — at least one ward required for a karykarta,
   * ignored (absent from the profile) for every other role. The write stores
   * `wardNo` as the first ward plus `wardNos` as the presence map, the same
   * shape the admin panel's `grantRole` writes.
   */
  wardNos: number[] | null;
}

/**
 * Creates the account and its profile, then activates the login.
 *
 * Three writes — Auth user, `users/{uid}`, custom claims — and every later step
 * can fail, so the earlier ones are rolled back. The alternative leaves an
 * Auth record with no `users` document, which the Accounts screen cannot show
 * (it reads `users`) and the app cannot recover from: a retry then fails with
 * `auth/email-already-in-use` and the only way forward is the Firebase console.
 * Rolling back means a retry just works.
 */
export function useCreateAccount() {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (input: NewAccount): Promise<boolean> => {
    setError(null);

    // The ward set, deduped/validated/sorted BEFORE anything is created —
    // the rules' `$ward.matches(/^[1-9][0-9]{0,2}$/)` ceiling is mirrored
    // here so a bad entry is a named form error, not a rolled-back Auth
    // user. A karykarta with no ward reads nothing by design.
    const wards = [
      ...new Set(
        (input.wardNos ?? []).filter(
          (wardNo) => Number.isInteger(wardNo) && wardNo >= 1 && wardNo <= 999
        )
      ),
    ].sort((a, b) => a - b);
    if (input.role === 'karykarta' && wards.length === 0) {
      setError('A karykarta needs at least one ward number above 0.');
      return false;
    }

    // Fail before creating anything. An account with no way to publish its
    // claim would be unusable the moment it is handed over, so "not
    // configured" is a refusal to start, not a warning after the fact.
    const base = adminApiBase();
    if (!base) {
      setError(
        'Account activation is not configured in this build. Set EXPO_PUBLIC_ADMIN_API_URL to Campaign HQ’s address, then try again.'
      );
      return false;
    }

    const manager = auth.currentUser;
    if (!manager) {
      setError(
        'Sign in again — creating an account needs your manager session to publish the new login’s role.'
      );
      return false;
    }

    setCreating(true);

    // Held so the rollback can delete exactly the account that was just made,
    // rather than relying on `currentUser` (which is null here — nobody is
    // signed in on the secondary app).
    let created: User | null = null;

    try {
      // Force a refresh so Campaign HQ sees this manager's CURRENT role. A
      // cached token can be an hour old, and the claims route authorises on
      // the role in the token it receives.
      const managerToken = await manager.getIdToken(true);

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
      // Blaze plan — so authorisation lives in `database.rules.json` instead:
      // the create path allows a `role` write only when the caller is
      // superAdmin/developer, and `scripts/probe-owner-write.mjs` asserts both
      // that a super admin can and that a karykarta cannot. The client asking is
      // not the client deciding.
      // `{ merge: true }` for the same reason as `ensureProfile`: a plain set is
      // validated at the `users/$uid` NODE, whose only `.write` rule is
      // delete-only, so it is refused (HTTP 401) whatever the caller's rank.
      // `update()` is validated per child, and each of these children grants
      // superAdmin when `auth.uid !== $uid` — which is the case here, because
      // the write runs on the PRIMARY app (the admin) even though the account
      // itself was created on the secondary one.
      // eslint-disable-next-line react-doctor/firebase-client-owned-authz-field
      await setDoc(
        `users/${created.uid}`,
        {
          email: input.email,
          displayName: input.displayName,
          photoURL: null,
          onboarded: true,
          role: input.role,
          // Only karykarta are ward-scoped. `wardNo` is the FIRST assigned
          // ward — every single-ward reader (badges, legacy tokens, scripts)
          // keeps its meaning — while `wardNos` is the FULL set as a presence
          // map ({"3": true, "7": true}) that /api/account/claims turns into
          // the comma-delimited `wardNos` claim the rules' membership test
          // reads. Both keys are ABSENT for every other role: RTDB stores no
          // null children, and the rules refuse a present ward key on a
          // non-karykarta rather than merely ignoring it.
          ...(input.role === 'karykarta' && wards.length > 0
            ? { wardNo: wards[0], wardNos: Object.fromEntries(wards.map((w) => [String(w), true])) }
            : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Publish the profile's role/ward onto the new login's custom claims.
      // The route's response tells us what it wrote; the token check below
      // proves the new session actually received it.
      const published = await publishAccountClaims({
        base,
        token: managerToken,
        uid: created.uid,
        operation: 'mobile-create',
      });

      if (published.role !== input.role) {
        throw new Error(
          'The account was saved but Campaign HQ did not publish its role. Nothing was kept — try again.'
        );
      }

      // Force-refresh the NEW user's token and inspect it. This is the
      // "instantly usable" guarantee: by the time this returns true, the very
      // token the account will sign in with already carries its role, ward and
      // activation state. A rules check on the first screen will pass.
      const token = await created.getIdTokenResult(true);

      if (token.claims.role !== input.role) {
        throw new Error(
          'The new login did not receive its role. Nothing was kept — try again.'
        );
      }

      if (input.role === 'karykarta' && token.claims.wardNo !== wards[0]) {
        throw new Error(
          'The new login did not receive its ward. Nothing was kept — try again.'
        );
      }

      // The full-set claim, exactly the shape /api/account/claims mints:
      // comma-delimited with leading/trailing commas so the rules'
      // `.contains(',' + ward + ',')` is an exact membership test.
      if (
        input.role === 'karykarta' &&
        token.claims.wardNos !== `,${wards.join(',')},`
      ) {
        throw new Error(
          'The new login did not receive its ward set. Nothing was kept — try again.'
        );
      }

      // Remember what was just typed so the admin can read it back from the
      // Accounts list later — Firebase Auth keeps only a hash, so this is the
      // one moment the password exists anywhere. After activation and
      // best-effort: it is a convenience layered on an account that is already
      // usable, so a locked keystore must not roll back an Auth user, a
      // profile and claims that are all perfectly good.
      await saveAccountCredential({
        uid: created.uid,
        email: input.email,
        password: input.password,
      });

      return true;
    } catch (caught) {
      // Undo every write so a retry starts clean. The profile goes first: the
      // manager's token is the one that can delete it, and deleting the Auth
      // record first would leave a profile whose login is gone. Both are
      // best-effort; the Auth record is the thing that makes a retry fail with
      // `email-already-in-use`, so it is the last to go.
      if (created) {
        await deleteDoc(`users/${created.uid}`).catch(() => undefined);
        await deleteUser(created).catch(() => undefined);
      }
      setError(messageFor(caught));
      return false;
    } finally {
      // The secondary app exists only to create the user without disturbing
      // the manager's session. Do not leave the new account signed in on this
      // device after the hand-off.
      await clearSecondarySession();
      setCreating(false);
    }
  }, []);

  return { create, creating, error };
}
