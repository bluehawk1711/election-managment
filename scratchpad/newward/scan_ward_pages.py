# -*- coding: utf-8 -*-
"""Scan ward supplement PDFs: render pages, find the additions (परिवर्धन) section."""
import sys, os, re
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf
import pytesseract
from PIL import Image

OUT = 'scratchpad/newward'
for w in (3, 7, 10):
    doc = pymupdf.open('data/Ward No- %d.pdf' % w)
    print('=== Ward No- %d.pdf : %d pages' % (w, doc.page_count))
    for pno in range(doc.page_count):
        page = doc[pno]
        pix = page.get_pixmap(dpi=200)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        txt = pytesseract.image_to_string(img, lang='hin+eng')
        # additions markers
        is_add = ('परिवर्धन' in txt) or ('परवरधन' in txt)
        # serial numbers present (standalone digits 3+)
        nums = re.findall(r'\b(\d{2,3})\b', txt)
        tag = 'ADD' if is_add else '   '
        print('  p%-2d %s  nums~%s  head=%r' % (pno + 1, tag, nums[:12], txt[:60].replace('\n', ' ')))
        # save the addition pages for cropping
        if is_add:
            img.save(os.path.join(OUT, 'ward%d_add_p%d.png' % (w, pno + 1)))
    doc.close()
print('saved addition-page renders to', OUT)
