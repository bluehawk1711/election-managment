# -*- coding: utf-8 -*-
"""Re-OCR problem pages in 4 horizontal bands (top->bottom) for better
accuracy, merging word boxes into ocr_tsv2/page-NNNN.tsv.

Bands overlap by OVERLAP px; words in the overlap margins are trimmed from
the band that would show them cut, keeping the copy rendered fully in the
neighbouring band. Duplicates are removed by (text, x, y) proximity.
"""
import json, os, subprocess, sys
from PIL import Image

TESS = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
WORK = os.path.dirname(os.path.abspath(__file__))
BANDS = 4
OVERLAP = 120
TRIM = 50


def tsv_words(img_path, yoff):
    out = subprocess.run([TESS, img_path, 'stdout', '-l', 'hin+eng',
                          '--psm', '6', 'tsv'],
                         capture_output=True)
    text = out.stdout.decode('utf-8', errors='replace')
    lines = text.splitlines()
    if not lines:
        return None, []
    hdr, rows = lines[0], []
    for ln in lines[1:]:
        p = ln.split('\t')
        if len(p) < 12 or p[0] != '5' or not p[11].strip():
            continue
        try:
            top = float(p[7]) + yoff
            h = float(p[9])
        except ValueError:
            continue
        p[7] = '%.1f' % top
        rows.append((p, top + h / 2))
    return hdr, rows


def main():
    probs = json.load(open(os.path.join(WORK, 'problems.json'), encoding='utf-8'))
    # only pages where the problem could be OCR-related (text fields)
    pages = sorted({p['page'] for p in probs['items']
                    if set(p['missing']) & {'name', 'father', 'house', 'gender'}})
    if not pages:
        print('no OCR-related problem pages')
        return
    os.makedirs('ocr_tsv2', exist_ok=True)
    tmp_dir = os.path.join(WORK, 'bands')
    os.makedirs(tmp_dir, exist_ok=True)

    for pno in pages:
        img = Image.open('ocr_pages/page-%04d.png' % pno)
        W, H = img.size
        step = H // BANDS
        all_rows, hdr = [], None
        for b in range(BANDS):
            top = max(0, b * step - OVERLAP)
            bot = min(H, (b + 1) * step + OVERLAP)
            band_path = os.path.join(tmp_dir, 'p%04d_b%d.png' % (pno, b))
            img.crop((0, top, W, bot)).save(band_path)
            h, rows = tsv_words(band_path, top)
            if h:
                hdr = h
            kept = []
            for p, ymid in rows:
                if b > 0 and ymid < top + TRIM:
                    continue          # cut fragment; full copy in previous band
                if b < BANDS - 1 and ymid > bot - TRIM:
                    continue          # cut fragment; full copy in next band
                kept.append(p)
            all_rows.extend(kept)
            os.remove(band_path)
        # dedup by (text, x/6, y/6)
        seen, ded = set(), []
        for p in all_rows:
            key = (p[11], round(float(p[6]) / 6), round(float(p[7]) / 6))
            if key in seen:
                continue
            seen.add(key)
            ded.append(p)
        outp = os.path.join('ocr_tsv2', 'page-%04d.tsv' % pno)
        with open(outp, 'w', encoding='utf-8') as f:
            f.write(hdr + '\n')
            for p in ded:
                f.write('\t'.join(p) + '\n')
        print('sliced page %d: %d words -> %s' % (pno, len(ded), outp))


if __name__ == '__main__':
    main()
