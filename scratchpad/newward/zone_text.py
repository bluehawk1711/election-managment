# -*- coding: utf-8 -*-
"""Map each embedded photo on candidate pages to its serial via adjacent cell text."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf

doc = pymupdf.open('data/VeerNagar-photos.pdf')

for pno in (101, 211, 255, 256):
    page = doc[pno - 1]
    imgs = page.get_images(full=True)
    slots = []
    for im in imgs:
        xref = im[0]
        r = page.get_image_rects(xref)[0]
        slots.append((xref, r))
    print('=== page %d (%d imgs)' % (pno, len(slots)))
    for xref, r in sorted(slots, key=lambda t: (round(t[1].y0), t[1].x0)):
        # text zone: same row (y within 60pt), left of photo
        zone = pymupdf.Rect(0, r.y0 - 6, r.x0 + 2, r.y1 + 6)
        txt = page.get_text('text', clip=zone).strip().replace('\n', ' | ')
        print('  xref=%d y=%.0f x=%.0f :: %s' % (xref, r.y0, r.x0, txt[:110]))
doc.close()
