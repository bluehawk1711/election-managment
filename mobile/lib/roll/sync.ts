/**
 * Overlay ⇄ Realtime Database sync — "my edits follow my account" (plan-voters.md §4,
 * the sync phase the plan deferred until now).
 *
 * Storage stays local-first: `lib/roll/overlay.ts` is still the write path and
 * AsyncStorage is still what a screen reads. This module only mirrors the
 * overlay to `users/{uid}/voterEdits/{voterId}`:
 *
 *   push  — every entry in the overlay queue (`roll:queue`) is written as the
 *           voter's full remote overlay, then dequeued. A failed write keeps
 *           its entry, so the next sync retries; nothing is ever dropped by a
 *           flaky connection.
 *   pull  — the whole `voterEdits` node (one `once('value')`) is merged into
 *           the local ward overlays with per-voter last-writer-wins
 *           (`mergeRemoteWard`), which is also what re-downloading this
 *           device's own pushes resolves to: a no-op.
 *
 * Scope: **the editor's own account only** — a node under
 * `users/{uid}/voterEdits`, so a karykarta's fieldwork is visible on every device
 * they sign into and to nobody else. RTDB rules enforce exactly that.
 *
 * Three overlay fields deliberately do NOT travel:
 *
 *   support      `firestore.rules` §2 bans political profiling keys on every
 *                client-writable path, and `support` (with us / against us) is
 *                on that banlist — the boundary holds for this collection too.
 *   photoUrl     when it is a `file://`/`data:` URI it only exists on the
 *                device that captured it; syncing it would paint a dead path
 *                onto every other device. Only `https?://` (Cloudinary)
 *                uploads travel — which `plan-voters.md` §8 already defined as
 *                the durable form.
 *   location…    travels as-is (JSON-safe flat numbers + optional string).
 *
 * Everything is fire-and-forget at the call sites (`void syncVoterEdits()`):
 * a screen must render and save whether or not the network is there.
 */
import { auth } from '@/lib/firebase';
import { getDoc, getDocs, setDoc } from '@/lib/db';
import {
  loadQueue,
  loadWardOverlay,
  mergeRemoteWard,
  overlayStorage,
  removeFromQueue,
} from '@/lib/roll/overlay';
import type { VoterOverlay } from '@/lib/roll/types';
import {
  replaceTeamOverlay,
  teamOverlayStorage,
  type TeamOverlayMap,
} from '@/lib/roll/team-overlay';

/**
 * Overlay keys that may leave the device, mirroring `VoterOverlay` minus
 * bookkeeping (`updatedAt`/`updatedBy` are added below) minus `support`
 * minus non-http `photoUrl`/`photoPublicId`.
 *
 * Kept as an explicit allowlist because `firestore.rules` rejects anything
 * outside its own allowlist — the two lists must agree, and a name that does
 * not exist server-side fails loudly here first.
 */
const PUSHED_KEYS = [
  'name',
  'fatherOrHusbandName',
  'houseNo',
  'age',
  'gender',
  'locality',
  'phone',
  'jati',
  'location',
  'photoUrl',
  'photoPublicId',
  'voted',
  'leaning',
  'leaningNote',
  'note',
] as const satisfies readonly (keyof VoterOverlay)[];

const HTTP_URL = /^https?:\/\//;

/** Local overlay → the `users/{uid}/voterEdits/{voterId}` document shape. */
function remotePayload(
  overlay: VoterOverlay,
  wardNo: number
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    wardNo,
    updatedAt: overlay.updatedAt,
    // The author, which for this private collection is normally — but not
    // necessarily — the pushing uid (a shared device that never ran
    // "reset local edits" can carry another account's edits in the queue).
    updatedBy: overlay.updatedBy,
  };
  for (const key of PUSHED_KEYS) {
    const value = overlay[key];
    if (value === undefined) continue;
    if (key === 'photoUrl' && typeof value === 'string' && !HTTP_URL.test(value)) {
      continue;
    }
    if (key === 'photoPublicId' && value === undefined) continue;
    payload[key] = value;
  }
  return payload;
}

