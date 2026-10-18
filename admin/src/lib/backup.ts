/**
 * "Backup everything" — one JSON file, downloaded from the browser.
 *
 * Every top-level collection the rules define, plus the two subcollections
 * that carry per-account state (`users/{uid}/voterEdits`, the audit surface,
 * and `voterPhones/{id}/proposals`). Reads reuse the SIGNED-IN session's
 * permissions — a developer running a backup holds `dataTools`,
 * `accountView` (the roster + each user's edits) and `voterRead` (the roll),
 * which is exactly the union the panel is allowed to see anyway. Nothing new
 * becomes readable here; this only serializes what the session already can.
 *
 * Why not an Admin-SDK export: that would mean a server holding the service
 * key for a *download* — the same local-dev-only posture as the seed route
 * applies there, and a client-side export needs no key at all. `voters` is
 * 6,855 small documents — one `getDocs`, seconds, fine for a prototype
 * backup.
 *
 * The file is produced as a Blob and handed to an `<a download>` click:
 * no server round-trip, no staging area, nothing to clean up.
 */
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** Everything with documents worth keeping, in a stable print order. */
export const BACKUP_COLLECTIONS = [
  'campaigns',
  'constituencies',
  'wards',
  'areas',
  'booths',
  'voters',
  'teamMembers',
  'tasks',
  'issues',
  'events',
  'expenses',
  'compliance',
  'users',
  'appConfig',
  'accountSecrets',
  'voterPhones',
] as const;

export interface BackupOutcome {
  /** The downloaded filename. */
  name: string;
  /** Blob size in bytes, for the toast. */
  bytes: number;
  /** Per-collection document counts (including subcollections). */
  counts: Record<string, number>;
}

interface FlatDoc {
  id: string;
  [key: string]: unknown;
}

async function flatDocs(...path: string[]): Promise<FlatDoc[]> {
  // `collection(db, path, …)` in this firebase version takes the FIRST
  // segment as a plain string, so the array cannot go in as one spread.
  const [root, ...rest] = path;
  const snapshot = await getDocs(collection(db, root, ...rest));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

/** Serializes the whole project state and triggers a browser download. */
export async function exportBackup(): Promise<BackupOutcome> {
  const counts: Record<string, number> = {};
  const collections: Record<string, FlatDoc[]> = {};

  for (const name of BACKUP_COLLECTIONS) {
    const docs = await flatDocs(name);
    collections[name] = docs;
    counts[name] = docs.length;
  }

  // users/{uid}/voterEdits — the per-account change overlays (the audit).
  const voterEdits: Record<string, FlatDoc[]> = {};
  for (const user of collections.users ?? []) {
    const docs = await flatDocs('users', user.id, 'voterEdits');
    if (docs.length > 0) {
      voterEdits[user.id] = docs;
      counts[`users/${user.id}/voterEdits`] = docs.length;
    }
  }

  // voterPhones/{id}/proposals — one proposal per proposing account.
  const proposals: Record<string, FlatDoc[]> = {};
  for (const board of collections.voterPhones ?? []) {
    const docs = await flatDocs('voterPhones', board.id, 'proposals');
    if (docs.length > 0) {
      proposals[board.id] = docs;
      counts[`voterPhones/${board.id}/proposals`] = docs.length;
    }
  }

  const payload = {
    format: 'campaign-hq-backup/1',
    exportedAt: new Date().toISOString(),
    collections,
    subcollections: { voterEdits, proposals },
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const name = `campaign-backup-${new Date().toISOString().slice(0, 10)}.json`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously after the click can cancel the download in some
  // browsers — one macrotask later is the standard grace period.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { name, bytes: blob.size, counts };
}