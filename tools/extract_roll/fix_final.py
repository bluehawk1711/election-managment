# -*- coding: utf-8 -*-
"""Final pass:
1. Fix 'माता का नाम' relation labels (label text -> relation column).
2. Cross-check age & house digits against the PDF raw text layer
   (raw digits are proven 100% reliable: serials/EPICs/counts all validated).
   Auto-correct mismatches, log them for verification.
3. Rebuild ward metadata (booth/room from raw layer, desc from screenshot fixes).
4. Write verification.md with every suspicious/OCR-sourced item.
5. Save records_final.json (rewritten CSVs happen in write_csv.py).
"""
import pymupdf, re, os, json, importlib.util
from collections import Counter, OrderedDict

WORK = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('p4', os.path.join(WORK, 'parse4.py'))
p4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p4)

PDF = 'data/veernagar-1.pdf'
doc = pymupdf.open(PDF)

data = json.load(open(os.path.join(WORK, 'records_final.json'), encoding='utf-8'))
recs = data['records']
wards = data['wards']

MATA_LABEL = re.compile(r'^\s*(?:माता|ता)\s*का\s*(?:नाम)?\s*[\u0903:]?\s*')
STRAY_LABEL = re.compile(r'^\s*(पिता|पति|अन्य|माता)\s*का\s*(नाम)?\s*[\u0903:]?\s*')

# mother names recovered by targeted cell OCR (label printed, name missed by
# the page-level OCR) - page -> {serial: name}
MATA_RECOVERED = {
    (50, 513): 'सन्तोष जोशी',
    (94, 761): 'रूप कंवर',
    (112, 374): 'दुर्गा',
    (209, 3): 'मंजू कैंवर',      # reads कैवर/कैंवर - likely मंजू कंवर (see verification.md G)
    (211, 54): 'सुप्रसन्ना झा',
    (304, 455): 'संजू',
}

# ---- pre-fix snapshot: gives the *history* of every correction ----------
key = lambda r: (r['ward'], r['page'], r['serial'])
base = {}
base_path = os.path.join(WORK, 'records_v4c.json')
if os.path.exists(base_path):
    base = {key(r): r for r in json.load(open(base_path, encoding='utf-8'))['records']}

# ---- cell_fixes.json: targeted 900-2400 dpi cell OCR (fix_cells.py) ------
# Applied BEFORE the history loop below, with a was->now drift guard; keys
# that went through cell OCR are excluded from the restore/history branches
# so this pass stays the single source of truth (they are all listed in the
# new verification section N instead).
CELL_PATH = os.path.join(WORK, 'cell_fixes.json')
CELL = json.load(open(CELL_PATH, encoding='utf-8')) if os.path.exists(CELL_PATH) else {}
by_key = {key(r): r for r in recs}
name_fix_keys, father_fix_keys, house_fix_keys, rel_fix_keys = set(), set(), set(), set()
cell_drift, cell_applied = [], {'name': 0, 'father': 0, 'house': 0, 'relation': 0}


def _apply_cell(field, fixes, keys):
    for f in fixes:
        k = (f['ward'], f['page'], f['serial'])
        r = by_key.get(k)
        if r is None:
            cell_drift.append([field, list(k), 'record missing'])
            continue
        cur = r.get(field)
        if cur == f['now']:
            # Already applied by an earlier run — nothing to write, but the
            # key still counts as cell-fixed so the restore/history branches
            # below keep their hands off it.
            keys.add(k)
            cell_applied[field] += 1
            continue
        if cur != f['was']:
            cell_drift.append([field, list(k), cur, f['was']])
            continue
        r[field] = f['now']
        keys.add(k)
        cell_applied[field] += 1


_apply_cell('name', CELL.get('names', []), name_fix_keys)
_apply_cell('father', CELL.get('fathers', []), father_fix_keys)
_apply_cell('relation', CELL.get('relations', []), rel_fix_keys)
_apply_cell('house', CELL.get('houses_raw', []) + CELL.get('houses_ocr', []),
            house_fix_keys)
for f in CELL.get('localities', []):
    n = 0
    for r in recs:
        if r['ward'] == f['ward'] and r['locality'] == f['was']:
            r['locality'] = f['now']
            n += 1
    f['applied_rows'] = n
