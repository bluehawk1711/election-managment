# -*- coding: utf-8 -*-
"""Recover EPIC ids for new-voter (addition) serials from VeerNagar-photos.pdf
text layer. The purak pages print EPIC right before/after the serial number.

Also reports which pages contain the target serials (to know if photos exist).
"""
import pymupdf, re, sys, csv, glob, os, json

sys.stdout.reconfigure(encoding='utf-8')

EPIC_RE = re.compile(r'(?:RJ/\d{2}/\d{3}/\d{6}|[A-Z]{3}\d{7}|[A-Z]{2}\d{7,8})')

# additions per ward from CSVs (empty pdf_page)
adds = {}
for f in sorted(glob.glob('data/rajasthan/jodhpur/jhanwar/veernagar/ward-*.csv')):
    w = int(os.path.basename(f)[5:7])
    rows = list(csv.DictReader(open(f, encoding='utf-8-sig')))
    adds[w] = sorted(int(r['serial_no']) for r in rows if not (r.get('pdf_page') or '').strip())

doc = pymupdf.open('data/VeerNagar-photos.pdf')

# map: (ward, serial) -> epic
found = {}
# pages where each target serial token appears
pages_hit = {}

for pno in range(len(doc)):
    t = doc[pno].get_text()
    if not t:
        continue
    wm = re.search(r'कमरपक\s*:\s*(\d+)', t)
    ward = int(wm.group(1)) if wm else None
    if ward not in adds:
        continue
    targets = set(adds[ward])
    if not targets:
        continue
    # tokenize: keep positions of epics and standalone serial ints
    events = []
    for m in EPIC_RE.finditer(t):
        events.append((m.start(), 'epic', m.group(0)))
    for m in re.finditer(r'(?<![\d./])(\d{1,4})(?![\d./])', t):
        v = int(m.group(1))
        if v in targets:
            events.append((m.start(), 'serial', v))
    events.sort()
    for i, (pos, kind, val) in enumerate(events):
        if kind != 'serial':
            continue
        pages_hit.setdefault((ward, val), []).append(pno + 1)
        if (ward, val) in found:
            continue
        # look for nearest epic within +-160 chars
        best = None; bestd = 1e9
        for j, (p2, k2, v2) in enumerate(events):
            if k2 != 'epic':
                continue
            d = abs(p2 - pos)
            if d < bestd:
                bestd = d; best = v2
        if best is not None and bestd <= 160:
            found[(ward, val)] = (best, pno + 1, bestd)

doc.close()

# epic sanity: must exist in some ward csv already? just print
out = {}
for (w, s), (epic, page, dist) in sorted(found.items()):
    out.setdefault(str(w), {})[str(s)] = epic
    print('ward %d serial %d -> %s (page %d, dist %d)' % (w, s, epic, page, dist))

print()
print('=== serial token pages (photo availability) ===')
for k in sorted(pages_hit):
    print(k, sorted(set(pages_hit[k])))

print()
print('=== still missing epic ===')
for w in sorted(adds):
    miss = [s for s in adds[w] if (w, s) not in found]
    if miss:
        print('ward', w, miss)

json.dump(out, open('scratchpad/newward/addition_epics.json', 'w'), ensure_ascii=False, indent=1)
print('saved scratchpad/newward/addition_epics.json')
