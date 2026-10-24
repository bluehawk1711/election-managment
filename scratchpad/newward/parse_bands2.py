"""Parse band OCR text by splitting on 'नाम:' markers."""
import os, re, json, sys

def parse_additions_text(text):
    # Extract additions section
    add_start = text.find('परिवर्धन सूची')
    del_start = text.find('विलोपन सूची')
    if add_start >= 0:
        if del_start >= 0 and del_start > add_start:
            text = text[add_start:del_start]
        else:
            text = text[add_start:]
    # Split by 'नाम:' - each occurrence starts a new record
    # But first, normalize: replace newlines with spaces within the text
    text = text.replace('\n', ' ')
    # Split by 'नाम:'
    parts = re.split(r'नाम:\s*', text)
    records = []
    for part in parts[1:]:  # skip before first नाम:
        rec = {}
        # name: everything until next field label or serial
        # Capture name (until पति/पिता/माता/मकान/आयु/लिंग or serial bracket or end)
        name_m = re.match(r'(.+?)(?=\s+(?:पति|पिता|माता)\s+का|\s+मकान|\s+आयु|\s+लिंग|\s*\[|\s+IRW|\s+CTK|\s+RJ/|$)', part)
        if name_m:
            name = name_m.group(1).strip()
            name = re.sub(r'\s*[|\.\*\\].*$', '', name).strip()
            if name and len(name) > 1:
                rec['name'] = name
        # serial (may be before or after name in the chunk)
        # Look in surrounding context - serials are in brackets
        # relation + father
        for rel_pat, rel_label in [('पति का नाम', 'पति'), ('पिता का नाम', 'पिता'), ('माता का नाम', 'माता')]:
            fm = re.search(rel_pat + r':\s*(.+?)(?=\s+मकान|\s+आयु|\s+लिंग|\s*\[|\s+IRW|\s+CTK|\s+RJ/|$)', part)
            if fm:
                rec['relation'] = rel_label
                val = fm.group(1).strip()
                val = re.sub(r'\s*[|\.\*\\].*$', '', val).strip()
                if val:
                    rec['father_or_husband'] = val
                break
        # house
        hm = re.search(r'मकान संख्या:\s*(.+?)(?=\s+आयु|\s+लिंग|\s*\[|\s+IRW|\s+CTK|\s+RJ/|$)', part)
        if hm:
            val = hm.group(1).strip()
            val = re.sub(r'\s*[|\.\*\\].*$', '', val).strip()
            dm = re.search(r'(\d{1,6})', val)
            if dm:
                rec['house_no'] = dm.group(1)
            elif val and val not in ('', 'मकान'):
                rec['house_no'] = val
        # age
        am = re.search(r'आयु:\s*(\d+)', part)
        if am:
            rec['age'] = int(am.group(1))
        # gender
        gm = re.search(r'लिंग:\s*(\S+)', part)
        if gm:
            g = gm.group(1).strip().rstrip('|').strip()
            if g in ('पुरूष', 'पुरुष', 'पुर'):
                rec['gender'] = 'पुरूष'
            elif g in ('स्त्री',):
                rec['gender'] = 'स्त्री'
            else:
                rec['gender'] = g
        # EPIC
        em = re.search(r'([A-Z]{2,3}\d{7})', part)
        if em:
            rec['epic'] = em.group(1)
        rj = re.search(r'(RJ/\d{2}/\d{3}/\d{6})', part)
        if rj and 'epic' not in rec:
            rec['epic'] = rj.group(1)
        # serial (look in the part and preceding context)
        sm = re.search(r'\[\s*(\d+)\s*\]', part)
        if sm:
            rec['serial'] = int(sm.group(1))
        # locality: Devanagari text without field labels
        # skip for now
        if rec.get('name') or rec.get('age') or rec.get('epic'):
            records.append(rec)
    return records

SUPP = {1:[29],2:[34],3:[31,34],4:[35,36],5:[33,36],6:[19],7:[16,19],8:[15,18],9:[12,16],10:[12,15],11:[27,28,31],12:[29,32],13:[24,25,28]}
all_recs = []
for w in range(1, 14):
    for pno in SUPP[w]:
        path = 'scratchpad/newward/band500_w%d_p%d.txt' % (w, pno)
        if not os.path.exists(path):
            continue
        text = open(path, encoding='utf-8').read()
        recs = parse_additions_text(text)
        for r in recs:
            r['ward'] = w
            r['page'] = pno
        all_recs.extend(recs)

# dedup by (ward, name, age)
seen = set()
unique = []
for r in all_recs:
    key = (r.get('ward'), r.get('name'), r.get('age'))
    if key in seen:
        continue
    seen.add(key)
    unique.append(r)

import json
json.dump(unique, open('data/rajasthan/jodhpur/jhanwar/veernagar/additions_parsed_v3.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('Total records: %d (unique by name+age: %d)' % (len(all_recs), len(unique)))
from collections import Counter
print('Per ward:', dict(Counter(r.get('ward') for r in unique)))