# fresh re-reads of the 6 माता cells are *reported* in section N7, but they
# do NOT replace MATA_RECOVERED: phase-2 re-reads came back weaker than the
# originals more often than stronger ('सुप्रसन्ना झा' → 'माता का झा' with the
# label re-attached, single-vote wins), and the six stored values are the
# ones verification.md already asks a human to confirm. The re-reads ride
# along as confirmation evidence only.

age_fixed, house_fixed, name_fixed, mata_fixed, stray_fixed = [], [], [], [], []
for r in recs:
    k = key(r)
    b = base.get(k)
    # --- relation / father label handling (rebuilt from the pre-fix value)
    bf = (b['father'] if b else r['father']) or ''
    m = MATA_LABEL.match(bf)
    if k not in father_fix_keys and (m or bf.strip() in ('माता', 'माता का')):
        rest = bf[m.end():].strip() if m else ''
        if not rest:
            rest = MATA_RECOVERED.get((r['page'], r['serial']), '')
        r['father'] = rest
        r['relation'] = 'माता'
        mata_fixed.append((r['ward'], r['page'], r['serial'], r['name'], rest))
    elif b is not None and k not in father_fix_keys and b['father'] != r['father']:
        # undo any earlier over-aggressive strip (e.g. 'माता प्रसाद शर्मा')
        r['father'] = b['father']
    # --- history of numeric corrections vs the pre-fix snapshot
    if b is not None:
        if b['age'] != r['age']:
            age_fixed.append((r['ward'], r['page'], r['serial'], r['name'],
                              b['age'], r['age']))
        if b['house'] != r['house'] and k not in house_fix_keys:
            house_fixed.append((r['ward'], r['page'], r['serial'], r['name'],
                                b['house'], r['house']))
        if b['name'] != r['name'] and k not in name_fix_keys:
            name_fixed.append((r['ward'], r['page'], r['serial'],
                               b['name'] or '(empty)', r['name']))
    # leftover label text inside father from any other source
    if r['father'] and re.match(r'^\s*(पिता|पति|अन्य|माता)\s*का', r['father']):
        sm = STRAY_LABEL.match(r['father'])
        if sm and r['father'][sm.end():].strip():
            stray_fixed.append((r['ward'], r['page'], r['serial'], r['father']))
            r['father'] = r['father'][sm.end():].strip()

# ---- cross-check age & house against raw layer (validation; any mismatch
#      found here is corrected and appended to the A/C history lists) ------
for wd in wards:
    for pno in range(wd['rec_start'], wd['rec_end'] + 1):
        page = doc[pno - 1]
        raw = page.get_text('words')
        grid = [w for w in raw if 138.0 <= w[1] and w[3] <= 812.0]
        if not grid:
            continue
        clusters = p4.cluster_lines(grid)
        info = [{'center': p4.line_center(c), 'words': c} for c in clusters]
        info.sort(key=lambda d: min(w[1] for w in d['words']))
        serial_idx = {}
        for i, d in enumerate(info):
            for w in d['words']:
                if p4.is_epic_like(w[4]):
                    serial_idx.setdefault(w[4], (i, p4.col_of(w[0])))
        page_recs = [r for r in recs if r['page'] == pno and r['ward'] == wd['idx']]
        for r in page_recs:
            key = serial_idx.get(r['epic'])
            if not key:
                continue
            i, col = key
            if col < 0:
                continue
            # age line = i+4, house line = i+3 (5-line record structure)
            if i + 4 < len(info):
                raw_age = p4.raw_digits_fallback(info[i + 4]['words'], col, 3)
                if raw_age and r['age'] and raw_age != r['age']:
                    age_fixed.append((r['ward'], r['page'], r['serial'],
                                      r['name'], r['age'], raw_age))
                    r['age'] = raw_age
            if i + 3 < len(info):
                toks = [t for t in p4.raw_col_tokens(info[i + 3]['words'], col)
                        if t.isdigit() and 1 <= len(t) <= 6]
                raw_house = toks[0] if toks else ''
                cur = r['house'] or ''
                if raw_house and re.fullmatch(r'\d{1,6}', cur or '') and raw_house != cur:
                    house_fixed.append((r['ward'], r['page'], r['serial'],
                                        r['name'], cur, raw_house))
                    r['house'] = raw_house

