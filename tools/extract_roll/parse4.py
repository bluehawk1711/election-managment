# -*- coding: utf-8 -*-
"""Parse voter-roll record grids from data/veernagar-1.pdf (v4).

Improvements over v3:
- field extraction retries with progressively lower OCR confidence when the
  cleaned value ends up empty (label-only OCR result was the main bug)
- uses sliced OCR words from ocr_tsv2/ when present (4-band re-OCR repair)
- better junk cleaning (ascii tokens inside Devanagari names, symbol tokens,
  adjacent duplicate words)
- captures relation (पिता/पति/अन्य)
- writes problems.json: pages + records with missing fields
"""
import pymupdf, re, os, json, sys
from collections import Counter

PDF = 'data/veernagar-1.pdf'
OCR_DIRS = ['ocr_tsv2', 'ocr_tsv']          # prefer sliced re-OCR
OCR_TXT_DIR = 'ocr_text'
WORK = os.path.dirname(os.path.abspath(__file__))

COVERS = [1, 29, 62, 96, 131, 163, 178, 193, 207, 218, 229, 255, 284]

IMG_W, IMG_H = 2480, 3505
PT_W, PT_H = 595.0, 841.0
SC_X = PT_W / IMG_W
SC_Y = PT_H / IMG_H

COL_EDGES = [0.0, 203.5, 375.5, 600.0]
PHOTO_CLIP = [145.0, 318.0, 492.0]

EPIC_RE = re.compile(r'^[A-Z]{3}\d{7}$')
RJ_RE = re.compile(r'^RJ/\d{2}/\d{3}/\d{6}$')
DEV_RE = re.compile(r'[\u0900-\u097F]')
ASCII_LETTER = re.compile(r'[A-Za-z]')
DIGIT = re.compile(r'\d')
PURE_SYMBOL = re.compile(r'^[\W_]+$', re.UNICODE)

BLACKLIST = {'photo', 'is', 'available', 'avallable', 'valiable', 'oe', 'nm',
             'ae', 'wea', 'ph', 'faz', 'gare', '|', '[', ']', "'",
             '\u2018', '\u2019', '"', ';', ':', '-', '.', ',', '?', '**',
             '\u201c**', 'ara:', 'फ8896', '५8896'}

FIELD_LABEL_RE = re.compile(r'नाम|पिता|पति|मकान|आयु|लिंग')
RELATION_RE = re.compile(r'(अन्य|पति|पिता)')


def is_epic_like(t):
    t = t.strip()
    if len(t) < 8 or not ASCII_LETTER.search(t) or not DIGIT.search(t):
        return False
    if re.match(r'^(NO|PG|PP|PT|QR)\.', t, re.I):
        return False
    return True


def ocr_path(pno):
    for d in OCR_DIRS:
        p = os.path.join(d, 'page-%04d.tsv' % pno)
        if os.path.exists(p):
            return p
    return os.path.join('ocr_tsv', 'page-%04d.tsv' % pno)


def read_ocr_tsv(path):
    words = []
    with open(path, encoding='utf-8') as f:
        next(f)
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) < 12 or p[0] != '5':
                continue
            t = p[11]
            if not t.strip():
                continue
            try:
                x, y, w, h = float(p[6]), float(p[7]), float(p[8]), float(p[9])
                conf = float(p[10])
            except ValueError:
                continue
            words.append({'xc': (x + w / 2) * SC_X, 'yc': (y + h / 2) * SC_Y,
                          'conf': conf, 't': t})
    return words


def col_of(xpt):
    for i in range(3):
        if COL_EDGES[i] <= xpt < COL_EDGES[i + 1]:
            return i
    return -1


def cluster_lines(raw_words, tol=5.0):
    ws = sorted(raw_words, key=lambda w: (w[1], w[0]))
    clusters, cur, cur_y = [], [], None
    for w in ws:
        if cur and (w[1] - cur_y) > tol:
            clusters.append(cur)
            cur, cur_y = [], None
        if cur_y is None:
            cur_y = w[1]
        cur.append(w)
    if cur:
        clusters.append(cur)
    return clusters


def line_center(cl):
    return (min(w[1] for w in cl) + max(w[3] for w in cl)) / 2


def ocr_line_text(ocr_words, center, col=None, conf_min=40.0, tol=8.0,
                  clip_photo=False, full=False):
    sel = []
    for w in ocr_words:
        if abs(w['yc'] - center) > tol:
            continue
        if not full:
            c = col_of(w['xc'])
            if c != col:
                continue
            if clip_photo and w['xc'] >= PHOTO_CLIP[c]:
                continue
        if w['conf'] < conf_min:
            continue
        if w['t'].strip().lower() in BLACKLIST:
            continue
        sel.append(w)
    sel.sort(key=lambda w: w['xc'])
    return ' '.join(w['t'] for w in sel).strip()


