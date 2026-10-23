import pymupdf, subprocess, os, sys
sys.stdout.reconfigure(encoding='utf-8')
TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
os.environ['PYTHONIOENCODING'] = 'utf-8'
supp = {
 1:[29], 2:[34], 3:[31,34], 4:[35,36], 5:[33,36],
 6:[19], 7:[16,19], 8:[15,18], 9:[12,16], 10:[12,15],
 11:[27,28,31], 12:[29,32], 13:[24,25,28],
}
wards = [int(x) for x in sys.argv[1:]] if len(sys.argv)>1 else list(supp)
for w in wards:
    d = pymupdf.open(f'data/Ward No- {w}.pdf')
    for pno in supp[w]:
        pix = d[pno-1].get_pixmap(dpi=400)
        img = f'scratchpad/newward/full400_w{w}_p{pno}.png'
        pix.save(img)
        out = subprocess.run([TESS, img, 'stdout', '-l', 'hin+eng', '--psm', '6'],
                            capture_output=True, text=True, encoding='utf-8', errors='replace')
        txtfile = f'scratchpad/newward/full400_w{w}_p{pno}.txt'
        open(txtfile, 'w', encoding='utf-8').write(out.stdout)
        print(f'  w{w} p{pno}: {len(out.stdout)} chars')
    d.close()
print('done')
