import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
import sys
wards = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else list(range(1, 14))
for w in wards:
    d = pymupdf.open(f'data/Ward No- {w}.pdf')
    print(f'\n========== WARD {w} ({d.page_count} pages) ==========')
    for pno in range(d.page_count):
        p = d[pno]
        r = p.rect
        pix = p.get_pixmap(dpi=100, clip=pymupdf.Rect(r.x0, r.y0, r.x1, r.y0 + r.height*0.16))
        img = f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}_hdr.png'
        pix.save(img)
        out = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', '6'],
                            capture_output=True, text=True, encoding='utf-8', errors='replace')
        txt = out.stdout.replace('\n', ' ')
        # only print if a section keyword appears
        keys = ['भाग', 'परिवर्धन', 'विलोपन', 'संशोधन', 'नामावली', 'मतदाता सूची', 'कुल']
        if any(k in txt for k in keys):
            short = txt.strip()[:180]
            print(f'  p{pno+1:2}: {short}')
    d.close()