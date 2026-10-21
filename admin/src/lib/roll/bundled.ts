/**
 * The roll the panel serves to itself — `public/roll/*.json`, copied from
 * `mobile/assets/roll/` (written by mobile's `scripts/generate-ward-bundles.ts`).
 *
 * Why static files and not Firestore: `firestore.rules` gives no
 * collection-level read on the roll (`voters/$id` is get-by-ward only), which
 * is precisely why the old `/voters` page had to redirect to the audit. A
 * static asset has no rules, no per-ward fetch waterfall, and no cost model —
 * the same fixed artefact the APK bundles, one HTTP GET away. Re-seed = re-copy
 * the files from `mobile/assets/roll/` (both halves must stay byte-identical;
 * `mobile/scripts/generate-ward-bundles.ts` is the generator of record).
 *
 * Lazy per ward, the web mirror of mobile's `require()`-inside-a-function:
 * a ward's rows materialise on first ask, not at module load, and a page that
 * only ever shows ward 9 never downloads ward 4. The module cache makes a
 * re-render (search keystroke, ward switch back) free.
 */
import type { RollVoter, WardMeta, WardsBundle } from './types';

const ROLL_BASE = '/roll';

/** `9` → `09` — the files are zero-padded. */
function wardFile(wardNo: number): string {
  return `${WARD_PAD[wardNo] ?? String(wardNo).padStart(2, '0')}`;
}

/** Inline pad map: pure, avoids a String allocation per render. */
const WARD_PAD: Record<number, string> = Object.fromEntries(
  Array.from({ length: 99 }, (_, i) => [i + 1, String(i + 1).padStart(2, '0')])
);

/** `voterId` → the bundled portrait URL — always a string, 404-tolerant. */
export function photoUrlFor(voterId: string, wardNo: number): string {
  // Portraits are keyed by voter id inside a per-ward folder — the same
  // convention `mobile/lib/roll/photos.ts` uses with static requires. A
  // missing file 404s into the <img> error handler, which falls back to the
  // placeholder box; there is no manifest to consult (7 001 entries would be
  // a 200 KB JSON for a question the error event already answers).
  return `/photos/ward-${wardFile(wardNo)}/${voterId}.jpg`;
}

/** The ward metadata bundle — fetched once per session. */
let wardsPromise: Promise<WardsBundle> | null = null;

export function getWards(): Promise<WardsBundle> {
  wardsPromise ??= fetch(`${ROLL_BASE}/wards.json`).then((response) => {
    if (!response.ok) throw new Error(`wards.json ${response.status}`);
    return response.json() as Promise<WardsBundle>;
  });
  return wardsPromise;
}

/** `wardNo → that ward's rows`, one in-flight fetch each. */
const wardCache = new Map<number, Promise<RollVoter[]>>();

/** One ward's voters. Cached forever — the bundle is a fixed artefact. */
export function getWardVoters(wardNo: number): Promise<RollVoter[]> {
  let pending = wardCache.get(wardNo);
  if (!pending) {
    pending = fetch(`${ROLL_BASE}/ward-${wardFile(wardNo)}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`ward-${wardNo}.json ${response.status}`);
        return response.json() as Promise<{ wardNo: number; voters: RollVoter[] }>;
      })
      .then((bundle) => bundle.voters);
    wardCache.set(wardNo, pending);
  }
  return pending;
}

/**
 * Every ward's voters, loaded once and shared. The search index spans the
 * whole roll (a name is not filed under a ward in anyone's head), so the
 * list page pays the 3.8 MB once — over HTTP, cacheable, and in parallel —
 * instead of the sequential Firestore waterfall this replaced.
 */
let allVotersPromise: Promise<RollVoter[]> | null = null;

export function getAllVoters(): Promise<RollVoter[]> {
  allVotersPromise ??= getWards().then(async (bundle) => {
    const perWard = await Promise.all(
      bundle.wards.map((ward: WardMeta) => getWardVoters(ward.wardNo))
    );
    return perWard.flat();
  });
  return allVotersPromise;
}