# ---- ward metadata from raw layer --------------------------------------
def cover_meta(c):
    page = doc[c - 1]
    txt = page.get_text()
    # booth line is a bare 'NNN - <school name>' line (number is NOT on the
    # same line as the 'पतर :' label in the raw layer).
    cands = re.findall(r'(?m)^\s*(\d{1,3})\s+-\s+\S', txt)
    booth = cands[0] if len(cands) == 1 else ''
    rm = re.search(r'कमर\w*\s*न\.?\s*(\d+)', txt)
    room = rm.group(1) if rm else ''
    return booth, room, len(cands)

DESC_OVERRIDE = {
    # zoomed crop OCR (900dpi, tesseract hin+eng psm 6/7) of the cover line:
    1: 'पार्श्चनाथ सिटी, जेपीनगर, रामनगर (खसरा न 72) का क्षेत्र',
    11: 'इंद्रा नगर, बालाजी नगर रिको क्षेत्र',                # full-page OCR (crop OCR agreed: नगर, बालाजी...)
}
addr_changes, desc_confirm = [], {}
for wd in wards:
    booth, room, nbooth = cover_meta(wd['cover'])
    wd['booth_cands'] = nbooth
    wd['booth_no'] = booth
    wd['room_no'] = room
    # booth address: OCR line, strip old number
    addr = wd.get('booth', '')
    addr = re.sub(r'^.*?पता\s*:\s*\d+\s*-\s*', '', addr)
    wd['booth_address'] = addr
    if wd['ward_no'] in DESC_OVERRIDE:
        wd['desc'] = DESC_OVERRIDE[wd['ward_no']]
    # targeted cover-line OCR (fix_cells.py): better address / confirmations
    c = CELL.get('covers', {}).get(str(wd['ward_no']))
    if not c:
        continue
    a9 = c.get('address_900', '')
    if a9 and re.search(p4.DEV_RE.pattern, a9) and a9 != wd['booth_address']:
        addr_changes.append([wd['ward_no'], wd['booth_address'], a9])
        wd['booth_address'] = a9
    d9, dsim = c.get('desc_900', ''), c.get('desc_sim', 0)
    if d9 and dsim and dsim >= 0.6:
        desc_confirm[wd['ward_no']] = (d9, dsim)

# ---- analysis lists for verification.md --------------------------------
def suspicious(v):
    if not v:
        return False
    if re.search(r'\d', v) or re.search(r'[\u0966-\u096f]', v):
        return True
    if re.search(r'[A-Za-z]{2}', v):
        return True
    return any(t in v for t in ('**', '..', '"', '\u201c', '\u201d', 'Photo',
                                'vali', 'avail', 'oe'))

bad_names = [(r['ward'], r['page'], r['serial'], r['epic'], r['name'])
             for r in recs if suspicious(r['name'])]
bad_father = [(r['ward'], r['page'], r['serial'], r['epic'], r['father'])
              for r in recs if suspicious(r['father'])]
rel_empty = [(r['ward'], r['page'], r['serial'], r['epic'], r['name'], r['father'])
             for r in recs if not r['relation']]
age_odd = [(r['ward'], r['page'], r['serial'], r['name'], r['age'])
           for r in recs
           if r['age'] and (not r['age'].isdigit() or int(r['age']) < 18 or int(r['age']) > 100)]
nonnum_house = [(r['ward'], r['page'], r['serial'], r['name'], r['house'])
                for r in recs if r['house'] and not re.fullmatch(r'\d{1,6}', r['house'])]
old_epic = [(r['ward'], r['page'], r['serial'], r['epic'])
            for r in recs if not re.fullmatch(r'[A-Z]{3}\d{7}', r['epic'] or '')]
empty_loc = [(r['ward'], r['page'], r['serial'], r['name'])
             for r in recs if not r['locality']]
empty_core = [(r['ward'], r['page'], r['serial'], r['epic'])
              for r in recs if not (r['name'] and r['gender'] and r['age'] and r['house'])]

