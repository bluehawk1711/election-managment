# -*- coding: utf-8 -*-
"""Targeted high-dpi cell OCR: fix the wrong data flagged in verification.md.

Reads `tools/extract_roll/records_final.json`, re-reads the *suspicious* cells
straight from `data/veernagar-1.pdf` at 900-2400 dpi with Tesseract (hin+eng),
votes across (dpi, psm) variants, and writes `cell_fixes.json` for
`fix_final.py` to apply. Every cell that was decided by OCR (not by the exact
PDF text layer) is also saved as a screenshot under `ocr_cells/`, named
`w<ward>_p<page>_s<serial>_<field>.png`, so each fix can be eyeballed.

Targets (sections of verification.md):
  E  suspicious names             -> name-cell OCR   (vote 900/1800 x psm 7/11)
  F  suspicious father names      -> father-cell OCR + relation label re-read
  D  junk house values            -> exact raw-layer digits when present,
                                      else house-cell OCR
  I  localities with Latin junk   -> header-line OCR
  G  6 recovered mother names     -> confirmation re-read (logged)
  J  booth / desc / addresses     -> cover-line OCR incl. 2400-dpi digit crop

Usage (cwd = repo root, PYTHONIOENCODING=utf-8):
    python tools/extract_roll/fix_cells.py [--dry-run]
"""
import difflib
import json
import os
import re
import sys
import time

import pymupdf
import pytesseract
from PIL import Image

import importlib.util

WORK = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p4', os.path.join(WORK, 'parse4.py'))
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

PDF = 'data/veernagar-1.pdf'
CELLS_DIR = 'ocr_cells'
RECORDS = os.path.join(WORK, 'records_final.json')
OUT = os.path.join(WORK, 'cell_fixes.json')
DRY = '--dry-run' in sys.argv

VARIANT_DPIS = (900, 1800)
VARIANT_PSMS = ('7', '11')

LABELISH = re.compile(
    r'नाम|पिता|पति|माता|अन्य|मकान|संख्या|लिंग|आयु|Photo|Available|vali')
GENDER_WORD = re.compile(r'\b(पुरूष|पुरुष|स्त्री|तृतीयलिंग)\b')
DEV = p4.DEV_RE
ASCII2 = re.compile(r'[A-Za-z]{2}')


# ---------------------------------------------------------------- geometry
_cache = {}


def pageinfo(pno):
    if pno not in _cache:
        page = p4_mod.doc[pno - 1]
        raw = page.get_text('words')
        grid = [w for w in raw if 138.0 <= w[1] and w[3] <= 812.0]
        clusters = p4.cluster_lines(grid)
        info = [{'y0': min(w[1] for w in c), 'y1': max(w[3] for w in c),
                 'center': p4.line_center(c), 'words': c} for c in clusters]
        info.sort(key=lambda d: d['y0'])
        _cache[pno] = (page, info)
    return _cache[pno]


def locate(rec):
    """(page, info, serial_line_index, column) for a record via its EPIC id."""
    page, info = pageinfo(rec['page'])
    for i, d in enumerate(info):
        for w in d['words']:
            if w[4].strip() == rec['epic']:
                return page, info, i, p4.col_of(w[0])
    return page, info, None, -1


def crop(page, x0, y0, x1, y1, dpi):
    clip = pymupdf.Rect(x0, y0, x1, y1)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72.0, dpi / 72.0),
                          clip=clip)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


# ------------------------------------------------------------------- ocr
def ocr_data(img, psm, whitelist=None):
    """Return (text, mean_conf) from one (image, psm) variant."""
    cfg = '--psm %s' % psm
    if whitelist:
        cfg += ' -c tessedit_char_whitelist=%s' % whitelist
    try:
        data = pytesseract.image_to_data(img, lang='hin+eng', config=cfg,
                                         output_type=pytesseract.Output.DICT)
    except pytesseract.TesseractError:
        return '', 0.0
    words, confs = [], []
    for t, c in zip(data['text'], data['conf']):
        t = (t or '').strip()
        try:
            c = float(c)
        except (TypeError, ValueError):
            c = -1
        if t:
            words.append(t)
            if c >= 0:
                confs.append(c)
    return ' '.join(words), (sum(confs) / len(confs) if confs else 0.0)


