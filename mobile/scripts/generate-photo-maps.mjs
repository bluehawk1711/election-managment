/**
 * Generates `lib/roll/photo-maps.generated.ts` — the static require map Metro
 * needs to bundle the portraits under `assets/photos/`.
 *
 * Metro resolves `require()` statically, so a filename cannot be computed at
 * runtime; every (voter id → asset) pair has to be written out as a literal
 * require. One generated file per run instead of hand-editing 7000 lines.
 *
 * Run from `mobile/`:
 *
 *     node scripts/generate-photo-maps.mjs
 *
 * Run after `tools/export_photos_to_app.py` (repo root) re-writes the assets.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ASSETS = path.join(MOBILE, 'assets', 'photos');
const OUT = path.join(MOBILE, 'lib', 'roll', 'photo-maps.generated.ts');

/** `ward-03` → 3, ignoring anything that is not a ward directory. */
function wardNumberOf(name) {
  const match = /^ward-(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** Natural order for file names like `w12-345.jpg` inside a ward. */
function byName(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

const wardDirs = readdirSync(ASSETS)
  .map((name) => ({ name, wardNo: wardNumberOf(name) }))
  .filter((entry) => entry.wardNo !== null && statSync(path.join(ASSETS, entry.name)).isDirectory())
  .sort((a, b) => a.wardNo - b.wardNo);

if (wardDirs.length === 0) {
  console.error('no ward-* directories under assets/photos — run the Python export first');
  process.exit(1);
}

const groups = [];
let total = 0;

for (const dir of wardDirs) {
  const files = readdirSync(path.join(ASSETS, dir.name))
    .filter((file) => file.endsWith('.jpg'))
    .sort(byName);

  const rows = files.map((file) => {
    const voterId = file.slice(0, -4); // strip .jpg
    // Relative to this file: mobile/lib/roll → mobile/assets/...
    const assetPath = `../assets/photos/${dir.name}/${file}`;
    return `    ${JSON.stringify(voterId)}: require(${JSON.stringify(assetPath)}),`;
  });

  total += files.length;
  groups.push(`  ${dir.wardNo}: {\n${rows.join('\n')}\n  },`);
}

const banner = `/**
 * GENERATED FILE — do not edit.
 *
 * Built by \`scripts/generate-photo-maps.mjs\` from the \`assets/photos/ward-NN/\`
 * directories. (Never put a glob ending in a star-slash in this comment —
 * that sequence closes a block comment early and turns the map into code.)
 * (${total} portraits). Every entry is a static require so Metro can bundle
 * the asset; the lookup lives in \`lib/roll/photos.ts\`.
 */
`;

const content = `${banner}export const PHOTO_ASSETS: Record<number, Record<string, number>> = {
${groups.join('\n')}
};
`;

writeFileSync(OUT, content);
console.log(`wrote ${path.relative(MOBILE, OUT)} — ${total} portraits across ${wardDirs.length} wards`);