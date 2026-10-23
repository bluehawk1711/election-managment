import json, sys
sys.stdout.reconfigure(encoding='utf-8')
recs = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/records_final.json', encoding='utf-8'))['records']
epic_set = set(r['epic'] for r in recs)
dels = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/deletions_2026_raw.json', encoding='utf-8'))
print('Total extracted:', len(dels))
matched = 0
for d in dels:
    if d['epic'] in epic_set:
        matched += 1
        r = [x for x in recs if x['epic'] == d['epic']][0]
        print('  MATCH: ward=%d epic=%s -> record ward=%d serial=%d name=%s' % (d['ward'], d['epic'], r['ward'], r['serial'], r['name']))
    else:
        print('  NOMATCH: ward=%d epic=%s' % (d['ward'], d['epic']))
print('Matched %d/%d' % (matched, len(dels)))
