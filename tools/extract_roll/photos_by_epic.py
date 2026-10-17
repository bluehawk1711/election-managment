# -*- coding: utf-8 -*-
"""Extract voter photos from data/VeerNagar-photos.pdf, named by EPIC ID.

The photos PDF uses the same record layout as the roll PDF (EXTRACTION.md):
3 columns (x edges 0 / 203.5 / 375.5 / 600 pt), 9 records per page, each
record's line 1 carrying `serial + EPIC`, line pitch ≈ 72.35 pt. Every record
cell draws a portrait image (146x182 px, x0 ∈ {163.1, 336.6, 510.1}, photo
top = line-1 top + 10.4 pt). Identification, in order of strength:

  1. **Geometry + EPIC text** — nearest EPIC token by centre-y within the
     same column (photo centre sits ~32.8 pt below its record's EPIC-line
     centre; observed offset is 32.79–32.87 pt over the whole document).
  2. **Ward + serial fallback** — some rows (supplement/new-voter pages 29,
     65, 139, 140, 175, 193, 211, 228, 242, 243, 285, 286, 317, 343) have an
     EMPTY EPIC line in the source (verified: no text, no ink). Their serial
     is still on line 1 (photo_top − 4.4 pt = line centre) and the page
     header carries the ward, so (ward, serial) → EPIC is looked up in the
     proven records_final.json. Validated: 6964/6981 printed EPICs equal the
     known-roll lookup for their (ward, serial); the other 17 are serials
     beyond the older data roll's range.
  3. **ward{W}-serial{S}.{ext}`** — rows whose (ward, serial) is also beyond
     the known roll and whose EPIC line is blank have no EPIC anywhere in the
     repo. They are still extracted and named by their official coordinates.

Other image kinds: 106x76 px stamps drawn inside 107 record cells' text area
(aux, saved `<EPIC>_pNNN` alongside the portrait) and 13 full-page 565x800
scan images (covers — not voter photos, left out of the photo files but
listed in the manifest).

Writes:
  data/photos/<EPIC>.<ext>            one portrait per voter (later duplicate
                                      occurrences: <EPIC>_pNNN.<ext>)
  data/photos/ward{W}-serial{S}.<ext> portraits with no EPIC in the source
  data/photos/manifest.json           provenance + validation + leftovers

Run from repo root:
  python tools/extract_roll/photos_by_epic.py
"""
import collections
import json
import os
import re

import pymupdf

PDF = 'data/VeerNagar-photos.pdf'
OUT_DIR = os.path.join('data', 'photos')
RECORDS_JSON = os.path.join('data', 'rajasthan', 'jodhpur', 'jhanwar',
                            'veernagar', 'records_final.json')

# Column x-edges of the record grid (pt), EXTRACTION.md §Step 3.
COL_EDGES = [0.0, 203.5, 375.5, 600.0]
# Photo centre → record-row centre tolerance (row pitch ≈ 72 pt; the photo
# centre sits ~32.8 pt below its own row's centre, measured 27.6–32.9 pt).
MAX_ROW_DIST = 40.0
# Line-1 centre relative to photo top: photo_top = line1_top + 10.4,
# line1 centre = line1_top + 6 ≈ photo_top − 4.4.
LINE1_CY_OFFSET = 4.4
SERIAL_ZONE = 75.0     # serial sits in the column's leftmost 75 pt
SERIAL_TOL = 5.0

PORTRAIT = (146, 182)
AUX = (106, 76)
SCAN = (565, 800)

EPIC_NEW = re.compile(r'^[A-Z]{3}\d{7}$')
EPIC_OLD = re.compile(r'^RJ/\d{2}/\d{3}/\d{6}$')
SERIAL_RE = re.compile(r'^\d{1,4}$')
WARD_RE = re.compile(r'कमर\w*\s*:\s*(\d+)')


def column_of(x_center):
    for i in range(3):
        if COL_EDGES[i] <= x_center < COL_EDGES[i + 1]:
            return i
    return None


