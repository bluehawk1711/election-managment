# -*- coding: utf-8 -*-
"""Detect cell boxes on a purak (additions) page render and save a debug overlay."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf
import numpy as np
from PIL import Image, ImageDraw

PDF = sys.argv[1] if len(sys.argv) > 1 else 'data/Ward No- 9.pdf'
PNO = int(sys.argv[2]) if len(sys.argv) > 2 else 16   # 1-based
DPI = 300

doc = pymupdf.open(PDF)
page = doc[PNO - 1]
pix = page.get_pixmap(dpi=DPI)
img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples).convert('L')
doc.close()
a = np.array(img)
H, W = a.shape
dark = a < 160
print('render', W, H)

def runs(mask, min_len):
    # return list of (start, end) of True runs >= min_len along last axis
    out = []
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return out
    splits = np.flatnonzero(np.diff(idx) > 1)
    starts = np.r_[idx[0], idx[splits + 1]]
    ends = np.r_[idx[splits], idx[-1]]
    for s, e in zip(starts, ends):
        if e - s + 1 >= min_len:
            out.append((s, e))
    return out

# horizontal lines
hlines = []
for y in range(H):
    for s, e in runs(dark[y], 200):
        hlines.append((y, s, e))
# vertical lines
vlines = []
for x in range(W):
    for s, e in runs(dark[:, x], 150):
        vlines.append((x, s, e))

def merge(lines, gap=6):
    # lines: list of (fixed, a, b) -> group by proximity of fixed, union a..b
    if not lines:
        return []
    lines = sorted(lines)
    groups = []
    cur_f = [lines[0][0]]
    cur_iv = [(lines[0][1], lines[0][2])]
    for f, s, e in lines[1:]:
        if f - cur_f[-1] <= gap:
            cur_f.append(f)
            cur_iv.append((s, e))
        else:
            groups.append((int(np.mean(cur_f)), min(i[0] for i in cur_iv), max(i[1] for i in cur_iv)))
            cur_f = [f]; cur_iv = [(s, e)]
    groups.append((int(np.mean(cur_f)), min(i[0] for i in cur_iv), max(i[1] for i in cur_iv)))
    return groups

hm = merge(hlines)
vm = merge(vlines, gap=6)
print('h lines', len(hm), 'v lines', len(vm))

# cells: bands between consecutive h-lines, split by v-lines active in band
cells = []
for i in range(len(hm) - 1):
    y0 = hm[i][0]; y1 = hm[i + 1][0]
    if y1 - y0 < 80:
        continue
    # v lines spanning most of the band
    vs = [v for v in vm if v[1] <= y0 + 40 and v[2] >= y1 - 40]
    if len(vs) < 2:
        continue
    for j in range(len(vs) - 1):
        x0 = vs[j][0]; x1 = vs[j + 1][0]
        if x1 - x0 < 150:
            continue
        cells.append((x0, y0, x1, y1))
print('cells', len(cells))

ov = img.convert('RGB')
dr = ImageDraw.Draw(ov)
for c in cells:
    dr.rectangle(c, outline=(255, 0, 0), width=4)
ov.thumbnail((900, 1300))
ov.save('scratchpad/newward/cells_debug.png')
print('saved scratchpad/newward/cells_debug.png')
