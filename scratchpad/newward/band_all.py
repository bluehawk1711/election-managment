"""OCR all supplement pages in 4 bands at 500 dpi, save text per page."""
import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
SUPP = {1:[29],2:[34],3:[31,34],4:[35,36],5:[33,36],6:[19],7:[16,19],8:[15,18],9:[12,16],10:[12,15],11:[27,28,31],12:[29,32],13:[24,25,28]}

wards = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else list(SUPP)
for w in wards:
    for pno in SUPP[w]:
        doc = pymupdf.open('data/Ward No- %d.pdf' % w)
        page = doc[pno-1]
        r = page.rect
        h = r.height
        bands = 4
        band_h = h / bands
        overlap = 40
        out_lines = []
        for i in range(bands):
            y0 = max(0, i * band_h - overlap)
            y1 = min(h, (i+1) * band_h + overlap)
            clip = pymupdf.Rect(r.x0, y0, r.x1, y1)
            pix = page.get_pixmap(dpi=500, clip=clip)
            img = 'scratchpad/newward/band_w%d_p%d_b%d.png' % (w, pno, i)
            pix.save(img)
            out = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', '6'],
                                capture_output=True, text=True, encoding='utf-8', errors='replace')
            out_lines.append('===== BAND %d =====' % i)
            out_lines.append(out.stdout.strip())
        doc.close()
        txtfile = 'scratchpad/newward/band500_w%d_p%d.txt' % (w, pno)
        open(txtfile, 'w', encoding='utf-8').write('\n'.join(out_lines))
        print('ward %d p%d: done' % (w, pno))