def kind_of(w, h):
    if (w, h) == PORTRAIT:
        return 'portrait'
    if (w, h) == AUX:
        return 'aux'
    return 'scan'


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = pymupdf.open(PDF)

    # Known roll for the ward+serial fallback (and cross-validation).
    known = None
    by_ws = {}
    if os.path.exists(RECORDS_JSON):
        with open(RECORDS_JSON, encoding='utf-8') as f:
            records = json.load(f)['records']
        known = {r['epic'] for r in records}
        by_ws = {(r['ward'], r['serial']): r['epic'] for r in records}

    matches = collections.defaultdict(list)   # epic -> list of match dicts
    leftovers = []                            # un-nameable images
    row_dists = []
    # cross-check counters: printed EPIC vs (ward,serial) known-roll lookup
    xs_ok = xs_out_of_range = xs_disagree = 0
    # cross-check: photo-identified epic vs photo's own (ward,serial) lookup
    map_ok = map_na = map_disagree = 0
    pages_without_records = []
    serial_lookup_used = 0
    serial_lookup_out_of_range = 0

    for pno in range(doc.page_count):
        page = doc[pno]
        words = page.get_text('words')

        epics = []
        for w in words:
            if EPIC_NEW.match(w[4]) or EPIC_OLD.match(w[4]):
                col = column_of((w[0] + w[2]) / 2)
                if col is not None:
                    epics.append({'epic': w[4], 'col': col,
                                  'cy': (w[1] + w[3]) / 2, 'y0': w[1]})
        ints = [w for w in words if SERIAL_RE.match(w[4])]
        wm = WARD_RE.search(page.get_text())
        ward = int(wm.group(1)) if wm else None

        # cross-check (printed EPIC) vs known roll by (ward, serial)
        for e in epics:
            if by_ws:
                ser = [w for w in ints
                       if COL_EDGES[e['col']] <= w[0] <
                       COL_EDGES[e['col']] + SERIAL_ZONE
                       and abs((w[1] + w[3]) / 2 - e['cy']) < 3]
                if ser and ward is not None:
                    got = by_ws.get((ward, int(ser[0][4])))
                    if got == e['epic']:
                        xs_ok += 1
                    elif got is None:
                        xs_out_of_range += 1
                    else:
                        xs_disagree += 1

        images = page.get_image_info(xrefs=True)
        if not images:
            continue
        if not epics:
            pages_without_records.append(pno + 1)

        for im in images:
            x0, y0, x1, y1 = im['bbox']
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            col = column_of(cx)
            kind = kind_of(im['width'], im['height'])
            base = {'pdf_page': pno + 1, 'xref': im['xref'], 'kind': kind,
                    'bbox_pt': [round(v, 1) for v in (x0, y0, x1, y1)],
                    'width': im['width'], 'height': im['height']}
            if kind == 'scan':
                leftovers.append(dict(base, reason='full-page scan, not a '
                                       'voter photo'))
                continue

            # --- identification 1: EPIC token in same column, nearest row ---
            epic = None
            source = None
            dist = None
            cands = [e for e in epics if e['col'] == col]
            if cands:
                best = min(cands, key=lambda e: abs(e['cy'] - cy))
                dist = abs(best['cy'] - cy)
                if dist <= MAX_ROW_DIST:
                    epic, source = best['epic'], 'geometry+epic-text'
                    row_dists.append(dist)

            # --- serial off line 1 (photo_top − 4.4 = line-1 centre) ------
            # Computed for EVERY row, matched or not: `serial` is part of the
            # manifest provenance (ward+serial = the voter id the app keys
            # photos on) and the (ward,serial) cross-checks below both read it.
            serial = None
            if ward is not None:
                line1_cy = y0 - LINE1_CY_OFFSET
                ser = [w for w in ints
                       if COL_EDGES[col] <= w[0] <
                       COL_EDGES[col] + SERIAL_ZONE
                       and abs((w[1] + w[3]) / 2 - line1_cy) <= SERIAL_TOL]
                if ser:
                    serial = int(ser[0][4])

            # --- identification 2/3: serial + ward ------------------------
            if epic is None and ward is not None and serial is not None:
                got = by_ws.get((ward, serial))
                if got:
                    epic, source = got, 'ward+serial-lookup'
                    serial_lookup_used += 1
                else:
                    serial_lookup_out_of_range += 1

            # --- cross-check of identifier 1 against known roll -----------
            if by_ws and source == 'geometry+epic-text' \
                    and serial is not None and ward is not None:
                got = by_ws.get((ward, serial))
                if got is None:
                    map_na += 1
                elif got == epic:
                    map_ok += 1
                else:
                    map_disagree += 1

            rec = dict(base, epic=epic, source=source,
                       serial=serial, ward=ward,
                       row_offset_pt=round(dist, 2) if dist is not None
                       else None,
                       old_format=bool(epic and EPIC_OLD.match(epic)))
            if epic is not None:
                matches[epic].append(rec)
            elif serial is not None and ward is not None:
                rec['name_hint'] = 'ward%d-serial%d' % (ward, serial)
                matches[rec['name_hint']].append(rec)
            else:
                leftovers.append(dict(base, reason='no EPIC, no serial/ward'))

    # ---- write files: portraits first (plain name), then aux/duplicates ---
    entries = []
    for stem, recs_ in matches.items():
        # portraits before aux; within a kind, page order
        recs_ = sorted(recs_, key=lambda r: (r['kind'] != 'portrait',
                                             r['pdf_page']))
        for i, r in enumerate(recs_):
            info = doc.extract_image(r['xref'])
            safe = stem.replace('/', '-')
            if i == 0:
                name = '%s.%s' % (safe, info['ext'])
            else:
                name = '%s_p%03d.%s' % (safe, r['pdf_page'], info['ext'])
            with open(os.path.join(OUT_DIR, name), 'wb') as f:
                f.write(info['image'])
            entries.append(dict(r, file=name,
                                epic_named=bool(EPIC_NEW.match(stem) or
                                                EPIC_OLD.match(stem))))

    # ---- validation summary --------------------------------------------
    tokens = sum(1 for pno in range(doc.page_count)
                 for w in doc[pno].get_text('words')
                 if EPIC_NEW.match(w[4]) or EPIC_OLD.match(w[4]))
    unique_tokens = set()
    for pno in range(doc.page_count):
        for w in doc[pno].get_text('words'):
            if EPIC_NEW.match(w[4]) or EPIC_OLD.match(w[4]):
                unique_tokens.add(w[4])
    epic_files = [e for e in entries if e['epic_named']]
    hint_files = [e for e in entries if not e['epic_named']]
    stems = [e['file'].rsplit('.', 1)[0] for e in entries]
    dupes = sorted({s for s in stems if stems.count(s) > 1})
    named_stems = {e['epic'] for e in epic_files}
    tess = (max(row_dists), sum(row_dists) / len(row_dists)) \
        if row_dists else (None, None)

    manifest = {
        'source_pdf': PDF,
        'photos_extracted_total': len(entries),
        'portraits_named_by_epic': len(epic_files),
        'portraits_named_by_ward_serial': len(hint_files),
        'aux_images_named': sum(1 for e in entries
                                if e['kind'] == 'aux'),
        'epic_tokens_in_pdf': tokens,
        'unique_epic_tokens': len(unique_tokens),
        'epic_tokens_without_photo_file': len(unique_tokens - named_stems),
        'duplicate_epic_files': {s: stems.count(s) for s in dupes},
        'leftover_not_extracted': len(leftovers),
        'ward_serial_lookup': {
            'resolved': serial_lookup_used,
            'serial_beyond_known_roll': serial_lookup_out_of_range,
        },
        'crosscheck_printed_epic_vs_known_roll': {
            'agree': xs_ok, 'serial_beyond_known_roll': xs_out_of_range,
            'disagree': xs_disagree,
        },
        'crosscheck_photo_mapping_vs_known_roll': {
            'agree': map_ok, 'serial_beyond_known_roll': map_na,
            'disagree': map_disagree,
        },
        'row_match_distance_pt': {'max': tess[0], 'mean': tess[1]},
        'known_roll_records': len(known) if known is not None else None,
        'distinct_epics_in_known_roll':
            len(named_stems & known) if known is not None else None,
        'pages_without_record_text': pages_without_records,
        'leftovers': leftovers,
        'images': sorted(entries,
                         key=lambda e: (e['pdf_page'], e['bbox_pt'][0])),
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w',
              encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('extracted: %d files -> %s/' % (len(entries), OUT_DIR))
    print('  named by EPIC (geometry+text): %d' % len(epic_files))
    print('  named by ward+serial lookup : %d' % len(
        [e for e in entries if e.get('source') == 'ward+serial-lookup']))
    print('  named ward{W}-serial{S}     : %d (EPIC blank in source AND '
          'beyond known roll)' % len(hint_files))
    print('  aux stamps kept alongside   : %d'
          % manifest['aux_images_named'])
    print('EPIC tokens: %d total, %d unique, %d without photo file'
          % (tokens, len(unique_tokens),
             manifest['epic_tokens_without_photo_file']))
    print('row match distance: mean %.2f pt, max %.2f pt'
          % (tess[1], tess[0]))
    print('crosscheck photo-identity vs (ward,serial): agree=%d '
          'beyond-known-roll=%d disagree=%d'
          % (map_ok, map_na, map_disagree))
    print('crosscheck printed-epic vs known roll: agree=%d '
          'beyond-known-roll=%d disagree=%d'
          % (xs_ok, xs_out_of_range, xs_disagree))
    print('leftovers not extracted: %d' % len(leftovers))
    for u in leftovers[:8]:
        print('  ', u)


if __name__ == '__main__':
    main()