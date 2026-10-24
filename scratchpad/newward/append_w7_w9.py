"""Append ward 7 and ward 9 addition records."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

ward7_additions = [
    (None, 'शैलेन्द्र कंवर', 'पिता', 'भूरसिंह', '463', 25, 'पुरूष', 'राम नगर तृतीय'),
    (None, 'उर्वशी कंवर', 'पिता', 'भूरसिंह', '463', 28, 'स्त्री', 'राम नगर तृतीय'),
    (None, 'मानक लाल सोनी', 'पिता', 'अन्दाराम', '07', None, 'पुरूष', 'राम नगर तृतीय'),
    (None, 'उर्पमिला प्रजापत', 'पति', 'भगवान राम', None, 47, 'स्त्री', 'राम नगर तृतीय'),
    (None, 'उषा प्रजापत', 'पिता', 'गौतम', None, None, 'स्त्री', 'राम नगर तृतीय'),
    (None, 'कृष्णा सोनी', 'पिता', 'मानकलाल सो', '0', 22, 'पुरूष', 'राम नगर तृतीय'),
    (None, 'मंजू सोनी', 'पति', 'माणकलाल', '0', 22, 'स्त्री', 'राम नगर तृतीय'),
    (None, 'गौतम', 'पिता', 'हरचंद', None, None, 'पुरूष', 'राम नगर तृतीय'),
    (None, 'भगवानराम', 'पिता', 'हरचंद', None, None, 'पुरूष', 'राम नगर तृतीय'),
    (None, 'गौरव सोनी', 'पिता', 'माणकलाल सोनी', '0', None, 'पुरूष', 'राम नगर तृतीय'),
]

ward9_additions = [
    (None, 'वर्षा शर्मा', 'पिता', 'अरुण गौड़', '780', 24, 'स्त्री', 'शंकर नगर'),
    (None, 'दिनेश खिलेरी', 'पिता', 'विरमा राम', '238', None, 'पुरूष', 'हनुमान ढाणी'),
    (None, 'पिंकी विशनोई', 'पति', 'दिनेश खिलेरी', '238', None, 'स्त्री', 'हनुमान ढाणी'),
    (None, 'मनीष', 'पिता', 'बिरमा राम', '237', None, 'पुरूष', 'हनुमान ढाणी'),
    (None, 'किरण', 'पति', 'मनीष', '237', None, 'स्त्री', 'हनुमान ढाणी'),
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

append(7, ward7_additions)
append(9, ward9_additions)