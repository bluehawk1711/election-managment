# -*- coding: utf-8 -*-
"""Targeted re-read for rows whose `father`/`name` still carries label residue.

`fix_cells.py` targeted *suspicious* values (digits / Latin). But a field like
`नाम: पिता का नाम: राम श्रीराम` is pure Devanagari text — never flagged, and
quietly shipped in the CSVs. These all come from the page-level OCR merging the
printed `पिता का नाम:` label (or a neighbouring column) into the value.

The printed cell itself is fine, so the fix is the same one fix_cells uses:
crop that one cell at 900/1800 dpi, vote across psm variants, accept only a
clean Devanagari value with no label fragments left. Results are *appended*
to `cell_fixes.json` (fathers / relations / unresolved) so `fix_final.py`
applies them through its drift guard on a re-run.

Usage (cwd = repo root):
    python tools/extract_roll/fix_residue.py
"""
import json
import os
import re
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

# Label phrases only — NOT bare पिता/पति/माता, which appear inside real
# words (प्रजापति, माता प्रसाद शर्मा) and made the first run both flag clean
# rows as residue and *reject* the correct OCR read of them.
RESIDUE = re.compile(
    r'नाम\s*[:：]|का\s*नाम|पिता\s*का|पति\s*का|माता\s*का|Photo|Available|vali')

LABEL_PREFIX = re.compile(
    r'^\s*(?:नाम|पिता\s*का(?:\s*नाम)?|पति\s*का(?:\s*नाम)?|माता\s*का(?:\s*नाम)?|'
    r'अन्य\s*का(?:\s*नाम)?)\s*[:：]?\s*')

# Orphan word *before* a label phrase: OCR noise like 'है पिता का गिरधारी लाल'
# or 'चर पिता का लक्ष्मण'.
ORPHAN_LABEL = re.compile(
    r'^\s*\S{1,8}\s+(?:पिता|पति|माता|अन्य)\s*का(?:\s*नाम)?\s*[:：]?\s*')


def strip_labels(text, rounds=4):
    t = text
    for _ in range(rounds):
        nxt = ORPHAN_LABEL.sub('', t, count=1)
        nxt = LABEL_PREFIX.sub('', nxt, count=1)
        if nxt == t:
            break
        t = nxt
    return t.strip()


def valid_residue_free(value):
    if not value or len(value) > 60:
        return False
    if RESIDUE.search(value):
        return False
    if re.search(r'\d', value):  # names carry no digits
        return False
    return p4.DEV_RE.search(value) is not None and not fc.suspicious(value)


def label_relation(raw_text):
    head = raw_text.split(':')[0] if ':' in raw_text else raw_text[:16]
    for w in ('माता', 'पति', 'पिता', 'अन्य'):
        if w in head:
            return {'माता': 'माता', 'पति': 'पति', 'पिता': 'पिता',
                    'अन्य': 'अन्य'}[w]
    return ''