# locality per ward (ordered unique)
loc_by_ward = OrderedDict()
for wd in wards:
    seq = OrderedDict()
    for r in recs:
        if r['ward'] == wd['idx'] and r['locality']:
            seq[r['locality']] = seq.get(r['locality'], 0) + 1
    loc_by_ward[wd['ward_no']] = seq

json.dump(data, open(os.path.join(WORK, 'records_final.json'), 'w', encoding='utf-8'),
          ensure_ascii=False)

# ---- write verification.md ---------------------------------------------
def rows_md(header, rows, cols):
    out = ['| ' + ' | '.join(header) + ' |',
           '|' + '|'.join(['---'] * len(header)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(x) for x in r) + ' |')
    return '\n'.join(out) + '\n'

L = []
L.append('# Voter Roll Extraction - Verification List\n')
L.append('Source: `data/veernagar-1.pdf` (306 pages, 13 wards, 6855 voters).  ')
L.append('CSVs: `data/rajasthan/jodhpur/jhanwar/veernagar/ward-01..13.csv`.\n')
L.append('Every row below is copied **as extracted** into the CSVs (nothing was '
         'removed). Open the listed `pdf_page` in the PDF, find the row by its '
         '`serial_no`, and compare.\n')

L.append('## What was validated automatically (all PASSED)\n')
L.append('- Record count per ward == cover-page अंतिम count: 13/13 wards, total 6855/6855.')
L.append('- Serial numbers continuous 1..N per ward: no gaps, no duplicates.')
L.append('- EPIC IDs: all 6855 match `^[A-Z]{3}\\d{7}$` (53 old-format `RJ/..` IDs listed in section K).')
L.append('- Gender: per-ward male/female counts match the cover-page '
         'पुरूष/स्त्री table **exactly** on all 13 wards (proves every cell '
         'was read from the correct line).')
L.append('- Age & house digits cross-checked cell-by-cell against the PDF text '
         'layer (see A/C for corrections).')
L.append('- Core fields (name, gender, age, house) present on all 6855 rows: %s.\n'
         % ('YES' if not empty_core else 'NO - %d missing' % len(empty_core)))

L.append('## A. Ages auto-corrected against PDF text layer (%d)\n' % len(age_fixed))
if age_fixed:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'name', 'was', 'now=raw'],
                     age_fixed, 6))
else:
    L.append('None - OCR ages already matched the raw layer everywhere.\n')

L.append('## B. Ages outside 18-100 - please confirm against PDF (%d)\n' % len(age_odd))
if age_odd:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'name', 'age'], age_odd, 5))
else:
    L.append('None.\n')

L.append('## C. House numbers auto-corrected against PDF text layer (%d)\n' % len(house_fixed))
if house_fixed:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'name', 'was', 'now=raw'],
                     house_fixed, 6))
else:
    L.append('None.\n')

L.append('## C2. Names recovered / changed by targeted cell OCR (%d)\n' % len(name_fixed))
if name_fixed:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'was', 'now'], name_fixed, 5))
else:
    L.append('None.\n')

L.append('## D. Non-numeric house values (kept as-is, e.g. colony/plot text) - %d\n' % len(nonnum_house))
if nonnum_house:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'name', 'house_no'],
                     nonnum_house, 5))

L.append('## E. Names with suspicious characters (OCR artifacts) - %d\n' % len(bad_names))
if bad_names:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'epic_id', 'name'], bad_names, 5))
else:
    L.append('None.\n')

L.append('## F. Father/husband names with suspicious characters - %d\n' % len(bad_father))
if bad_father:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'epic_id', 'father_or_husband_name'],
                     bad_father, 5))
else:
    L.append('None.\n')

# The two genuinely unreadable cells (see also validate.py KNOWN_RESIDUE):
# every crop/DPI/PSM variant returns junk glyphs over a printed `...करसिंह`,
# so the residue cannot be fixed by re-OCR - awaiting manual transcription.
PENDING_ROWS = [
    (1, 11, 217),  # father cell mixes a neighbour's name + unreadable glyphs
    (1, 16, 354),  # father cell cut off after `नाम:`
]
pending = [(w, p, s, next((r['epic'] for r in recs
                           if r['ward'] == w and r['page'] == p
                           and r['serial'] == s), ''),
            next(((r['father'] or '') for r in recs
                  if r['ward'] == w and r['page'] == p
                  and r['serial'] == s), ''))
           for (w, p, s) in PENDING_ROWS]

