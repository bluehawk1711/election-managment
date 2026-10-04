/**
 * The roll bundled inside the APK — `assets/roll/*.json`, written by
 * `scripts/generate-ward-bundles.ts`.
 *
 * Why this exists: every launch used to pay a Firestore fetch before the
 * first row could paint, and a cold device with no network painted nothing.
 * The roll is a *fixed* artefact (one PDF extraction, 6,855 rows) — it can
 * simply ship with the app, so the first-ever launch renders from data that
 * is already resident. Edits never touch it; they live in the local overlay
 * (`lib/roll/overlay.ts`), which is local-only too — the base row stays
 * byte-identical to the CSVs it came from.
 *
 * `require` rather than static `import`: Metro bundles all thirteen files
 * either way (the paths are literal), but a `require` inside a function only
 * *executes* — parses and materialises the object — when that ward is first
 * asked for. Cold start holds one ward in memory, not thirteen.
 *
 * The JSON modules are `any`-typed on purpose: `resolveJsonModule` would
 * otherwise infer literal types for ~6,855 nested row objects, which makes
 * `tsc` crawl for no benefit. The assertions below are the contract.
 */
import type { RollVoter, WardsBundle } from '@/lib/roll/types';

interface WardBundle {
  wardNo: number;
  voters: RollVoter[];
}

export const BUNDLE_WARD_COUNT = 13;

/**
 * `wardNo → require()` of that ward's file. The `require` calls are literal
 * so Metro's static analysis can see every file; execution is deferred to
 * first use.
 */
const WARD_LOADERS: Record<number, () => unknown> = {
  1: () => require('../../assets/roll/ward-01.json'),
  2: () => require('../../assets/roll/ward-02.json'),
  3: () => require('../../assets/roll/ward-03.json'),
  4: () => require('../../assets/roll/ward-04.json'),
  5: () => require('../../assets/roll/ward-05.json'),
  6: () => require('../../assets/roll/ward-06.json'),
  7: () => require('../../assets/roll/ward-07.json'),
  8: () => require('../../assets/roll/ward-08.json'),
  9: () => require('../../assets/roll/ward-09.json'),
  10: () => require('../../assets/roll/ward-10.json'),
  11: () => require('../../assets/roll/ward-11.json'),
  12: () => require('../../assets/roll/ward-12.json'),
  13: () => require('../../assets/roll/ward-13.json'),
};

/** The ward metadata bundle, or `null` if the generator has never run. */
export function bundledWards(): WardsBundle | null {
  try {
    return require('../../assets/roll/wards.json') as WardsBundle;
  } catch {
    return null;
  }
}

/**
 * One ward's bundled rows, or `null` when the ward is not in the bundle.
 *
 * The array is shared with the caller (module cache), which is safe: the base
 * roll is read-only by contract — `mergeVoter` copies, and nothing writes
 * through a `RollVoter`.
 */
export function bundledVoters(wardNo: number): RollVoter[] | null {
  const load = WARD_LOADERS[wardNo];
  if (!load) return null;
  try {
    const bundle = load() as WardBundle;
    return bundle.voters ?? null;
  } catch {
    // Bundle missing (generator never ran, or a partial install). The caller
    // falls through to whatever source is next — never a crash.
    return null;
  }
}

/** Every bundled row, in ward order — for `eager` callers and `wardNo: null`. */
export function bundledAllVoters(): RollVoter[] {
  const rows: RollVoter[] = [];
  for (let wardNo = 1; wardNo <= BUNDLE_WARD_COUNT; wardNo += 1) {
    const ward = bundledVoters(wardNo);
    if (ward) rows.push(...ward);
  }
  return rows;
}
