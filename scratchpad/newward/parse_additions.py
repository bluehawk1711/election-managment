"""Best-effort extraction of addition records from 400 dpi OCR text."""
import os, re, json, sys

SUPP = {1:[29],2:[34],3:[31,34],4:[35,36],5:[33,36],6:[19],7:[16,19],8:[15,18],9:[12,16],10:[12,15],11:[27,28,31],12:[29,32],13:[24,25,28]}
OUTDIR = 'data/rajasthan/jodhpur/jhanwar/veernagar'
records = []
for w in range(1, 14):
    for pno in SUPP[w]:
        path = '%s/additions_ocr/ward%d_p%d.txt' % (OUTDIR, w, pno)
        if not os.path.exists(path):
            continue
        text = open(path, encoding='utf-8').read()
        # find serial numbers in brackets
        serials = re.findall(r'\[\s*(\d+)\s*\]', text)
        # find EPICs
        epics = re.findall(r'[A-Z]{2,3}\d{7}', text)
        epics += re.findall(r'RJ/\d{2}/\d{3}/\d{6}', text)
        # find age/gender pairs
        age_gender = re.findall(r'आयु:\s*(\d+)\s*.*?लिंग:\s*(\S+)', text)
        # find names after नाम:
        names = re.findall(r'नाम:\s*([^\n]+?)(?=नाम:|$)', text)
        rec = {
            'ward': w, 'page': pno,
            'serials': serials,
            'epics': epics,
            'age_gender_count': len(age_gender),
            'name_count': len(names),
            'raw_text': text,
        }
        records.append(rec)
        print('ward %d p%d: serials=%d epics=%d age/gender=%d' % (w, pno, len(serials), len(epics), len(age_gender)))

json.dump(records, open('%s/additions_parsed.json' % OUTDIR, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('\nSaved %d page records to additions_parsed.json' % len(records))
