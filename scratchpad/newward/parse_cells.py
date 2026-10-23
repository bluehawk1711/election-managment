"""Parse cropped cell OCR into structured addition records."""
import os, re, json, sys, glob

CELLS = 'scratchpad/newward/cells'
OUTDIR = 'data/rajasthan/jodhpur/jhanwar/veernagar'
GENDER_MAP = {'पुरूष': 'पुरूष', 'स्त्री': 'स्त्री', 'पुरुष': 'पुरूष', 'स्': 'स्त्री', 'at': 'स्त्री', 'wt': 'स्त्री', 'पुर': 'पुरूष'}

def parse_cell(text):
    rec = {'serial': None, 'epic': None, 'name': None, 'relation': None,
           'father_or_husband': None, 'house_no': None, 'age': None, 'gender': None,
           'locality': None}
    # serial: bracketed number
    m = re.search(r'\[\s*(\d+)\s*\]', text)
    if m:
        rec['serial'] = int(m.group(1))
    # EPIC: 3 letters + 7 digits or RJ/... format
    m = re.search(r'([A-Z]{2,3}\d{7})', text)
    if m:
        rec['epic'] = m.group(1)
    m = re.search(r'(RJ/\d{2}/\d{3}/\d{6})', text)
    if m and not rec['epic']:
        rec['epic'] = m.group(1)
    # name
    m = re.search(r'नाम:\s*(.+?)(?:\n|$)', text)
    if m:
        name = m.group(1).strip()
        # clean trailing garbage
        name = re.sub(r'\s*\|.*', '', name).strip()
        if name and name not in ('', 'नाम'):
            rec['name'] = name
    # relation + father/husband
    for rel_pat, rel_label in [('पति का नाम', 'पति'), ('पिता का नाम', 'पिता'), ('माता का नाम', 'माता')]:
        m = re.search(rel_pat + r':\s*(.+?)(?:\n|$)', text)
        if m:
            rec['relation'] = rel_label
            val = m.group(1).strip()
            val = re.sub(r'\s*\|.*', '', val).strip()
            if val:
                rec['father_or_husband'] = val
            break
    # house
    m = re.search(r'मकान संख्या:\s*(.+?)(?:\n|$)', text)
    if m:
        val = m.group(1).strip()
        val = re.sub(r'\s*\|.*', '', val).strip()
        # extract digits
        dm = re.search(r'(\d{1,6})', val)
        if dm:
            rec['house_no'] = dm.group(1)
        elif val and val not in ('', 'मकान'):
            rec['house_no'] = val  # keep text if no digits
    # age + gender
    m = re.search(r'आयु:\s*(\d+)', text)
    if m:
        rec['age'] = int(m.group(1))
    m = re.search(r'लिंग:\s*(\S+)', text)
    if m:
        g = m.group(1).strip().rstrip('|').strip()
        rec['gender'] = g if g else None
    # locality: Devanagari line without field labels
    for line in text.splitlines():
        line = line.strip()
        if (line and not any(k in line for k in ['नाम:', 'मकान', 'आयु:', 'लिंग:', 'पिता', 'पति', '[', 'IRW', 'CTK', 'RJ/'])
            and re.search(r'[\u0900-\u097F]', line)):
            rec['locality'] = line
            break
    return rec

# Process all cell files
all_recs = []
for f in sorted(glob.glob(os.path.join(CELLS, 'w*_p*_r*_c*.txt'))):
    basename = os.path.basename(f)
    m = re.match(r'w(\d+)_p(\d+)_r(\d+)_c(\d+)\.txt', basename)
    if not m:
        continue
    w, pno, row, col = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    text = open(f, encoding='utf-8').read()
    rec = parse_cell(text)
    rec['ward'] = w
    rec['page'] = pno
    rec['row'] = row
    rec['col'] = col
    # only keep non-empty cells
    if rec['name'] or rec['serial'] or rec['epic'] or rec['age']:
        all_recs.append(rec)

json.dump(all_recs, open(os.path.join(OUTDIR, 'additions_cells.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('Parsed %d non-empty cells' % len(all_recs))
# summary
from collections import Counter
print('Per ward:', dict(Counter(r['ward'] for r in all_recs)))
