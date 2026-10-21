/**
 * Every Realtime Database path and mutation the panel performs, in one file.
 *
 * Split by intent, not by collection:
 *
 *   *Reflections* — `build*Query`/`*Ref` return PATH STRINGS; they know
 *   nothing about React or React Query and are subscribed through
 *   `hooks/use-live.ts` from the pages.
 *
 *   *Mutations* — plain async functions that THROW on failure (with the raw
 *   Firebase error) so callers can react: mutation callbacks show toasts,
 *   `createAccount` implements its own rollback (see its comment). Nothing in
 *   here catches silently.
 *
 * ## Why paths, not `Query` objects
 *
 * Firestore's `Query` was a *server-side* description: the SDK sent it to
 * the backend, which could answer "the 50 documents matching this filter,
 * ordered by that field". RTDB has no equivalent — its queries are
 * `(orderByChild, limitToFirst, …)` tuples that can only order by one named
 * child and cannot express "sort by an arbitrary field, then take the first
 * N", which is what every list in this panel asks for.
 *
 * So the panel's reads are paths, and the filtering/sorting/limiting happens
 * in memory inside `lib/db/index.ts`. The cost is stated there honestly
 * (every child of the node is downloaded); for a campaign-scale roster it is
 * the right trade, and the alternative — one `.indexOn` per collection per
 * sort field — buys nothing a human roster of this size can feel.
 *
 * ## The node layout
 *
 * The paths below are the ones `mobile/database.rules` governs, so the panel
 * and the app read and write the SAME tree:
 *
 *     wards/{wardNo}                     imported roll metadata
 *     votersByWard/{wardNo}/{voterId}    the roll, sharded per ward
 *     users/{uid}                        the profile (role, device, lock)
 *     users/{uid}/voterEdits/{voterId}   the account-private edit overlay
 *     tasks/{taskId}                     fieldwork tasks
 *     teams/{teamId}                     the uid → displayName roster
 *     voterPhones/{voterId}              the finalized shared number
 *     voterPhones/{voterId}/proposals/{uid}
 *     appConfig/general                  the release gate
 *     accountSecrets/{uid}               the password vault
 *     areas/{areaId}                     campaign areas
 *
 * ## The single most load-bearing detail in this file
 *
 * **Every rules-coupled payload mirrors `mobile/database.rules` exactly** —
 * exact key sets, numbers where rules say `isNumber()`, and full-node writes
 * for the finalized phone board (whose rule validates the whole node, so a
 * partial merge would be rejected).
 */
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
import { app, auth } from '@/lib/firebase';
import { phoneKey, type FinalizedContact } from '@/lib/contacts';
import {
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onDoc,
  onDocs,
  setDoc,
  updateDoc,
  type DbData,
  type DbSnapshot,
} from '@/lib/db';
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
// Reflections (paths)
// ------------------------------------------------------------------

/** The roll for one ward — `votersByWard/{wardNo}`. */
export function buildVotersQuery(wardNo: number): string {
  // RTDB: equality on wardNo becomes a path assertion under votersByWard.
  // The roll is already sharded per-ward, so this is a single read.
  return `votersByWard/${wardNo}`;
}

/** The ward metadata — `wards`. */
export function buildWardsQuery(): string {
  // RTDB: no compound queries. Read the wards node and sort client-side.
  return 'wards';
}

/** The account roster — `users`. */
export function buildUsersQuery(): string {
  // RTDB: no compound queries. Read the users node and filter client-side.
  return 'users';
}

/**
 * Every team roster — the Teams dialog's list.
 *
 * The roster is super-admin-only in `database.rules`, so this read is denied
 * for anyone below (and the dialog is gated on the same capability locally,
 * which only spares them the permission-denied toast). Members have no
 * discovery path of their own by design: a karykarta reads the ONE roster
 * whose id matches their own `teamId`, never the collection.
 */
export function buildTeamsQuery(): string {
  return 'teams';
}

/** Every task — the Tasks page's list. */
export function buildTasksQuery(): string {
  // RTDB: no compound queries. Read tasks node and filter client-side.
  return 'tasks';
}

