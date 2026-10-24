# -*- coding: utf-8 -*-
"""Recompute missing addition photos using CSV row counts as ground truth."""
import json, sys, csv, os
sys.stdout.reconfigure(encoding='utf-8')

VDIR = 'data/rajasthan/jodhpur/jhanwar/veernagar'
rf = json.load(open(os.path.join(VDIR, 'records_final.json'), encoding='utf-8'))
recs = rf['records']
main_max = {}
for r in recs:
    if r.get('epic'):
        main_max[r['ward']] = max(main_max.get(r['ward'], 0), r['serial'])

# CSV row counts = ground truth including additions
csv_total = {}
for w in range(1, 14):
    p = os.path.join(VDIR, 'ward-%02d.csv' % w)
    with open(p, encoding='utf-8-sig') as f:
        csv_total[w] = sum(1 for _ in csv.DictReader(f))

m = json.load(open('data/photos/manifest.json', encoding='utf-8'))
have = set((e['ward'], e['serial']) for e in m['images']
           if e.get('kind') == 'portrait' and e.get('ward') and e.get('serial'))

tot_add = tot_missing = 0
missing_detail = {}
for w in range(1, 14):
    mm = main_max.get(w, 0)
    total = csv_total[w]
    adds = [s for s in range(mm + 1, total + 1)]
    miss = [s for s in adds if (w, s) not in have]
    tot_add += len(adds)
    tot_missing += len(miss)
    missing_detail[w] = miss
    print('ward %2d: main_max=%3d csv_total=%3d additions=%3d missing_photo=%2d %s' %
          (w, mm, total, len(adds), len(miss), miss))

print('\nTOTAL additions =', tot_add, '| missing photos =', tot_missing)
json.dump(missing_detail, open('scratchpad/newward/missing_photos.json', 'w'))
print('wrote scratchpad/newward/missing_photos.json')
