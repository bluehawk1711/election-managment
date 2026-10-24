"""Append ward 5 addition records (7 records from OCR)."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

ward5_additions = [
    # (serial, epic, name, relation, father_or_husband, house_no, age, gender, locality)
    (764, None, 'धनाराम', 'पिता', 'तेजाराम', None, 32, 'पुरूष', 'बाबा रामदेव नगर'),
    (767, None, 'मिनाक्षी', 'पति', 'किशन सिंह', '484', 25, 'स्त्री', 'महादेव नगर'),
    (767, None, 'कोमल', 'पिता', 'मालाराम', '38', 18, 'स्त्री', 'महादेव नगर'),
    (767, None, 'विमला देवासी', 'पिता', 'मालाराम', '438', 29, 'स्त्री', 'महादेव नगर'),
    (768, None, 'शांति', 'पति', 'कालू', '96', 25, 'स्त्री', 'महादेव नगर'),
    (769, None, 'सुरेश', 'पिता', 'गीगाराम', None, 30, 'पुरूष', 'महादेव नगर'),
    (770, None, 'सुन्दर देवी', 'पति', 'खेताराम', '496', 64, 'स्त्री', 'महादेव नगर'),
]

csv_path = os.path.join(BASE, 'ward-05.csv')
with open(csv_path, 'a', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    for (serial, epic, name, relation, fh, house, age, gender, locality) in ward5_additions:
        writer.writerow([serial, epic if epic else '', name, relation, fh, house if house else '', age, gender, locality, ''])
print('Ward 5: appended %d records' % len(ward5_additions))

# Update wards-summary
path = os.path.join(BASE, 'wards-summary.csv')
rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
fieldnames = list(rows[0].keys())
for r in rows:
    if r['ward_no'] == '5':
        r['voters'] = str(int(r['voters']) + len(ward5_additions))
        r['male'] = str(int(r['male']) + sum(1 for a in ward5_additions if a[7] == 'पुरूष'))
        r['female'] = str(int(r['female']) + sum(1 for a in ward5_additions if a[7] == 'स्त्री'))
with open(path, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=fieldnames)
    w.writeheader()
    w.writerows(rows)
print('Updated wards-summary for ward 5')
