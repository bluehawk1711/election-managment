/**
 * Overlay ⇄ Firestore sync — "my edits follow my account" (plan-voters.md §4,
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
 *   pull  — the whole `voterEdits` collection (one `getDocs`) is merged into
 *           the local ward overlays with per-voter last-writer-wins
 *           (`mergeRemoteWard`), which is also what re-downloading this
 *           device's own pushes resolves to: a no-op.
 *
 * Scope: **the editor's own account only** — a subcollection under
 * `users/{uid}`, so a karykarta's fieldwork is visible on every device they
 * sign into and to nobody else. `firestore.rules` enforces exactly that.
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
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  loadQueue,
  loadWardOverlay,
  mergeRemoteWard,
  overlayStorage,
  removeFromQueue,
} from '@/lib/roll/overlay';
import type { VoterOverlay } from '@/lib/roll/types';

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
 * Writes every queued edit to Firestore and dequeues the ones that landed.
 * Returns how many documents were written. Never throws — an offline device
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
        await setDoc(
          doc(db, 'users', uid, 'voterEdits', entry.voterId),
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

  const snapshot = await getDocs(collection(db, 'users', uid, 'voterEdits'));
  const byWard = new Map<number, Record<string, VoterOverlay>>();

  for (const change of snapshot.docs) {
    const data = change.data() as VoterOverlay & { wardNo?: number };
    const wardNo = data.wardNo;
    if (typeof wardNo !== 'number' || !Number.isFinite(wardNo)) continue;
    const { wardNo: _dropped, ...overlay } = data;
    if (typeof overlay.updatedAt !== 'number') continue;
    const group = byWard.get(wardNo) ?? {};
    // The document id IS the voter id (written that way in `pushEdits`).
    group[change.id] = overlay as VoterOverlay;
    byWard.set(wardNo, group);
  }

  for (const [wardNo, remote] of byWard) {
    await mergeRemoteWard(overlayStorage, wardNo, remote);
  }
  return snapshot.size;
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