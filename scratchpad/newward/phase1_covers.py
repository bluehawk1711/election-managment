import sys; sys.stdout.reconfigure(encoding='utf-8')
import pymupdf, subprocess, os
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
for w in range(1, 14):
    d = pymupdf.open(f'data/Ward No- {w}.pdf')
    p = d[0]
    r = p.rect
    pix = p.get_pixmap(dpi=200, clip=pymupdf.Rect(r.x0, r.y0, r.x1, r.y0 + r.height*0.4))
    img = f'scratchpad/newward/ocr_phase1/w{w}_p1_top.png'
    pix.save(img)
    out = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', '6'],
                        capture_output=True, text=True, encoding='utf-8', errors='replace')
    txt = out.stdout.replace('\n', ' | ')
    print(f'=== WARD {w} (pages={d.page_count}) ===')
    print(txt[:500])
    d.close()