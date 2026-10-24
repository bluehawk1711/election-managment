# -*- coding: utf-8 -*-
"""Locate the additions page in each ward supplement PDF by matching a known
addition name via targeted OCR."""
import sys, os, re
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf
import pytesseract
from PIL import Image

TARGETS = {
    3: ['रेखा जांगिड', 'राधेश्याम जांगिड', 'निरमा', 'कालु'],
    7: ['मंजू सोनी', 'गौरव सोनी', 'भगवानराम', 'गौतम'],
    10: ['मीनाक्षी', 'अंजनी', 'पूजा', 'नितिन'],
}
OUT = 'scratchpad/newward'
for w, names in TARGETS.items():
    doc = pymupdf.open('data/Ward No- %d.pdf' % w)
    print('=== Ward No- %d.pdf (%d pages)' % (w, doc.page_count))
    for pno in range(doc.page_count):
        page = doc[pno]
        pix = page.get_pixmap(dpi=160)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        txt = pytesseract.image_to_string(img, lang='hin+eng')
        hits = [n for n in names if n in txt]
        if hits:
            print('  p%-2d HIT %s' % (pno + 1, hits))
            img.save(os.path.join(OUT, 'ward%d_add_p%d.png' % (w, pno + 1)))
    doc.close()
print('done')
