/**
 * "Backup everything" — one JSON file, downloaded from the browser.
 *
 * Every top-level node the rules define, plus the two sub-nodes that carry
 * per-account state (`users/{uid}/voterEdits`, the audit surface, and
 * `voterPhones/{id}/proposals`). Reads reuse the SIGNED-IN session's
 * permissions — a developer running a backup holds `dataTools`,
 * `accountView` (the roster + each user's edits) and the roll tier, which is
 * exactly the union the panel is allowed to see anyway. Nothing new becomes
 * readable here; this only serializes what the session already can.
 *
 * ## Why the roll is NOT in here
 *
 * The Firestore version pulled `voters` as a collection. `database.rules`
 * denies that read in RTDB (and always did in `firestore.rules`): the roll is
 * ward-scoped per document, and "read every voter" has no client-side path at
 * all — `votersByWard/{wardNo}` is the only read, one ward at a time, and
 * `voters/$id` outright refuses a collection read. A backup that silently
 * omitted 6 855 rows would be worse than one that says so, and one that
 * fetched them would be exactly the bulk read the panel exists to avoid.
 * Re-import the roll from `mobile/scripts/seed-rtdb.mjs` instead — it is the
 * authoritative copy of an official document, not of anybody's work.
 *
 * Why not an Admin-SDK export: that would mean a server holding the service
 * key for a *download* — the same local-dev-only posture as the seed route
 * applies there, and a client-side export needs no key at all.
 *
 * The file is produced as a Blob and handed to an `<a download>` click:
 * no server round-trip, no staging area, nothing to clean up.
 */
import { getChildren } from '@/lib/db';

/**
 * Everything with nodes worth keeping, in a stable print order.
 *
 * The names are RTDB TOP-LEVEL NODES, not Firestore collections — `appConfig`
 * and `accountSecrets` hold exactly one child each (`general` / the per-uid
 * entries), which is why they read back as arrays of one entry below.
 */
export const BACKUP_NODES = [
  'campaigns',
  'constituencies',
  'wards',
  'areas',
  'booths',
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
  /** Per-node child counts (including sub-nodes). */
  counts: Record<string, number>;
}

interface FlatEntry {
  id: string;
  [key: string]: unknown;
}

/**
 * One node's children as `{ id, …fields }` rows.
 *
 * `getChildren` already flattens RTDB's one shape quirk — a node keyed by
 * integers arrives as an ARRAY (`wards` is keyed `"1".."13"`) — so this never
 * sees it; it only spreads the fields beside the key.
 */
async function flatEntries(path: string): Promise<FlatEntry[]> {
  return (await getChildren(path)).map((row) => ({ id: row.id, ...row.data() }));
}

/** Serializes the whole project state and triggers a browser download. */
export async function exportBackup(): Promise<BackupOutcome> {
  const counts: Record<string, number> = {};
  const nodes: Record<string, FlatEntry[]> = {};

  for (const name of BACKUP_NODES) {
    const entries = await flatEntries(name);
    nodes[name] = entries;
    counts[name] = entries.length;
  }

  // users/{uid}/voterEdits — the per-account change overlays (the audit).
  const voterEdits: Record<string, FlatEntry[]> = {};
  for (const user of nodes.users ?? []) {
    const entries = await flatEntries(`users/${user.id}/voterEdits`);
    if (entries.length > 0) {
      voterEdits[user.id] = entries;
      counts[`users/${user.id}/voterEdits`] = entries.length;
    }
  }

  // voterPhones/{id}/proposals — one proposal per proposing account.
  const proposals: Record<string, FlatEntry[]> = {};
  for (const board of nodes.voterPhones ?? []) {
    const entries = await flatEntries(`voterPhones/${board.id}/proposals`);
    if (entries.length > 0) {
      proposals[board.id] = entries;
      counts[`voterPhones/${board.id}/proposals`] = entries.length;
    }
  }

  const payload = {
    format: 'campaign-hq-backup/2',
    exportedAt: new Date().toISOString(),
    // The roll is absent by design — see the header.
    note: 'The voter roll is not part of this backup: it is imported reference data (seed-rtdb.mjs), not work product.',
    nodes,
    subnodes: { voterEdits, proposals },
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