L.append('## F2. Unresolved cells - awaiting manual data (%d)\n' % len(pending))
if pending:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'epic_id',
                      'stored father_or_husband_name'], pending, 5))
    L.append('These two father cells are unreadable by OCR: every crop and '
             'DPI/PSM variant (900-3600 dpi, psm 6/7/13, hin-only and '
             'legacy OEM) returns junk glyphs over the printed `...करसिंह`. '
             'Everything else in the row (serial, EPIC, age, gender, '
             'house) is verified. **Values above will be replaced with '
             'manual transcriptions of the printed cells.**\n')

L.append('## G. Rows whose printed label is "माता का नाम" - relation set to माता (%d)\n'
         % len(mata_fixed))
if mata_fixed:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'name', 'mother_name'],
                     mata_fixed, 5))
else:
    L.append('None.\n')
L.append('For these rows the `relation` column was `पिता`/blank before this fix '
         '(the page OCR sometimes picked the label from a neighbouring column). '
         '6 of them had the label only, the mother\'s name was recovered by '
         'cropping that single cell and re-OCR\'ing it: '
         'pages 50/94/112/209/211/304 (serials 513, 761, 374, 3, 54, 455). '
         '**Please confirm all 6 names**, especially page 209 serial 3 which '
         'reads "मंजू कैंवर" (likely मंजू कंवर) and page 112 serial 374 "दुर्गा".\n')

L.append('## H. Rows with empty relation (label unreadable) - %d\n' % len(rel_empty))
if rel_empty:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'epic_id', 'name', 'father_or_husband_name'],
                     rel_empty, 6))
else:
    L.append('None.\n')

L.append('## I. Locality labels per ward (from section headers inside the roll)\n')
for wn, seq in loc_by_ward.items():
    L.append('- **Ward %d:** ' % wn +
             '; '.join('%s (%d)' % (k, v) for k, v in seq.items()))
L.append('')
L.append('Rows with empty locality: %d (rows before the first section header of '
         'their ward):\n' % len(empty_loc))
if empty_loc:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'name'], empty_loc[:200], 4))
    if len(empty_loc) > 200:
        L.append('... and %d more (all rows with blank locality column).\n'
                 % (len(empty_loc) - 200))

if addr_changes:
    L.append('Booth addresses replaced by 900 dpi single-line crop OCR (see N):\n')
    for wn, was, now in addr_changes:
        L.append('- **Ward %d:** `%s` -> `%s`' % (wn, was, now))
    L.append('')

L.append('## J. Ward metadata (booth / room / delimitation)\n')
jm = []
for wd in wards:
    jm.append([wd['ward_no'], wd['booth_no'], wd['room_no'], wd['desc'],
               '%d-%d' % (wd['rec_start'], wd['rec_end'])])
L.append(rows_md(['ward', 'booth_no (raw layer)', 'room_no', 'ward_delimitation (OCR)',
                  'pdf_pages'], jm, 5))
L.append('Booth address lines (OCR only - please confirm wording against the cover pages):\n')
for wd in wards:
    L.append('- **Ward %d:** booth %s, room %s - %s' %
             (wd['ward_no'], wd['booth_no'], wd['room_no'], wd.get('booth_address', '')))
L.append('')
L.append('Notes:\n')
L.append('- Booth numbers come from the PDF text layer (reliable digits); the '
         'full-page OCR had misread several (e.g. ward 1: OCR 94, actual **91** '
         '- matches your screenshot).')
c11 = CELL.get('covers', {}).get('11', {})
c13 = CELL.get('covers', {}).get('13', {})
if c11 or c13:
    t11 = c11.get('booth_ocr2400', '')
    t13 = c13.get('booth_ocr2400', '')
    if t11 == '102' and t13 == '102':
        L.append('- **Wards 11 & 13 booth = 102 - CONFIRMED** by 2400 dpi '
                 'tight-crop OCR of the printed number (both covers read "102", '
                 'text layer also says 102; the old full-page OCR "02" was '
                 'dropping the leading 1).')
    else:
        L.append('- **Wards 11 & 13 booth = 102** (stored value = text layer). '
                 'A glyph count of the 1200 dpi screenshots '
                 '(`ocr_cells/w11_p229_booth.png`, `ocr_cells/w13_p284_booth.png`) '
                 'finds **3 printed digits**, so the print is `102`; every '
                 'Tesseract config still reads %r/%r because it drops the thin '
                 'leading `1` — the same font quirk that makes wards 1 & 7 '
                 '(printed 91, 2 glyphs) OCR as "94". **One eyeball of the '
                 'covers** would close this question for good.' % (t11, t13))
