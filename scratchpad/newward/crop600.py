"""Detailed OCR of each cell at 600 dpi with multiple PSM, keep best."""
import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
SUPP = {1:[29],2:[34],3:[31,34],4:[35,36],5:[33,36],6:[19],7:[16,19],8:[15,18],9:[12,16],10:[12,15],11:[27,28,31],12:[29,32],13:[24,25,28]}
COL_EDGES = [0.0, 203.5, 375.5, 600.0]
PHOTO_CLIP = [145.0, 318.0, 492.0]
ROW_TOP = 275.0
ROW_PITCH = 72.0
NROWS = 8
OUTDIR = 'scratchpad/newward/cells600'
os.makedirs(OUTDIR, exist_ok=True)

def dev_count(s):
    return sum(1 for c in s if '\u0900' <= c <= '\u097F')

wards = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else [1]
for w in wards:
    for pno in SUPP[w]:
        doc = pymupdf.open('data/Ward No- %d.pdf' % w)
        page = doc[pno-1]
        for row in range(NROWS):
            for col in range(3):
                x0 = COL_EDGES[col]
                photo_clip = PHOTO_CLIP[col]
                y0 = ROW_TOP + row * ROW_PITCH
                y1 = y0 + ROW_PITCH
                cell_rect = pymupdf.Rect(x0 + 2, y0 + 2, photo_clip - 2, y1 - 2)
                pix = page.get_pixmap(dpi=600, clip=cell_rect)
                img = '%s/w%d_p%d_r%d_c%d.png' % (OUTDIR, w, pno, row, col)
                pix.save(img)
                best = ''
                best_score = -1
                for psm in [6, 7, 11]:
                    out = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', str(psm)],
                                        capture_output=True, text=True, encoding='utf-8', errors='replace')
                    txt = out.stdout.strip()
                    score = dev_count(txt) + len(txt) // 10
                    if score > best_score:
                        best_score = score
                        best = txt
                if best and len(best) > 8:
                    txtfile = '%s/w%d_p%d_r%d_c%d.txt' % (OUTDIR, w, pno, row, col)
                    open(txtfile, 'w', encoding='utf-8').write(best)
        doc.close()
        print('ward %d p%d done' % (w, pno))
