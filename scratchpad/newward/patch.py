p = 'scratchpad/newward/phase1_sections.py'
s = open(p).read()
s = s.replace("        pix = p.get_pixmap(dpi=120)\n        img = f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}_full.png'",
              "        pix = p.get_pixmap(dpi=100, clip=pymupdf.Rect(r.x0, r.y0, r.x1, r.y0 + r.height*0.22))\n        img = f'scratchpad/newward/ocr_phase1/w{w}_p{pno+1}_top.png'")
open(p, 'w').write(s)
print('done')
"