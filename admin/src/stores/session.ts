/**
 * The signed-in admin's identity — one Zustand store, two listeners.
 *
 * Zustand rather than React context because this state is read FINE-grained
 * (a badge reads `role`, the drawer reads `uid`, the topbar reads
 * `displayName`) and is subscribed by `providers.tsx` exactly once. Context
 * would re-render every consumer of any field on each profile edit; Zustand's
 * selectors make each read its own subscription.
 *
 * Bootstrap lives outside the store (providers.tsx): `onAuthStateChanged`
 * switches the auth identity, and an `onSnapshot(users/{uid})` owns the
 * profile fields — so a role granted by another super admin lands live on an
 * open panel without a reload, and the buttons re-enable because `role`
 * changed, not because someone remembered to refetch.
 *
 * `user` is Firebase's auth record (uid/email/displayName before a profile
 * write lands); `role`/`wardNo`/`onboarded` come from the `users/{uid}`
 * document. `role` is `null` for both "no profile yet" and "profile with no
 * role" — deliberately identical: `firestore.rules` treats a missing role as
 * zero capabilities, and the UI must agree so no control appears privileged
 * that the server will reject.
 */
import { create } from 'zustand';

export type SessionStatus = 'loading' | 'anon' | 'ready';

export interface SessionState {
  status: SessionStatus;
  /** The auth identity. Null while loading or signed out. */
  uid: string | null;
  email: string;
  displayName: string;
  /** From `users/{uid}` — null when absent or not one of the four roles. */
  role: string | null;
  /** Only meaningful when `role === 'karykarta'`. */
  wardNo: number | null;
  onboarded: boolean;
  /**
   * True once the `users/{uid}` listener has emitted its first snapshot.
   * The gate uses this to hold the boot screen until the role is known, so a
   * plain admin is never briefly shown the Overview (or any other route)
   * before the `/voters` redirect can happen.
   */
  profileReady: boolean;

  /** Auth listener result: a user identity (profile merge happens next). */
  signIn: (payload: { uid: string; email: string; displayName: string }) => void;
  /** Profile snapshot — merged over the current identity. */
  applyProfile: (payload: {
    displayName?: string;
    role?: string | null;
    wardNo?: number | null;
    onboarded?: boolean;
  }) => void;
  signOut: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  uid: null,
  email: '',
  displayName: '',
  role: null,
  wardNo: null,
  onboarded: false,
  profileReady: false,

  signIn: (payload) =>
    set((state) => ({
      status: 'ready',
      uid: payload.uid,
      // Auth's own values for now — a fresher profile snapshot overwrites
      // them on the next line of the bootstrap sequence. A token refresh for
      // the same identity keeps the already-loaded profile; a different uid
      // starts the boot wait again.
      profileReady: state.uid === payload.uid ? state.profileReady : false,
      email: payload.email,
      displayName: payload.displayName,
    })),

  applyProfile: (payload) =>
    set((state) => ({
      status: state.uid ? 'ready' : state.status,
      profileReady: true,
      displayName: payload.displayName ?? state.displayName,
      role: payload.role === undefined ? state.role : payload.role,
      wardNo: payload.wardNo === undefined ? state.wardNo : payload.wardNo,
      onboarded: payload.onboarded ?? state.onboarded,
    })),

  signOut: () =>
    set({
      status: 'anon',
      uid: null,
      email: '',
      displayName: '',
      role: null,
      wardNo: null,
      onboarded: false,
      profileReady: false,
    }),
}));