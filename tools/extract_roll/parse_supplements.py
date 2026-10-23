"""Parse supplement pages using 400 dpi full-page OCR text."""
import re, os, json, sys

SUPP = {
 1:[29], 2:[34], 3:[31,34], 4:[35,36], 5:[33,36],
 6:[19], 7:[16,19], 8:[15,18], 9:[12,16], 10:[12,15],
 11:[27,28,31], 12:[29,32], 13:[24,25,28],
}

def split_sections(text):
    add, dele, corr = [], [], []
    section = 'main'
    for line in text.splitlines():
        if 'परिवर्धन' in line:
            section = 'additions'; continue
        if 'विलोपन' in line:
            section = 'deletions'; continue
        if 'संशोधन' in line:
            section = 'corrections'; continue
        if section == 'additions':
            add.append(line)
        elif section == 'deletions':
            dele.append(line)
        elif section == 'corrections':
            corr.append(line)
    return '\n'.join(add), '\n'.join(dele), '\n'.join(corr)

def find_epics(text):
    out = []
    for m in re.finditer(r'[A-Z]{2,3}\d{7}', text):
        if m.group(0) not in out:
            out.append(m.group(0))
    for m in re.finditer(r'RJ/\d{2}/\d{3}/\d{6}', text):
        if m.group(0) not in out:
            out.append(m.group(0))
    return out

def find_serials(text):
    return re.findall(r'\[\s*(\d+)\s*\]', text)

def main():
    wards = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else list(SUPP)
    additions_out, deletions_out = [], []
    for w in wards:
        for pno in SUPP[w]:
            path = f'scratchpad/newward/full400_w{w}_p{pno}.txt'
            if not os.path.exists(path):
                print(f'missing {path}'); continue
            text = open(path, encoding='utf-8').read()
            add_text, del_text, corr_text = split_sections(text)
            add_epics = find_epics(add_text)
            del_epics = find_epics(del_text)
            serials = find_serials(add_text)
            additions_out.append({'ward': w, 'page': pno, 'addition_epics': add_epics,
                                 'addition_serials': serials})
            for e in del_epics:
                deletions_out.append({'ward': w, 'page': pno, 'epic': e})
            print(f'ward {w} p{pno}: add_epics={len(add_epics)} serials={len(serials)} del_epics={len(del_epics)}')
    outdir = 'data/rajasthan/jodhpur/jhanwar/veernagar'
    json.dump(additions_out, open(f'{outdir}/additions_2026_raw.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    json.dump(deletions_out, open(f'{outdir}/deletions_2026_raw.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f'\nTotal deletion EPICs: {len(deletions_out)} (unique {len(set(d["epic"] for d in deletions_out))})')

if __name__ == '__main__':
    main()
