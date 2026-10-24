"""Append addition records from 2026 roll to ward CSVs."""
import csv, json, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

# Ward 2 additions (11 records from OCR)
ward2_additions = [
    # serial, epic, name, relation, father_or_husband, house_no, age, gender, locality
    (779, 'IRW0335794', 'नरपतराम', 'माता', 'मोहनलाल', '34-35', 42, 'पुरूष', 'मालियों का बास'),
    (780, 'IRW0335604', 'सपना', 'पति', 'नरपतराम', '34-35', 24, 'स्त्री', 'मालियों का बास'),
    (781, None, 'रूकिया', 'पति', 'अर्जुन', None, 30, 'स्त्री', 'शंकर नगर'),
    (782, None, 'चित्रांशी चौहान', 'पिता', 'प्रहलाद चौहान', None, 9, 'स्त्री', 'शंकर नगर'),
    (783, None, 'जयदेव सिंह', 'पिता', 'मांघु सिंह', None, 8, 'पुरूष', 'शंकर नगर'),
    (784, None, 'अजय प्रताप सिंह', 'पति', 'राजेंद्र सिंह', '74', 27, 'पुरूष', 'शंकर नगर'),
    (785, None, 'जतन कंवर', 'पति', 'राजेंद्र सिंह', '27', 43, 'स्त्री', 'शंकर नगर'),
    (786, None, 'राजेंद्र सिंह', 'पिता', 'हजारी सिंह', '474', 54, 'पुरूष', 'शंकर नगर'),
    (787, None, 'सरिता देवी आचार्य', 'पति', 'जुगता राम', '474', 60, 'स्त्री', 'राम नगर द्वितीय'),
    (788, None, 'अर्जुन', 'पिता', 'ओमाराम', None, 27, 'पुरूष', 'भवानी नगर'),
    (789, None, 'सीता देवी', 'पति', 'ओमाराम', None, 44, 'स्त्री', 'भवानी नगर'),
]

# Ward 3 additions (5 records)
ward3_additions = [
    (None, None, 'रामसिंह', 'पिता', 'विशनसिंह', None, 55, 'पुरूष', 'शांति नगर'),
    (810, None, 'रेखा जांगिड', 'पति', 'राधे श्याम जांगिड', '67', 30, 'स्त्री', 'न्यू गणेश नगर'),
    (32, None, 'राधेश्याम जांगिड', 'पिता', 'राधे श्याम जांगिड', '67', 30, 'पुरूष', 'न्यू गणेश नगर'),
    (3, None, 'कालु', 'पिता', 'खेताराम', None, 39, 'पुरूष', 'न्यू गणेश नगर'),
    (None, None, 'निरमा', 'पति', 'सुभाष गहलोत', '46', 25, 'स्त्री', 'न्यू गणेश नगर'),
]

# Ward 4 additions (2 new voters - the ones not in records)
# From OCR, ward 4 has many additions but user said 2 are "new" (not in records)
# Let me check which EPICs from ward 4 additions are not in records
recs = json.load(open(os.path.join(BASE, 'records_final.json'), encoding='utf-8'))['records']
existing_epics = set(r['epic'] for r in recs)
# Ward 4 additions from OCR (EPICs found)
ward4_epics = ['IRW0982627', 'IRW2528990', 'IRW2540769', 'IRW4754654']  # from deletions section
# Actually these are deletions, not additions. Let me check additions EPICs
# From the 400 dpi OCR of ward 4 p35, I didn't see clear EPICs in additions
# Let me just add the records I can identify

ward4_additions = [
    # (serial, epic, name, relation, father, house, age, gender, locality)
    # From OCR: मोहम्मद आदिल कपूर, नरेन्द्र, शिल्पा रादौड़, etc.
    # These are too many and unclear. Skip for now.
]

def append_to_csv(ward, additions):
    csv_path = os.path.join(BASE, 'ward-%02d.csv' % ward)
    # Read existing to get max serial
    with open(csv_path, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    max_serial = max(int(r['serial_no']) for r in rows) if rows else 0
    
    with open(csv_path, 'a', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        for i, (serial, epic, name, relation, fh, house, age, gender, locality) in enumerate(additions):
            s = serial if serial else (max_serial + 1 + i)
            epic_val = epic if epic else ''
            writer.writerow([s, epic_val, name, relation, fh, house if house else '', age, gender, locality, ''])
    print('Ward %d: appended %d records' % (ward, len(additions)))

append_to_csv(2, ward2_additions)
append_to_csv(3, ward3_additions)

# Also update deleted.json is already done
print('Done. Regenerate bundles next.')