/**
 * Tasks assigned to one account — the "current load" line in the details
 * dialog.
 *
 * There is no `tasksByAssignee` index in the rules, so this is the whole
 * `tasks` node filtered by `assigneeId` in memory — the same trade
 * `lib/db`'s in-memory query makes everywhere else.
 */
export function buildAssignedTasksQuery(_uid: string): string {
  return 'tasks';
}

/** The signed-in account's own voter edits — the overlay the drawer merges. */
export function buildMyEditsQuery(uid: string): string {
  return `users/${uid}/voterEdits`;
}

/** The signed-in account's private overlay for one voter. */
export function overlayRef(uid: string, voterId: string): string {
  return `users/${uid}/voterEdits/${voterId}`;
}

/** The finalized shared number for one voter. */
export function boardRef(voterId: string): string {
  return `voterPhones/${voterId}`;
}

/** Every proposal filed for one voter. */
export function buildProposalsQuery(voterId: string): string {
  return `voterPhones/${voterId}/proposals`;
}

// ------------------------------------------------------------------
// Adaptive listeners for one-shot semantics (getDoc-shaped) pages use
// ------------------------------------------------------------------

/** Subscribes a single node; emits `null` while it does not exist. */
export function subscribeDocOrNull<T>(
  path: string,
  map: (doc: { id: string; data: () => Record<string, unknown> }) => T | null,
  emit: (value: T | null) => void,
  fail: (error: unknown) => void
): () => void {
  return onDoc(
    path,
    (snapshot) => {
      if (!snapshot.exists()) {
        emit(null);
        return;
      }
      emit(map({ id: snapshot.id, data: () => snapshot.data() }));
    },
    fail
  );
}

/**
 * Subscribes every child of a node, mapped to plain objects.
 *
 * The RTDB counterpart of Firestore's `onSnapshot(collection)`: one read of
 * the whole node, filtered/sorted in memory by `lib/db`. `fail` is only
 * honoured before the first emit, exactly as the Firestore version was.
 */
export function subscribeCollectionOf<T>(
  path: string,
  map: (entry: { id: string; data: () => Record<string, unknown> }) => T,
  emit: (data: T[]) => void,
  fail: (error: unknown) => void
): () => void {
  return onDocs(
    path,
    undefined,
    (rows) =>
      emit(rows.map((row) => map({ id: row.id, data: () => row.data() }))),
    fail
  );
}

// ------------------------------------------------------------------
// Mutations — voter overlay (account-private, mirroring sync.ts payloads)
// ------------------------------------------------------------------

/**
 * Writes an edit patch to the account's private overlay node.
 *
 * A MERGE, exactly as the Firestore version was: only CHANGED fields travel
 * (plus the three bookkeeping keys the rules require on every write), so the
 * overlay accumulates corrections the way `lib/roll/overlay.ts` merges a
 * local patch.
 *
 * `support` can never be sent — it is not in `VoterPatch`, and the rules'
 * political-profiling denylist would reject it as an unknown key regardless.
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
 * `authorName` must be 1..160 chars in the rules — the profile's
 * `displayName` can theoretically be empty, so it falls back through the
 * email local part to a literal, rather than lets an empty name 400 the
 * write.
 */
export async function proposePhone(args: {
  uid: string;
  voter: VoterRow;
  phone: string;
  authorName: string;
}): Promise<void> {
  const authorName = args.authorName.trim() || 'Unknown';

  await setDoc(`voterPhones/${args.voter.id}/proposals/${args.uid}`, {
    phone: phoneKey(args.phone),
    authorName,
    wardNo: args.voter.wardNo,
    updatedAt: Date.now(),
  });
}

