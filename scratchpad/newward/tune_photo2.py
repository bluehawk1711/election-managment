# -*- coding: utf-8 -*-
"""Scan grid of cells on ward 9 p16 additions page; find photo by ink density."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import numpy as np

doc = m.pymupdf.open('data/Ward No- 9.pdf')
gray = m.render_gray(doc[15])  # page 16
H, W = gray.shape
print('page shape', H, W)

# From tune_serial.py, serial boxes on this page are at approx y=1512,1505,1799...
# Each cell spans roughly: box_y-40 .. box_y+340, box_x-30 .. box_x+700
# Let's scan bands around each known serial box and report the ink-density
# profile of the region to the right of the text (where the photo sits).
BOXES = [(145, 1512, 130, 42), (828, 1505, 134, 49), (146, 1799, 130, 59)]
for i, (bx, by, bw, bh) in enumerate(BOXES):
    x0 = max(0, bx - 40)
    x1 = min(W, bx + 760)
    y0 = max(0, by - 60)
    y1 = min(H, by + 420)
    region = gray[y0:y1, x0:x1]
    ink = (region < 205).astype(np.float32)
    # column density every 40px from left of region
    col = ink.mean(axis=0)
    row = ink.mean(axis=1)
    print('--- box %d at (%d,%d) region x[%d:%d] y[%d:%d]' % (i, bx, by, x0, x1, y0, y1))
    print('  col profile (from region left):')
    prof = []
    for j in range(0, len(col), 40):
        prof.append('x+%d=%.2f' % (j, col[j]))
    print('   ', ' '.join(prof))
    print('  row profile (from region top):')
    prof = []
    for j in range(0, len(row), 40):
        prof.append('y+%d=%.2f' % (j, row[j]))
    print('   ', ' '.join(prof))
doc.close()
