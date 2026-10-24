"""Append ward 4 and ward 6 addition records."""
import csv, os, sys
sys.stdout.reconfigure(encoding='utf-8')
BASE = 'data/rajasthan/jodhpur/jhanwar/veernagar'

# Ward 4 additions (from 600 dpi cell OCR)
ward4_additions = [
    (828, None, 'मोहम्मद आदिल कपूर', 'पिता', 'सोहम्मद यामीन कपूर', '364/355', 49, 'पुरूष', 'बाबा रामदेव नगर'),
    (829, None, 'नरेन्द्र', 'पिता', 'देवाराम', None, 23, 'पुरूष', 'बाबा रामदेव नगर'),
    (829, None, 'शिल्पा राठौड़', 'पिता', 'देवाराम', None, 49, 'स्त्री', 'बाबा रामदेव नगर'),
    (830, None, 'सोनू', 'पिता', 'मुकेश', None, 24, 'स्त्री', 'बाबा रामदेव नगर'),
    (831, None, 'रवीना', 'पिता', None, None, 48, 'स्त्री', 'बाबा रामदेव नगर'),
    (832, None, 'मोहम्मद अशरफ कपूर', 'पिता', 'मोहम्मद यामीन कपूर', '364/355', 27, 'पुरूष', 'बाबा रामदेव नगर'),
    (833, None, 'चेतन', 'पिता', 'सुरेश', '29A', 20, 'पुरूष', 'बाबा रामदेव नगर'),
    (834, None, 'रेहाना कपूर', 'पति', 'वसीम', '364', 29, 'स्त्री', 'बाबा रामदेव नगर'),
    (835, None, 'चुकी देवी', 'पति', 'शंकर राम', None, 28, 'स्त्री', 'बाबा रामदेव नगर'),
    (836, None, 'अफसाना', 'पति', 'अल्ताफ शाह', None, 25, 'स्त्री', 'बाबा रामदेव नगर'),
    (837, None, 'मोहित चौधरी', 'पिता', 'फुसा राम', None, 20, 'पुरूष', 'बाबा रामदेव नगर'),
    (838, None, 'रेखा', 'पति', 'सुरेश प्रजापत', None, 27, 'स्त्री', 'बाबा रामदेव नगर'),
    (839, None, 'अजय शर्मा', 'पिता', 'रमेश शर्मा', None, 23, 'पुरूष', 'बाबा रामदेव नगर'),
    (840, None, 'दुर्गा', 'पति', 'धनाराम', None, 33, 'स्त्री', 'बाबा रामदेव नगर'),
    (842, None, 'ललित सिंह', 'पिता', 'भावेश सिंह', None, 19, 'पुरूष', 'बाबा रामदेव नगर'),
    (843, None, 'जयश्री', 'पिता', 'भावेश सिंह राजपुरोहित', None, 22, 'स्त्री', 'बाबा रामदेव नगर'),
    (844, None, 'देवी सिंह', 'पिता', 'केसर सिंह', None, 20, 'पुरूष', 'बाबा रामदेव नगर'),
    (845, None, 'मो आसिफ कपूर', 'पिता', 'मो यासीन कपूर', None, 25, 'पुरूष', 'बाबा रामदेव नगर'),
    (846, None, 'मोहम्मद वासिद कपूर', 'पिता', 'मोहम्मद यासीन कपूर', None, 25, 'पुरूष', 'बाबा रामदेव नगर'),
    (847, None, 'मुस्कान', 'पति', 'मोहम्मद वासिद कपूर', '364', 25, 'स्त्री', 'बाबा रामदेव नगर'),
]

# Ward 6 additions (5 records from 600 dpi cell OCR)
ward6_additions = [
    (289, None, 'मुकेश सियाग', 'पिता', 'ओमाराम', None, 24, 'पुरूष', 'अमरावती विहार'),
    (290, None, 'पियूष', 'पिता', 'राम निवास', '290', 49, 'पुरूष', 'अमरावती विहार'),
    (293, None, 'गंगा देवी', 'पति', 'शिवराज सुधार', None, 34, 'स्त्री', 'अमरावती विहार'),
    (292, None, 'सुरेश कुमार', 'पिता', 'गोरधन लाल', '42', 37, 'पुरूष', 'अमरावती विहार'),
    (294, None, 'सुमित्रा प्रजापत्त', 'पति', 'रामावतार', '235', None, 'स्त्री', 'अमरावती विहार'),
    (294, None, 'शिव राज सुधार', 'पिता', 'भागीरथ', '37', 34, 'पुरूष', 'अमरावती विहार'),
]

def append(ward, additions):
    csv_path = os.path.join(BASE, 'ward-%02d.csv' % ward)
    rows = list(csv.DictReader(open(csv_path, encoding='utf-8-sig')))
    max_serial = max(int(r['serial_no']) for r in rows) if rows else 0
    with open(csv_path, 'a', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        for i, (serial, epic, name, relation, fh, house, age, gender, locality) in enumerate(additions):
            s = serial if serial else (max_serial + 1 + i)
            writer.writerow([s, epic if epic else '', name, relation, fh if fh else '', house if house else '', age if age else '', gender, locality, ''])
    # Update summary
    path = os.path.join(BASE, 'wards-summary.csv')
    srows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    fn = list(srows[0].keys())
    for r in srows:
        if r['ward_no'] == str(ward):
            r['voters'] = str(int(r['voters']) + len(additions))
            r['male'] = str(int(r['male']) + sum(1 for a in additions if a[7] == 'पुरूष'))
            r['female'] = str(int(r['female']) + sum(1 for a in additions if a[7] == 'स्त्री'))
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fn)
        w.writeheader()
        w.writerows(srows)
    print('Ward %d: appended %d records' % (ward, len(additions)))

append(4, ward4_additions)
append(6, ward6_additions)