def tidy_tokens(s):
    toks = [t for t in s.split() if not PURE_SYMBOL.match(t)]
    # drop symbols-as-words and ascii-noise inside Devanagari text
    has_dev = any(DEV_RE.search(t) for t in toks)
    if has_dev:
        toks = [t for t in toks
                if not (ASCII_LETTER.search(t) and not DIGIT.search(t))]
    # drop adjacent duplicates (OCR repeats)
    out = []
    for t in toks:
        if out and out[-1] == t:
            continue
        out.append(t)
    return ' '.join(out)


def clean_field(text, kind):
    if kind == 'name':
        v = re.sub(r'^\s*नाम\s*:?\s*', '', text).strip()
        return tidy_tokens(v)
    if kind == 'father':
        v = re.sub(r'^\s*(अन्य|पिता|पति)\s*का\s*नाम\s*:?\s*', '', text).strip()
        v = re.sub(r'^\s*(पिता|पति)\s*(का)?\s*(नाम)?\s*:?\s*', '', v).strip()
        return tidy_tokens(v)
    if kind == 'house':
        v = re.sub(r'^\s*मकान\s*संख्या\s*:?\s*', '', text).strip()
        v = tidy_tokens(v)
        if v in ('मकान', 'संख्या', 'मकान संख्या', 'Feat:', 'Feat'):
            return ''
        if v and not DIGIT.search(v) and not DEV_RE.search(v):
            return ''   # pure-latin junk like 'Feat:'
        return v
    return text


def parse_age_gender(text):
    age, gender = '', ''
    m = re.search(r'(\d{1,3})', text)
    if m:
        age = m.group(1)
    m = re.search(r'(पुरूष|पुरुष|स्त्री|अन्य|तृतीय)', text)
    if m:
        g = m.group(1)
        gender = 'पुरूष' if g in ('पुरूष', 'पुरुष') else (
            'तृतीयलिंग' if g in ('अन्य', 'तृतीय') else g)
    return age, gender


def raw_col_tokens(words, col):
    return [w[4].strip() for w in words if col_of(w[0]) == col]


def raw_digits_fallback(words, col, maxlen=6):
    for t in raw_col_tokens(words, col):
        if t.isdigit() and len(t) <= maxlen:
            return t
    return ''


def raw_gender_token(words, col):
    toks = [t for t in raw_col_tokens(words, col) if t and not t.isdigit()]
    toks = [t for t in toks if not t.endswith(':')]
    return toks[-1] if toks else ''


ATTEMPTS = ((40, 8.0), (15, 10.0), (0, 12.0))


def extract_field(ocr_words, center, col, kind):
    """Return (value, relation). Retries at lower confidence until non-empty."""
    clip = kind in ('name', 'father')
    relation = ''
    best = ''
    for cm, tol in ATTEMPTS:
        txt = ocr_line_text(ocr_words, center, col=col, conf_min=cm, tol=tol,
                            clip_photo=clip)
        if txt and not relation:
            m = RELATION_RE.search(txt)
            if m and kind == 'father':
                relation = m.group(1)
        val = clean_field(txt, kind)
        if val:
            return val, (relation or (RELATION_RE.search(txt).group(1)
                                      if (kind == 'father' and RELATION_RE.search(txt)) else ''))
        if txt and not best:
            best = val
    return best, relation


