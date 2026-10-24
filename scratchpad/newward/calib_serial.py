# -*- coding: utf-8 -*-
"""Calibrate serial box OCR against known printed serials (ward 10 page 14 = 195-213)."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import numpy as np, cv2, re

doc = m.pymupdf.open('data/Ward No- 10.pdf')
gray = m.render_gray(doc[13])  # page 14, serials 195-213

# Known cells from tune_serial.py run on this page (x,y,w,h -> serial)
KNOWN = [
    (128, 1130, 132, 43, 195), (144, 1793, 129, 58, 196),
    (827, 1786, 135, 58, 197), (1512, 1780, 131, 58, 198),
    (144, 2080, 130, 57, 199), (828, 2073, 135, 57, 200),
    (1513, 2067, 132, 57, 201), (146, 2365, 130, 59, 202),
    (829, 2358, 135, 58, 203), (1514, 2352, 133, 57, 204),
    (149, 2653, 129, 57, 205), (830, 2645, 135, 58, 206),
    (1515, 2639, 134, 57, 207),
]

def best_ocr(gray, bx, by, bw, bh):
    crop = gray[max(0,by-4):by+bh+4, max(0,bx-4):bx+bw+4]
    # upscale 2x for small digits
    up = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    results = {}
    for tag, img in [('raw', crop), ('up', up)]:
        for psm in (7, 8, 13):
            t = m.tess(img, psm, lang='eng', whitelist='0123456789').strip()
            digits = re.sub(r'[^0-9]', '', t)
            results[(tag, psm)] = digits
    return results

for bx, by, bw, bh, expect in KNOWN:
    r = best_ocr(gray, bx, by, bw, bh)
    row = ' '.join('%s=%s' % (k[0][1] + str(k[1]), v or '-') for k, v in sorted(r.items()))
    print('expect %3d -> %s' % (expect, row))
doc.close()
