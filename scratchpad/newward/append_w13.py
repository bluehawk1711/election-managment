"""Append ward 13 addition records."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

ward13_additions = [
    (None, 'राहुल जांगिड', 'पिता', 'हनुमान राम', None, 24, 'पुरूष', 'सुखदेव विहार'),
    (None, 'राकेश', 'पिता', 'हेमाराम', None, None, 'पुरूष', 'सुखदेव विहार'),
    (None, 'रिकु सियाग', 'पति', 'तेजाराम', None, 29, 'स्त्री', 'मोती नगर'),
    (None, 'श्याम सुन्दर', 'पिता', 'कन्हूयालाल', None, 43, 'पुरूष', 'हरीश नगर'),
    (None, 'सुलोचना शर्मा', 'पति', 'श्याम सुन्दर शर्मा', '73', 46, 'स्त्री', 'महावीर नगर'),
    (None, 'प्रिया जांगिड', 'पिता', 'बाबूलाल', '8', 25, 'स्त्री', 'महावीर नगर'),
    (None, 'रुपाराम', 'पिता', 'संगलाराम', '347', 57, 'पुरूष', 'महावीर नगर'),
]

def append(ward, additions):
    csv_path = os.path.join(BASE, 'ward-%02d.csv' % ward)
    rows = list(csv.DictReader(open(csv_path, encoding='utf-8-sig')))
    max_serial = max(int(r['serial_no']) for r in rows) if rows else 0
    with open(csv_path, 'a', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        for i, (serial, name, relation, fh, house, age, gender, locality) in enumerate(additions):
            s = serial if serial else (max_serial + 1 + i)
            writer.writerow([s, '', name, relation, fh if fh else '', house if house else '', age if age else '', gender, locality, ''])
    path = os.path.join(BASE, 'wards-summary.csv')
    srows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    fn = list(srows[0].keys())
    for r in srows:
        if r['ward_no'] == str(ward):
            r['voters'] = str(int(r['voters']) + len(additions))
            r['male'] = str(int(r['male']) + sum(1 for a in additions if a[6] == 'पुरूष'))
            r['female'] = str(int(r['female']) + sum(1 for a in additions if a[6] == 'स्त्री'))
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fn)
        w.writeheader()
        w.writerows(srows)
    print('Ward %d: appended %d records' % (ward, len(additions)))

append(13, ward13_additions)