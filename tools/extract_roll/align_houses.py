# -*- coding: utf-8 -*-
"""Final `house_no` alignment — the house-number policy, applied everywhere.

Policy (the user's rules, restated as code):

  * A house number is a digit string of 1..6 digits. When the value carries
    one, the digits win over the surrounding text:
        "जे-36"            -> 36
        "34,प्रेम नागर"     -> 34
        "B-25 परसवानाथ"    -> 25
        "मकान एम-433"       -> 433
  * A run of 7+ digits is never a house number — it is an EPIC-digit or
    age-column merge from an earlier bad pass (`4946992` = EPIC `…4946992`).
  * If no 1..6 digit run exists anywhere, the record has no house number:
    keep it EMPTY and drop OCR garbage ("az", "rfe", "bt", "के", "बुध प्रकाश
    गौड़", "प्लाट नं.").

Ground truth for every row the policy could not settle from text (and for
every row a partial earlier pass touched): re-OCR the single house cell from
the PDF with a digit whitelist, majority-voting over (dpi, psm) variants.
The raw text layer is deliberately NOT consulted — `sample_mismatches` in
cell_fixes.json shows it decodes the printed `| … |` rules around the number
as a leading `1` (raw says `128` where the print says `28`).

Rows whose CSV value already matches records_final.json AND is 1..6 digits
are authoritative (fix_final raw-re-read rows) and are not re-OCR'd.

Writes, in order: ward CSVs -> records_final.json (`house` synced) ->
verification.md section D (rebuilt as the list of no-number rows).

Run from the repo root (takes a few minutes):
    PYTHONIOENCODING=utf-8 python tools/extract_roll/align_houses.py
"""
import csv
import importlib.util
import json
import os
import re
import time
from collections import Counter

import pymupdf

WORK = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(WORK, '..', '..', 'data', 'rajasthan',
                    'jodhpur', 'jhanwar', 'veernagar')
RECORDS = os.path.join(WORK, 'records_final.json')
VERIFICATION = os.path.join(WORK, '..', '..', 'verification.md')

# fix_cells.py already has the geometry (page cache, record locator, cell
# box, rasteriser, OCR helper); reuse it instead of re-deriving the grid.
_spec = importlib.util.spec_from_file_location(
    'fix_cells', os.path.join(WORK, 'fix_cells.py'))
fc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fc)

DIGIT_RUN = re.compile(r'\d+')

# (dpi, psm) attempts, in order; we stop early when two agree.
VARIANTS = ((900, '7'), (1800, '7'), (1800, '11'))


def normalize(run):
    """'0034' -> '34'; '0' -> '' (a 0 is the roll's no-number marker)."""
    stripped = run.lstrip('0')
    return stripped if stripped else ''


def runs1to6(text):
    """Every 1..6-digit house candidate in `text`, longest first."""
    out = []
    for run in DIGIT_RUN.findall(text or ''):
        if len(run) > 6:
            continue
        norm = normalize(run)
        if norm:
            out.append(norm)
    return sorted(set(out), key=len, reverse=True)


def ocr_house(page, box):
    """Digit-run candidates from the printed cell, majority-voted."""
    votes = Counter()
    texts = []
    for step, (dpi, psm) in enumerate(VARIANTS):
        img = fc.crop(page, *box, dpi)
        text, _conf = fc.ocr_data(img, psm, whitelist='0123456789')
        texts.append(text)
        found = runs1to6(text)
        if found:
            votes[found[0]] += 1
        # Early exit: two identical first choices are a done deal.
        if step == 1 and len(votes) == 1 and max(votes.values()) == 2:
            break
    if not votes:
        return '', texts
    # Most-agreed run wins; ties break toward the longest reading.
    best = max(votes.items(), key=lambda kv: (kv[1], len(kv[0])))
    if best[1] == 1 and len([v for v in votes.values() if v == 1]) > 1:
        # Every variant invented something different — no confidence at all.
        return '', texts
    return best[0], texts


