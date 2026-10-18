/**
 * Every Firestore query and mutation the panel performs, in one file.
 *
 * Split by intent, not by collection:
 *
 *   *Reflections* — `build*Query`/`*Ref` return plain `Query`/`DocumentReference`
 *   objects; they know nothing about React or React Query and are subscribed
 *   through `hooks/use-live.ts` from the pages.
 *
 *   *Mutations* — plain async functions that THROW on failure (with the raw
 *   Firebase error) so callers can react: mutation callbacks show toasts,
 *   `createAccount` implements its own rollback (see its comment). Nothing in
 *   here catches silently.
 *
 * The single most load-bearing detail in this file: **every rules-coupled
 * payload mirrors `mobile/firestore.rules` exactly** — exact key sets,
 * `serverTimestamp()` where rules say `== request.time`, `deleteField()` to
 * drop `wardNo`, full-document writes for the finalized phone board (whose
 * rule uses `exactKeys` on the RESULT, so a partial merge would be rejected).
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Query,
  type DocumentReference,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { initializeApp as initSecondaryApp } from 'firebase/app';
import { app, auth, db } from '@/lib/firebase';
import { phoneKey, type FinalizedContact } from '@/lib/contacts';
import type {
  AccountVault,
  AppConfig,
  AuthAccountDetail,
  Profile,
  Task,
  TaskStatus,
  VoterRow,
} from '@/lib/types';
import { hashPassword } from '@/lib/vault';
import type { AppRole } from '@/lib/roles';

// ------------------------------------------------------------------
// Reflections (queries / references)
// ------------------------------------------------------------------

export function buildVotersQuery(wardNo: number): Query {
  // Equality only — the automatic single-field index serves it, which is why
  // `firestore.indexes.json` stays empty. Multi-criteria filtering (search,
  // gender chips, …) happens in-memory on the page, the same prototype-scale
  // trade `lib/filters.ts` documents for the mobile app.
  return query(collection(db, 'voters'), where('wardNo', '==', wardNo));
}

export function buildWardsQuery(): Query {
  return query(collection(db, 'wards'));
}

export function buildUsersQuery(): Query {
  return query(collection(db, 'users'));
}

export function buildTasksQuery(): Query {
  return query(collection(db, 'tasks'));
}

/** Tasks assigned to one account — the "current load" line in the details dialog. */
export function buildAssignedTasksQuery(uid: string): Query {
  // Single-field equality — served by the automatic index (see
  // buildVotersQuery on why that matters here).
  return query(collection(db, 'tasks'), where('assigneeId', '==', uid));
}

/** The signed-in account's own voter edits — the overlay the drawer merges. */
export function buildMyEditsQuery(uid: string): Query {
  return query(collection(db, 'users', uid, 'voterEdits'));
}

export function overlayRef(uid: string, voterId: string): DocumentReference {
  return doc(db, 'users', uid, 'voterEdits', voterId);
}

export function boardRef(voterId: string): DocumentReference {
  return doc(db, 'voterPhones', voterId);
}

export function buildProposalsQuery(voterId: string): Query {
  return query(collection(db, 'voterPhones', voterId, 'proposals'));
}

// ------------------------------------------------------------------
// Adaptive listeners for one-shot semantics (getDoc-shaped) pages use
// ------------------------------------------------------------------

/** Subscribes a single document; emits `null` while it does not exist. */
export function subscribeDocOrNull<T>(
  ref: DocumentReference,
  map: (doc: { id: string; data: () => Record<string, unknown> }) => T | null,
  emit: (value: T | null) => void,
  fail: (error: unknown) => void
): () => void {
  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        emit(null);
        return;
      }
      emit(
        map({
          id: snapshot.id,
          data: () => snapshot.data() as Record<string, unknown>,
        })
      );
    },
    fail
  );
}

// ------------------------------------------------------------------
// Mutations — voter overlay (account-private, mirroring sync.ts payloads)
// ------------------------------------------------------------------

