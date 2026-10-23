# -*- coding: utf-8 -*-
"""Mark the voter records that carry a DELETED stamp in `data/VeerNagar-photos.pdf`.

The photos PDF draws one image over a deleted voter's record cell: the
106x76 px diagonal `DELETED` stamp (the only 106x76 image in the document —
all 107 placements share one xref, so the marker is unambiguous). Every other
image kind is a portrait (146x182) or a full-page cover scan (565x800).

`data/photos/manifest.json` (written by `photos_by_epic.py`, EXTRACTION.md
Step 7) already carries every image placement with its identified record, so
this script only filters `kind == 'aux'` and validates the identification:

  * every stamp's `(ward, serial)` must resolve in `records_final.json`, and
  * that record's EPIC must equal the EPIC the manifest assigned to the stamp
    (two independent identifications — geometry+EPIC text vs the roll lookup —
    must agree, or the run aborts).

Output: `data/rajasthan/jodhpur/jhanwar/veernagar/deleted.json`

  {
    "source_pdf": "data/VeerNagar-photos.pdf",
    "marker": "106x76 px diagonal DELETED stamp drawn over the record cell",
    "count": 107,
    "records": [ { "ward", "serial", "epic_id", "photos_pdf_page",
                   "stamp_bbox_pt" }, ... ]
  }

`mobile/scripts/generate-ward-bundles.ts` reads this file and sets
`deleted: true` on those rows, which is what puts the DELETED badge on the
card in the mobile app and the admin panel (EXTRACTION.md Step 8).

Run from repo root:
  python tools/extract_roll/deleted_flags.py
"""
import json
import os

MANIFEST = os.path.join('data', 'photos', 'manifest.json')
RECORDS_JSON = os.path.join('data', 'rajasthan', 'jodhpur', 'jhanwar',
                            'veernagar', 'records_final.json')
OUT_JSON = os.path.join('data', 'rajasthan', 'jodhpur', 'jhanwar',
                        'veernagar', 'deleted.json')

STAMP = (106, 76)


def main():
    with open(MANIFEST, encoding='utf-8') as f:
        manifest = json.load(f)
    with open(RECORDS_JSON, encoding='utf-8') as f:
        records = json.load(f)['records']

    by_ws = {(r['ward'], r['serial']): r for r in records}
    known_eps = {r['epic'] for r in records}

    stamps = [e for e in manifest['images'] if e['kind'] == 'aux']
    # The aux kind is defined by exact pixel size in photos_by_epic.py, but
    # re-assert it here: this file is what the apps trust.
    wrong = [e for e in stamps if (e['width'], e['height']) != STAMP]
    if wrong:
        raise SystemExit('unexpected aux image sizes: %r' % wrong)

    out = []
    problems = []
    for e in stamps:
        ward, serial = e.get('ward'), e.get('serial')
        rec = by_ws.get((ward, serial))
        if rec is None:
            problems.append('p%d: (%s, %s) not in the known roll'
                            % (e['pdf_page'], ward, serial))
            continue
        if rec['epic'] != e.get('epic'):
            problems.append('p%d: stamp says %s, roll says %s for (%s, %s)'
                            % (e['pdf_page'], e.get('epic'), rec['epic'],
                               ward, serial))
            continue
        out.append({
            'ward': ward,
            'serial': serial,
            'epic_id': rec['epic'],
            'photos_pdf_page': e['pdf_page'],
            'stamp_bbox_pt': e['bbox_pt'],
        })

    if problems:
        raise SystemExit('identification mismatches:\n  ' +
                         '\n  '.join(problems))

    out.sort(key=lambda r: (r['ward'], r['serial']))

    # A stamp is one deleted voter: no EPIC may appear twice (the manifest
    # keeps duplicate occurrences as separate <EPIC>_pNNN entries).
    eps = [r['epic_id'] for r in out]
    dupes = sorted({e for e in eps if eps.count(e) > 1})
    if dupes:
        raise SystemExit('same voter stamped twice: %r' % dupes)

    payload = {
        'source_pdf': 'data/VeerNagar-photos.pdf',
        'marker': '106x76 px diagonal DELETED stamp drawn over the record cell',
        'count': len(out),
        'records': out,
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('deleted records: %d -> %s' % (len(out), OUT_JSON))
    by_ward = {}
    for r in out:
        by_ward[r['ward']] = by_ward.get(r['ward'], 0) + 1
    print('per ward: %s' % sorted(by_ward.items()))
    print('all in the known roll: %d/%d; all distinct: yes'
          % (len(out), len(stamps)))


if __name__ == '__main__':
    main()
