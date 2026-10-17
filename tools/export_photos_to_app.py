# -*- coding: utf-8 -*-
"""Export extracted roll portraits into the mobile app as JPEG assets.

Reads `data/photos/manifest.json` (written by `tools/extract_roll/photos_by_epic.py`)
and writes one JPEG per voter under:

    mobile/assets/photos/ward-NN/w{ward}-{serial}.jpg

The filename is the roll's stable voter id (`types.ts`: `w{wardNo}-{serialNo}`),
which is what the app keys rows on — so `lib/roll/photos.ts` looks a face up by
the same id it already has, no EPIC sanitising involved.

Only `kind == 'portrait'` entries are exported: the 106x76 stamps drawn in a
record's text area (`kind == 'aux'`) and the 13 full-page cover scans are not
voter faces. Duplicated EPIC tokens already resolved to distinct (ward, serial)
rows by the extractor, so the ids never collide — the assertion below is what
proves that rather than assumes it.

PNG (146x182, lossless, ~17 KB each) → JPEG quality 62 (~4-5 KB). At field-work
size the difference is invisible and it halves what the APK has to carry.

Run from repo root:

    python tools/export_photos_to_app.py

Then regenerate the require map:

    node scripts/generate-photo-maps.mjs
"""
import json
import os
import shutil

from PIL import Image

MANIFEST = os.path.join('data', 'photos', 'manifest.json')
SRC_DIR = os.path.join('data', 'photos')
OUT_ROOT = os.path.join('mobile', 'assets', 'photos')
JPEG_QUALITY = 62


def main():
    with open(MANIFEST, encoding='utf-8') as f:
        manifest = json.load(f)

    entries = [e for e in manifest['images'] if e['kind'] == 'portrait']
    print('portrait entries in manifest:', len(entries))

    # Fresh output tree: a stale file left by an earlier run would otherwise
    # survive as a photo for a voter id that no longer exists.
    if os.path.isdir(OUT_ROOT):
        shutil.rmtree(OUT_ROOT)
    os.makedirs(OUT_ROOT, exist_ok=True)

    seen = {}
    written = 0
    duplicates = []
    missing_serial = []
    missing_source = []

    for entry in entries:
        ward = entry.get('ward')
        serial = entry.get('serial')
        if ward is None or serial is None:
            missing_serial.append(entry['file'])
            continue

        # The app's voter id — see RollVoter.id in lib/roll/types.ts.
        voter_id = 'w%d-%d' % (ward, serial)
        # One portrait per voter row: two entries mapping to the same id means
        # the extractor's row mapping drifted, and silently keeping the first
        # would ship a wrong face. Assert loudly instead.
        # One portrait per voter row. A repeat here means the SAME voter is
        # drawn twice in the PDF — which the roll genuinely does, listing a
        # shifted/deleted voter again on a supplement page with a fresh scan
        # of their old photo (e.g. IRW1338359 on pages 25 and 29). Entries
        # are processed in page order, so the first — the main-roll row — is
        # kept and the supplement's duplicate is logged below.
        if voter_id in seen:
            duplicates.append((seen[voter_id], entry['file'], voter_id))
            continue
        seen[voter_id] = entry['file']

        src = os.path.join(SRC_DIR, entry['file'])
        if not os.path.exists(src):
            missing_source.append(entry['file'])
            continue

        with Image.open(src) as im:
            # JPEG has no alpha: flatten onto white rather than let the
            # converter turn transparent pixels black.
            if im.mode in ('RGBA', 'LA', 'P'):
                rgba = im.convert('RGBA')
                background = Image.new('RGB', rgba.size, (255, 255, 255))
                background.paste(rgba, mask=rgba.split()[-1])
                rgb = background
            else:
                rgb = im.convert('RGB')

            out_dir = os.path.join(OUT_ROOT, 'ward-%02d' % ward)
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, voter_id + '.jpg')
            rgb.save(out_path, 'JPEG', quality=JPEG_QUALITY, optimize=True)
            written += 1

    total_bytes = 0
    count = 0
    for root, _dirs, files in os.walk(OUT_ROOT):
        for name in files:
            total_bytes += os.path.getsize(os.path.join(root, name))
            count += 1

    print('written:', written, '| files on disk:', count,
          '| total: %.1f MB (%.1f KB avg)'
          % (total_bytes / 1e6, total_bytes / max(count, 1) / 1024))
    if missing_serial:
        print('entries without ward+serial (%d): %s'
              % (len(missing_serial), missing_serial[:10]))
    if missing_source:
        print('source files missing (%d): %s'
              % (len(missing_source), missing_source[:10]))
    if duplicates:
        print('duplicate rows skipped (%d), main-roll photo kept:'
              % len(duplicates))
        for keep, dropped, voter_id in duplicates[:10]:
            print('  %s: kept %s, dropped %s' % (voter_id, keep, dropped))
    if written + len(duplicates) != len(entries):
        raise SystemExit(
            'mismatch: %d entries but %d written + %d duplicates'
            % (len(entries), written, len(duplicates)))


if __name__ == '__main__':
    main()