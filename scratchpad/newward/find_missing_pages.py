# -*- coding: utf-8 -*-
"""Find which photos-PDF pages stamp the missing addition serials, per ward."""
import json, sys, re
sys.stdout.reconfigure(encoding='utf-8')
import pymupdf

m = json.load(open('data/photos/manifest.json', encoding='utf-8'))
missing = json.load(open('scratchpad/newward/missing_photos.json', encoding='utf-8'))

# Build per-ward serial -> set of pdf_pages where any image is stamped
pages_for = {}
for e in m['images']:
    if e.get('kind') != 'portrait':
        continue
    w, s = e.get('ward'), e.get('serial')
    if not w or not s:
        continue
    pages_for.setdefault((w, s), set()).add(e['pdf_page'])

doc = pymupdf.open('data/VeerNagar-photos.pdf')
print('photos pdf pages:', doc.page_count)

for wk in sorted(missing, key=int):
    w = int(wk)
    ms = missing[wk]
    if not ms:
        continue
    # union of pages that carry any of this ward's nearby serials
    cand = set()
    for (ww, s), ps in pages_for.items():
        if ww == w and (min(ms) - 4) <= s <= (max(ms) + 2):
            cand |= ps
    print('\nward %d missing %s -> candidate pages %s' % (w, ms, sorted(cand)))
    for pno in sorted(cand):
        if 1 <= pno <= doc.page_count:
            print('   p%d text head: %r' % (pno, doc[pno - 1].get_text()[:120].replace('\n', ' | ')))
doc.close()
