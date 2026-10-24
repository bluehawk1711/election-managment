# -*- coding: utf-8 -*-
"""Detect portrait photo boxes on an additions page via ruled-cell detection.

The additions page draws each voter in a bordered cell. We detect the cell
grid from long horizontal/vertical dark lines, then take the right portion of
each cell (where the portrait sits) as the photo crop.
"""
import sys, os, json
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from PIL import Image
import pytesseract

def detect_cells(img, min_frac=0.5):
    g = np.array(img.convert('L'))
    H, W = g.shape
    dark = g < 160
    # horizontal lines: rows with a long run of dark pixels
    row_frac = dark.mean(axis=1)
    col_frac = dark.mean(axis=0)
    hlines = [y for y in range(H) if row_frac[y] > min_frac]
    vlines = [x for x in range(W) if col_frac[x] > min_frac * 0.5]
    return hlines, vlines, (W, H)

def cluster(vals, gap=8):
    out = []
    for v in vals:
        if out and v - out[-1][-1] <= gap:
            out[-1].append(v)
        else:
            out.append([v])
    return [int(np.mean(c)) for c in out]

def main():
    page_png = sys.argv[1]
    img = Image.open(page_png)
    hlines, vlines, (W, H) = detect_cells(img)
    hc = cluster(hlines); vc = cluster(vlines)
    print('page', page_png, img.size, 'hlines', hc, 'vlines', vc)
    # build cells from consecutive h/v line pairs
    cells = []
    for i in range(len(hc) - 1):
        y0, y1 = hc[i], hc[i + 1]
        if y1 - y0 < 60:
            continue
        xs = [x for x in vc if y0 < x < y1] or vc
        for j in range(len(vc) - 1):
            x0, x1 = vc[j], vc[j + 1]
            if x1 - x0 < 120:
                continue
            cells.append((x0, y0, x1, y1))
    # dedupe + sort reading order
    cells = sorted(set(cells), key=lambda c: (c[1], c[0]))
    print('cells', len(cells))
    out = []
    for (x0, y0, x1, y1) in cells:
        w, h = x1 - x0, y1 - y0
        pad = 6
        # text = left 60%, photo = right 40%
        tx1 = x0 + int(w * 0.62)
        text_box = (x0 + pad, y0 + pad, tx1, y1 - pad)
        photo_box = (tx1 + 4, y0 + pad, x1 - pad, y1 - pad)
        t = img.crop(text_box)
        txt = pytesseract.image_to_string(t, lang='hin+eng')
        import re
        def grab(label):
            m = re.search(label + r'\s*[:：]?\s*([^\n]+)', txt)
            return m.group(1).strip(' .।') if m else ''
        serial = grab(r'(?:क्रमांक|संख्या|क्र)')
        m = re.search(r'\b(\d{2,4})\b', txt)
        serial_num = int(m.group(1)) if m else None
        name = grab('नाम')
        rel = grab(r'पिता का नाम|पति का नाम|माता का नाम')
        rel_label = 'पिता' if 'पिता' in txt else ('पति' if 'पति' in txt else ('माता' if 'माता' in txt else ''))
        out.append(dict(box=[x0, y0, x1, y1], photo=list(photo_box),
                        serial=serial_num, name=name, rel=rel, rel_label=rel_label,
                        raw=txt.strip()))
    print(json.dumps(out, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