# ---------------------------------------------------------------- cleaning
def strip_label(text):
    """Drop a leading '...:' field label (repeatable, max 3)."""
    t = text
    for _ in range(3):
        m = re.match(r'^\s*([^:：]{0,26})[:：]\s*(.*)$', t, re.S)
        if not m:
            break
        pre, rest = m.group(1), m.group(2)
        if LABELISH.search(pre) or len(pre.strip()) <= 3:
            t = rest
        else:
            break
    return t


def clean_value(text, kind):
    t = strip_label(text)
    t = p4.tidy_tokens(t)
    t = t.strip(' |[]\u201c\u2019"\'')
    if kind == 'house':
        t = GENDER_WORD.sub(' ', t)
        t = p4.tidy_tokens(t)
        t = t.strip()
    return t


def suspicious(v):
    if not v:
        return False
    if re.search(r'\d', v) or re.search(r'[\u0966-\u096f]', v):
        return True
    if ASCII2.search(v):
        return True
    return any(t in v for t in ('**', '..', '"', '\u201c', '\u201d', 'Photo',
                                'vali', 'avail', 'oe'))


def valid_value(v, kind):
    if not v or len(v) > 60:
        return False
    if re.search(r'नाम\s*[:：]|का\s*नाम|Photo|Available|मकान\s*संख्या', v):
        return False
    if kind == 'house':
        if p4.PURE_SYMBOL.match(v) or GENDER_WORD.search(v) == v:
            return False
        if v in ('मकान', 'संख्या', 'लिंग', 'लिंग:', 'मकान:'):
            return False
        return bool(re.search(r'\d', v) or DEV.search(v) or ASCII2.search(v))
    # name / father: printed roll names are Devanagari; junk must not pass
    return DEV.search(v) is not None and not suspicious(v)


def vote(cands, kind):
    """cands: list of (text, conf, psm, dpi). -> (best_text, best_meta) | None."""
    valid = []
    for raw, conf, psm, dpi in cands:
        v = clean_value(raw, kind)
        if valid_value(v, kind):
            valid.append((v, conf, psm, dpi))
    if not valid:
        return None, []
    groups = {}
    for v, conf, psm, dpi in valid:
        g = groups.setdefault(v, {'n': 0, 'conf': 0.0, 'dpi': 0, 'psm': psm})
        g['n'] += 1
        g['conf'] += conf
        g['dpi'] = max(g['dpi'], dpi)
    best = max(groups.items(),
               key=lambda kv: (kv[1]['n'], kv[1]['conf'], len(kv[0])))
    return best[0], {'votes': best[1]['n'], 'conf': round(best[1]['conf'], 1),
                     'dpi': best[1]['dpi'], 'psm': best[1]['psm']}


def variants(page, x0, y0, x1, y1):
    out = []
    for dpi in VARIANT_DPIS:
        img = crop(page, x0, y0, x1, y1, dpi)
        for psm in VARIANT_PSMS:
            txt, conf = ocr_data(img, psm)
            out.append((txt, conf, psm, dpi))
    return out


def shot(path, page, x0, y0, x1, y1, dpi=900):
    if DRY:
        return path
    os.makedirs(CELLS_DIR, exist_ok=True)
    crop(page, x0, y0, x1, y1, dpi).save(os.path.join(CELLS_DIR, path))
    return os.path.join(CELLS_DIR, path)


def name_key(rec):
    return 'w%02d_p%03d_s%04d' % (rec['ward'], rec['page'], rec['serial'] or 0)


