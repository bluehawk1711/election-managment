/**
 * The bundled `RollSource` (plan-voters.md §2) — the default, and the whole
 * point of `scripts/generate-ward-bundles.ts`.
 *
 * Zero latency by construction: `getVoters` is a synchronous `require` under
 * an async signature, so `useRoll`'s "network pass" resolves in a microtask
 * and the list paints from data the APK already contains — first launch,
 * airplane mode, revoked rules, it does not matter. Writes are impossible
 * (a plain object read), which restates a server-side rule in the client: the
 * base roll is imported data, never client-editable. `database.rules.json`
 * grants no bulk read on `voters` at all, so even a compromised client could
 * not refetch it from the database.
 *
 * Everything a user changes still goes through the overlay, local-first —
 * this source has no opinion on it.
 */
import { bundledAllVoters, bundledVoters, bundledWards } from '@/lib/roll/bundled';
import type { RollSource, RollVoter, WardsBundle } from '@/lib/roll/types';

export const bundledSource: RollSource = {
  kind: 'bundled',

  async getWards(): Promise<WardsBundle> {
    const bundle = bundledWards();
    if (!bundle) {
      throw new Error(
        'Bundled roll not found (assets/roll/wards.json). Run `pnpm roll:bundle`.'
      );
    }
    return bundle;
  },

  async getVoters(wardNo: number | null): Promise<RollVoter[]> {
    if (wardNo == null) return bundledAllVoters();
    return bundledVoters(wardNo) ?? [];
  },
};
