/**
 * Firestore collection names — the single place the app, `firestore.rules`,
 * `scripts/seed.mjs` and `rules-tests/` agree on what exists.
 *
 * All campaign collections are SHARED: every signed-in user reads and writes
 * the same campaign documents (single-campaign prototype). `users` is the only
 * owner-scoped collection.
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