/** Serialises callers: one push flight at a time. */
let pushing: Promise<number> | null = null;

/**
 * Writes every queued edit to Realtime Database and dequeues the ones that landed.
 * Returns how many references were updated. Never throws — an offline device
 * simply keeps its queue.
 */
export async function pushEdits(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  if (pushing) return pushing;

  pushing = (async () => {
    const entries = await loadQueue(overlayStorage);
    let written = 0;
    for (const entry of entries) {
      const ward = await loadWardOverlay(overlayStorage, entry.wardNo);
      const overlay = ward[entry.voterId];
      if (!overlay) {
        // The overlay was cleared (Settings → reset) while queued: the edit no
        // longer exists locally, so there is nothing to push. Drop the entry —
        // but do NOT delete a remote doc here; a reset is local, not a request
        // to erase the account's copy on every device.
        await removeFromQueue(overlayStorage, entry.voterId);
        continue;
      }
      try {
        // A MERGE, exactly as the Firestore version was — `setDoc(…, { merge:
        // true })`. Deliberately NOT a compare-and-set: nothing here was ever
        // conditional, and quietly turning a storage port into a
        // concurrency-control change is the sort of swap that surfaces weeks
        // later as "one of my edits disappeared". `lib/db`'s `writeIfUnchanged`
        // is there if a genuinely conditional write is ever wanted; this is
        // not the place for one.
        await setDoc(
          `users/${uid}/voterEdits/${entry.voterId}`,
          remotePayload(overlay, entry.wardNo),
          { merge: true }
        );
        await removeFromQueue(overlayStorage, entry.voterId);
        written += 1;
      } catch {
        // Offline or rules rejection: the entry stays queued and the next
        // sync retries. Loop continues so one bad voter cannot stall the rest.
      }
    }
    return written;
  })().finally(() => {
    pushing = null;
  });

  return pushing;
}

/** Downloads this account's edits and merges them into the local overlays. */
export async function pullEdits(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;

  const rows = await getDocs(`users/${uid}/voterEdits`);
  const byWard = new Map<number, Record<string, VoterOverlay>>();
  let pulled = 0;

  for (const row of rows) {
    const data = row.data();
    const wardNo = data.wardNo;
    if (typeof wardNo !== 'number' || !Number.isFinite(wardNo)) continue;
    if (typeof data.updatedAt !== 'number') continue;

    // `wardNo` is grouping metadata, not an overlay field — the Firestore
    // version destructured it OUT here, and carrying it back in would write a
    // key `VoterOverlay` does not declare into the local store on every pull.
    const { wardNo: _grouped, ...overlay } = data;

    const group = byWard.get(wardNo) ?? {};
    // `unknown` first: a `Record<string, unknown>` coming off the wire has no
    // structural overlap with `VoterOverlay`'s optional fields, so the direct
    // cast is refused — and rightly so, as a compile-time reminder that what
    // actually validates these keys and types is `database.rules`, not TS.
    group[row.id] = overlay as unknown as VoterOverlay;
    byWard.set(wardNo, group);
    pulled += 1;
  }

  for (const [wardNo, remote] of byWard) {
    await mergeRemoteWard(overlayStorage, wardNo, remote);
  }
  // Count of VOTERS, not of wards — this number is reported as "pulled N".
  return pulled;
}

/**
 * Downloads TEAMMATES' edits into the read-only team layer.
 *
 * Two accounts sharing a non-empty `teamId` may read each other's
 * `voterEdits` (RTDB rules `sameTeam`). Membership itself lives on
 * profiles, but the roster cannot be discovered by querying `/users` — that
 * collection's `list` rule is `canViewAccounts` (admin and up), so a
 * karykarta's `where('teamId', '==', …)` would be PERMISSION_DENIED and this
 * feature would silently do nothing for exactly the users it exists for.
 *
 * The `teams/{teamId}` roster doc is the way out: a uid → displayName map the
 * account managers maintain, readable by a member in one `get()` (its rule
 * matches the doc id against the caller's own `teamId`). No collection scan,
 * no profile exposure, and the roster is a HINT, not truth — actual reads of
 * each member's `voterEdits` are still gated per-document by `sameTeam`, so a
 * stale roster entry costs a denied query at worst, never a leaked document.
 *
 * Every step is best-effort and returns 0 on any failure: a member with no
 * team, a rules rejection, or an offline device all leave the previous team
 * layer untouched rather than clearing it. The one deliberate clear is the
 * no-team case — a member removed from their team must not keep seeing the
 * old teammates' data on this device.
 *
 * Returns how many teammate nodes were pulled.
 */
