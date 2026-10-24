"""Append ward 10 addition records."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

ward10_additions = [
    (None, 'पूजा', 'पति', 'मनोज', '78', 24, 'स्त्री', 'शंकर नगर'),
    (None, 'मनोज', 'पिता', 'लक्ष्मण', '78', 23, 'पुरूष', 'शंकर नगर'),
    (None, 'सुमित', 'पिता', 'लक्ष्मण', '78', 18, 'पुरूष', 'शंकर नगर'),
    (None, 'नितिन', 'पिता', 'लक्ष्मण', '78', 34, 'पुरूष', 'शंकर नगर'),
    (None, 'सज्जन', 'पिता', 'अरविन्द', '78', 37, 'स्त्री', 'शंकर नगर'),
    (None, 'अनिशा', 'पति', 'रमेश', '78', 38, 'स्त्री', 'शंकर नगर'),
    (None, 'रमेश', 'पिता', None, '478', 39, 'पुरूष', 'शंकर नगर'),
    (None, 'मीनाक्षी दुबे', 'पति', 'अंजनी कुमार दुबे', None, 28, 'स्त्री', 'शंकर नगर'),
    (None, 'अंजनी कुमार दुबे', 'पिता', 'बी एन दुबे', None, 48, 'पुरूष', 'शंकर नगर'),
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

append(10, ward10_additions)