# ------------------------------------------------------------ target lists
def junk_house(v):
    if not v or re.fullmatch(r'\d{1,6}', v):
        return False
    if re.search(r'लिंग|का\s*नाम|नाम\s*:|आयु|मकान|Photo|Available', v):
        return True
    if p4.PURE_SYMBOL.match(v):
        return True
    if any(t in v for t in ('**', 'fit', 'Feat', '\u00a7', '\u00ab', '\u00bb',
                            '=\u2014', '\u2014-')):
        return True
    return False


def raw_house_digits(info, si, col):
    if si is None or si + 3 >= len(info):
        return ''
    toks = [w[4].strip() for w in info[si + 3]['words']
            if p4.col_of(w[0]) == col]
    for t in toks:
        if t.isdigit() and 1 <= len(t) <= 6:
            return t
    return ''


# --------------------------------------------------------------- main run
class p4_mod:
    doc = None


def cell_box(info, si, li, col, kind):
    d = info[li]
    x0 = p4.COL_EDGES[col]
    x1 = p4.COL_EDGES[col + 1]
    if kind in ('name', 'father'):
        x1 = min(x1, p4.PHOTO_CLIP[col])
    return x0, d['y0'] - 2, x1, d['y1'] + 2


def main():
    t_start = time.time()
    p4_mod.doc = pymupdf.open(PDF)
    data = json.load(open(RECORDS, encoding='utf-8'))
    recs = data['records']
    wards = data['wards']

    names = [r for r in recs if suspicious(r['name'])]
    fathers = [r for r in recs if suspicious(r['father'])]
    houses_junk = [r for r in recs if junk_house(r['house'])]
    print('targets: names=%d fathers=%d junk-houses=%d'
          % (len(names), len(fathers), len(houses_junk)))

    fixes = {'names': [], 'fathers': [], 'relations': [], 'houses_raw': [],
             'houses_ocr': [], 'localities': [], 'covers': {},
             'unresolved': [], 'mothers_confirmed': [], 'sample_check': {}}

    # ---- E: suspicious names --------------------------------------------
    for n, rec in enumerate(names, 1):
        page, info, si, col = locate(rec)
        if si is None or si + 1 >= len(info):
            fixes['unresolved'].append({'field': 'name', **meta(rec),
                                        'reason': 'epic/line not found'})
            continue
        box = cell_box(info, si, si + 1, col, 'name')
        cands = variants(page, *box)
        best, m = vote(cands, 'name')
        if best and best != rec['name']:
            fix = {**meta(rec), 'was': rec['name'], 'now': best, **m,
                   'screenshot': shot('%s_name.png' % name_key(rec),
                                      page, *box)}
            fixes['names'].append(fix)
        else:
            fixes['unresolved'].append(
                {'field': 'name', **meta(rec), 'was': rec['name'],
                 'candidates': [c[0] for c in cands]})
        if n % 50 == 0:
            print('  names %d/%d' % (n, len(names)))
    print('names done: %d fixed, %d unresolved  (%.0fs)'
          % (len(fixes['names']),
             sum(1 for u in fixes['unresolved'] if u['field'] == 'name'),
             time.time() - t_start))

    # ---- F: suspicious fathers (+ relation re-read) ----------------------
    rel_of = lambda t: next((w for w in ('माता', 'पति', 'पिता', 'अन्य')
                             if re.search(w, t.split(':')[0] if ':' in t
                                          else t[:14])), '')
    for n, rec in enumerate(fathers, 1):
        page, info, si, col = locate(rec)
        if si is None or si + 2 >= len(info):
            fixes['unresolved'].append({'field': 'father', **meta(rec),
                                        'reason': 'epic/line not found'})
            continue
        box = cell_box(info, si, si + 2, col, 'father')
        cands = variants(page, *box)
        best, m = vote(cands, 'father')
        if best and best != rec['father']:
            fixes['fathers'].append(
                {**meta(rec), 'was': rec['father'], 'now': best, **m,
                 'screenshot': shot('%s_father.png' % name_key(rec),
                                    page, *box)})
            # relation label from the winning raw text (before ':' only)
            raw_win = next((c[0] for c in cands
                            if clean_value(c[0], 'father') == best), '')
            head = raw_win.split(':')[0] if ':' in raw_win else raw_win[:16]
            rel = next((w for w in ('माता', 'पति', 'पिता', 'अन्य')
                        if w in head), '')
            if rel and rel != rec['relation']:
                fixes['relations'].append({**meta(rec), 'was': rec['relation'],
                                           'now': rel})
        else:
            fixes['unresolved'].append(
                {'field': 'father', **meta(rec), 'was': rec['father'],
                 'candidates': [c[0] for c in cands]})
        if n % 50 == 0:
            print('  fathers %d/%d' % (n, len(fathers)))
    print('fathers done: %d fixed, %d relations  (%.0fs)'
          % (len(fixes['fathers']), len(fixes['relations']),
             time.time() - t_start))

    # ---- D: junk houses --------------------------------------------------
    sample = []
    if len(houses_junk) > 40:
        sample = list(__import__('random').sample(houses_junk, 40))
    agree = disagree = 0
    for n, rec in enumerate(houses_junk, 1):
        page, info, si, col = locate(rec)
        if si is None or si + 3 >= len(info):
            fixes['unresolved'].append({'field': 'house', **meta(rec),
                                        'reason': 'epic/line not found'})
            continue
        raw = raw_house_digits(info, si, col)
        box = cell_box(info, si, si + 3, col, 'house')
        if raw:
            # cross-check a 40-row sample against high-dpi OCR
            if rec in sample:
                cands = variants(page, *box)
                ocr_digits = next((d for t, _, _, _ in cands
                                   for d in [re.search(r'\d{1,6}', t)]
                                   if d), None)
                if ocr_digits and ocr_digits.group(0) == raw:
                    agree += 1
                else:
                    disagree += 1
                    fixes.setdefault('sample_mismatches', []).append(
                        {**meta(rec), 'raw': raw,
                         'ocr': [c[0] for c in cands]})
            fixes['houses_raw'].append({**meta(rec), 'was': rec['house'],
                                        'now': raw})
        else:
            cands = variants(page, *box)
            best, m = vote(cands, 'house')
            if best and best != rec['house']:
                fixes['houses_ocr'].append(
                    {**meta(rec), 'was': rec['house'], 'now': best, **m,
                     'screenshot': shot('%s_house.png' % name_key(rec),
                                        page, *box)})
            else:
                fixes['unresolved'].append(
                    {'field': 'house', **meta(rec), 'was': rec['house'],
                     'candidates': [c[0] for c in cands]})
        if n % 100 == 0:
            print('  houses %d/%d' % (n, len(houses_junk)))
    fixes['sample_check'] = {'checked': len(sample), 'agree': agree,
                             'disagree': disagree}
    print('houses done: %d raw, %d ocr, sample agree %d/%d  (%.0fs)'
          % (len(fixes['houses_raw']), len(fixes['houses_ocr']), agree,
             len(sample), time.time() - t_start))

    # ---- I: localities with Latin junk -----------------------------------
    junk_loc = {}
    for r in recs:
        loc = r['locality'] or ''
        if loc and ASCII2.search(loc):
            junk_loc.setdefault((r['ward'], loc), 0)
            junk_loc[(r['ward'], loc)] += 1
    print('junk localities:', junk_loc)
    for (ward, old), rows in junk_loc.items():
        wmeta = next(w for w in wards if w['idx'] == ward)
        best_new, best_shot, best_page, votes = '', None, None, {}
        for pno in range(wmeta['rec_start'], wmeta['rec_end'] + 1):
            page, info = pageinfo(pno)
            try:
                ocrw = p4.read_ocr_tsv(p4.ocr_path(pno))
            except OSError:
                continue
            for d in info:
                if any(p4.is_epic_like(w[4]) for w in d['words']):
                    continue
                txt = p4.ocr_line_text(ocrw, d['center'], conf_min=30,
                                       tol=8.0, full=True)
                if txt.strip() != old.strip():
                    continue
                x0 = min(w[0] for w in d['words']) - 2
                x1 = max(w[2] for w in d['words']) + 2
                box = (x0, d['y0'] - 2, x1, d['y1'] + 2)
                for psm in ('6', '7'):
                    img = crop(page, *box, 900)
                    got, _ = ocr_data(img, psm)
                    v = clean_value(got, 'name')
                    if valid_value(v, 'name') and ASCII2.search(v) is None:
                        votes[v] = votes.get(v, 0) + 1
                        best_page, best_shot = pno, box
        if votes:
            best_new = max(votes.items(), key=lambda kv: kv[1])[0]
            shot('w%02d_p%03d_locality.png' % (ward, best_page),
                 pageinfo(best_page)[0], *best_shot)
        if best_new and best_new != old:
            fixes['localities'].append(
                {'ward': ward, 'rows': rows, 'was': old, 'now': best_new,
                 'votes': votes})
        else:
            fixes['unresolved'].append({'field': 'locality', 'ward': ward,
                                        'was': old, 'candidates':
                                            list(votes)})

    # ---- G: confirm the 6 recovered mother names -------------------------
    MATA = [(50, 513), (94, 761), (112, 374), (209, 3), (211, 54), (304, 455)]
    for pno, serial in MATA:
        rec = next((r for r in recs if r['page'] == pno and r['serial'] == serial),
                   None)
        if not rec:
            continue
        page, info, si, col = locate(rec)
        if si is None or si + 2 >= len(info):
            continue
        box = cell_box(info, si, si + 2, col, 'father')
        cands = variants(page, *box)
        best, m = vote(cands, 'father')
        fixes['mothers_confirmed'].append(
            {'page': pno, 'serial': serial, 'stored': rec['father'],
             're_read': best, **(m or {}),
             'screenshot': shot('%s_mother.png' % name_key(rec), page, *box)})

    # ---- J: cover lines (booth / address / delimitation) -----------------
    for w in wards:
        page = p4_mod.doc[w['cover'] - 1]
        entry = {'ward': w['ward_no'], 'page': w['cover'],
                 'booth_raw': w.get('booth_no', ''),
                 'address_stored': w.get('booth_address', ''),
                 'desc_stored': w.get('desc', '')}
        # booth number: exact word after nothing, before '-'
        for wd in page.get_text('words'):
            if (re.fullmatch(r'\d{1,3}', wd[4])
                    and re.match(r'\s*-', page.get_text()[
                        int(wd[0]):][:0] or ' ')):
                pass
        words = page.get_text('words')
        for i, wd in enumerate(words):
            if re.fullmatch(r'\d{1,3}', wd[4]) and i + 1 < len(words) \
                    and words[i + 1][4].startswith('-'):
                box = (wd[0] - 2, wd[1] - 2, wd[2] + 2, wd[3] + 2)
                got, _ = ocr_data(crop(page, *box, 2400), '8',
                                  whitelist='0123456789')
                entry['booth_ocr2400'] = got.strip()
                entry['booth_shot'] = shot('w%02d_p%03d_booth.png'
                                           % (w['ward_no'], w['cover']),
                                           page, *box, dpi=1200)
                break
        # every text line: booth-address line + delimitation line by OCR
        best_desc, best_desc_sim, best_desc_line = '', 0.0, None
        for b in page.get_text('dict')['blocks']:
            if b.get('type') != 0:
                continue
            for l in b['lines']:
                raw_line = ''.join(s['text'] for s in l['spans'])
                if not raw_line.strip() or len(raw_line.strip()) < 6:
                    continue
                x0, y0, x1, y1 = l['bbox']
                box = (x0 - 2, y0 - 1, x1 + 2, y1 + 1)
                got, _ = ocr_data(crop(page, *box, 900), '7')
                m = re.match(r'^\s*(\d{1,3})\s*-\s*(.+)', got)
                if m and not entry.get('address_900'):
                    entry['booth_ocr900'] = m.group(1)
                    entry['address_900'] = m.group(2).strip()
                    entry['address_shot'] = shot(
                        'w%02d_p%03d_address.png' % (w['ward_no'], w['cover']),
                        page, *box)
                if w.get('desc'):
                    sim = difflib.SequenceMatcher(
                        None, got.strip(), w['desc']).ratio()
                    if sim > best_desc_sim:
                        best_desc_sim, best_desc, best_desc_line = sim, got.strip(), box
        if best_desc_line:
            entry['desc_900'] = best_desc
            entry['desc_sim'] = round(best_desc_sim, 3)
            entry['desc_shot'] = shot('w%02d_p%03d_desc.png'
                                      % (w['ward_no'], w['cover']),
                                      page, *best_desc_line)
        fixes['covers'][str(w['ward_no'])] = entry
        print('  cover ward %2d: booth raw=%s ocr2400=%r desc_sim=%s'
              % (w['ward_no'], entry.get('booth_raw'),
                 entry.get('booth_ocr2400', ''), entry.get('desc_sim')))

    fixes['counts'] = {k: len(v) for k, v in fixes.items() if isinstance(v, list)}
    fixes['counts']['unresolved'] = len(fixes['unresolved'])
    fixes['dry_run'] = DRY
    fixes['elapsed_s'] = round(time.time() - t_start, 1)

    print('\n=== SUMMARY (%.0fs) ===' % (time.time() - t_start))
    print(json.dumps(fixes['counts'], ensure_ascii=False, indent=2))
    print('sample raw-vs-ocr house check: %d/%d agree'
          % (agree, len(sample)))
    print('\n--- name fixes ---')
    for f in fixes['names']:
        print('  w%d p%d s%d: %r -> %r  (%dv, psm%s)'
              % (f['ward'], f['page'], f['serial'], f['was'], f['now'],
                 f.get('votes', 0), f.get('psm')))
    print('\n--- father fixes (%d) ---' % len(fixes['fathers']))
    for f in fixes['fathers'][:60]:
        print('  w%d p%d s%d: %r -> %r  (%dv)'
              % (f['ward'], f['page'], f['serial'], f['was'], f['now'],
                 f.get('votes', 0)))
    if len(fixes['fathers']) > 60:
        print('  ... and %d more' % (len(fixes['fathers']) - 60))
    print('\n--- house OCR fixes (%d) ---' % len(fixes['houses_ocr']))
    for f in fixes['houses_ocr']:
        print('  w%d p%d s%d: %r -> %r' % (f['ward'], f['page'], f['serial'],
                                            f['was'], f['now']))
    print('\n--- localities ---')
    for f in fixes['localities']:
        print('  w%d (%d rows): %r -> %r' % (f['ward'], f['rows'], f['was'],
                                             f['now']))
    print('\n--- unresolved (%d) ---' % len(fixes['unresolved']))
    for f in fixes['unresolved'][:40]:
        print('  %s w%s p%s s%s: %r  cands=%s'
              % (f.get('field'), f.get('ward'), f.get('page'),
                 f.get('serial'), f.get('was'), f.get('candidates', [])[:3]))
    if len(fixes['unresolved']) > 40:
        print('  ... and %d more' % (len(fixes['unresolved']) - 40))

    if not DRY:
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(fixes, f, ensure_ascii=False, indent=2)
        print('\nsaved', OUT)
    else:
        print('\nDRY RUN - nothing written')


def meta(rec):
    return {'ward': rec['ward'], 'page': rec['page'], 'serial': rec['serial'],
            'epic': rec['epic']}


if __name__ == '__main__':
    main()
