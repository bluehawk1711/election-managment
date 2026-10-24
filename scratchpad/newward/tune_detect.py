# -*- coding: utf-8 -*-
"""Tune photo-box + serial-box detection on known purak pages."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import numpy as np, cv2

PAGES = [('data/Ward No- 9.pdf', 15), ('data/Ward No- 9.pdf', 11),
         ('data/Ward No- 10.pdf', 13), ('data/Ward No- 10.pdf', 14)]

for pdf, pg in PAGES:
    doc = m.pymupdf.open(pdf)
    gray = m.render_gray(doc[pg])
    ink = (gray < 190).astype(np.uint8)
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (200, 1))
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 160))
    hl = cv2.morphologyEx(ink, cv2.MORPH_OPEN, hk)
    vl = cv2.morphologyEx(ink, cv2.MORPH_OPEN, vk)
    clean = (ink & ~(hl | vl)).astype(np.float32)
    dens = cv2.boxFilter(clean, -1, (190, 230), normalize=True)
    mask = (dens > 0.33).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (40, 40)))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(mask, 8)
    print('==', pdf, 'page', pg + 1)
    print('-- photo candidates (density map):')
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if 100 <= w <= 500 and 120 <= h <= 500:
            print('   %4d %4d %3d %3d' % (x, y, w, h))
    # serial boxes: small filled rects after 25px dilation of raw ink
    k25 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
    d25 = cv2.dilate(ink, k25, 1)
    n2, l2, s2, c2 = cv2.connectedComponentsWithStats(d25, 8)
    print('-- serial box candidates:')
    cnt = 0
    for i in range(1, n2):
        x, y, w, h, area = s2[i]
        if 100 <= w <= 230 and 55 <= h <= 130 and area / (w * h) > 0.45:
            txt = m.tess(gray[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4], 7,
                         lang='eng', whitelist='0123456789')
            print('   %4d %4d %3d %3d -> %r' % (x, y, w, h, txt.strip()))
            cnt += 1
    print('   total', cnt)
    doc.close()
