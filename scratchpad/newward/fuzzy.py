import json, sys
sys.stdout.reconfigure(encoding='utf-8')
recs = json.load(open('data/rajasthan/jodhpur/jhanwar/veernagar/records_final.json', encoding='utf-8'))['records']
# For each unmatched, find closest EPIC in same ward by edit distance
unmatched = ['IRW4759540', 'RW2540769', 'IRW7845056', 'RW4844603', 'RWO0777755']
ward_map = {}
for r in recs:
    ward_map.setdefault(r['ward'], []).append(r['epic'])

def ed(a, b):
    if len(a) < len(b): a, b = b, a
    if not b: return len(a)
    prev = list(range(len(b)+1))
    for i, ca in enumerate(a):
        cur = [i+1]
        for j, cb in enumerate(b):
            cur.append(min(prev[j+1]+1, cur[j]+1, prev[j]+(ca!=cb)))
        prev = cur
    return prev[-1]

for e in unmatched:
    # determine ward from dels
    pass

# Just find closest in all records
for e in unmatched:
    best = sorted(recs, key=lambda r: ed(e, r['epic']))[:3]
    print(e, '->', [(r['ward'], r['serial'], r['epic'], ed(e, r['epic'])) for r in best])
