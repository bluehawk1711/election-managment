# -*- coding: utf-8 -*-
"""Photo detector: locate the portrait inside a purak cell.

A voter cell has Hindi text on the left and a portrait photo on the right.
The photo is a tall, densely-inked rectangular block. We detect it by:
  1. taking the cell region,
  2. eroding away thin strokes so text lines collapse but the solid photo
     survives,
  3. finding the largest tall component in the right portion of the cell.

Returns (x0,y0,x1,y1) in absolute page coords, or None.
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
import cv2

def find_photo(gray, cell, page_w):
    x0, y0, x1, y1 = cell
    # Only look at the right 70% of the cell where photos live; photos are
    # ~150-260px wide at 300dpi.
    sx0 = x0 + int((x1 - x0) * 0.30)
    region = gray[y0:y1, sx0:x1]
    if region.size == 0:
        return None
    # Bin dark<205 to catch light-grey scan backgrounds of photos.
    ink = (region < 205).astype(np.uint8)
    # Vertical closing merges stacked text lines / photo into solid blocks.
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 40))
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, vk)
    # Horizontal opening removes stray horizontal rules longer than photo.
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (60, 1))
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, hk)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(opened, 8)
    best = None
    best_score = -1
    for i in range(1, n):
        cx, cy, w, h, area = stats[i]
        if h < 120 or w < 90 or w > 340:
            continue
        ar = w / h
        if not (0.45 <= ar <= 1.1):
            continue
        fill = area / (w * h)
        if fill < 0.5:
            continue
        score = area
        if score > best_score:
            best_score = score
            best = (sx0 + cx, y0 + cy, sx0 + cx + w, y0 + cy + h)
    return best


def crop_photo(gray, box, pad=6):
    x0, y0, x1, y1 = box
    H, W = gray.shape
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(W, x1 + pad); y1 = min(H, y1 + pad)
    return gray[y0:y1, x0:x1]


if __name__ == '__main__':
    import importlib.util
    spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    import pymupdf
    doc = pymupdf.open('data/Ward No- 9.pdf')
    gray = m.render_gray(doc[15])
    H, W = gray.shape
    # Known serial boxes on w9 p16 -> approximate cells around them
    CELLS = [(127, 1048, 700, 1424), (810, 1048, 1390, 1424), (1490, 1048, 2070, 1424)]
    from PIL import Image
    for i, cell in enumerate(CELLS):
        box = find_photo(gray, cell, W)
        if box is None:
            print(i, 'no photo'); continue
        sub = crop_photo(gray, box)
        Image.fromarray(sub).save('scratchpad/newward/testphoto_%d.png' % i)
        print(i, 'photo box', box, 'size', sub.shape)
    doc.close()
