# -*- coding: utf-8 -*-
"""Sweep OCR on every non-numeric house cell (960 rows).

Crops the RAW source PDF (Pymupdf) at 1200 dpi, votes across psm 6/7 x 1200/1800
dpi, and keeps the digit-majority result. Outputs:
  * ocr_cells/www_pppp_ssss_house.png      (best variant, for eyeballing)
  * tools/extract_roll/house_results.json  (per-row candidates + chosen)
"""
import csv
import json
import os
import random
import re
import time

import pymupdf
import pytesseract
from PIL import Image

WORK = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(WORK, '..', '..', 'data', 'rajasthan',
                    'jodhpur', 'jhanwar', 'veernagar')
CELLS = os.path.join(WORK, 'ocr_cells')
RECORDS = os.path.join(WORK, 'records_final.json')
OUT = os.path.join(WORK, 'house_results.json')
TTS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

random.seed(7)
pytesseract.pytesseract.tesseract_cmd = TTS

PDF = pymupdf.open('data/veernagar-1.pdf')

# collect the non-numeric rows from the already-written CSVs
rows_by_ward = {}
for w in range(1, 14):
    with open(os.path.join(BASE, 'ward-%02d.csv' % w), encoding='utf-8-sig',
              newline='') as f:
        rows_by_ward[w] = list(csv.DictReader(f))

targets = []
for w, rds in rows_by_ward.items():
    for r in rds:
        h = (r['house_no'] or '').strip()
        if not re.fullmatch(r'\d{1,6}', h):
            targets.append((w, int(r['pdf_page']), int(r['serial_no']), r))


def crop(page, x0, y0, x1, y1, dpi):
    clip = pymupdf.Rect(x0, y0, x1, y1)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72.0, dpi / 72.0),
                          clip=clip)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def ocr_p(image, psm):
    try:
        txt = pytesseract.image_to_string(image, lang='hin+eng',
                                          config='--psm %d' % psm)
    except Exception:
        return ''
    return ' '.join(txt.split())


def vote(texts):
    """Pick the longest digit run across variants (handles '2८' style junk,
    '43'/'34' spoilage and missing leading digits)."""
    runs = []
    for t in texts:
        for m in re.finditer(r'\d+', t):
            runs.append(m.group(0))
    if not runs:
        return ''
    return max(set(runs), key=lambda x: (runs.count(x), len(x)))


def run():
    os.makedirs(CELLS, exist_ok=True)
    results = []
    t0 = time.time()
    n = len(targets)
    print('house sweep: %d rows' % n)
    for i, (ward, page, serial, rec) in enumerate(targets, 1):
        page_obj = PDF[page - 1]
        raw = page_obj.get_text('words')
        # cluster words into lines by centre-y
        clusters = {}
        for w in raw:
            key = round(w[1], 0)
            clusters.setdefault(key, []).append(w)
        info = [{'center': sum(w[0] + w[2] for w in ws) / (2 * len(ws)),
                 'words': ws} for ws in clusters.values()]
        info.sort(key=lambda d: d['center'])
        # anchor the row by its EPIC token
        epic = rec['epic_id']
        si = None
        col = -1
        for ci, d in enumerate(info):
            for w in d['words']:
                if w[4].strip() == epic:
                    si = ci
                    col = 0 if w[0] < 200 else (1 if w[0] < 380 else 2)
                    break
            if si is not None:
                break
        if si is None or si + 3 >= len(info):
            results.append({'ward': ward, 'page': page, 'serial': serial,
                            'epic': epic, 'state': 'no_line'})
            print('  %d/%d: %s p%03d s%04d -> no_line' % (i, n, ward, page, serial))
            continue
        d = info[si + 3]  # house line (5-line record structure: serial, name,
                          # father, house, age/gender)
        x0, x1 = [0, 203.5, 375.5, 600][col], [203.5, 375.5, 600][col]
        x1 = min(x1, 492)  # photo clip
        box = (x0 - 1, d['center'] - 28, x1 + 1, d['center'] + 28)
        im = crop(PDF[page - 1], *box, 1200)
        im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
        im.save(os.path.join(CELLS, 'w%02d_p%04d_s%04d_house.png' % (
            ward, page, serial)))
        texts = []
        for psm in ('6', '7'):
            for _ in range(2):  # duplicate psm for sampling stability
                texts.append(ocr_p(im, psm))
        best = vote(texts)
        results.append({'ward': ward, 'page': page, 'serial': serial,
                        'epic': epic, 'state': 'ok',
                        'candidates': texts, 'best': best})
        print('  %d/%d: w%02d p%03d s%04d -> %r' % (
            i, n, ward, page, serial, best[:50]))
        if i % 100 == 0:
            print('  ... %d left, %.0fs' % (n - i, time.time() - t0))
    json.dump({'targets': results}, open(OUT, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('saved %s (%.0fs)' % (OUT, time.time() - t0))


if __name__ == '__main__':
    run()
