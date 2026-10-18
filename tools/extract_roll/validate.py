# -*- coding: utf-8 -*-
"""Post-fix validation: assert every invariant EXTRACTION.md promises.

Run from the repo root after fix_final.py + write_csv.py:
    python tools/extract_roll/validate.py

Checks:
  1. records_final.json == CSVs (row counts per ward, spot values)
  2. 6855 total rows; per-ward counts == wards-summary.csv
  3. serials continuous 1..N per ward, no duplicates
  4. EPIC format (counts new/old format; old listed in section K)
  5. gender tallies per ward == wards-summary.csv (cover-page truth)
  6. core fields present (name, gender, age) on every row; house follows
     the house policy — 1..6 digits (align_houses.py) or EMPTY when the
     printed `मकान संख्या:` cell carries no number
  7. ages digits 18..100
  8. house is `^\d{1,6}$` or empty — no text, no label residue, no 7-digit
     EPIC/age-column merges
  9. no suspicious label residue left in name/father (e.g. 'नाम:', 'Photo')
 10. verification.md exists and its section counts match fresh recomputation
Exits non-zero with a failure list if anything is violated.
"""
import csv
import json
import os
import re
import sys

DATA = os.path.join('data', 'rajasthan', 'jodhpur', 'jhanwar', 'veernagar')
REC = os.path.join('tools', 'extract_roll', 'records_final.json')
fail = []

# Two father cells the PDF genuinely does not let us read (documented in
# verification.md section F2): every crop/DPI/PSM variant returns junk over
# a printed `...करसिंह`. They are excluded from check 9 only - awaiting
# manual transcription, not silently passed.
KNOWN_RESIDUE = {(1, 11, 217, 'father'), (1, 16, 354, 'father')}


def check(cond, msg):
    if not cond:
        fail.append(msg)
    return cond


data = json.load(open(REC, encoding='utf-8'))
recs = data['records']
wards = data['wards']

