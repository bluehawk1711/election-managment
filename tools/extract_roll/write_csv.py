# -*- coding: utf-8 -*-
"""Write final per-ward CSVs under data/rajasthan/jodhpur/jhanwar/veernagar/.

One CSV per ward + a wards summary CSV. UTF-8 with BOM so Excel opens
Devanagari correctly.
"""
import json, os, csv

WORK = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join('data', 'rajasthan', 'jodhpur', 'jhanwar', 'veernagar')
os.makedirs(OUT_DIR, exist_ok=True)

data = json.load(open(os.path.join(WORK, 'records_final.json'), encoding='utf-8'))
recs = data['records']

HEADER = ['serial_no', 'epic_id', 'name', 'relation',
          'father_or_husband_name', 'house_no', 'age', 'gender',
          'locality', 'pdf_page']

summary_rows = []
for wd in data['wards']:
    wrecs = sorted((r for r in recs if r['ward'] == wd['idx']),
                   key=lambda r: r['serial'] or 0)
    fname = 'ward-%02d.csv' % wd['ward_no']
    path = os.path.join(OUT_DIR, fname)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        for r in wrecs:
            w.writerow([r['serial'], r['epic'], r['name'], r['relation'],
                        r['father'], r['house'], r['age'], r['gender'],
                        r['locality'], r['page']])
    print('%s  %d rows' % (path, len(wrecs)))
    summary_rows.append({
        'ward_no': wd['ward_no'],
        'voters': len(wrecs),
        'male': sum(1 for r in wrecs if r['gender'] == 'पुरूष'),
        'female': sum(1 for r in wrecs if r['gender'] == 'स्त्री'),
        'third_gender': sum(1 for r in wrecs if r['gender'] == 'तृतीयलिंग'),
        'ward_delimitation': wd['desc'],
        'booth_no': wd.get('booth_no', ''),
        'room_no': wd.get('room_no', ''),
        'booth_address': wd.get('booth_address', wd.get('booth', '')),
        'pdf_pages': '%d-%d' % (wd['rec_start'], wd['rec_end']),
    })

sum_path = os.path.join(OUT_DIR, 'wards-summary.csv')
with open(sum_path, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(summary_rows[0].keys()))
    w.writeheader()
    for row in summary_rows:
        w.writerow(row)
print(sum_path)

total = sum(r['voters'] for r in summary_rows)
print('total voters:', total)