def parse_page(page, ocr_words, ward_idx, page_no, state, gender_map, problems):
    raw = page.get_text('words')
    grid = [w for w in raw if 138.0 <= w[1] and w[3] <= 812.0]
    if not grid:
        return 0
    clusters = cluster_lines(grid)
    info = [{'y0': min(w[1] for w in c), 'center': line_center(c), 'words': c}
            for c in clusters]
    info.sort(key=lambda d: d['y0'])
    for d in info:
        d['serial'] = any(is_epic_like(w[4]) for w in d['words'])

    recs = 0
    i, n = 0, len(info)
    while i < n:
        d = info[i]
        if d['serial']:
            field_idx = []
            j = i + 1
            while j < n and len(field_idx) < 4:
                if info[j]['serial']:
                    break
                ocr_probe = ocr_line_text(ocr_words, info[j]['center'],
                                          conf_min=30, tol=8.0, full=True)
                if (field_idx and DEV_RE.search(ocr_probe)
                        and not FIELD_LABEL_RE.search(ocr_probe)
                        and len(ocr_probe) > 6):
                    state['locality'] = ocr_probe
                    break
                field_idx.append(j)
                j += 1
            kinds = ['name', 'father', 'house', 'age']
            for col in range(3):
                serial, epic = None, ''
                for w in sorted((w for w in d['words'] if col_of(w[0]) == col),
                                key=lambda w: w[0]):
                    t = w[4].strip()
                    if is_epic_like(t) and not epic:
                        epic = t
                    elif t.isdigit() and len(t) <= 4 and serial is None:
                        serial = int(t)
                if serial is None and not epic:
                    continue
                row = {'ward': ward_idx, 'page': page_no, 'serial': serial,
                       'epic': epic, 'locality': state.get('locality', ''),
                       'relation': ''}
                for k, ji in zip(kinds, field_idx):
                    center = info[ji]['center']
                    if k == 'age':
                        txt = ''
                        for cm, tol in ATTEMPTS[:2]:
                            txt = ocr_line_text(ocr_words, center, col=col,
                                                conf_min=cm, tol=tol)
                            if txt:
                                break
                        age, gender = parse_age_gender(txt)
                        if not age:
                            age = raw_digits_fallback(info[ji]['words'], col, 3)
                        if not gender:
                            gender = gender_map.get(
                                raw_gender_token(info[ji]['words'], col), '')
                        row['age'] = age
                        row['gender'] = gender
                    else:
                        val, rel = extract_field(ocr_words, center, col, k)
                        row[k] = val
                        if k == 'father' and rel:
                            row['relation'] = rel
                        if k == 'house' and not val:
                            row['house'] = raw_digits_fallback(
                                info[ji]['words'], col, 6)
                for k in ('name', 'father', 'house', 'age', 'gender'):
                    row.setdefault(k, '')
                missing = [k for k in ('name', 'father', 'house', 'age', 'gender')
                           if not row[k]]
                if missing:
                    problems.append({'ward': ward_idx, 'page': page_no,
                                     'serial': row['serial'], 'epic': row['epic'],
                                     'col': col, 'missing': missing})
                state['recs'].append(row)
                recs += 1
            i = j
        else:
            txt = ocr_line_text(ocr_words, d['center'], conf_min=30, tol=8.0, full=True)
            if txt and DEV_RE.search(txt) and not FIELD_LABEL_RE.search(txt):
                state['locality'] = txt
            i += 1
    return recs


def parse_cover(page):
    txt = page.get_text()
    raw = page.get_text('words')
    out = {}
    m = re.search(r'कमरनक\s*:\s*(\d+)', txt)
    out['ward'] = int(m.group(1)) if m else None
    nums = [(w[0], w[4]) for w in raw if w[1] > 690 and re.fullmatch(r'\d{1,6}', w[4])]
    nums.sort()
    out['counts'] = [t for _, t in nums]
    return out


def run_pass(doc, wards, gender_map, problems):
    all_recs = []
    for wd in wards:
        state = {'locality': '', 'recs': []}
        for pno in range(wd['rec_start'], wd['rec_end'] + 1):
            tsv = ocr_path(pno)
            ocr = read_ocr_tsv(tsv)
            parse_page(doc[pno - 1], ocr, wd['idx'], pno, state, gender_map, problems)
        wd['n_parsed'] = len(state['recs'])
        all_recs.extend(state['recs'])
    return all_recs


def build_gender_map(doc, wards, all_recs):
    pairs = Counter()
    recs_by_page = {}
    for r in all_recs:
        recs_by_page.setdefault((r['ward'], r['page']), []).append(r)
    for wd in wards:
        for pno in range(wd['rec_start'], wd['rec_end'] + 1):
            page = doc[pno - 1]
            raw = page.get_text('words')
            grid = [w for w in raw if 138.0 <= w[1] and w[3] <= 812.0]
            if not grid:
                continue
            clusters = cluster_lines(grid)
            info = [{'center': line_center(c), 'words': c} for c in clusters]
            info.sort(key=lambda d: min(w[1] for w in d['words']))
            rows = recs_by_page.get((wd['idx'], pno), [])
            serial_lines = [d for d in info
                            if any(is_epic_like(w[4]) for w in d['words'])]
            for d in serial_lines:
                idx = info.index(d)
                if idx + 4 < len(info):
                    age_cl = info[idx + 4]
                    for col in range(3):
                        gt = raw_gender_token(age_cl['words'], col)
                        if not gt:
                            continue
                        for w in d['words']:
                            if col_of(w[0]) == col and is_epic_like(w[4]):
                                for r in rows:
                                    if r['epic'] == w[4] and r['gender']:
                                        pairs[(gt, r['gender'])] += 1
    gmap, best = {}, {}
    for (gt, g), c in pairs.items():
        if best.get(gt, 0) < c:
            best[gt] = c
            gmap[gt] = g
    return gmap


