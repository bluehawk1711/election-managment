# -*- coding: utf-8 -*-
"""Inspect embedded images on the candidate pages for missing additions."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf

doc = pymupdf.open('data/VeerNagar-photos.pdf')
for pno in (101, 211, 255, 256):
    page = doc[pno - 1]
    imgs = page.get_images(full=True)
    print('=== page %d: %d images, rect=%s' % (pno, len(imgs), page.rect))
    for i, im in enumerate(imgs):
        xref = im[0]
        info = doc.extract_image(xref)
        # position on page
        rects = page.get_image_rects(xref)
        r = rects[0] if rects else None
        print('  [%d] xref=%d %dx%d %s ext=%s at %s' %
              (i, xref, info['width'], info['height'], info['colorspace'], info['ext'],
               ('(%.0f,%.0f,%.0f,%.0f)' % (r.x0, r.y0, r.x1, r.y1)) if r else '?'))
doc.close()
