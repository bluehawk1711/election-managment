import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
w = int(sys.argv[1])
d = pymupdf.open(f'data/Ward No- {w}.pdf')
out_lines = []
for pno in range(d.page_count):
    p = d[pno]
    pix = p.get_pixmap(dpi=80)
    img = f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}_80.png'
    pix.save(img)
    o = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', '6'],
                      capture_output=True, text=True, encoding='utf-8', errors='replace')
    txt = o.stdout
    hits = []
    for kw in ['पूरक', 'परिवर्धन', 'विलोपन', 'संशोधन']:
        if kw in txt:
            hits.append(kw)
    if hits:
        out_lines.append(f'p{pno+1}: {",".join(hits)}')
        # save full text
        with open(f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}.txt', 'w', encoding='utf-8') as f:
            f.write(txt)
print(f'WARD {w}: {len(out_lines)} special pages')
for l in out_lines:
    print('  ' + l)
d.close()
