# -*- coding: utf-8 -*-
"""Locate which 130-Looni e-roll part files contain the Veernagar roll's voters.

The e-roll PDFs under data/130-eroll/ are pure scans (verified: 0 fonts,
0 text objects, one full-page image per page across all 372 files / 12,573
pages), so the only way in is OCR. Scanning all 12,573 pages at eng+hin
would take many hours; instead this does two passes:

  Pass 1 (this script, parallel): OCR 3 pages per file (cover + 2 record
    pages) at 250 dpi with `eng` only — EPIC ids are Latin. Fuzzy-match the
    read EPICs against the 6,855 ids in records_final.json, folding the
    confusions tesseract actually makes on this font (I/R, 0/O, 1/l, 5/S,
    8/B). Any file with a hit contains our voters and is queued for the
    deep pass.

  Pass 2 (scan_eroll_deep.py): every page of the hit files, eng+hin, full
    card text — matched back to roll rows for cross-checking.

Run from repo root (background):
    python tools/extract_roll/scan_eroll.py
Writes:
    tools/extract_roll/eroll_hits.json
"""
import io
import json
import os
import re
import glob
import multiprocessing as mp

import pymupdf
import pytesseract
from PIL import Image

EROLL_DIR = os.path.join('data', '130-eroll')
RECORDS = os.path.join('tools', 'extract_roll', 'records_final.json')
OUT = os.path.join('tools', 'extract_roll', 'eroll_hits.json')

NEW_EPIC = re.compile(r'[A-Z]{3}\s?\d{7}')
OLD_EPIC = re.compile(r'RJ\s?/\s?\d{2}\s?/\s?\d{3}\s?/\s?\d{4,6}')


def fold(epic: str) -> str:
    """Collapse the OCR confusions this font provokes, on both sides."""
    out = []
    for c in epic.upper().replace(' ', ''):
        if c in '0OQD':
            out.append('0')
        elif c in '1IL':
            out.append('1')
        elif c in '5S':
            out.append('5')
        elif c in '8B':
            out.append('8')
        elif c in '2Z':
            out.append('2')
        else:
            out.append(c)
    return ''.join(out)


def extract_epics(text: str):
    text = text.upper()
    return ([fold(m.group(0)) for m in NEW_EPIC.finditer(text)],
            [fold(m.group(0)) for m in OLD_EPIC.finditer(text)])


def ocr_page(path: str, page_index: int, dpi: int, lang: str) -> str:
    doc = pymupdf.open(path)
    try:
        pix = doc[page_index].get_pixmap(dpi=dpi)
        img = Image.open(io.BytesIO(pix.tobytes('png')))
        return pytesseract.image_to_string(img, lang=lang, config='--psm 6')
    finally:
        doc.close()


def scan_file(args):
    path, known_new, known_old = args
    name = os.path.basename(path)
    part = re.search(r'HIN-(\d+)-WI', name)
    part = int(part.group(1)) if part else -1
    result = {'part': part, 'file': name, 'pages': 0,
              'sample_epics': [], 'hits': [], 'old_hits': []}
    try:
        doc = pymupdf.open(path)
        n = doc.page_count
        doc.close()
        result['pages'] = n
        # cover + first record page + a middle record page
        candidates = [0, 2]
        if n > 14:
            candidates.append(n // 2)
        seen = set()
        for pno in candidates:
            try:
                text = ocr_page(path, pno, 250, 'eng')
            except Exception as exc:  # keep scanning other files
                result.setdefault('errors', []).append('%s: %s' % (pno, exc))
                continue
            new, old = extract_epics(text)
            for e in new:
                if e in seen:
                    continue
                seen.add(e)
                result['sample_epics'].append(e)
                if e in known_new:
                    result['hits'].append({'eroll_epic_fold': e,
                                           'page': pno + 1})
            for e in old:
                if e in known_old:
                    result['old_hits'].append({'eroll_epic_fold': e,
                                               'page': pno + 1})
    except Exception as exc:
        result['fatal'] = str(exc)
    return result


def main():
    data = json.load(open(RECORDS, encoding='utf-8'))
    recs = data['records']
    known_new = set()
    known_old = set()
    for r in recs:
        epic = (r['epic'] or '').upper()
        if epic.startswith('RJ/'):
            known_old.add(fold(epic))
        else:
            known_new.add(fold(epic))
    print('roll epics: %d new-format, %d old-format'
          % (len(known_new), len(known_old)))

    files = sorted(glob.glob(os.path.join(EROLL_DIR, '*.pdf')))
    print('e-roll files:', len(files))

    jobs = [(p, known_new, known_old) for p in files]
    workers = min(6, os.cpu_count() or 2)
    results = []
    with mp.Pool(workers) as pool:
        for i, res in enumerate(pool.imap_unordered(scan_file, jobs), 1):
            results.append(res)
            if res['hits'] or res['old_hits']:
                print('HIT part %d: %d new-format, %d old-format'
                      % (res['part'], len(res['hits']), len(res['old_hits'])),
                      flush=True)
            if i % 25 == 0:
                print('... %d/%d files scanned' % (i, len(jobs)), flush=True)

    results.sort(key=lambda r: r['part'])
    hit_files = [r for r in results if r['hits'] or r['old_hits']]
    summary = {
        'source': EROLL_DIR,
        'files_scanned': len(results),
        'files_with_hits': len(hit_files),
        'note': 'Pass-1 locator scan: 3 pages/file OCR @250dpi eng, '
                'confusion-folded EPIC match against records_final.json.',
        'results': results,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('saved', OUT)
    print('files with hits:', len(hit_files),
          '->', sorted(r['part'] for r in hit_files))


if __name__ == '__main__':
    main()
