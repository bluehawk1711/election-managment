# -*- coding: utf-8 -*-
"""Detect real cells on ward 9 p16 and profile each to locate its photo."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import numpy as np
import pymupdf
from PIL import Image

doc = pymupdf.open('data/Ward No- 9.pdf')
gray = m.render_gray(doc[15])
H, W = gray.shape
cells = m.detect_cells(gray)
# keep voter-sized cells (taller than ~250px)
cells = [c for c in cells if (c[3] - c[1]) >= 250]
cells.sort(key=lambda c: (c[1], c[0]))
print('voter cells', len(cells))
for i, (x0, y0, x1, y1) in enumerate(cells):
    region = gray[y0:y1, x0:x1]
    ink = (region < 205).astype(np.float32)
    col = ink.mean(axis=0)
    # find rightmost dense band (the photo): scan from right
    rw = x1 - x0
    # profile in 10 buckets
    buckets = [col[int(j*rw/10):int((j+1)*rw/10)].mean() for j in range(10)]
    print('cell %d box=(%d,%d,%d,%d) w=%d h=%d colbuckets=%s' %
          (i, x0, y0, x1, y1, rw, y1-y0,
           ' '.join('%.2f' % b for b in buckets)))
    # crop right 35% as candidate photo and save
    cand = gray[y0:y1, int(x1 - rw*0.38):x1]
    Image.fromarray(cand).save('scratchpad/newward/cand_%d.png' % i)
doc.close()
