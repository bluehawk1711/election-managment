import json, sys, re
sys.stdout.reconfigure(encoding='utf-8')
recs = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/records_final.json', encoding='utf-8'))['records']
epic_set = set(r['epic'] for r in recs)
dels = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/deletions_2026_raw.json', encoding='utf-8'))

def variants(e):
    v = [e]
    if not e.startswith('I'):
        v.append('I' + e)
    if e.startswith('RW'):
        v.append('IRW' + e[2:])
    v.append(e.replace('O', '0'))
    v.append(e.replace('0', 'O'))
    # leading I
    if e.startswith('R'):
        v.append('I' + e)
    return v

unmatched = []
for d in dels:
    if d['epic'] in epic_set:
        continue
    found = None
    for v in variants(d['epic']):
        if v in epic_set:
            found = v
            break
    if found:
        r = [x for x in recs if x['epic'] == found][0]
        print('FIXED: %s -> %s (ward %d serial %d %s)' % (d['epic'], found, r['ward'], r['serial'], r['name']))
        d['epic'] = found  # correct in place
    else:
        unmatched.append(d['epic'])
        print('STILL UNMATCHED: %s' % d['epic'])

# save corrected
json.dump(dels, open('data/rajasthan/jodhpur/jhanwar/veernagar/deletions_2026_raw.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\nUnmatched:', unmatched)
