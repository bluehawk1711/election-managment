import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
w = int(sys.argv[1])
start = int(sys.argv[2]) if len(sys.argv) > 2 else 1
end = int(sys.argv[3]) if len(sys.argv) > 3 else None
d = pymupdf.open(f'data/Ward No- {w}.pdf')
if end is None:
    end = d.page_count
for pno in range(start-1, end):
    p = d[pno]
    pix = p.get_pixmap(dpi=80)
    img = f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}_80.png'
    pix.save(img)
    o = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', '6'],
                      capture_output=True, text=True, encoding='utf-8', errors='replace')
    txt = o.stdout
    hits = [kw for kw in ['पूरक', 'परिवर्धन', 'विलोपन', 'संशोधन'] if kw in txt]
    tag = ','.join(hits) if hits else '-'
    print(f'  p{pno+1:2}: {tag}')
    if hits:
        with open(f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}.txt', 'w', encoding='utf-8') as f:
            f.write(txt)
d.close()
