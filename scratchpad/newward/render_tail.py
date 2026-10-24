# -*- coding: utf-8 -*-
"""Render tail pages of each ward supplement PDF to locate additions pages."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf
from PIL import Image

OUT = 'scratchpad/newward/tail'
os.makedirs(OUT, exist_ok=True)
TAIL = 6  # render last N pages
for w in (3, 7, 10):
    doc = pymupdf.open('data/Ward No- %d.pdf' % w)
    n = doc.page_count
    print('ward %d: %d pages' % (w, n))
    for pno in range(max(0, n - TAIL), n):
        pix = doc[pno].get_pixmap(dpi=150)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        # split into strips by height ratio (3 strips for 1239w, 4 for 1653w)
        path = os.path.join(OUT, 'ward%d_p%02d.png' % (w, pno + 1))
        img.save(path)
        print('  saved', path, img.size)
    doc.close()
print('done')
