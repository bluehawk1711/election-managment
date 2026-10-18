import {
  applyActionCode,
  isSignInWithEmailLink,
  onAuthStateChanged,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { parseAuthLink } from '@/lib/auth-link';
import {
  clearLockNotice,
  deviceInfo,
  noteLock,
} from '@/lib/device';
import { profileFromDoc, type Profile } from '@/lib/documents';
import { auth, db } from '@/lib/firebase';

/** Where `email-link.tsx` stashes the address it sent the link to. */
export const PENDING_EMAIL_KEY = 'firebase.emailLink.pendingEmail';

interface AuthContextType {
  /**
   * The signed-in user, or null once resolved and signed out.
   *
   * No `session` field: Firebase has no session object. The `User` carries
   * `getIdToken()`, and the SDK refreshes behind it.
   */
  user: User | null;
  profile: Profile | null;
  /** True until the persisted user has been read off disk. */
  loading: boolean;
  /**
   * True once signed in, until this user's profile document has resolved.
   *
   * Distinct from `profile === null`, which is genuinely ambiguous on its own:
   * a null profile means either "the snapshot has not landed yet" or "this
   * account really has no role". `loading` only covers the *first* source
   * (the persisted user), so between the two there was a ~1s window where the
   * app was fully interactive, `profile` was null, and every screen that
   * gates on a role showed its "no role assigned yet" empty state — which then
   * vanished when the snapshot arrived. Reading that as "no role" is what
   * flashed "अभी कोई भूमिका नहीं दी गई" at a signed-in user on every cold
   * start. Screens must show a loading state while this is true.
   */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Keyed by uid rather than cleared in an effect: the effect may only write
  // from the subscription callback, and a uid check makes it impossible for a
  // render to expose the previous account's profile to the next one.
  const [profileEntry, setProfileEntry] = useState<{
    uid: string;
    profile: Profile | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The uid whose profile has *resolved* — either delivered or terminally
   * failed. A separate field rather than a flag on `profileEntry`, because the
   * failure path sets the entry to null, which is indistinguishable from
   * "still loading" without it. Without this the app would spin forever on a
   * rules rejection.
   */
  const [resolvedProfileUid, setResolvedProfileUid] = useState<string | null>(null);

  const userId = user?.uid ?? null;
  const profile =
    user && profileEntry?.uid === user.uid ? profileEntry.profile : null;
  const profileLoading = userId !== null && resolvedProfileUid !== userId;

  useEffect(() => {
    // Fires once after the SDK has finished reading LargeSecureStore, with
    // either a User or null, and again on every sign-in, sign-out and token
    // refresh. Everything renders a spinner until that first call, so a
    // returning user never sees the sign-in screen flash before their session
    // loads.
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;

    const reference = doc(db, 'users', userId);

    /**
     * The direct analogue of the `profiles:{id}` postgres_changes channel in
     * the Supabase starter, and it earns its place for the same reason: the
     * onboarding screen writes to this document from elsewhere, and the guard
     * in app/_layout.tsx has to see that without polling.
     */
    return onSnapshot(
      reference,
      async (snapshot) => {
        if (!snapshot.exists()) {
          // There is no Cloud Function creating this document — those need the
          // Blaze plan, which a starter should not require. The client writes
          // it instead, and doing it from the *listener* rather than once after
          // sign-up means it self-heals: if the first attempt never landed, the
          // next launch fixes it. A post-sign-up write would not.
          await ensureProfile(auth.currentUser);
          return;
        }

        setProfileEntry({ uid: userId, profile: profileFromDoc(snapshot) });
        setResolvedProfileUid(userId);
      },
      () => {
        // A rules rejection here is terminal. Leave the profile null rather
        // than stale; the guards treat that as "not loaded", not "onboarded".
        // Marked resolved anyway — this *is* the answer, and waiting on a
        // snapshot that will never fire would hang the app.
        setProfileEntry(null);
        setResolvedProfileUid(userId);
      }
    );
  }, [userId]);

  useEffect(() => {
    /**
     * Completes a sign-in or a verification that finished in a mail client.
     *
     * Email links, password resets and address verification all come back as a
     * deep link into the app. This lives on the provider rather than a
     * `callback` route because the link can arrive while any screen is mounted,
     * and on a cold start before the router has settled anywhere at all.
     */
    const handleUrl = async (url: string) => {
      // The SDK is the authority on whether this is a sign-in link, so ask it
      // rather than re-implementing the check.
      if (isSignInWithEmailLink(auth, url)) {
        const email = await SecureStore.getItemAsync(PENDING_EMAIL_KEY);
        // Opened on a different device from the one that requested it. Firebase
        // requires the address back, and prompting for it here would be a
        // phishing vector, so this is a dead end by design.
        if (!email) return;

        try {
          await signInWithEmailLink(auth, email, url);
          await SecureStore.deleteItemAsync(PENDING_EMAIL_KEY);
        } catch {
          // An expired or reused link. The user is still on the sign-in
          // screen, which is the right place to be.
        }
        return;
      }

      const link = parseAuthLink(url);
      if (!link) return;

      if (link.kind === 'resetPassword') {
        router.push({
          pathname: '/reset-password',
          params: { oobCode: link.oobCode },
        });
        return;
      }

      if (link.kind === 'verifyEmail') {
        try {
          await applyActionCode(auth, link.oobCode);
          // The User object caches `emailVerified`, so it keeps reporting the
          // old value until it is reloaded.
          await auth.currentUser?.reload();
          setUser(auth.currentUser);
        } catch {
          // Already used, or expired. Settings still offers to resend.
        }
      }
    };

    // The link that launched the app from cold.
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // And any that arrive while it is already running.
    const subscription = Linking.addEventListener('url', ({ url }) =>
      handleUrl(url)
    );

    return () => subscription.remove();
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setProfileEntry(null);
  }, []);

  // ---------------------------------------------------------------------
  // Per-device account lock (firestore.rules §users).
  //
  // Runs on every profile snapshot for a signed-in user and enforces three
  // states, in this order:
  //
  //  1. `profile.locked` → the account is locked (by an admin, or by the
  //     account itself earlier): end the session NOW and leave a notice for
  //     the sign-in screen. Rules already deny every capability — this is
  //     just the client half of the same gate.
  //  2. bound device exists but is NOT this install → a different device
  //     signed in with this account's password. Lock the account
  //     (`locked: true` from the OWNER path — the only way a non-admin can
  //     lock, and that path can never write `locked: false`), leave the
  //     notice, sign out. Recovery is a super-admin unlock, which also drops
  //     the binding so the rightful device re-binds on its next sign-in.
  //  3. no binding yet → first launch from this install: bind it. Rules
  //     only permit a device write while none exists, so any later attempt
  //     to swap the binding (from a modified client) is rejected server-side.
  //
  // The super-admin exemption: a super admin skips step 2 entirely. They
  // rebind instead of locking (firestore.rules §users allows a device write
  // for the `superAdmin` role on any write, not just the first), because
  // freezing the one account that unlocks everyone else behind a single
  // phone would be recovery-hostage-taking. A deliberate admin lock
  // (`profile.locked` in step 1) still applies to them.
  //
  // Everything is best-effort: a failure here degrades to "no binding" or
  // "signed out locally", never to a half-broken session.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!userId || !profile) return;
    let cancelled = false;

    (async () => {
      try {
        const info = await deviceInfo();
        if (cancelled) return;

        if (profile.locked) {
          await noteLock(profile.lockedReason ?? 'admin');
          if (cancelled) return;
          await firebaseSignOut(auth);
          setProfileEntry(null);
          return;
        }

        const bound = profile.device?.id ?? null;

        // Super admins are not device-bound: rebind to whichever install
        // they are on (or bind for the first time) and move on. The rules
        // server-side allow exactly this — a device write from a
        // `superAdmin` profile on any write, not just the first.
        if (profile.role === 'superAdmin') {
          if (bound !== info.id) {
            await updateDoc(doc(db, 'users', userId), {
              device: info,
              updatedAt: serverTimestamp(),
            });
          }
          await clearLockNotice();
          return;
        }

        if (bound && bound !== info.id) {
          try {
            await updateDoc(doc(db, 'users', userId), {
              locked: true,
              lockedReason: 'device_change',
              lockedAt: Date.now(),
              // 'system' says "nobody pressed a button — a foreign device
              // walked into the account", which is what the panel shows.
              lockedBy: 'system',
              updatedAt: serverTimestamp(),
            });
          } catch {
            // Offline or already locked by the other device's own attempt —
            // the sign-out below still runs either way.
          }
          if (cancelled) return;
          await noteLock('device_change');
          await firebaseSignOut(auth);
          setProfileEntry(null);
          return;
        }

        if (!bound) {
          await updateDoc(doc(db, 'users', userId), {
            device: info,
            updatedAt: serverTimestamp(),
          });
        }
        // Normal path (bound to this install, or we just bound it): this
        // sign-in is legitimate, so any lock notice left by a previous
        // lockout no longer describes the current state.
        await clearLockNotice();
      } catch {
        // Device bookkeeping must never keep a signed-in user from using the
        // app — the rules enforce the lock server-side regardless.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, profile]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const snapshot = await getDoc(doc(db, 'users', userId));
    if (!snapshot.exists()) {
      setResolvedProfileUid(userId);
      return;
    }
    setProfileEntry({ uid: userId, profile: profileFromDoc(snapshot) });
    setResolvedProfileUid(userId);
  }, [userId]);

  return (
    <AuthContext.Provider
      value={{
        user,
        // Derived rather than cleared in an effect: `profileEntry` is keyed by
        // uid, so a signed-out render — or a render during an account switch —
        // can never briefly expose the previous user's profile.
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Creates `users/{uid}` the first time it is missing.
 *
 * `onboarded: false` is required by firestore.rules on create — a client cannot
 * sign up already onboarded and skip the flow.
 */
async function ensureProfile(current: User | null): Promise<void> {
  if (!current) return;

  try {
    await setDoc(doc(db, 'users', current.uid), {
      email: current.email,
      displayName: current.displayName,
      photoURL: current.photoURL,
      onboarded: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Two listeners racing, or a rules rejection. The snapshot listener stays
    // subscribed either way, so the next event tries again.
  }
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