export async function pullTeamEdits(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;

  // 1. The caller's own team. No team → nothing to share; clear the layer so a
  //    just-removed member's data does not linger on this device.
  const me = await getDoc(`users/${uid}`);
  const teamId = me.exists() ? (me.data() as { teamId?: string }).teamId : undefined;
  if (typeof teamId !== 'string' || teamId === '') {
    await replaceTeamOverlay(teamOverlayStorage, {});
    return 0;
  }

  // 2. The roster: uid → displayName, readable because the doc id equals the
  //    caller's own teamId. A missing roster (team assigned before this doc
  //    existed) clears the layer — there is nothing to pull, and inventing a
  //    roster from profiles is exactly the query the rules forbid.
  const rosterSnap = await getDoc(`teams/${teamId}`);
  const members: Record<string, string> = rosterSnap.exists()
    ? ((rosterSnap.data() as { members?: Record<string, string> }).members ?? {})
    : {};

  const entries: TeamOverlayMap = {};
  let pulled = 0;

  for (const [memberUid, authorName] of Object.entries(members)) {
    if (memberUid === uid) continue; // own edits already live in the ward overlay

    // Rules evaluate `sameTeam` per returned row, so this read only ever
    // yields visible teammates' documents — the roster hint cannot widen it.
    // A denied read throws, and the caller's best-effort contract means the
    // previous team layer survives rather than being cleared.
    const edits = await getDocs(`users/${memberUid}/voterEdits`);

    for (const edit of edits) {
      // Same `unknown` hop as `pullEdits` — rules validate, not the compiler.
      const overlay = edit.data() as unknown as VoterOverlay;
      if (typeof overlay.updatedAt !== 'number') continue;
      entries[edit.id] = {
        overlay,
        authorUid: memberUid,
        authorName: typeof authorName === 'string' && authorName !== '' ? authorName : null,
      };
      pulled += 1;
    }
  }

  await replaceTeamOverlay(teamOverlayStorage, entries);
  return pulled;
}

/** The single-flight guard for `syncVoterEdits`. */
let syncing: Promise<void> | null = null;
let lastRan = 0;

/**
 * Push, then pull. Call it from anywhere, fire-and-forget
 * (`void syncVoterEdits()`), any number of times:
 *
 *  - signed out → a no-op;
 *  - already running → the in-flight promise is returned;
 *  - throttled to one run per `THROTTLE_MS` unless `force` (the mount effect
 *    of five screens mounting at once must not become five round-trips).
 */
export async function syncVoterEdits(options: { force?: boolean } = {}): Promise<void> {
  if (!auth.currentUser) return;
  if (syncing) return syncing;
  const now = Date.now();
  const THROTTLE_MS = 30_000;
  if (!options.force && now - lastRan < THROTTLE_MS) return;

  syncing = (async () => {
    // Push first: this device's pending queue is the smaller, more fragile
    // side, and pushing before pulling means a successful push of edit A is
    // immediately re-read as remote-newer… which is a no-op merge anyway
    // (same `updatedAt`), so ordering costs nothing and protects an offline
    // queue from being starved by a large pull.
    await pushEdits().catch(() => 0);
    await pullEdits().catch(() => 0);
    // Teammates last: it is a read-only cache and must never block or
    // gate the owner's own push/pull above.
    await pullTeamEdits().catch(() => 0);
  })().finally(() => {
    lastRan = Date.now();
    syncing = null;
  });

  return syncing;
}

/** Test seam: forget the throttle/single-flight guards. */
export function __resetSyncGuards(): void {
  syncing = null;
  pushing = null;
  lastRan = 0;
}