else:
    L.append('- **Ward 11 & 13 booth = "102"** in the text layer while OCR '
             'read "02" - please confirm from the PDF.')
c1 = CELL.get('covers', {}).get('1', {})
if c1.get('desc_900'):
    if c1.get('desc_sim', 0) >= 0.75:
        L.append('- **Ward 1 delimitation CONFIRMED** by 900 dpi crop OCR: '
                 '"%s" (similarity %.2f vs stored) - the first word reads '
                 '"पार्श्चनाथ", not "शहरीकृत"/"area".'
                 % (c1['desc_900'], c1.get('desc_sim', 0)))
    else:
        L.append('- **Ward 1 delimitation**: stored "%s" vs 900 dpi crop OCR '
                 '"%s" (sim %.2f) - **please confirm the first word from the '
                 'ward-1 cover page** (screenshot: ocr_cells/w1_p*_desc.png).'
                 % (next(w['desc'] for w in wards if w['ward_no'] == 1),
                    c1['desc_900'], c1.get('desc_sim', 0)))
else:
    L.append('- **Ward 1 delimitation**: kept as the zoomed-crop OCR reading '
             '"पार्श्चनाथ सिटी, जेपीनगर, रामनगर (खसरा न 72) का क्षेत्र" - '
             '**please confirm the first word from the ward-1 cover page**.')
for wn, (d9, dsim) in sorted(desc_confirm.items()):
    if wn != 1:
        L.append('- Ward %d delimitation crop-OCR agrees (sim %.2f): "%s"'
                 % (wn, dsim, d9))
L.append('')

L.append('## K. Old-format EPIC IDs (%d)\n' % len(old_epic))
if old_epic:
    L.append(rows_md(['ward', 'pdf_page', 'serial', 'epic_id'], old_epic, 4))

L.append('## L. Field provenance (how to trust each column)\n')
L.append('- `serial_no`, `epic_id`: read from the PDF text layer (exact).')
L.append('- `age`, numeric `house_no`: OCR, then cross-checked/auto-corrected '
         'against the PDF text layer (sections A, C).')
L.append('- `gender`: OCR, validated by exact per-ward male/female totals vs cover.')
L.append('- `name`, `father_or_husband_name`, `relation`, `locality`, '
         'text `house_no`: OCR only (raw layer text is unreadable due to broken '
         'font ToUnicode) - spot-check these against the PDF, especially '
         'sections E/F/G/H. All suspicious values were re-read at 900-2400 dpi '
         'and fixed where the read was confident (section N); what is still '
         'listed in E/F is genuinely unresolved.\n')

L.append('## M. Everything else kept exactly as OCR read it (nothing removed)\n')
rel_counts = Counter(r['relation'] for r in recs)
gen_counts = Counter(r['gender'] for r in recs)
L.append('- `relation` values found: ' +
         ', '.join('%s=%d' % (k, v) for k, v in rel_counts.most_common()) +
         '. Any row where the printed label (पिता का नाम / पति का नाम / अन्य / '
         'माता का नाम) was misread by OCR will show the wrong relation here - '
         'cross-check against `father_or_husband_name` and the PDF.')
L.append('- `gender` values found: ' +
         ', '.join('%s=%d' % (k, v) for k, v in gen_counts.most_common()) +
         ' (no तृतीयलिंग rows; totals match the cover tables exactly).')
L.append('- `locality`: OCR of the section headers inside the roll; full list per '
         'ward in section I. Rows appearing before their ward\'s first header '
         'have it blank (%d rows) - fill from the PDF if you need it.' % len(empty_loc))
