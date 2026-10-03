# -*- coding: utf-8 -*-
"""Targeted repair: crop the exact cell of each remaining problem record
from the 300-dpi page image, upscale 3x, OCR with psm 6, print all lines
so the values can be patched manually/via patch_file.py.
"""
import pymupdf, re, os, json, subprocess, sys
from PIL import Image

import importlib.util
WORK = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p4', os.path.join(WORK, 'parse4.py'))
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)

TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
SX = 2480 / 595.0
SY = 3505 / 841.0

probs = json.load(open(os.path.join(WORK, 'problems.json'), encoding='utf-8'))
doc = pymupdf.open('data/veernagar-1.pdf')

for item in probs['items']:
    pno, col, epic = item['page'], item['col'], item['epic']
    page = doc[pno - 1]
    raw = page.get_text('words')
    grid = [w for w in raw if 138.0 <= w[1] and w[3] <= 812.0]
    clusters = p4.cluster_lines(grid)
    info = [{'center': p4.line_center(c), 'words': c} for c in clusters]
    info.sort(key=lambda d: min(w[1] for w in d['words']))
    # find serial line with this epic
    si = None
    for i, d in enumerate(info):
        if any(epic == w[4] for w in d['words']):
            si = i
            break
    if si is None:
        print('epic not found:', item)
        continue
    # cell rows: serial line .. up to 4 lines below
    y0 = min(w[1] for w in info[si]['words']) - 3
    y1 = max(w[3] for w in info[si + 4]['words']) + 3 if si + 4 < len(info) else y0 + 60
    x0 = p4.COL_EDGES[col]
    x1 = p4.COL_EDGES[col + 1]
    box = (x0 * SX - 6, y0 * SY, x1 * SX + 6, y1 * SY)
    img = Image.open('ocr_pages/page-%04d.png' % pno).crop(
        tuple(int(v) for v in box))
    img = img.resize((img.width * 3, img.height * 3), Image.LANCZOS)
    cell_path = os.path.join(WORK, 'cell_p%d_%d.png' % (pno, col))
    img.save(cell_path)
    out = subprocess.run([TESS, cell_path, 'stdout', '-l', 'hin+eng',
                          '--psm', '6', 'tsv'], capture_output=True)
    text = out.stdout.decode('utf-8', errors='replace')
    # group words into lines by (block, par, line)
    lines = {}
    for ln in text.splitlines()[1:]:
        p = ln.split('\t')
        if len(p) < 12 or p[0] != '5' or not p[11].strip():
            continue
        try:
            conf = float(p[10])
        except ValueError:
            continue
        if conf < 20:
            continue
        key = (p[2], p[3], p[4])
        lines.setdefault(key, []).append((float(p[6]), p[11], conf))
    print('=== page %d col %d epic %s missing %s' % (pno, col, epic, item['missing']))
    for key in sorted(lines, key=lambda k: min(w[0] for w in lines[k])):
        ws = sorted(lines[key])
        print('   ', ' '.join(w[1] for w in ws))
    print('   saved', cell_path)
