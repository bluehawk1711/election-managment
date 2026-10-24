# -*- coding: utf-8 -*-
"""Inspect the ward supplement PDFs to locate addition pages + embedded photos."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf

for w in (3, 7, 10):
    doc = pymupdf.open('data/Ward No- %d.pdf' % w)
    print('=== Ward No- %d.pdf : %d pages' % (w, doc.page_count))
    for pno in range(doc.page_count):
        page = doc[pno]
        imgs = page.get_images(full=True)
        txt = page.get_text('text')[:80].replace('\n', ' | ')
        if imgs:
            dims = set((im[2], im[3]) for im in imgs)
            print('  p%d: %d imgs %s :: %s' % (pno + 1, len(imgs), dims, txt))
    doc.close()
