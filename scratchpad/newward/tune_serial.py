# -*- coding: utf-8 -*-
"""Find + OCR serial boxes precisely on known purak pages (contour approach)."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import numpy as np, cv2, re

def find_serial_box(gray, cell):
    x0, y0, x1, y1 = cell
    reg = gray[max(0, y0):y0 + 130, max(0, x0):min(gray.shape[1], x0 + 450)]
    bw = (reg < 160).astype(np.uint8)
    cnts, _ = cv2.findContours(bw, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if 70 <= w <= 260 and 28 <= h <= 90 and 1.4 <= w / h <= 4.5:
            peri = cv2.arcLength(c, True)
            ap = cv2.approxPolyDP(c, 0.08 * peri, True)
            if 4 <= len(ap) <= 6:
                score = w * h
                if best is None or score > best[0]:
                    best = (score, x0 + x, y0 + y, w, h)
    return best

for pdf, pg, expect in [('data/Ward No- 9.pdf', 15, [221, 222, 223, 224, 225]),
                        ('data/Ward No- 10.pdf', 13, list(range(195, 214)))]:
    doc = m.pymupdf.open(pdf)
    gray = m.render_gray(doc[pg])
    cells = m.detect_cells(gray)
    cells = [c for c in cells if c[3] - c[1] > 100]
    cells.sort(key=lambda c: (c[1], c[0]))
    rows, cur, row_y = [], [], None
    for c in cells:
        if cur and c[1] - row_y > 60:
            rows.append(cur); cur = []
        if not cur:
            row_y = c[1]
        cur.append(c)
    if cur:
        rows.append(cur)
    ordered = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda c: c[0]))
    print('==', pdf, 'page', pg + 1, 'cells', len(ordered))
    i = 0
    for cell in ordered:
        b = find_serial_box(gray, cell)
        if b is None:
            print('   cell', cell, '-> no box')
            continue
        _, bx, by, bw2, bh2 = b
        crop = gray[by - 3:by + bh2 + 3, bx - 3:bx + bw2 + 3]
        outs = {}
        for psm in (7, 8, 13):
            t = m.tess(crop, psm, lang='eng', whitelist='0123456789').strip()
            outs[psm] = t
        print('   box %4d %4d %3d %3d -> %s (expect %s)' %
              (bx, by, bw2, bh2, outs, expect[i] if i < len(expect) else '?'))
        i += 1
    doc.close()