def main():
    doc = pymupdf.open(PDF)
    bounds = COVERS + [len(doc) + 1]
    wards = []
    for k in range(len(COVERS)):
        wards.append({'idx': k + 1, 'cover': COVERS[k],
                      'rec_start': COVERS[k] + 2, 'rec_end': bounds[k + 1] - 1})

    for wd in wards:
        cov = parse_cover(doc[wd['cover'] - 1])
        wd['ward_no'] = cov['ward']
        wd['counts'] = cov['counts']
        txt_path = os.path.join(OCR_TXT_DIR, 'page-%04d.txt' % wd['cover'])
        desc = booth = ''
        if os.path.exists(txt_path):
            lines = [l.strip() for l in open(txt_path, encoding='utf-8')]
            for idx, l in enumerate(lines):
                if 'परिसीमन' in l and 'विवरण' in l:
                    for l2 in lines[idx + 1:idx + 4]:
                        if l2 and 'परिसीमन' not in l2:
                            desc = l2
                            break
                if 'मतदान बूथ' in l:
                    for l2 in lines[idx:idx + 3]:
                        if '-' in l2 and len(l2) > 20:
                            booth = l2
                            break
        wd['desc'] = desc
        wd['booth'] = booth

    problems = []
    all_recs = run_pass(doc, wards, {}, problems)
    gmap = build_gender_map(doc, wards, all_recs)
    problems = []
    all_recs = run_pass(doc, wards, gmap, problems)

    print()
    print('ward | expected | counts(from cover)     | parsed | serials  | epic_ok | name! | father! | house! | age! | gender!')
    tot_exp = tot = 0
    for wd in wards:
        recs = [r for r in all_recs if r['ward'] == wd['idx']]
        serials = [r['serial'] for r in recs if r['serial'] is not None]
        exp = int(wd['counts'][1]) if len(wd['counts']) > 1 else -1
        epic_ok = sum(1 for r in recs
                      if EPIC_RE.match(r['epic'] or '') or RJ_RE.match(r['epic'] or ''))
        nm = sum(1 for r in recs if not r['name'])
        fa = sum(1 for r in recs if not r['father'])
        ho = sum(1 for r in recs if not r['house'])
        ag = sum(1 for r in recs if not r['age'])
        ge = sum(1 for r in recs if not r['gender'])
        rng = '%d..%d' % (min(serials), max(serials)) if serials else 'NA'
        print('%4d | %8d | %-22s | %6d | %-8s | %7d | %5d | %7d | %6d | %4d | %6d' % (
            wd['ward_no'], exp, ','.join(wd['counts'])[:22], len(recs),
            rng, epic_ok, nm, fa, ho, ag, ge))
        tot_exp += exp
        tot += len(recs)
    print('TOTAL expected:', tot_exp, '| parsed:', tot)

    print()
    for wd in wards:
        recs = [r for r in all_recs if r['ward'] == wd['idx']]
        serials = sorted(s for s in (r['serial'] for r in recs) if s is not None)
        seen, dup = set(), []
        for s in serials:
            if s in seen:
                dup.append(s)
            seen.add(s)
        exp = int(wd['counts'][1]) if len(wd['counts']) > 1 else 0
        missing = sorted(set(range(1, exp + 1)) - seen)
        if dup or missing or len(recs) != exp:
            print('ward', wd['ward_no'], 'dup:', dup[:10], '| missing:', missing[:15],
                  '| n=%d exp=%d' % (len(recs), exp))

    # problems summary
    miss_counter = Counter()
    for p in problems:
        for m in p['missing']:
            miss_counter[m] += 1
    pages = sorted({p['page'] for p in problems})
    print('\nmissing field totals:', dict(miss_counter))
    print('problem records:', len(problems), '| problem pages:', len(pages))
    with open(os.path.join(WORK, 'problems.json'), 'w', encoding='utf-8') as f:
        json.dump({'pages': pages, 'items': problems}, f, ensure_ascii=False)

    out_name = sys.argv[1] if len(sys.argv) > 1 else 'records.json'
    out_path = os.path.join(WORK, out_name)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'wards': wards, 'records': all_recs}, f, ensure_ascii=False)
    print('saved', out_path, '+ problems.json')


if __name__ == '__main__':
    main()