/**
 * Puts a number in use (or clears it) — super admin + developer only as far
 * as the rules are concerned.
 *
 * The whole board node is written every time (no merge): its rule validates
 * the whole node, so the payload must always carry exactly
 * `{wardNo, finalPhone, finalizedBy, finalizedName, finalizedAt}` — a
 * partial merge onto an older node would leak a stale key and be rejected.
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
  await setDoc(boardRef(args.voter.id), payload as unknown as DbData);
}

// ------------------------------------------------------------------
// Mutations — tasks
// ------------------------------------------------------------------

/** A legal `tasks` node — the keys the rules validate. */
export type TaskDraft = Pick<
  Task,
  | 'title'
  | 'description'
  | 'assigneeId'
  | 'areaId'
  | 'boothId'
  | 'dueDate'
  | 'status'
  | 'report'
>;

export async function createTask(draft: TaskDraft, uid: string): Promise<void> {
  const now = Date.now();
  await addDoc('tasks', {
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
    createdAt: now,
    updatedAt: now,
  });
}

export async function setTaskStatus(
  id: string,
  status: TaskStatus
): Promise<void> {
  await updateDoc(`tasks/${id}`, {
    status,
    updatedAt: Date.now(),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await deleteDoc(`tasks/${id}`);
}

// ------------------------------------------------------------------
// Mutations — accounts
// ------------------------------------------------------------------

/**
 * Grants or changes a role (and ward scope).
 *
 * Two rules constraints shape this:
 *
 *  - the profile's `role` and `wardNo` are separate child rules in
 *    `database.rules`, and a non-karykarta must end up with wardNo ABSENT,
 *    not null-ish — the rules validate the RESULTING node, and a `null`
 *    child is not stored at all in RTDB, which is exactly the "absent"
 *    state the rule wants;
 *  - the ROLE ITSELF is authoritative only in the Auth custom claim, so the
 *    claim is set here too — otherwise the rules (which read
 *    `auth.token.role`) would keep the OLD role until the token refreshed.
 */
export async function grantRole(args: {
  targetUid: string;
  role: AppRole;
  /** Required and positive for karykarta; ignored for other roles. */
  wardNo: number | null;
  profile: Profile;
}): Promise<void> {
  if (args.role === 'karykarta') {
    if (args.wardNo == null || args.wardNo <= 0) {
      throw new Error('A karykarta must be assigned to a ward.');
    }
    await updateDoc(`users/${args.targetUid}`, {
      role: args.role,
      wardNo: args.wardNo,
      updatedAt: Date.now(),
    });
  } else {
    // Leaving karykarta: the old ward key must come OFF the node. RTDB
    // stores no `null` children, so writing `null` REMOVES the key — the
    // same outcome `deleteField()` had in Firestore.
    await updateDoc(`users/${args.targetUid}`, {
      role: args.role,
      wardNo: null,
      updatedAt: Date.now(),
    });
  }

  // Publish the new role onto the account's LOGIN TOKEN, not just its
  // profile: RTDB rules read `auth.token.role`, so a role change that stopped
  // here would keep enforcing the OLD role until the token refreshed.
  await publishClaims(args.targetUid);
}

/**
 * Republishes `users/{uid}` onto the account's Auth custom claims.
 *
 * The route reads the profile server-side and derives the claims from it, so
 * this call carries no payload that could forge one — the document the rules
 * already authorised is the only input. It is the second half of every
 * account-management mutation below: write the profile, then publish it.
 *
 * The refreshed token takes a minute or two to reach the target's device;
 * that lag is the cost of making roles revocable rather than baked into a
 * document (see `database.rules`'s header, which documents it honestly).
 */
async function publishClaims(targetUid: string): Promise<void> {
  const caller = auth.currentUser;
  if (!caller) {
    throw new Error('Sign in again — publishing claims needs the manager’s ID token.');
  }
  // The route is reachable in production, so it authorises the caller rather
  // than trusting the request body. A fresh token also carries the caller's
  // current role, which is what the route checks before writing anything.
  const token = await caller.getIdToken();
  const response = await fetch('/api/account/claims', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ uid: targetUid }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.error ?? 'The change could not be published to the account’s login token.'
    );
  }
}

export async function deleteAccount(targetUid: string): Promise<void> {
  await deleteDoc(`users/${targetUid}`);
}

// ----------------------------------------------------------- app config --

