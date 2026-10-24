"""Parse 600 dpi cell OCR into structured records."""
import os, re, json, sys, glob

CELLS = 'scratchpad/newward/cells600'
OUTDIR = 'data/rajasthan/jodhpur/jhanwar/veernagar'
GENDER_MAP = {'पुरूष': 'पुरूष', 'पुरुष': 'पुरूष', 'स्त्री': 'स्त्री', 'at': 'स्त्री', 'wt': 'स्त्री'}

def parse_cell(text):
    rec = {'serial': None, 'epic': None, 'name': None, 'relation': None,
           'father_or_husband': None, 'house_no': None, 'age': None, 'gender': None,
           'locality': None}
    m = re.search(r'\[\s*(\d+)\s*\]', text)
    if m: rec['serial'] = int(m.group(1))
    m = re.search(r'([A-Z]{2,3}\d{7})', text)
    if m: rec['epic'] = m.group(1)
    m = re.search(r'(RJ/\d{2}/\d{3}/\d{6})', text)
    if m and not rec['epic']: rec['epic'] = m.group(1)
    m = re.search(r'नाम[:\s]+(.+?)(?:\n|$)', text)
    if m:
        name = m.group(1).strip()
        name = re.sub(r'\s*[|\.\*\\].*$', '', name).strip()
        name = re.sub(r'\s+(पति|पिता|माता)\s+का.*$', '', name).strip()
        if name and len(name) > 1 and 'नाम' not in name:
            rec['name'] = name
    for rel_pat, rel_label in [('पति का नाम', 'पति'), ('पिता का नाम', 'पिता'), ('माता का नाम', 'माता')]:
        fm = re.search(rel_pat + r'[:\s]+(.+?)(?:\n|$)', text)
        if fm:
            rec['relation'] = rel_label
            val = fm.group(1).strip()
            val = re.sub(r'\s*[|\.\*\\].*$', '', val).strip()
            val = re.sub(r'\s+(मकान|आयु|लिंग).*$', '', val).strip()
            if val and 'नाम' not in val:
                rec['father_or_husband'] = val
            break
    m = re.search(r'मकान संख्या[:\s]*(.+?)(?:\n|$)', text)
    if m:
        val = m.group(1).strip()
        val = re.sub(r'\s*[|\.\*\\].*$', '', val).strip()
        dm = re.search(r'(\d{1,6})', val)
        if dm: rec['house_no'] = dm.group(1)
        elif val and val not in ('', 'मकान'): rec['house_no'] = val
    m = re.search(r'आयु[:\s]*(\d+)', text)
    if m: rec['age'] = int(m.group(1))
    m = re.search(r'लिंग[:\s]*(\S+)', text)
    if m:
        g = m.group(1).strip().rstrip('|').strip()
        if g in ('पुरूष', 'पुरुष', 'पुर'): rec['gender'] = 'पुरूष'
        elif g in ('स्त्री',): rec['gender'] = 'स्त्री'
        else: rec['gender'] = g
    for line in text.splitlines():
        line = line.strip()
        if (line and not any(k in line for k in ['नाम:', 'मकान', 'आयु:', 'लिंग:', 'पिता', 'पति', 'माता', '[', 'IRW', 'CTK', 'RJ/', 'Due', 'Deleted'])
            and re.search(r'[\u0900-\u097F]', line)):
            rec['locality'] = line
            break
    return rec

all_recs = []
for f in sorted(glob.glob(os.path.join(CELLS, 'w*_p*_r*_c*.txt'))):
    basename = os.path.basename(f)
    m = re.match(r'w(\d+)_p(\d+)_r(\d+)_c(\d+)\.txt', basename)
    if not m: continue
    w, pno, row, col = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    text = open(f, encoding='utf-8').read()
    rec = parse_cell(text)
    rec['ward'] = w; rec['page'] = pno; rec['row'] = row; rec['col'] = col
    if rec['name'] or rec['serial'] or rec['epic'] or rec['age']:
        all_recs.append(rec)

json.dump(all_recs, open(os.path.join(OUTDIR, 'additions_600.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
# Also copy to main data dir
json.dump(all_recs, open(os.path.join(OUTDIR.replace('scratchpad/newward/cells600', OUTDIR), 'additions_600.json'), 'w', encoding='utf-8') if False else open(os.path.join(OUTDIR, 'additions_600.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('Parsed %d non-empty cells' % len(all_recs))
from collections import Counter
print('Per ward:', dict(Counter(r['ward'] for r in all_recs)))
# stats
print('With serial:', sum(1 for r in all_recs if r['serial']))
print('With epic:', sum(1 for r in all_recs if r['epic']))
print('With name:', sum(1 for r in all_recs if r['name']))
print('With age:', sum(1 for r in all_recs if r['age']))
