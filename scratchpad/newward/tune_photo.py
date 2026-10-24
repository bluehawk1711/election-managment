# -*- coding: utf-8 -*-
"""Locate photo inside a known cell: scan right-side strip, print density profile."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import importlib.util
spec = importlib.util.spec_from_file_location('c', 'scratchpad/newward/crop_all_purak.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import numpy as np, cv2

doc = m.pymupdf.open('data/Ward No- 9.pdf')
gray = m.render_gray(doc[15])  # w9 p16
# cell for 221 = (127,1048,2179,1424); photo should be right side
for label, (x0, y0, x1, y1) in [('221', (127, 1048, 2179, 1424))]:
    strip = gray[y0:y1, x1 - 900:x1]
    ink = (strip < 200).astype(np.float32)
    # column density profile
    col = ink.mean(axis=0)
    print(label, 'col density (every 30px from right):')
    for i, v in enumerate(col[::-1][::30]):
        print('   dx=%4d dens=%.2f' % (i * 30, v))
    # row density
    row = ink.mean(axis=1)
    print(label, 'row density (every 30px):')
    for i, v in enumerate(row[::30]):
        print('   dy=%4d dens=%.2f' % (i * 30, v))
doc.close()
