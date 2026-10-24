"""Parse band OCR text into structured addition records."""
import os, re, json, sys

def parse_band_text(text):
    """Extract records from band OCR text. Returns list of dicts."""
    records = []
    # Split into lines
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    # Remove band headers and page headers
    filtered = []
    for line in lines:
        if line.startswith('=====') or line.startswith('राज्य निर्वाचन') or line.startswith('पंचायत चुनाव') or \
           line.startswith('जिलापरिषद') or line.startswith('पंचायत समिति') or line.startswith('विधानसभा') or \
           line.startswith('ग्रामपंचायत') or line.startswith('वार्ड') or line.startswith('पूरक') or \
           line.startswith('पुनरीक्षण') or line.startswith('बट:') or line.startswith('घटक') or \
           line.startswith('पृष्ठ') or line.startswith('आयु ।') or line.startswith('परिवर्धन की') or \
           line.startswith('संख्या') or 'Due To' in line or 'Deleted' in line:
            continue
        filtered.append(line)
    
    # Now parse: find serial markers and associate fields
    # Strategy: join all lines, then split by serial markers
    full = '\n'.join(filtered)
    
    # Find all serial markers [N] or [ N ]
    # Split text into chunks starting at each serial
    serial_positions = [(m.start(), m.group(1)) for m in re.finditer(r'\[\s*(\d+)\s*\]', full)]
    
    for idx, (pos, serial) in enumerate(serial_positions):
        end = serial_positions[idx+1][0] if idx+1 < len(serial_positions) else len(full)
        chunk = full[pos:end]
        rec = {'serial': int(serial)}
        # EPIC
        epic_m = re.search(r'([A-Z]{2,3}\d{7})', chunk)
        if epic_m:
            rec['epic'] = epic_m.group(1)
        rj_m = re.search(r'(RJ/\d{2}/\d{3}/\d{6})', chunk)
        if rj_m and 'epic' not in rec:
            rec['epic'] = rj_m.group(1)
        # Name
        name_m = re.search(r'नाम:\s*(.+?)(?:\n|$)', chunk)
        if name_m:
            name = name_m.group(1).strip()
            # clean: remove trailing field labels and pipes
            name = re.sub(r'\s*[|\.\*].*$', '', name).strip()
            name = re.sub(r'\s+(पति|पिता|माता)\s+का.*$', '', name).strip()
            if name and not name.startswith('नाम'):
                rec['name'] = name
        # Relation + father/husband
        for rel_pat, rel_label in [('पति का नाम', 'पति'), ('पिता का नाम', 'पिता'), ('माता का नाम', 'माता')]:
            fm = re.search(rel_pat + r':\s*(.+?)(?:\n|$)', chunk)
            if fm:
                rec['relation'] = rel_label
                val = fm.group(1).strip()
                val = re.sub(r'\s*[|\.\*].*$', '', val).strip()
                val = re.sub(r'\s+(मकान|आयु|लिंग).*$', '', val).strip()
                if val:
                    rec['father_or_husband'] = val
                break
        # House
        house_m = re.search(r'मकान संख्या:\s*(.+?)(?:\n|$)', chunk)
        if house_m:
            val = house_m.group(1).strip()
            val = re.sub(r'\s*[|\.\*].*$', '', val).strip()
            dm = re.search(r'(\d{1,6})', val)
            if dm:
                rec['house_no'] = dm.group(1)
            elif val and val not in ('', 'मकान'):
                rec['house_no'] = val
        # Age
        age_m = re.search(r'आयु:\s*(\d+)', chunk)
        if age_m:
            rec['age'] = int(age_m.group(1))
        # Gender
        gender_m = re.search(r'लिंग:\s*(\S+)', chunk)
        if gender_m:
            g = gender_m.group(1).strip().rstrip('|').strip()
            if g in ('पुरूष', 'पुरुष', 'पुर'):
                rec['gender'] = 'पुरूष'
            elif g in ('स्त्री', 'at', 'wt', 'स्'):
                rec['gender'] = 'स्त्री'
            else:
                rec['gender'] = g
        # Locality: Devanagari line without field labels
        for line in chunk.split('\n'):
            line = line.strip()
            if (line and not any(k in line for k in ['नाम:', 'मकान', 'आयु:', 'लिंग:', 'पिता', 'पति', 'माता', '[', 'IRW', 'CTK', 'RJ/', 'Due', 'Deleted'])
                and re.search(r'[\u0900-\u097F]', line) and len(line) > 3):
                rec['locality'] = line
                break
        records.append(rec)
    return records

# Process all band files
all_records = []
for w in range(1, 14):
    for pno in [29,34,31,34,35,36,33,36,19,16,19,15,18,12,16,12,15,27,28,31,29,32,24,25,28]:
        # only process files that exist
        path = 'scratchpad/newward/band500_w%d_p%d.txt' % (w, pno)
        if not os.path.exists(path):
            continue
        text = open(path, encoding='utf-8').read()
        # only process additions section
        # find additions section
        add_start = text.find('परिवर्धन सूची')
        del_start = text.find('विलोपन सूची')
        if add_start >= 0:
            if del_start >= 0 and del_start > add_start:
                add_text = text[add_start:del_start]
            else:
                add_text = text[add_start:]
        else:
            add_text = text
        recs = parse_band_text(add_text)
        for r in recs:
            r['ward'] = w
            r['page'] = pno
        all_records.extend(recs)

# Deduplicate by (ward, serial)
seen = set()
unique = []
for r in all_records:
    key = (r.get('ward'), r.get('serial'))
    if key in seen:
        continue
    seen.add(key)
    unique.append(r)

json.dump(unique, open('data/rajasthan/jodhpur/jhanwar/veernagar/additions_parsed_v2.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('Total records: %d (unique: %d)' % (len(all_records), len(unique)))
# summary per ward
from collections import Counter
print('Per ward:', dict(Counter(r.get('ward') for r in unique)))
# check completeness
for r in unique[:5]:
    print(r)
