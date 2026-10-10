# -*- coding: utf-8 -*-
"""Pass 2: deep-OCR every page of the e-roll files that contain Veernagar
voters (the pass-1 hits in eroll_hits.json), parse the voter cards, and
cross-check them against records_final.json.

Each record page holds a grid of voter cards like:

    17 IRW0199661
    निर्वाचक का नाम : टीपू कंवर
    पति का नाम: भेरूसिंह
    गृह संख्या : 91 फोटो उपलब्ध
    उम्र : 37 लिंग : महिला

So per page we can rebuild, for every voter the page carries: serial, EPIC,
name, father/husband, house, age, gender — everything the e-roll adds on top
of what we already extracted from the ward roll (there are no photo images;
the cells print "फोटो उपलब्ध" as text).

Run from repo root (background):
    python tools/extract_roll/scan_eroll_deep.py
Writes:
    tools/extract_roll/eroll_matches.json
"""
import io
import json
import os
import re
import multiprocessing as mp

import pymupdf
import pytesseract
from PIL import Image

HITS = os.path.join('tools', 'extract_roll', 'eroll_hits.json')
RECORDS = os.path.join('tools', 'extract_roll', 'records_final.json')
OUT = os.path.join('tools', 'extract_roll', 'eroll_matches.json')
EROLL_DIR = os.path.join('data', '130-eroll')

NEW_EPIC = re.compile(r'[A-Z]{3}\s?\d{7}')
OLD_EPIC = re.compile(r'RJ\s?/\s?\d{2}\s?/\s?\d{3}\s?/\s?\d{4,6}')

# Split a page's text into cards. Every card starts with the elector label.
CARD_SPLIT = re.compile(r'(?=निर्वाचक का नाम\s*:)')

# After folding confusions, the EPIC token -> roll row (built once in main).
KNOWN = {}          # folded epic -> roll row
BY_PAGE = {}        # (part, page) -> list of (folded epic, page text)


def fold(epic: str) -> str:
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


def norm_num(s: str) -> str:
    return re.sub(r'\D', '', s or '')


def parse_card(text: str):
    """One card's text -> dict of fields (best effort, OCR-quality)."""
    name = re.search(r'निर्वाचक का नाम\s*[:：]\s*([^\n|]+)', text)
    father = re.search(
        r'(पिता|पति|पत्ति|माता)\s*का नाम\s*[:：]?\s*([^\n|]+)', text)
    house = re.search(r'गृह संख्या\s*[:：]?\s*([0-9BGZS\-?]+)', text)
    age = re.search(r'उम्र\s*[:：]?\s*(\d{1,3})', text)
    gender = 'पुरुष' if 'पुरुष' in text else (
        'महिला' if 'महिला' in text else None)
    return {
        'name': name.group(1).strip() if name else None,
        'father': father.group(2).strip() if father else None,
        'house': house.group(1) if house else None,
        'age': age.group(1) if age else None,
        'gender': gender,
    }


def scan_file(args):
    """OCR every page of one hit file; return per-page EPIC -> card parses."""
    part, path = args
    rows = []
    doc = pymupdf.open(path)
    try:
        for pno in range(doc.page_count):
            try:
                pix = doc[pno].get_pixmap(dpi=300)
                img = Image.open(io.BytesIO(pix.tobytes('png')))
                text = pytesseract.image_to_string(
                    img, lang='eng+hin', config='--psm 6')
            except Exception as exc:
                rows.append({'page': pno + 1, 'error': str(exc)})
                continue
            epics = [fold(m.group(0)) for m in NEW_EPIC.finditer(text)] + \
                    [fold(m.group(0)) for m in OLD_EPIC.finditer(text)]
            cards = {}
            for chunk in CARD_SPLIT.split(text):
                head = re.match(
                    r'^\s*(\d{1,4})\s+([A-Z0-9/\s]{6,20})', chunk)
                # EPIC sits on the serial line before the first निर्वाचक label,
                # so pull it from the whole page list positionally instead of
                # per-chunk when the regex misses.
                m = NEW_EPIC.search(chunk) or OLD_EPIC.search(chunk)
                if m:
                    cards[fold(m.group(0))] = parse_card(chunk)
            rows.append({
                'page': pno + 1,
                'epics': epics,
                'cards': {k: v for k, v in cards.items()},
                'matched': [e for e in epics if e in KNOWN],
            })
    finally:
        doc.close()
    return {'part': part, 'file': os.path.basename(path), 'pages': rows}


def main():
    global KNOWN
    data = json.load(open(RECORDS, encoding='utf-8'))
    for r in data['records']:
        KNOWN[fold((r['epic'] or '').upper())] = r
    print('roll rows indexed:', len(KNOWN))

    hits = json.load(open(HITS, encoding='utf-8'))
    hit_parts = sorted({r['part'] for r in hits['results']
                        if r['hits'] or r['old_hits']})
    print('pass-1 hit parts:', hit_parts)

    jobs = []
    for r in hits['results']:
        if r['part'] in hit_parts:
            jobs.append((r['part'], os.path.join(EROLL_DIR, r['file'])))
    print('deep-scanning files:', len(jobs))

    results = []
    workers = min(6, os.cpu_count() or 2)
    with mp.Pool(workers) as pool:
        for res in pool.imap_unordered(scan_file, jobs):
            results.append(res)
            matched = sum(len(p.get('matched', [])) for p in res['pages'])
            print('part %d: %d pages, %d matched EPICs'
                  % (res['part'], len(res['pages']), matched), flush=True)
    results.sort(key=lambda r: r['part'])

    # Flatten: matched EPIC -> {roll row, eroll part/page, card OCR fields}
    matches = []
    matched_ids = set()
    for res in results:
        for page in res['pages']:
            for epic in page.get('matched', []):
                roll = KNOWN[epic]
                matched_ids.add(roll['epic'])
                card = page.get('cards', {}).get(epic, {})
                matches.append({
                    'ward': roll['ward'],
                    'serial': roll['serial'],
                    'epic': roll['epic'],
                    'eroll_part': res['part'],
                    'eroll_page': page['page'],
                    'roll_name': roll['name'],
                    'eroll_name': card.get('name'),
                    'roll_father': roll['father'],
                    'eroll_father': card.get('father'),
                    'roll_house': roll['house'],
                    'eroll_house': card.get('house'),
                    'roll_age': roll['age'],
                    'eroll_age': card.get('age'),
                    'roll_gender': roll['gender'],
                    'eroll_gender': card.get('gender'),
                })
    matches.sort(key=lambda m: (m['ward'], m['serial'] or 0))

    unmatched = [r for r in data['records'] if r['epic'] not in matched_ids]

    out = {
        'hit_parts': hit_parts,
        'files_deep_scanned': len(results),
        'matched_voters': len(matches),
        'roll_total': len(data['records']),
        'unmatched': len(unmatched),
        'note': 'Pass-2 deep OCR (300 dpi, eng+hin, psm 6) of pass-1 hit '
                'files; fields are OCR-quality and intended for '
                'cross-checking the ward roll, not replacing it. No photo '
                'images exist: cells print "फोटो उपलब्ध".',
        'matches': matches,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('saved', OUT)
    print('matched %d / %d voters; unmatched %d'
          % (len(matches), len(data['records']), len(unmatched)))


if __name__ == '__main__':
    main()