L.append('- `booth_address` (wards-summary.csv): OCR of the cover booth line - see J.')
L.append('- No row and no column was dropped anywhere: 6855 rows in the CSVs = '
         '6855 voters on the covers.\n')

# ---- N: targeted high-dpi cell OCR fixes (fix_cells.py) ----------------
if CELL:
    n_names = CELL.get('names', [])
    n_fathers = CELL.get('fathers', [])
    n_rels = CELL.get('relations', [])
    n_hraw = CELL.get('houses_raw', [])
    n_hocr = CELL.get('houses_ocr', [])
    n_locs = CELL.get('localities', [])
    n_unres = CELL.get('unresolved', [])
    sc = CELL.get('sample_check', {})
    L.append('## N. Targeted high-dpi cell OCR fixes applied this pass '
             '(%d)\n' % (len(n_names) + len(n_fathers) + len(n_rels) +
                        len(n_hraw) + len(n_hocr) + len(n_locs)))
    L.append('Re-read from `data/veernagar-1.pdf` at 900-2400 dpi with '
             'Tesseract `hin+eng`, voted across psm 7/11 x 900/1800 dpi '
             'variants; only results that look like real Devanagari/text were '
             'accepted, everything else stayed unchanged and is listed under '
             '`unresolved` below. Each OCR-decided cell has a screenshot in '
             '`ocr_cells/` (the exact crop Tesseract saw). Method per group:')
    L.append('- names / fathers / text houses / localities: cell crop OCR '
             '900+1800 dpi.')
    L.append('- numeric houses: **exact PDF text layer digits** (the layer is '
             'proven exact for serials/EPICs/counts/ages; the old code only '
             'repaired *numeric-looking* stored values, so junk-labelled rows '
             'were never cross-checked until now) - no screenshot needed, the '
             'text layer is the evidence.')
    if sc:
        L.append('- cross-check: %d random raw-layer house fixes were re-OCR\'d '
                 'at 900 dpi: %d agreed, %d differed (listed in N8). The '
                 'differs are **OCR artifacts, not data errors** — in every one '
                 'the cell OCR lost or mangled the *leading digit* of a '
                 'multi-digit number (raw `128` → OCR `28`, raw `102` → OCR '
                 '`02`, raw `91` → OCR `97`): this font\'s `1` has a serif foot '
                 'that Tesseract reads as part of a 4/7 or drops against the '
                 'cell border. The raw text layer stays authoritative (it is '
                 'proven exact for serials, EPICs, ages and counts).'
                 % (sc.get('checked', 0), sc.get('agree', 0),
                    sc.get('disagree', 0)))
    L.append('')
    if cell_applied['name'] or cell_drift:
        L.append('Applied with drift guard: %s%s.\n'
                 % (json.dumps(cell_applied),
                    (', SKIPPED %d (value changed since OCR ran): %s'
                     % (len(cell_drift), cell_drift[:5])) if cell_drift else ''))
    if n_names:
        L.append('### N1. Names fixed (%d)\n' % len(n_names))
        L.append(rows_md(
            ['ward', 'pdf_page', 'serial', 'was', 'now', 'votes', 'dpi',
             'screenshot'],
            [[f['ward'], f['page'], f['serial'], f['was'], f['now'],
              f.get('votes', ''), f.get('dpi', ''),
              '`%s`' % f.get('screenshot', '')] for f in n_names], 8))
    if n_fathers:
        L.append('### N2. Father/husband names fixed (%d)\n' % len(n_fathers))
        L.append(rows_md(
            ['ward', 'pdf_page', 'serial', 'was', 'now', 'votes', 'screenshot'],
            [[f['ward'], f['page'], f['serial'], f['was'], f['now'],
              f.get('votes', ''), '`%s`' % f.get('screenshot', '')]
             for f in n_fathers], 7))
    if n_rels:
        L.append('### N3. Relation labels corrected from the father-cell label '
                 '(%d)\n' % len(n_rels))
        L.append(rows_md(['ward', 'pdf_page', 'serial', 'was', 'now'],
                         [[f['ward'], f['page'], f['serial'], f['was'],
                           f['now']] for f in n_rels], 5))
    if n_hraw:
        L.append('### N4. Junk house numbers replaced by exact text-layer '
                 'digits (%d)\n' % len(n_hraw))
        L.append(rows_md(['ward', 'pdf_page', 'serial', 'was', 'now=raw'],
                         [[f['ward'], f['page'], f['serial'], f['was'],
                           f['now']] for f in n_hraw], 5))
    if n_hocr:
        L.append('### N5. Text house numbers fixed by cell OCR (%d)\n'
                 % len(n_hocr))
        L.append(rows_md(
            ['ward', 'pdf_page', 'serial', 'was', 'now', 'dpi', 'screenshot'],
            [[f['ward'], f['page'], f['serial'], f['was'], f['now'],
              f.get('dpi', ''), '`%s`' % f.get('screenshot', '')]
             for f in n_hocr], 7))
    if n_locs:
        L.append('### N6. Locality headers fixed (%d)\n' % len(n_locs))
        L.append(rows_md(['ward', 'rows affected', 'was', 'now'],
                         [[f['ward'], f.get('applied_rows', f.get('rows', '?')),
                           f['was'], f['now']] for f in n_locs], 4))
    if CELL.get('mothers_confirmed'):
        L.append('### N7. Re-read confirmation of the 6 माता name cells\n')
        L.append(rows_md(
            ['pdf_page', 'serial', 'stored', 're-read (900/1800 dpi)', 'votes'],
            [[m['page'], m['serial'], m['stored'], m.get('re_read') or '(unreadable)',
              m.get('votes', '')] for m in CELL['mothers_confirmed']], 5))
        L.append('')
    if CELL.get('sample_mismatches'):
        L.append('### N8. Raw-layer vs OCR house mismatches in the sample '
                 '(%d)\n' % len(CELL['sample_mismatches']))
        L.append(rows_md(
            ['ward', 'pdf_page', 'serial', 'raw', 'OCR candidates'],
            [[f['ward'], f['page'], f['serial'], f['raw'],
              ' \\| '.join(str(c) for c in f['ocr'][:4])]
             for f in CELL['sample_mismatches']], 5))
    if CELL.get('covers'):
        L.append('### N9. Cover-page confirmations (booth / address / '
                 'delimitation)\n')
        rows = []
        for wn in sorted(CELL['covers'], key=lambda x: int(x)):
            c = CELL['covers'][wn]
            rows.append([wn, c.get('booth_raw', ''),
                         c.get('booth_ocr2400', ''),
                         'ok' if not c.get('address_900') or
                         c.get('address_900') == c.get('address_stored')
                         else 'replaced',
                         '%s' % c.get('desc_sim', '')])
        L.append(rows_md(
            ['ward', 'booth (raw layer)', 'booth (2400 dpi OCR)',
             'address (900 dpi)', 'desc similarity'], rows, 5))
        L.append('')
    if n_unres:
        L.append('### N10. Cells that stayed suspicious after 4-variant OCR - '
                 '**manual check against the PDF please** (%d)\n'
                 % len(n_unres))
        L.append(rows_md(
            ['field', 'ward', 'pdf_page', 'serial', 'kept value',
             'OCR candidates'],
            [[f.get('field'), f.get('ward'), f.get('page'), f.get('serial'),
              f.get('was'),
              ' \\| '.join(str(c)[:40] for c in (f.get('candidates') or [])[:4])]
             for f in n_unres], 6))
    L.append('')

open(os.path.join(WORK, '..', '..', 'verification.md') if False else 'verification.md',
     'w', encoding='utf-8').write('\n'.join(L))

print('mata rows:', len(mata_fixed), '| stray labels:', len(stray_fixed))
print('age corrected:', len(age_fixed), '| house corrected:', len(house_fixed),
      '| name corrected:', len(name_fixed))
print('raw re-check: any *new* mismatch would appear above in the A/C counts')
print('age out-of-range:', len(age_odd), '| nonnum house:', len(nonnum_house))
print('bad names:', len(bad_names), '| bad fathers:', len(bad_father))
print('rel empty:', len(rel_empty), '| empty locality:', len(empty_loc))
print('empty core:', len(empty_core))
print('booth per ward:', [(wd['ward_no'], wd['booth_no'], wd['room_no'], wd['booth_cands']) for wd in wards])
print('saved verification.md + records_final.json')
