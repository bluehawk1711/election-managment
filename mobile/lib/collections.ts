/**
 * Realtime Database node names — the single place the app, `database.rules.json`
 * and `scripts/seed-rtdb.mjs` agree on what exists.
 *
 * All campaign nodes are SHARED: every signed-in user reads and writes the same
 * campaign data (single-campaign prototype). `users` is the only owner-scoped
 * node. The `voters` entry is a special case — it names the node the seeding
 * script fills, but the APP never reads it in bulk; the roll is bundled. See
 * `lib/roll/source.ts`.
 */
export const COLLECTIONS = {
  campaigns: 'campaigns',
  constituencies: 'constituencies',
  wards: 'wards',
  areas: 'areas',
  booths: 'booths',
  voters: 'voters',
  teamMembers: 'teamMembers',
  tasks: 'tasks',
  issues: 'issues',
  events: 'events',
  expenses: 'expenses',
  compliance: 'compliance',
  users: 'users',
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;

/** The one campaign document this prototype talks about. */
export const CAMPAIGN_ID = 'active';

/** Default page size for shared collections — prototypes are not warehouses. */
export const DEFAULT_LIMIT = 500;
