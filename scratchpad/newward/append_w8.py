"""Append ward 8 addition records."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

ward8_additions = [
    (None, 'मुकेश सोनार', 'पिता', 'मदन लाल', None, 32, 'पुरूष', 'बाबा रामदेव नगर'),
    (None, 'अनिता पटेल', 'पति', 'महेंद्र पटेल', None, 29, 'स्त्री', 'बाबा रामदेव नगर'),
    (None, 'महेंद्र पटेल', 'पिता', 'नरसिंह राम', None, 26, 'पुरूष', 'बाबा रामदेव नगर'),
    (None, 'सुनील कुमार', 'पिता', None, '66', 36, 'पुरूष', 'मोती नगर'),
    (None, 'ओम प्रकाश चौधरी', 'पिता', 'खला राम', None, 42, 'पुरूष', 'हरीश नगर'),
    (None, 'राम कंवरी', 'पति', 'ओम प्रकाश', '20', 38, 'स्त्री', 'हरीश नगर'),
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

append(8, ward8_additions)