"""Append ward 11 addition records."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

ward11_additions = [
    (None, 'खुशबू चौहान', 'पति', 'रफ़ीक', '52', 20, 'स्त्री', 'बालाजी नगर'),
    (None, 'रफ़ीक', 'पिता', 'सुभान खान', '22', 25, 'पुरूष', 'बालाजी नगर'),
    (None, 'मो साबिर', 'पिता', 'रहीम', '236', 23, 'पुरूष', 'बालाजी नगर'),
    (None, 'आमसा', 'पति', 'रहीम बक्श', '236', 47, 'स्त्री', 'बालाजी नगर'),
    (None, 'वसारत नवाज', 'पिता', 'अब्दुल गनी', '232', 31, 'पुरूष', 'बालाजी नगर'),
    (None, 'नसीम पठान', 'पिता', 'अब्दुल गनी', '232', 45, 'स्त्री', 'बालाजी नगर'),
    (None, 'अब्दुल गनी', 'पिता', 'वजीर खान', '232', 72, 'पुरूष', 'बालाजी नगर'),
    (None, 'चारण', 'पति', 'राजूराम', '264', 24, 'स्त्री', 'बालाजी नगर'),
    (None, 'साहिल', 'पिता', 'मोहम्मद सादिक', '235', 20, 'पुरूष', 'बालाजी नगर'),
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

append(11, ward11_additions)