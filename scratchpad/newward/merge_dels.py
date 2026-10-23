import json, sys
sys.stdout.reconfigure(encoding='utf-8')
existing = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/deleted.json', encoding='utf-8'))
exist_epics = set(d['epic_id'] for d in existing['records'])
new_dels = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/deletions_2026_raw.json', encoding='utf-8'))
recs = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/records_final.json', encoding='utf-8'))['records']
epic_to_rec = {r['epic']: r for r in recs}
new_matched = []
for d in new_dels:
    if d['epic'] in epic_to_rec and d['epic'] not in exist_epics:
        r = epic_to_rec[d['epic']]
        new_matched.append({'ward': r['ward'], 'serial': r['serial'], 'epic_id': d['epic'],
                           'photos_pdf_page': None, 'stamp_bbox_pt': None})
print('Existing:', len(existing['records']))
print('New matched (not already in deleted):', len(new_matched))
for d in new_matched:
    print('  ward %d serial %d %s' % (d['ward'], d['serial'], d['epic_id']))
existing['records'] = existing['records'] + new_matched
existing['records'].sort(key=lambda x: (x['ward'], x['serial']))
existing['count'] = len(existing['records'])
json.dump(existing, open('data/rajasthan/jodhpur/jhanwar/veernagar/deleted.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('Merged total:', len(existing['records']))
