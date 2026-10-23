"""OCR a single page in multiple horizontal bands for better accuracy."""
import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'

def ocr_page_bands(pdf, pno, dpi=500, bands=4):
    doc = pymupdf.open(pdf)
    page = doc[pno-1]
    r = page.rect
    h = r.height
    band_h = h / bands
    overlap = 30  # pt overlap between bands
    results = []
    for i in range(bands):
        y0 = max(0, i * band_h - overlap)
        y1 = min(h, (i+1) * band_h + overlap)
        clip = pymupdf.Rect(r.x0, y0, r.x1, y1)
        pix = page.get_pixmap(dpi=dpi, clip=clip)
        img = 'scratchpad/newward/band_w%d_p%d_b%d.png' % (int(pdf.split('No- ')[1].split('.')[0]), pno, i)
        pix.save(img)
        for psm in [6, 4]:
            out = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', str(psm)],
                                capture_output=True, text=True, encoding='utf-8', errors='replace')
            txt = out.stdout.strip()
            if txt:
                results.append((i, psm, txt))
    doc.close()
    return results

# Test on ward 1 page 29
w, pno = 1, 29
res = ocr_page_bands('data/Ward No- %d.pdf' % w, pno, dpi=500, bands=4)
for i, psm, txt in res:
    print('='*20, 'band', i, 'psm', psm, '='*20)
    print(txt[:2000])
    print()