def main():
    fc.p4_mod.doc = pymupdf.open(fc.PDF)
    data = json.load(open(fc.RECORDS, encoding='utf-8'))
    recs = data['records']

    fixes = json.load(open(os.path.join(WORK, 'cell_fixes.json'),
                           encoding='utf-8'))

    # ------------------------------------------------ cleanup pass (idempotent)
    # Revert entries whose OCR "fix" landed on something worse than the
    # stored value: label residue in the result, or one of the handful of
    # 1-glyph regressions against an already-clean original.
    REVERT = {
        (5, 136, 89): 'गिरधारी लाल',        # OCR: 'है पिता का गिरधारी लाल'
        (7, 187, 168): 'लक्ष्मण',            # OCR: 'चर पिता का लक्ष्मण'
        (3, 64, 26): 'भगवान राम',            # OCR dropped भ
        (3, 72, 215): 'मुजिब अहमद',          # मु read as सु
        (5, 135, 80): 'रामकृपाल राय',        # कृ read as कु
        (5, 139, 176): 'हनुमान राम',         # न read as त
        (8, 197, 63): 'मुजीब अहमद',
        (8, 201, 158): 'हनुमान राम',
    }
    DELETE = {
        (2, 45, 376),   # was clean ('जगदीश चन्द्र प्रजापति'), OCR truncated surname
        (13, 302, 406), # OCR landed on the bare label 'पिता का'
    }
    kept = []
    for f in fixes.get('fathers', []):
        k = (f['ward'], f['page'], f['serial'])
        if k in DELETE:
            continue
        if k in REVERT:
            f['now'] = REVERT[k]
        elif RESIDUE.search(f['now'] or ''):
            # bad OCR win — fall back to the original minus its trailing dots
            f['now'] = (f['was'] or '').rstrip(' .')
        kept.append(f)
    fixes['fathers'] = kept

    # Prune unresolved rows that are actually fine (no residue, nothing
    # suspicious) — added by the first run's over-broad bare-पति match.
    def worth_review(value):
        v = value or ''
        return bool(RESIDUE.search(v)) or fc.suspicious(v)

    fixes['unresolved'] = [u for u in fixes.get('unresolved', [])
                           if worth_review(u.get('was'))]

    json.dump(fixes, open(os.path.join(WORK, 'cell_fixes.json'), 'w',
                          encoding='utf-8'), ensure_ascii=False, indent=2)

    targets = []
    for r in recs:
        for field in ('father', 'name'):
            v = r[field] or ''
            if RESIDUE.search(v):
                targets.append((field, r))
    print('residue targets:', len(targets))

    already = {(f['ward'], f['page'], f['serial'])
               for f in fixes.get('fathers', []) + fixes.get('names', [])}
    unresolved_keys = {(u.get('ward'), u.get('page'), u.get('serial'))
                       for u in fixes.get('unresolved', [])}

    fixed = relations = skipped = 0
    for field, rec in targets:
        k = (rec['ward'], rec['page'], rec['serial'])
        if k in already:
            print('  skip (already targeted):', field, k, rec[field][:40])
            skipped += 1
            continue
        page, info, si, col = fc.locate(rec)
        if si is None:
            print('  epic not found:', k)
            skipped += 1
            continue
        line = si + (2 if field == 'father' else 1)
        if line >= len(info):
            skipped += 1
            continue
        box = fc.cell_box(info, si, line, col, field)
        cands = fc.variants(page, *box)
        cleaned = []
        for raw, conf, psm, dpi in cands:
            v = strip_labels(fc.clean_value(raw, 'father'))
            cleaned.append((v, conf, psm, dpi, raw))
        ok = [(v, c, p, d, raw) for v, c, p, d, raw in cleaned
              if valid_residue_free(v)]
        shot = fc.shot('%s_%s.png' % (fc.name_key(rec), field), page, *box)
        if ok:
            # majority vote, tie-break by confidence
            groups = {}
            for v, c, p, d, raw in ok:
                g = groups.setdefault(v, {'n': 0, 'conf': 0.0, 'psm': p,
                                          'dpi': d, 'raw': raw})
                g['n'] += 1
                g['conf'] += c
            best_v, best_g = max(groups.items(),
                                 key=lambda kv: (kv[1]['n'], kv[1]['conf']))
            entry = {**fc.meta(rec), 'was': rec[field], 'now': best_v,
                     'votes': best_g['n'], 'psm': best_g['psm'],
                     'dpi': best_g['dpi'], 'screenshot': shot}
            fixes.setdefault('fathers' if field == 'father' else 'names',
                             []).append(entry)
            fixed += 1
            if field == 'father':
                rel = label_relation(best_g['raw'])
                if rel and rel != rec['relation']:
                    fixes.setdefault('relations', []).append(
                        {**fc.meta(rec), 'was': rec['relation'], 'now': rel})
                    relations += 1
            print('  FIXED %s w%s p%s s%s: %r -> %r (%dv)'
                  % (field, rec['ward'], rec['page'], rec['serial'],
                     rec[field], best_v, best_g['n']))
        else:
            if k not in unresolved_keys:
                fixes.setdefault('unresolved', []).append(
                    {'field': field, **fc.meta(rec), 'was': rec[field],
                     'candidates': [c[0] for c in cleaned]})
            print('  UNRESOLVED %s w%s p%s s%s: %r  cands=%s'
                  % (field, rec['ward'], rec['page'], rec['serial'],
                     rec[field], [c[0] for c in cleaned][:4]))

    json.dump(fixes, open(os.path.join(WORK, 'cell_fixes.json'), 'w',
                          encoding='utf-8'), ensure_ascii=False, indent=2)
    print('fixed %d, relations %d, skipped %d -> cell_fixes.json'
          % (fixed, relations, skipped))


if __name__ == '__main__':
    main()