/** `appConfig/general`, or null before anyone has saved it. */
export async function readAppConfig(): Promise<AppConfig | null> {
  const snapshot = await getDoc('appConfig/general');
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
 * Saves the release gate — the WHOLE node every time, with client-side
 * millis because the rule accepts a number and the mapper reads plain
 * numbers, and one consistent shape beats two sources of "when".
 */
export async function saveAppConfig(
  config: Pick<AppConfig, 'latestVersion' | 'requiredVersion' | 'supportPhone'>,
  editorUid: string
): Promise<void> {
  await setDoc('appConfig/general', {
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
 * path in `database.rules`.
 */
export async function lockAccount(
  targetUid: string,
  managerUid: string
): Promise<void> {
  await updateDoc(`users/${targetUid}`, {
    locked: true,
    lockedReason: 'admin',
    lockedAt: Date.now(),
    lockedBy: managerUid,
    updatedAt: Date.now(),
  });

  // `locked` is a CLAIM, not just a document field: `database.rules` gates
  // every capability on `auth.token.locked`, and an RTDB rule cannot read
  // `/users/{uid}` from a rule anywhere else in the tree. Without this the
  // lock would be decorative — a modified client keeps its old token and
  // every write still passes until the token happens to refresh.
  await publishClaims(targetUid);
}

/**
 * Unlocks AND drops the device binding — one write, on purpose:
 *
 * after an unlock there must be no stale fingerprint left to fight with, so
 * whoever signs in next (the phone the account really lives on) becomes the
 * bound device. Writing `null` REMOVES the `device` child in RTDB (a `null`
 * child is not stored), which is exactly the "cleared" state the owner half
 * of the rule looks for.
 */
export async function unlockAccount(targetUid: string): Promise<void> {
  await updateDoc(`users/${targetUid}`, {
    locked: false,
    lockedReason: null,
    lockedAt: null,
    lockedBy: null,
    device: null,
    updatedAt: Date.now(),
  });

  // Clearing the lock is half of it — the other half is dropping
  // `auth.token.locked`, which is what every rule actually reads.
  await publishClaims(targetUid);
}

/**
 * Grants or revokes the multi-device exemption for one account.
 *
 * `multiDevice: true` lifts the single-device lock for THIS account: it may
 * sign in from any number of installs and never self-locks on a foreign one.
 * `multiDeviceBy`/`multiDeviceAt` are the audit trail the roster shows — who
 * granted it and when.
 */
export async function setMultiDevice(
  targetUid: string,
  value: boolean,
  managerUid: string
): Promise<void> {
  await updateDoc(`users/${targetUid}`, {
    multiDevice: value,
    multiDeviceBy: value ? managerUid : null,
    multiDeviceAt: value ? Date.now() : null,
    updatedAt: Date.now(),
  });
}

/**
 * Assigns (or clears) the team label for one account — profile AND roster.
 *
 * A `teamId` is a short string. Two accounts sharing a non-empty `teamId`
 * may READ each other's `voterEdits` overlay in the mobile app (the
 * `teamId` claim, and the `teamId` stamped on each edit, are what the rules
 * compare). `''` clears it — the account joins no team and shares nothing.
 *
 * Two nodes change together, which is why this is two writes rather than
 * the single write it started as:
 *
 *   - `users/{uid}.teamId` — membership. THIS is what the rules read.
 *   - `teams/{teamId}.members` — the uid → displayName roster the app pulls
 *     to discover teammates and attribute their edits by name. `/users` is
 *     admin-only, so the roster is the only member-readable discovery path;
 *     a stale roster entry costs a skipped pull, never a leak (the rules
 *     re-check membership per document).
 *
 * The writes are not atomic in RTDB — there is no cross-node batch — so the
 * order is: profile first, roster second. A crash between them leaves an
 * account whose `teamId` points at a roster that does not list it yet, which
 * the rules re-check anyway; the reverse order would leave a roster that
 * lists a member the rules would refuse to share with.
 */
export async function setTeam(
  targetUid: string,
  teamId: string,
  displayName: string
): Promise<void> {
  const trimmed = teamId.trim();

  // Resolve the CURRENT team so the account can be removed from its old
  // roster. A missing profile (deleted account mid-dialog) simply has no
  // old team.
  const snapshot = await getDoc(`users/${targetUid}`);
  const previousTeam = snapshot.exists()
    ? ((snapshot.data().teamId as string | undefined) ?? null)
    : null;
  const oldRoster =
    typeof previousTeam === 'string' &&
    previousTeam !== '' &&
    previousTeam !== trimmed
      ? previousTeam
      : null;

  await updateDoc(`users/${targetUid}`, {
    teamId: trimmed === '' ? null : trimmed,
    updatedAt: Date.now(),
  });

  if (oldRoster) {
    // Leaving a team: drop this uid from the old roster. Writing `null`
    // REMOVES the member key in RTDB, and every other member's entry
    // survives one member's departure.
    await updateDoc(`teams/${oldRoster}`, {
      [`members.${targetUid}`]: null,
      updatedAt: Date.now(),
    });
  }

  if (trimmed !== '') {
    // Joining (or staying on) a team: upsert this uid's entry. A merge, not
    // a whole-node write — a full write would replace every other member's
    // entry with this one.
    await setDoc(
      `teams/${trimmed}`,
      {
        members: {
          [targetUid]: displayName.trim() !== '' ? displayName.trim() : null,
        },
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  }

  // Team sharing is claim-driven for the same reason roles are: a reader
  // compares its own `auth.token.teamId` to the `teamId` stamped on a
  // teammate's edit, because an RTDB rule cannot look the team up.
  await publishClaims(targetUid);
}

/**
 * Creates a team — an EMPTY roster, ready for members.
 *
 * A team is nothing but `teams/{label}`: a uid → displayName map the mobile
 * app reads to discover who else it may see (and to attribute their edits by
 * name). Creating one does not put anybody on it; `setTeam` does that, one
 * account at a time.
 *
 * The existence check is not cosmetic: a merge-write upserts, which means a
 * second click on "Create" would silently open an existing team and its
 * members instead of refusing. "It already exists — add members to it" is a
 * much better answer than a roster that quietly changed under someone.
 */
export async function createTeam(teamId: string): Promise<void> {
  const label = teamId.trim();
  if (!label) throw new Error('A team label is required.');

  const existing = await getDoc(`teams/${label}`);
  if (existing.exists()) {
    throw new Error(
      `A team named "${label}" already exists — add members to it instead.`
    );
  }

  await setDoc(`teams/${label}`, { members: {}, updatedAt: Date.now() });
}

/**
 * Puts several accounts on one team, each through `setTeam` (which clears
 * the OLD roster when the account was on another team).
 *
 * Sequential rather than one big write: each `setTeam` reads the account's
 * current team first, and a read cannot be folded into a write. A dozen
 * accounts is a dozen round trips, which for a dialog someone presses once a
 * season is the right trade against a half-applied multi-account move.
 */
export async function addTeamMembers(
  teamId: string,
  members: readonly { uid: string; displayName: string }[]
): Promise<void> {
  for (const member of members) {
    await setTeam(member.uid, teamId, member.displayName);
  }
}

/** Takes several accounts off a team — `''` is the no-team state. */
export async function removeTeamMembers(
  teamId: string,
  members: readonly { uid: string; displayName: string }[]
): Promise<void> {
  for (const member of members) {
    await setTeam(member.uid, '', member.displayName);
  }
  // A roster left behind after its last member is gone reads as a team that
  // exists to the panel and to the `teams` list, with nobody on it.
  const remaining = await getDoc(`teams/${teamId}`);
  const map = remaining.exists()
    ? ((remaining.data().members as Record<string, string> | undefined) ?? {})
    : {};
  if (Object.keys(map).length === 0) {
    await deleteDoc(`teams/${teamId}`);
  }
}

/**
 * Deletes a team outright: every member's `teamId` is cleared first, then
 * the roster goes.
 *
 * Clearing first is the whole point — a deleted roster with profiles still
 * pointing at it would leave members whose edits are still shared while the
 * panel shows a team that no longer exists. Each clear goes through
 * `setTeam`, so the rules' `userId != request.auth.uid` guard still applies:
 * the super admin running this cannot strip their OWN team assignment here
 * (they never should — see the button's own tooltip), and the call reports
 * the refusal rather than skipping it silently.
 */
export async function deleteTeam(
  teamId: string,
  members: readonly { uid: string; displayName: string }[]
): Promise<void> {
  await removeTeamMembers(teamId, members);
  await deleteDoc(`teams/${teamId}`);
}

/** Reads the password vault for one account, or null when none exists. */
export async function readVault(
  targetUid: string
): Promise<AccountVault | null> {
  const snapshot = await getDoc(`accountSecrets/${targetUid}`);
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
  await setDoc(`accountSecrets/${vault.uid}`, vault as unknown as DbData);
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
 * The client's Firebase config is public by design; `database.rules`
 * authorises the `users` write below independently, gated on the CALLER's
 * role claim. Without that capability the write here is denied by the same
 * rules that gate the Accounts list — the `can()` check in the form is a
 * convenience, the rules are the boundary. (The properly-scoped version is
 * a Cloud Function with the Admin SDK — needs the Blaze plan, out of scope
 * for this prototype; noted as the production answer, not as a blocker.)
 *
 * ## Rollback
 *
 * Three writes — profile, vault, then claims — so a later failure undoes the
 * earlier ones. Without that, a failed profile write leaves an Auth record
 * with no `users` node, and a retry then dies on
 * `auth/email-already-in-use` with no path forward but the Firebase console.
 * With the rollback, a retry just works. The claims write comes last because
 * it is the one that makes the new login usable; a profile without claims
 * would sign in to the no-role empty state and look like a broken account.
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
      // The create rule gates this field on the CALLER's capability
      // (client-owned authz field — the rules are the boundary, see above).
      role: input.role,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (input.role === 'karykarta') {
      if (input.wardNo == null || input.wardNo <= 0) {
        throw new Error('A karykarta must be assigned to a ward.');
      }
      payload.wardNo = input.wardNo;
    }
    // Non-karykarta: NO wardNo key at all — the rule rejects a present
    // wardNo here, and RTDB stores no `null` children, so the key is simply
    // absent.

    // `merge` maps to RTDB's update(), which evaluates each child against its
    // own rule. A plain set() would be judged at `users/$uid`, whose only
    // `.write` is delete-only, so it is refused for EVERY caller — the exact
    // reason `mobile/hooks/useCreateAccount.ts` also uses `{ merge: true }`.
    await setDoc(`users/${created.uid}`, payload, { merge: true });

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

    // Put the role on the login token as well as the profile. RTDB rules read
    // `auth.token.role`, not `users/$uid`, so without this the account could
    // authenticate but every rule would treat it as having no role.
    await publishClaims(created.uid);
  } catch (error) {
    // Undo every write so a retry starts clean (see header): the profile and
    // vault nodes first (deleting only the Auth record would strand them),
    // then the Auth record itself.
    if (created) {
      await deleteDoc(`users/${created.uid}`).catch(() => undefined);
      await deleteDoc(`accountSecrets/${created.uid}`).catch(() => undefined);
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
 * node never carries the plaintext. Also the migration target for a
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

/** Reads a whole node's children once — used for export-style pages only. */
export async function fetchCollectionOnce<T>(
  path: string,
  map: (doc: { id: string; data: () => Record<string, unknown> }) => T
): Promise<T[]> {
  const rows: DbSnapshot[] = await getDocs(path);
  return rows.map((row) => map({ id: row.id, data: () => row.data() }));
}

/**
 * The Auth-side facts for one account — `/api/account/detail` (Admin SDK).
 *
 * Returns `null` — never throws — for every "cannot look up" case: the route
 * is local-dev only (403 on a shared build), the uid has no Auth record, or
 * the fetch itself fails. The details dialog then omits the Auth section
 * instead of turning one unavailable panel into a broken dialog; the
 * profile side is displayed either way.
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
