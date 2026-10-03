# -*- coding: utf-8 -*-
"""Recover the mother's name for rows where only the label 'माता का' was OCR'd.
Crops the father-line cell of each record at 300dpi, upscales 4x, OCRs it.
"""
import pymupdf, os, json, subprocess, sys
from PIL import Image
import importlib.util

WORK = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p4', os.path.join(WORK, 'parse4.py'))
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)

TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
SX = 2480 / 595.0
SY = 3505 / 841.0

TARGETS = [(50, 513), (94, 761), (112, 374), (209, 3), (211, 54), (304, 455)]
doc = pymupdf.open('data/veernagar-1.pdf')

for pno, serial in TARGETS:
    page = doc[pno - 1]
    raw = page.get_text('words')
    grid = [w for w in raw if 138.0 <= w[1] and w[3] <= 812.0]
    clusters = p4.cluster_lines(grid)
    info = [{'center': p4.line_center(c), 'words': c} for c in clusters]
    info.sort(key=lambda d: min(w[1] for w in d['words']))
    si, col = None, None
    for i, d in enumerate(info):
        if not any(p4.is_epic_like(w[4]) for w in d['words']):
            continue
        for w in d['words']:
            if w[4].strip().isdigit() and int(w[4]) == serial:
                si, col = i, p4.col_of(w[0])
                break
        if si is not None:
            break
    if si is None or si + 2 >= len(info):
        print('not found:', pno, serial)
        continue
    y0 = min(w[1] for w in info[si + 2]['words']) - 3
    y1 = max(w[3] for w in info[si + 2]['words']) + 3
    x0, x1 = p4.COL_EDGES[col], p4.COL_EDGES[col + 1]
    box = (int(x0 * SX - 6), int(y0 * SY), int(x1 * SX + 6), int(y1 * SY))
    img = Image.open('ocr_pages/page-%04d.png' % pno).crop(box)
    img = img.resize((img.width * 4, img.height * 4), Image.LANCZOS)
    p = os.path.join(WORK, 'mata_p%d_%d.png' % (pno, serial))
    img.save(p)
    outs = []
    for psm in ('7', '6'):
        r = subprocess.run([TESS, p, 'stdout', '-l', 'hin+eng', '--psm', psm],
                           capture_output=True)
        outs.append(r.stdout.decode('utf-8', errors='replace').strip())
    print('page %d serial %d col %d ->' % (pno, serial, col), outs)
