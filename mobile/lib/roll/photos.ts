/**
 * Bundled roll portraits — the official election-roll photos extracted from
 * `data/VeerNagar-photos.pdf` into `assets/photos/` (see EXTRACTION.md §Step 7
 * and `tools/export_photos_to_app.py`).
 *
 * Why bundled rather than uploaded: the roll photos exist for every voter
 * before anyone edits anything, ~7000 files at ~3 KB, and a karykarta needs
 * them standing in a lane with no data. They are keyed by the roll's own
 * voter id (`w{ward}-{serial}` — identical semantics to `RollVoter.id`), so
 * lookup is one object index with no EPIC sanitising.
 *
 * Precedence in the UI is the caller's job and is always:
 *
 *   1. `voter.photoUrl` — a photo the user captured/replaced (overlay);
 *   2. the bundled roll portrait from here;
 *   3. the placeholder box.
 *
 * The generated map is `require`d lazily behind a test guard: jest has no
 * Metro asset registry for 7 000 images, and a test that renders a row should
 * not pay for faces it never shows.
 */
import type { VoterView } from '@/lib/roll/types';

type PhotoMaps = Record<number, Record<string, number>>;

let maps: PhotoMaps | null = null;

function photoMaps(): PhotoMaps {
  if (maps) return maps;
  if (process.env.JEST_WORKER_ID) {
    // Jest: no asset registry — behave as "no bundled photos", which is the
    // state every existing test predates.
    maps = {};
    return maps;
  }
  try {
    // Lazy + require (not a static import): Metro still bundles the map
    // statically, but the ~7000 entries parse on first use instead of at
    // module load, and a missing/corrupt generated file degrades to "no
    // photos" instead of crashing the whole roll behind it.
    maps = (
      require('./photo-maps.generated') as { PHOTO_ASSETS: PhotoMaps }
    ).PHOTO_ASSETS;
  } catch {
    maps = {};
  }
  return maps;
}

/**
 * The bundled portrait for one voter, as a source for `expo-image`
 * (`require(...)` asset / number form), or `null`.
 *
 * `Pick<VoterView, 'id' | 'wardNo'>` rather than the whole view: this is a
 * lookup key pair, and taking the full object would hide which two fields the
 * answer depends on.
 */
export function rollPhotoAsset(
  voter: Pick<VoterView, 'id' | 'wardNo'>
): number | null {
  const asset = photoMaps()[voter.wardNo]?.[voter.id];
  return typeof asset === 'number' ? asset : null;
}

/** How many portraits are bundled — for diagnostics/settings copy. */
export function bundledPhotoCount(): number {
  const maps = photoMaps();
  return Object.values(maps).reduce((sum, ward) => sum + Object.keys(ward).length, 0);
}

/** Test seam: drop the memoised map. */
export function __resetPhotoCache(): void {
  maps = null;
}