def rewrite_verification_d(empty_rows):
    """Rebuild `## D. …` from the final state (rows with no house number)."""
    lines = open(VERIFICATION, encoding='utf-8').read().split('\n')
    start = next(i for i, ln in enumerate(lines)
                 if ln.startswith('## D'))
    end = next((i for i in range(start + 1, len(lines))
                if lines[i].startswith('## ')), len(lines))
    block = [
        '## D. Rows with NO house number, kept empty per the house policy '
        '(%d)' % len(empty_rows),
        '',
        'House numbers are digits only (`^\\d{1,6}$`). Text with a number '
        'keeps its digits (`जे-36` -> `36`), and a record with no number in '
        'the printed `मकान संख्या:` cell stays empty:',
        '',
        '| ward | pdf_page | serial | name |',
        '|---|---|---|---|',
    ]
    for ward, page, serial, name in empty_rows:
        block += ['| %s | %s | %s | %s |' % (ward, page, serial, name)]
    lines[start:end] = block + ['']
    open(VERIFICATION, 'w', encoding='utf-8').write('\n'.join(lines))


def main():
    t0 = time.time()
    doc_data = json.load(open(RECORDS, encoding='utf-8'))
    idx2no = {w['idx']: w['ward_no'] for w in doc_data['wards']}
    rec_map = {(idx2no[r['ward']], int(r['serial'])): r
               for r in doc_data['records']}

    # The base for non-OCR rows is records_final's house — the value fix_final
    # raw-re-read, BEFORE the partial passes that clobbered some CSV cells.
    stats = Counter()
    empty_rows = []
    fc.p4_mod.doc = pymupdf.open(fc.PDF)

    for ward in range(1, 14):
        path = os.path.join(DATA, 'ward-%02d.csv' % ward)
        with open(path, encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f))
        changed = 0

        for r in rows:
            serial = int(r['serial_no'])
            csv_h = (r['house_no'] or '').strip()
            rec = rec_map.get((ward, serial))
            rec_h = (rec['house'] or '').strip() if rec else ''
            csv_ok = bool(re.fullmatch(r'\d{1,6}', csv_h))

            # In-CSV already (CSV == records and numeric): trusted, skip.
            if csv_ok and csv_h == rec_h:
                continue

            stats['universe'] += 1

            value = ''
            # 1. Cell OCR = ground truth for every unsettled row.
            located = fc.locate({'page': int(r['pdf_page']),
                                 'epic': r['epic_id']})
            _page, info, si, col = located
            if si is not None and si + 3 < len(info):
                box = fc.cell_box(info, si, si + 3, col, 'house')
                ocr_val, _texts = ocr_house(_page, box)
                if ocr_val:
                    value = ocr_val
                    stats['ocr'] += 1

            # 2. Fall back to the record text (जे-36 -> 36 …).
            if not value:
                cands = runs1to6(rec_h) or runs1to6(csv_h)
                if cands:
                    value = cands[0]
                    stats['text'] += 1

            if not value:
                stats['empty'] += 1

            if csv_h != value:
                changed += 1
                r['house_no'] = value
                stats['written'] += 1
            if not value and rec:
                empty_rows.append((idx2no[rec['ward']], rec['page'],
                                   rec['serial'], rec['name']))

        if changed:
            with open(path, 'w', encoding='utf-8-sig', newline='') as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)
        # Any row left valid-and-matching must still be counted for section D
        # — collect empties for ALL rows, not only the ones just written.
        for r in rows:
            if not r['house_no']:
                rec = rec_map.get((ward, int(r['serial_no'])))
                if rec:
                    empty_rows.append((idx2no[rec['ward']], rec['page'],
                                       rec['serial'], rec['name']))
        print('ward %02d: %d rows rewritten  (%.0fs)'
              % (ward, changed, time.time() - t0))

    # Deduplicate D-list rows (collected in both loops) and sort.
    seen = set()
    dedup = []
    for row in empty_rows:
        key = (row[0], row[2])
        if key not in seen:
            seen.add(key)
            dedup.append(row)
    dedup.sort(key=lambda row: (row[0], row[2]))

    # ---- sync records_final.json with the final CSV house values ----------
    for ward in range(1, 14):
        path = os.path.join(DATA, 'ward-%02d.csv' % ward)
        with open(path, encoding='utf-8-sig', newline='') as f:
            for r in csv.DictReader(f):
                rec = rec_map.get((ward, int(r['serial_no'])))
                if rec is not None:
                    rec['house'] = (r['house_no'] or '').strip()
    json.dump(doc_data, open(RECORDS, 'w', encoding='utf-8'),
              ensure_ascii=False)

    rewrite_verification_d(dedup)

    print('universe=%d  ocr=%d  text=%d  empty=%d  written=%d'
          % (stats['universe'], stats['ocr'], stats['text'],
             stats['empty'], stats['written']))
    print('no-number rows listed in verification.md D: %d  (%.0fs total)'
          % (len(dedup), time.time() - t0))


if __name__ == '__main__':
    main()