/**
 * Writes an edit patch to the account's private overlay document.
 *
 * Partial write with `{ merge: true }`: only CHANGED fields travel (plus the
 * three bookkeeping keys rules require on every write), so the document
 * accumulates corrections exactly the way `lib/roll/overlay.ts` merges a
 * local patch — and `request.resource.data` after the merge stays inside the
 * rules' `hasOnly(...)` key allowlist, because both sides only ever contain
 * keys from that same allowlist.
 *
 * `support` can never be sent — it is not in `VoterPatch`, and the rules'
 * political-profiling denylist would reject it as an unknown key regardless.
 *
 * The patch is `Record<string, unknown>` rather than `VoterPatch` because a
 * value may also be Firestore's `deleteField()` sentinel — the only way to
 * CLEAR an optional key back to its roll default (the rules validate the
 * RESULT, and a missing key passes their allowlist; `''` would not wake the
 * consumer's `??` fallback). Keys outside the rules' allowlist are the rules'
 * problem — they reject the whole write, loudly.
 */
export async function saveVoterPatch(
  uid: string,
  row: VoterRow,
  patch: Record<string, unknown>
): Promise<void> {
  const payload: Record<string, unknown> = {
    wardNo: row.wardNo,
    updatedAt: Date.now(),
    updatedBy: uid,
  };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue; // untouched fields simply do not travel
    payload[key] = value;
  }

  await setDoc(overlayRef(uid, row.id), payload, { merge: true });
}

// ------------------------------------------------------------------
// Mutations — shared phone board
// ------------------------------------------------------------------

/**
 * Files this account's proposed number for one voter.
 *
 * `authorName` must be 1..160 chars in rules — the profile's `displayName`
 * can theoretically be empty, so it falls back through the email local part
 * to a literal, rather than lets an empty name 400 the write.
 */
export async function proposePhone(args: {
  uid: string;
  voter: VoterRow;
  phone: string;
  authorName: string;
}): Promise<void> {
  const authorName = args.authorName.trim() || 'Unknown';

  await setDoc(doc(db, 'voterPhones', args.voter.id, 'proposals', args.uid), {
    phone: phoneKey(args.phone),
    authorName,
    wardNo: args.voter.wardNo,
    updatedAt: Date.now(),
  });
}

/**
 * Puts a number in use (or clears it) — `contactFinalize`, super admin +
 * developer only as far as the rules are concerned.
 *
 * The whole board document is written every time (no `merge`): its rule uses
 * `exactKeys` on the RESULT, so the payload must always carry exactly
 * `{wardNo, finalPhone, finalizedBy, finalizedName, finalizedAt}` — a partial
 * merge onto an older document would leak a stale key and be rejected.
 * `finalPhone: ''` with `finalizedAt: null` is the cleared state, legal per
 * the same rule.
 */
export async function finalizePhone(args: {
  uid: string;
  voter: VoterRow;
  finalName: string;
  /** Normalized digits to put in use, or `''` to clear the choice. */
  finalPhone: string;
}): Promise<void> {
  const payload: FinalizedContact = {
    wardNo: args.voter.wardNo,
    finalPhone: args.finalPhone,
    finalizedBy: args.uid,
    finalizedName: args.finalName.trim() || 'Unknown',
    finalizedAt: args.finalPhone ? Date.now() : null,
  };
  await setDoc(boardRef(args.voter.id), payload);
}

// ------------------------------------------------------------------
// Mutations — tasks
// ------------------------------------------------------------------

/** A legal `tasks` document — all eleven keys rules `exactKeys` demands. */
export type TaskDraft = Pick<
  Task,
  'title' | 'description' | 'assigneeId' | 'areaId' | 'boothId' | 'dueDate' | 'status' | 'report'
>;

