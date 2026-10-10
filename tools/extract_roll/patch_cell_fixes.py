# -*- coding: utf-8 -*-
"""Phase-2 probe: re-read the 4 truncated locality headers + the 4 odd booth
digit crops at higher quality, with padded crops and more (dpi, psm) variants.

Prints every candidate so the right value can be picked by eye, and (with
--apply) writes the chosen localities into cell_fixes.json. Booth numbers are
evidence only — `fix_final.py` keeps the raw layer as the stored value.

Usage (cwd = repo root):
    python tools/extract_roll/patch_cell_fixes.py            # probe
    python tools/extract_roll/patch_cell_fixes.py --apply    # write chosen
"""
import json
import os
import re
import sys
import importlib.util

import pymupdf

WORK = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p4', os.path.join(WORK, 'parse4.py'))
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)

fc_spec = importlib.util.spec_from_file_location(
    'fix_cells', os.path.join(WORK, 'fix_cells.py'))
fc = importlib.util.module_from_spec(fc_spec)
fc_spec.loader.exec_module(fc)

APPLY = '--apply' in sys.argv
FIXES_PATH = os.path.join(WORK, 'cell_fixes.json')
fixes = json.load(open(FIXES_PATH, encoding='utf-8'))

fc.p4_mod.doc = pymupdf.open(fc.PDF)
data = json.load(open(fc.RECORDS, encoding='utf-8'))
recs, wards = data['records'], data['wards']

# ---------------------------------------------------------------- localities
# The four whose phase-1 read came back truncated (first word lost).
BAD_LOCS = {
    4: ('BOUT नगर, सांगरिया', 'नगर, सांगरिया'),
    8: ('PONT नगर, सांगरिया', 'नगर, सांगरिया'),
    11: ('BOUT नगर, सांगरिया', 'नगर, सांगरिया'),
    12: ('BOUT नगर, सांगरिया', 'नगर, सांगरिया'),
}

CHOSEN = {}  # (ward, old) -> new value, filled by --apply via CHOOSE below


def header_lines(ward_idx, old):
    """Every printed occurrence of a locality header string, as crop boxes."""
    wmeta = next(w for w in wards if w['idx'] == ward_idx)
    out = []
    for pno in range(wmeta['rec_start'], wmeta['rec_end'] + 1):
        page, info = fc.pageinfo(pno)
        try:
            ocrw = p4.read_ocr_tsv(p4.ocr_path(pno))
        except OSError:
            continue
        for d in info:
            if any(p4.is_epic_like(w[4]) for w in d['words']):
                continue
            txt = p4.ocr_line_text(ocrw, d['center'], conf_min=30, tol=8.0,
                                   full=True)
            if txt.strip() != old.strip():
                continue
            x0 = min(w[0] for w in d['words']) - 8   # 8pt pad, not 2
            x1 = max(w[2] for w in d['words']) + 4
            out.append((pno, (x0, d['y0'] - 3, x1, d['y1'] + 3)))
    return out


print('=== locality re-reads ===')
loc_candidates = {}
for ward, (old, cur_now) in BAD_LOCS.items():
    hits = header_lines(ward, old)
    votes = {}
    for pno, box in hits:
        for dpi in (900, 1800):
            img = fc.crop(fc.pageinfo(pno)[0], *box, dpi)
            for psm in ('6', '7', '11'):
                got, conf = fc.ocr_data(img, psm)
                v = fc.clean_value(got, 'name')
                ok = fc.valid_value(v, 'name') and not fc.ASCII2.search(v)
                print('  w%d p%d @%d psm%s: %r -> %r %s'
                      % (ward, pno, dpi, psm, got[:70], v,
                         'OK' if ok else 'reject'))
                if ok:
                    votes[v] = votes.get(v, 0) + 1
    loc_candidates[ward] = votes
    if votes:
        best = max(votes.items(), key=lambda kv: kv[1])
        print('  => ward %d winner %r (%d votes of %d)'
              % (ward, best[0], best[1], sum(votes.values())))
    print()

# ------------------------------------------------------------------- booths
# 91 read as 97 (the font's '1' has a serif foot → looks like 7), 102 as 02.
# Re-crop with a wider margin and more configs to give verification.md an
# honest answer; raw layer stays the stored value either way.
print('=== booth digit re-reads (wards 1, 7, 11, 13) ===')
for wn in (1, 7, 11, 13):
    wmeta = next(w for w in wards if w['ward_no'] == wn)
    page = fc.p4_mod.doc[wmeta['cover'] - 1]
    words = page.get_text('words')
    for i, wd in enumerate(words):
        if re.fullmatch(r'\d{1,3}', wd[4]) and i + 1 < len(words) \
                and words[i + 1][4].startswith('-'):
            raw_booth = fixes['covers'][str(wn)].get('booth_raw')
            # only the booth line: its number must equal the raw layer's
            if raw_booth and wd[4] != raw_booth:
                continue
            for pad in (4, 10):
                box = (wd[0] - pad, wd[1] - pad, wd[2] + pad, wd[3] + pad)
                for dpi in (1200, 2400):
                    img = fc.crop(page, *box, dpi)
                    for psm in ('7', '8', '10', '13'):
                        for wl in ('0123456789', None):
                            got, conf = fc.ocr_data(img, psm, whitelist=wl)
                            if got.strip() and got.strip() != wd[4]:
                                print('  w%d: raw word %r pad=%d @%d psm%s wl=%s -> %r'
                                      % (wn, wd[4], pad, dpi, psm, wl, got.strip()))
            break
print('\n(booth entries not printed above agreed with the raw layer)')

if APPLY:
    # Hand-picked from the probe output: the value that reads the full header.
    chosen = json.load(open(os.path.join(WORK, 'chosen_localities.json'),
                            encoding='utf-8'))
    for entry in fixes['localities']:
        key = str(entry['ward'])
        if key in chosen and entry['was'] == chosen[key]['was']:
            entry['now'] = chosen[key]['now']
    json.dump(fixes, open(FIXES_PATH, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print('patched', FIXES_PATH)