# ---- 1/2/3/5: CSVs vs summary vs records -------------------------------
summary = {}
with open(os.path.join(DATA, 'wards-summary.csv'), encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        summary[int(row['ward_no'])] = row

check(len(recs) == 6855, 'records_final.json has %d rows, want 6855' % len(recs))
check(len(summary) == 13, 'wards-summary.csv has %d wards, want 13' % len(summary))

for wd in wards:
    wn = wd['ward_no']
    rows = sorted((r for r in recs if r['ward'] == wd['idx']),
                  key=lambda r: r['serial'] or 0)
    # serial continuity
    serials = [r['serial'] for r in rows]
    check(serials == list(range(1, len(rows) + 1)),
          'ward %d: serials not continuous 1..N' % wn)
    # summary counts
    s = summary.get(wn)
    if check(s is not None, 'ward %d missing from wards-summary.csv' % wn):
        check(int(s['voters']) == len(rows),
              'ward %d: summary %s rows vs records %d'
              % (wn, s['voters'], len(rows)))
        m = sum(1 for r in rows if r['gender'] == 'पुरूष')
        fm = sum(1 for r in rows if r['gender'] == 'स्त्री')
        check(int(s['male']) == m and int(s['female']) == fm,
              'ward %d: gender tally m/f %d/%d vs summary %s/%s'
              % (wn, m, fm, s['male'], s['female']))
    # CSV parity
    path = os.path.join(DATA, 'ward-%02d.csv' % wn)
    if check(os.path.exists(path), 'missing %s' % path):
        with open(path, encoding='utf-8-sig') as f:
            crows = list(csv.DictReader(f))
        check(len(crows) == len(rows),
              'ward %d: CSV %d rows vs records %d'
              % (wn, len(crows), len(rows)))
        for cr, r in zip(crows, rows):
            if (cr['serial_no'] != str(r['serial'])
                    or cr['epic_id'] != r['epic']
                    or cr['name'] != r['name']
                    or cr['father_or_husband_name'] != r['father']
                    or cr['house_no'] != r['house']
                    or cr['locality'] != r['locality']):
                fail.append('ward %d serial %s: CSV != records (field drift)'
                            % (wn, r['serial']))
                break

# ---- 4/6/7/8: per-row invariants ---------------------------------------
old_fmt = 0
known_residue = 0
for r in recs:
    tag = 'w%s p%s s%s' % (r['ward'], r['page'], r['serial'])
    if not re.fullmatch(r'[A-Z]{3}\d{7}', r['epic'] or ''):
        # Old-format EPIC: `RJ/24/185/282555` / `RJ/21/161/000634` — the
        # slash-separated form listed in verification.md section K (53 rows).
        if re.match(r'RJ[/\-]', r['epic'] or ''):
            old_fmt += 1
        else:
            fail.append('%s: bad epic %r' % (tag, r['epic']))
    if not (r['name'] and r['gender'] and r['age']):
        fail.append('%s: empty core field' % tag)
    if r['gender'] not in ('पुरूष', 'स्त्री', 'तृतीयलिंग'):
        fail.append('%s: bad gender %r' % (tag, r['gender']))
    a = r['age']
    if not (str(a).isdigit() and 18 <= int(a) <= 100):
        fail.append('%s: age %r outside 18..100' % (tag, a))
    h = r['house'] or ''
    # House policy (tools/extract_roll/align_houses.py): digits only or
    # empty. A record with no printed number legitimately has none (section
    # D lists them); anything else — text, label fragments, 7-digit merges —
    # is exactly what that pass removed, so it must never come back.
    if h and not re.fullmatch(r'\d{1,6}', h):
        fail.append('%s: house %r not ^\\d{1,6}$ or empty' % (tag, h))
    for field in ('name', 'father'):
        v = r[field] or ''
        if re.search(r'नाम\s*[:：]|का\s*नाम|पिता\s*का|पति\s*का|माता\s*का|'
                     r'Photo|Available|मकान\s*संख्या', v):
            if (r['ward'], r['page'], r['serial'], field) in KNOWN_RESIDUE:
                known_residue += 1
                continue
            fail.append('%s: label residue in %s: %r' % (tag, field, v))
    if not re.fullmatch(r'(पिता|पति|माता|अन्य)', r['relation'] or ''):
        fail.append('%s: bad relation %r' % (tag, r['relation']))

# ---- 10: verification.md section counts --------------------------------
check(os.path.exists('verification.md'), 'verification.md missing')
if os.path.exists('verification.md'):
    vmd = open('verification.md', encoding='utf-8').read()
    heads = dict(re.findall(r'^## ([A-Z]\d?)[.\s].*?\((\d+)\)', vmd, re.M))

    # Mirror fix_final.suspicious EXACTLY, substring quirks included, or the
    # section counts drift from the recomputation.
    suspicious = lambda v: bool(v) and (
        re.search(r'\d', v) or re.search(r'[\u0966-\u096f]', v)
        or re.search(r'[A-Za-z]{2}', v)
        or any(t in v for t in ('**', '..', '"', '\u201c', '\u201d', 'Photo',
                                'vali', 'avail', 'oe')))
    bad_names = sum(1 for r in recs if suspicious(r['name']))
    bad_father = sum(1 for r in recs if suspicious(r['father']))
    if 'E' in heads:
        check(int(heads['E']) == bad_names,
              'verification E says %s, records have %d suspicious names'
              % (heads['E'], bad_names))
    if 'F' in heads:
        check(int(heads['F']) == bad_father,
              'verification F says %s, records have %d suspicious fathers'
              % (heads['F'], bad_father))

print('rows: %d | wards: %d | old-format EPIC: %d' % (len(recs), len(wards), old_fmt))
print('known-unresolved residue (verification F2, awaiting manual data): %d'
      % known_residue)
print('suspicious names left: %d | fathers left: %d'
      % (sum(1 for r in recs if suspicious(r['name'])),
         sum(1 for r in recs if suspicious(r['father']))))
if fail:
    print('\nFAILED %d checks:' % len(fail))
    for m in fail[:60]:
        print('  -', m)
    if len(fail) > 60:
        print('  ... and %d more' % (len(fail) - 60))
    sys.exit(1)
print('\nALL CHECKS PASSED')
