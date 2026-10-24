# -*- coding: utf-8 -*-
"""Extract the 25 missing purak (addition) portraits from the ward scan PDFs.

The additions pages are scan images; their portraits were never keyed by the
photo extractor (which reads VeerNagar-photos.pdf). Every cell→serial mapping
below was verified against the readable page render + the ward CSV:

  ward 3  p34 : cells = CSV 810..814 (printed serials match CSV). CSV 809 is a
                re-listing of main-roll voter IRW1008580 (ward3-117) — the
                scan has no separate portrait for it, so the existing epic
                photo is copied under serial 809.
  ward 6  p19 : cells = CSV 289..294 in order; the 7th cell is the विलोपन
                (E-144) row and is skipped.
  ward 7  p19 : printed serials 314..323 = CSV 308..317 (offset -6). Only
                314..317 (printed 320..323) were missing photos.
  ward 10 p15 : printed serials 214..222 = CSV 195..203 (offset -19); the
                first cell (पूजा) sits above the detected grid at a fixed
                mirrored position.

Output: data/photos/ward{w}-serial{s}.png + manifest.json entries with
kind='portrait', matching the naming the earlier serial-keyed runs used.
Run `tools/export_photos_to_app.py` + `node mobile/scripts/generate-photo-maps.mjs`
afterwards, then copy the new ward-NN files into admin/public/photos.
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crop_cells2 import render_gray  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8')

DATA_PHOTOS = os.path.join('data', 'photos')
MANIFEST = os.path.join(DATA_PHOTOS, 'manifest.json')

# (ward, page_1based, cell_box, csv_serial)
CELL_MAP = [
    # --- ward 3, p34 -----------------------------------------------------
    (3, 34, (134, 1193, 814, 1413), 810),   # रामसिंह पि. विशनसिंह
    (3, 34, (133, 1553, 816, 1773), 811),   # रेखा जांगिड
    (3, 34, (816, 1553, 1499, 1773), 812),  # राधेश्याम जांगिड
    (3, 34, (1499, 1553, 2180, 1773), 813), # कालु
    (3, 34, (132, 1844, 816, 2066), 814),   # निरमा
    # --- ward 6, p19 -----------------------------------------------------
    (6, 19, (210, 1220, 890, 1427), 289),   # मुकेश सियाग
    (6, 19, (214, 1584, 890, 1812), 290),   # पियूष
    (6, 19, (890, 1584, 1574, 1812), 291),  # गंगा देवी
    (6, 19, (1574, 1584, 2261, 1812), 292), # सुरेश कुमार
    (6, 19, (210, 1947, 836, 2097), 293),   # सुमित्रा प्रजापत
    (6, 19, (889, 1947, 1574, 2097), 294),  # शिव राज सुधार
    # --- ward 7, p19 (printed 320..323) ----------------------------------
    (7, 19, (902, 1946, 1588, 2100), 314),  # मंजू सोनी
    (7, 19, (1588, 1946, 2273, 2100), 315), # गौतम
    (7, 19, (216, 2233, 900, 2385), 316),   # भगवानराम
    (7, 19, (900, 2233, 1584, 2385), 317),  # गौरव सोनी
    # --- ward 10, p15 (printed 214..222) ---------------------------------
    (10, 15, (222, 755, 905, 987), 195),    # पूजा
    (10, 15, (905, 755, 1590, 987), 196),   # मनोज
    (10, 15, (1590, 755, 2276, 987), 197),  # सुमित
    (10, 15, (222, 1046, 904, 1210), 198),  # नितिन
    (10, 15, (904, 1046, 1589, 1210), 199), # सज्जन
    (10, 15, (1589, 1046, 2275, 1210), 200),# अनिशा
    (10, 15, (225, 1357, 902, 1563), 201),  # रमेश
    (10, 15, (902, 1357, 1429, 1563), 202), # मीनाक्षी दुबे
    (10, 15, (1587, 1357, 2273, 1563), 203),# अंजनी कुमार दुबे
]

# CSV 809 re-uses the main-roll epic photo of the same voter.
EPIC_COPIES = [(3, 809, 'IRW1008580.png')]

PX_PER_PT = 300.0 / 72.0


def photo_region(cell):
    """The portrait sits in the right 32% of a cell, vertically inset 6%."""
    x0, y0, x1, y1 = cell
    cw, ch = x1 - x0, y1 - y0
    return (x0 + int(cw * 0.66), y0 + int(ch * 0.06),
            x1 - int(cw * 0.02), y1 - int(ch * 0.06))


def main():
    with open(MANIFEST, encoding='utf-8') as f:
        manifest = json.load(f)

    have = {(e['ward'], e['serial']) for e in manifest['images']
            if e.get('kind') == 'portrait' and e.get('ward') is not None
            and e.get('serial') is not None}

    render_cache = {}
    new_entries = []

    def add_entry(ward, serial, file_name, pdf_page, bbox_px, cell):
        entry = {
            'pdf_page': pdf_page,
            'xref': None,
            'kind': 'portrait',
            'bbox_pt': [round(v / PX_PER_PT, 1) for v in bbox_px],
            'width': bbox_px[2] - bbox_px[0],
            'height': bbox_px[3] - bbox_px[1],
            'epic': None,
            'source': 'ward-pdf-purak-cell',
            'serial': serial,
            'ward': ward,
            'row_offset_pt': None,
            'old_format': False,
            'name_hint': 'ward%d-serial%d' % (ward, serial),
            'file': file_name,
            'epic_named': False,
            'cell_px': list(cell),
        }
        new_entries.append(entry)

    for ward, pno, cell, serial in CELL_MAP:
        if (ward, serial) in have:
            print('skip (already in manifest): w%d-%d' % (ward, serial))
            continue
        if ward not in render_cache:
            render_cache[ward] = {}
        if pno not in render_cache[ward]:
            render_cache[ward][pno] = render_gray(
                os.path.join('data', 'Ward No- %d.pdf' % ward), pno - 1)
        arr = render_cache[ward][pno]
        px0, py0, px1, py1 = photo_region(cell)
        crop = arr[py0:py1, px0:px1]
        file_name = 'ward%d-serial%d.png' % (ward, serial)
        Image.fromarray(crop).save(os.path.join(DATA_PHOTOS, file_name))
        add_entry(ward, serial, file_name, pno, (px0, py0, px1, py1), cell)
        print('cropped w%d-%d -> %s (%dx%d)' % (ward, serial, file_name,
                                                crop.shape[1], crop.shape[0]))

    for ward, serial, src in EPIC_COPIES:
        if (ward, serial) in have:
            print('skip (already in manifest): w%d-%d' % (ward, serial))
            continue
        file_name = 'ward%d-serial%d.png' % (ward, serial)
        shutil.copyfile(os.path.join(DATA_PHOTOS, src),
                        os.path.join(DATA_PHOTOS, file_name))
        with Image.open(os.path.join(DATA_PHOTOS, file_name)) as im:
            w, h = im.size
        add_entry(ward, serial, file_name, None, (0, 0, w, h), (0, 0, w, h))
        print('copied %s -> %s for w%d-%d' % (src, file_name, ward, serial))

    if not new_entries:
        print('nothing new')
        return

    manifest['images'].extend(new_entries)
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print('manifest: %d new portrait entries (total %d)'
          % (len(new_entries), len(manifest['images'])))


if __name__ == '__main__':
    main()