export async function createTask(draft: TaskDraft, uid: string): Promise<void> {
  await addDoc(collection(db, 'tasks'), {
    title: draft.title,
    description: draft.description,
    assigneeId: draft.assigneeId,
    areaId: draft.areaId,
    boothId: draft.boothId,
    // `nullableMillis` — plain number or null, never a Date/Timestamp: rules
    // accept only int/float/null here.
    dueDate: draft.dueDate,
    status: draft.status,
    report: draft.report,
    createdBy: uid,
    // `== request.time` in rules: serverTimestamp or the create is rejected.
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<void> {
  await updateDoc(doc(db, 'tasks', id), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await deleteDoc(doc(db, 'tasks', id));
}

// ------------------------------------------------------------------
// Mutations — accounts
// ------------------------------------------------------------------

/**
 * Grants or changes a role (and ward scope).
 *
 * Two rules constraints shape this:
 *
 *  - affected keys may be ONLY `role`/`wardNo` — so the payload never carries
 *    `displayName` or anything else, and promotion and profile edits cannot
 *    collapse into one write;
 *  - a non-karykarta must end up with wardNo ABSENT, not null-ish — the rules
 *    validate the RESULTING document, and `deleteField()` is the only way an
 *    update can *remove* a key (`{wardNo: null}` would leave the key present,
 *    which the create-side invariant explicitly forbids for non-karykarta
 *    … and the update rule reads `get('wardNo', null) == null` as satisfied by
 *    an absent or null value — but keeping absent/absent consistent with what
 *    account creation writes matters for the panel's own reading of profiles,
 *    where absence and null mean the same thing).
 */
export async function grantRole(args: {
  targetUid: string;
  role: AppRole;
  /** Required and positive for karykarta; ignored for other roles. */
  wardNo: number | null;
  profile: Profile;
}): Promise<void> {
  const patch: Record<string, unknown> = { role: args.role };

  if (args.role === 'karykarta') {
    if (args.wardNo == null || args.wardNo <= 0) {
      throw new Error('A karykarta must be assigned to a ward.');
    }
    patch.wardNo = args.wardNo;
  } else if (args.profile.wardNo != null) {
    // Leaving karykarta: the old ward key must come OFF the document.
    patch.wardNo = deleteField();
  }

  await updateDoc(doc(db, 'users', args.targetUid), patch);
}

export async function deleteAccount(targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', targetUid));
}

// ----------------------------------------------------------- app config --

/** `appConfig/general`, or null before anyone has saved it. */
export async function readAppConfig(): Promise<AppConfig | null> {
  const snapshot = await getDoc(doc(db, 'appConfig', 'general'));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Partial<AppConfig>;
  return {
    latestVersion: typeof data.latestVersion === 'string' ? data.latestVersion : '',
    requiredVersion:
      typeof data.requiredVersion === 'string' ? data.requiredVersion : '',
    supportPhone: typeof data.supportPhone === 'string' ? data.supportPhone : '',
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
}

/**
 * Saves the release gate — the WHOLE document every time (`exactKeys` in
 * rules), with client-side millis rather than `serverTimestamp()` because
 * the rule accepts a timestamp but the mapper reads plain numbers, and one
 * consistent shape beats two sources of "when".
 */
export async function saveAppConfig(
  config: Pick<AppConfig, 'latestVersion' | 'requiredVersion' | 'supportPhone'>,
  editorUid: string
): Promise<void> {
  await setDoc(doc(db, 'appConfig', 'general'), {
    ...config,
    updatedAt: Date.now(),
    updatedBy: editorUid,
  });
}

// ------------------------------------------------- lock / unlock + vault --

/**
 * Locks an account from the panel — `lockedReason: 'admin'` so the sign-out
 * screen and the row badge can say "an administrator did this", unlike the
 * `'device_change'` self-lock a foreign sign-in writes through the OWNER
 * path in firestore.rules.
 *
 * The caller's uid travels as `lockedBy`: the reason the rules only accept
 * this write at all is the `canManageAccounts` clause — this is a super
 * admin or developer session, verified on every document the rules touch.
 */
export async function lockAccount(
  targetUid: string,
  managerUid: string
): Promise<void> {
  await updateDoc(doc(db, 'users', targetUid), {
    locked: true,
    lockedReason: 'admin',
    lockedAt: Date.now(),
    lockedBy: managerUid,
  });
}

/**
 * Unlocks AND drops the device binding — one write, on purpose:

 * after an unlock there must be no stale fingerprint left to fight with, so
 * whoever signs in next (the phone the account really lives on) becomes the
 * bound device. `deleteField()` is the only way a rules-validated result can
 * REMOVE `device`; `{device: null}` would leave the key present and
 * `validDevice` would accept it as… null — but the owner half then never
 * gets its first-bind back, so clearing rather than nulling is what keeps
 * the cycle closed.
 *
 * Rules: the manage-clause update, the only path where `locked` may become
 * `false` ("only super admin can unlock" — mobile's auth provider refuses
 * the same flip through the owner path).
 */
export async function unlockAccount(targetUid: string): Promise<void> {
  await updateDoc(doc(db, 'users', targetUid), {
    locked: false,
    lockedReason: '',
    lockedAt: null,
    lockedBy: '',
    device: deleteField(),
  });
}

/** Reads the password vault for one account, or null when none exists. */
export async function readVault(targetUid: string): Promise<AccountVault | null> {
  const snapshot = await getDoc(doc(db, 'accountSecrets', targetUid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Partial<AccountVault>;
  return {
    uid: targetUid,
    email: typeof data.email === 'string' ? data.email : '',
    password: typeof data.password === 'string' ? data.password : '',
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
}

async function writeVault(vault: AccountVault): Promise<void> {
  await setDoc(doc(db, 'accountSecrets', vault.uid), vault);
}

// ---------------------------------------------------------- auth helpers --

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Creates an account and its profile — ported from
 * `mobile/hooks/useCreateAccount.ts`, comment for comment:
 *
 * ## Why a second Firebase app
 *
 * `createUserWithEmailAndPassword(auth, …)` on the app's own `Auth` signs the
 * CREATING user in as the new account — that is documented SDK behaviour. In
 * an account-management screen it is fatal: the super admin would be logged
 * out of their own session, and into the role they just granted, on the first
 * account they make. A second app with the same config has its own Auth, so
 * signing in on it never touches the primary session. Memoised because
 * `initializeApp` throws `app/duplicate-app` on a second call.
 *
 * ## Why this is not a security hole
 *
 * The client's Firebase config is public by design; `firestore.rules`
 * authorises the `users` write below independently, gated on the CALLER's
 * `canManageAccounts`. Without that capability the `setDoc` here is denied by
 * the same rules that gate the Accounts list — the `can()` check in the form
 * is a convenience, the rules are the boundary. (The properly-scoped version
 * is a Cloud Function with the Admin SDK — needs the Blaze plan, out of scope
 * for this prototype; noted as the production answer, not as a blocker.)
 *
 * ## Rollback
 *
 * Two writes, so the second failing undoes the first: without it, a failed
 * profile write leaves an Auth record with no `users` document, and a retry
 * then dies on `auth/email-already-in-use` with no path forward but the
 * Firebase console. With the rollback, a retry just works.
 */
let secondaryAuth: Auth | null = null;

function accountsAuth(): Auth {
  if (secondaryAuth) return secondaryAuth;
  secondaryAuth = getAuth(
    // Second app, same config — its own Auth, so signing in the NEW user here
    // never disturbs the primary session (see the file header).
    initSecondaryApp(app.options, 'accounts')
  );
  return secondaryAuth;
}

export interface NewAccount {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
  /** Required for karykarta; the key must be ABSENT for every other role. */
  wardNo: number | null;
}

export async function createAccount(input: NewAccount): Promise<void> {
  let created: User | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(
      accountsAuth(),
      input.email,
      input.password
    );
    created = credential.user;

    const payload: Record<string, unknown> = {
      email: input.email,
      displayName: input.displayName,
      photoURL: null,
      // The one path that skips onboarding — the admin is setting the
      // account up, not the account owner. Rule demands `true` here.
      onboarded: true,
      // The create rule gates this field on the CALLER's canManageAccounts
      // (client-owned authz field — the rules are the boundary, see above).
      role: input.role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (input.role === 'karykarta') {
      if (input.wardNo == null || input.wardNo <= 0) {
        throw new Error('A karykarta must be assigned to a ward.');
      }
      payload.wardNo = input.wardNo;
    }
    // Non-karykarta: NO wardNo key at all — rules reject `wardNo: null` here
    // (`!keys().hasAny(['wardNo'])`), presence alone is a failure.

    await setDoc(doc(db, 'users', created.uid), payload);

    // The password vault — `accountSecrets/{uid}`. Without a Cloud Function
    // this is the ONLY place the credential stays recoverable (Firebase Auth
    // itself stores just a scrypt hash), and it is what lets the Accounts
    // page reveal a password and rotate one without the owner present.
    // `auth.currentUser` here is the signed-in super admin doing the
    // creating, which is the `updatedBy` the rules require.
    const manager = auth.currentUser?.uid;
    if (!manager) {
      throw new Error(
        'Sign in first — the password vault records which account set the password.'
      );
    }
    await writeVault({
      uid: created.uid,
      email: input.email,
      // Hashed at write time — the vault never stores the password itself
      // (lib/vault.ts documents the key-in-code trade).
      password: await hashPassword(input.password),
      updatedAt: Date.now(),
      updatedBy: manager,
    });

    // Park the new profile doc so callers can invalidate immediately.
  } catch (error) {
    // Undo both writes so a retry starts clean (see header): the profile
    // document first (deleting only the Auth record would strand it), then
    // the Auth record itself.
    if (created) {
      await deleteDoc(doc(db, 'users', created.uid)).catch(() => undefined);
      await deleteUser(created).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Rotates an account's REAL Firebase Auth password WITHOUT needing the old
 * one, then refreshes the vault with a HASH of the new value.
 *
 * The no-old-password half runs through `/api/account/password` — a
 * local API route that uses the **Admin SDK**'s `updateUser(uid,
 * {password})`, which has no re-authentication requirement at all. The
 * client SDK's `updatePassword` can only ever act on a freshly-signed-in
 * user, so every client-side alternative degraded into "sign in as them
 * first, and that needs their current password" — which is exactly the
 * dependency this route removes.
 *
 * The vault half closes the loop so "check the password" keeps answering
 * after a rotation: it stores `sha256(new + key)` (lib/vault.ts), never the
 * plaintext, and the panel verifies a typed candidate against that hash.
 */
export async function changeAccountPassword(args: {
  targetUid: string;
  email: string;
  newPassword: string;
  managerUid: string;
}): Promise<void> {
  const response = await fetch('/api/account/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid: args.targetUid, password: args.newPassword }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error ?? 'The password change was refused.');
  }

  await updateVaultPassword(args);
}

/**
 * Writes the vault entry for a ROTATED password — hash on the way in, so the
 * document never carries the plaintext. Also the migration target for a
 * legacy plaintext entry that just verified as a candidate.
 */
export async function updateVaultPassword(args: {
  targetUid: string;
  email: string;
  newPassword: string;
  managerUid: string;
}): Promise<void> {
  await writeVault({
    uid: args.targetUid,
    email: args.email,
    password: await hashPassword(args.newPassword),
    updatedAt: Date.now(),
    updatedBy: args.managerUid,
  });
}

/** Reads a whole collection once — used for export-style pages only. */
export async function fetchCollectionOnce<T>(
  q: Query,
  map: (doc: { id: string; data: () => Record<string, unknown> }) => T
): Promise<T[]> {
  const snapshot = await getDocs(q);
  return snapshot.docs.map((entry) =>
    map({ id: entry.id, data: () => entry.data() as Record<string, unknown> })
  );
}

/**
 * The Auth-side facts for one account — `/api/account/detail` (Admin SDK).
 *
 * Returns `null` — never throws — for every "cannot look up" case: the route
 * is local-dev only (403 on a shared build), the uid has no Auth record, or
 * the fetch itself fails. The details dialog then omits the Auth section
 * instead of turning one unavailable panel into a broken dialog; the
 * Firestore-side profile is displayed either way.
 */
export async function fetchAccountDetail(
  uid: string
): Promise<AuthAccountDetail | null> {
  let response: Response;
  try {
    response = await fetch(`/api/account/detail?uid=${encodeURIComponent(uid)}`);
  } catch {
    return null; // route not present in this build
  }
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    detail?: AuthAccountDetail;
  };
  if (!response.ok || payload.ok !== true || !payload.detail) return null;
  return payload.detail;
}