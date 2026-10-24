# -*- coding: utf-8 -*-
"""Crop every purak (additions) voter cell from the 13 ward PDFs.

The ward PDFs are scans (no text layer), so the only reliable way to get the
new voters' photos is to render each purak page and crop the photo box out of
each ruled cell. While cropping we also OCR the cell's serial box, name line,
relation line, house/age/gender and the locality heading above the row.

Output: one JSON object per cell appended to
    scratchpad/newward/purak_cells.jsonl
Photo crops saved to
    data/photos/purak/ward{w}-s{serial}.png

Resumable: pages already present in the JSONL are skipped.
"""
import sys, os, json, re, subprocess
sys.stdout.reconfigure(encoding='utf-8')

import numpy as np
import cv2
import pymupdf
from PIL import Image
import io

TESS = 'tesseract'
DPI = 300
OUT_JSONL = 'scratchpad/newward/purak_cells.jsonl'
CROP_DIR = os.path.join('data', 'photos', 'purak')

def render_gray(page):
    pix = page.get_pixmap(dpi=DPI)
    img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples).convert('L')
    return np.array(img)

def runs(mask, min_len):
    out = []
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return out
    splits = np.flatnonzero(np.diff(idx) > 1)
    starts = np.r_[idx[0], idx[splits + 1]]
    ends = np.r_[idx[splits], idx[-1]]
    for s, e in zip(starts, ends):
        if e - s + 1 >= min_len:
            out.append((int(s), int(e)))
    return out

def merge(lines, gap=6):
    if not lines:
        return []
    lines = sorted(lines)
    groups = []
    cur_f = [lines[0][0]]
    cur_iv = [(lines[0][1], lines[0][2])]
    for f, s, e in lines[1:]:
        if f - cur_f[-1] <= gap:
            cur_f.append(f)
            cur_iv.append((s, e))
        else:
            groups.append((int(np.mean(cur_f)), min(i[0] for i in cur_iv), max(i[1] for i in cur_iv)))
            cur_f = [f]; cur_iv = [(s, e)]
    groups.append((int(np.mean(cur_f)), min(i[0] for i in cur_iv), max(i[1] for i in cur_iv)))
    return groups

def detect_cells(gray):
    dark = gray < 160
    H, W = dark.shape
    hlines = []
    for y in range(H):
        for s, e in runs(dark[y], 200):
            hlines.append((y, s, e))
    vlines = []
    for x in range(W):
        for s, e in runs(dark[:, x], 150):
            vlines.append((x, s, e))
    hm = merge(hlines)
    vm = merge(vlines, gap=6)
    cells = []
    for i in range(len(hm) - 1):
        y0 = hm[i][0]; y1 = hm[i + 1][0]
        if y1 - y0 < 80:
            continue
        vs = [v for v in vm if v[1] <= y0 + 40 and v[2] >= y1 - 40]
        if len(vs) < 2:
            continue
        for j in range(len(vs) - 1):
            x0 = vs[j][0]; x1 = vs[j + 1][0]
            if x1 - x0 < 150:
                continue
            cells.append((x0, y0, x1, y1))
    return cells

def photo_blobs(gray):
    ink = (gray < 190).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))
    dil = cv2.dilate(ink, k, iterations=1)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(dil, 8)
    blobs = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (110 <= w <= 470 and 130 <= h <= 540):
            continue
        ar = w / h
        if not (0.5 <= ar <= 1.7):
            continue
        if area / (w * h) < 0.18:
            continue
        sub = ink[y:y + h, x:x + w]
        rowcov = sub.mean(axis=1)
        if (rowcov > 0.06).mean() < 0.55:
            continue
        blobs.append((int(x), int(y), int(w), int(h)))
    return blobs

def tess(img_arr, psm, lang='hin+eng', whitelist=None):
    im = Image.fromarray(img_arr)
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    tmp = 'scratchpad/newward/_t.png'
    with open(tmp, 'wb') as f:
        f.write(buf.getvalue())
    cmd = [TESS, tmp, 'stdout', '-l', lang, '--psm', str(psm)]
    if whitelist:
        cmd += ['-c', 'tessedit_char_whitelist=' + whitelist]
    r = subprocess.run(cmd, capture_output=True)
    return r.stdout.decode('utf-8', errors='replace')

def tess_tsv(img_arr, psm, lang='hin+eng'):
    im = Image.fromarray(img_arr)
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    tmp = 'scratchpad/newward/_t.png'
    with open(tmp, 'wb') as f:
        f.write(buf.getvalue())
    r = subprocess.run([TESS, tmp, 'stdout', '-l', lang, '--psm', str(psm), 'tsv'],
                       capture_output=True)
    text = r.stdout.decode('utf-8', errors='replace')
    lines = {}
    for ln in text.splitlines()[1:]:
        p = ln.split('\t')
        if len(p) < 12 or p[0] != '5' or not p[11].strip():
            continue
        try:
            conf = float(p[10])
        except ValueError:
            continue
        if conf < 20:
            continue
        key = (p[2], p[3], p[4])
        lines.setdefault(key, []).append((float(p[6]), p[11], conf))
    out = []
    for key in sorted(lines, key=lambda k: min(w[0] for w in lines[k])):
        ws = sorted(lines[key])
        out.append(' '.join(w[1] for w in ws))
    return out

def parse_cell_lines(text_lines):
    name = relation = rel_name = house = age = gender = ''
    for ln in text_lines:
        s = ln.strip()
        if not s:
            continue
        if re.match(r'^नाम', s) and not re.match(r'^(पिता|पति|माता)', s):
            m = re.match(r'^नाम\s*[:：।]?\s*(.+)$', s)
            if m and not name:
                name = m.group(1).strip(' :：।')
        m = re.search(r'(पिता|पति|माता)\s*(?:का\s*नाम)?\s*[:：।]?\s*(.*)$', s)
        if m and not rel_name:
            rel = m.group(1)
            val = m.group(2).strip(' :：।')
            if val and not re.search(r'[:：]', s.split(rel)[0]):
                relation, rel_name = rel, val
        m = re.search(r'मकान\s*(?:संख्या)?\s*[:：।]?\s*([^\s:：]+)', s)
        if m and not house:
            v = m.group(1)
            if v not in ('संख्या:', '_'):
                house = v
        m = re.search(r'आयु\s*[:：।]?\s*(\d+)', s)
        if m and not age:
            age = m.group(1)
        if 'लिंग' in s:
            if 'तृतीय' in s:
                gender = 'तृतीयलिंग'
            elif re.search(r'पुरु?ष', s):
                gender = 'पुरूष'
            elif 'स्त्री' in s:
                gender = 'स्त्री'
    return dict(name=name, relation=relation or (rel_name and 'पिता'), rel_name=rel_name,
                house=house, age=age, gender=gender)

def trim_ink(gray_sub, thresh=200):
    ink = gray_sub < thresh
    rows = np.where(ink.any(axis=1))[0]
    cols = np.where(ink.any(axis=0))[0]
    if rows.size == 0 or cols.size == 0:
        return None
    return int(rows[0]), int(rows[-1]), int(cols[0]), int(cols[-1])

def load_done():
    done = set()
    if os.path.exists(OUT_JSONL):
        for line in open(OUT_JSONL, encoding='utf-8'):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
                done.add((o['ward'], o['page']))
            except Exception:
                pass
    return done

def main():
    os.makedirs(CROP_DIR, exist_ok=True)
    done = load_done()
    out = open(OUT_JSONL, 'a', encoding='utf-8')
    try:
        for w in range(1, 14):
            pdf = 'data/Ward No- %d.pdf' % w
            doc = pymupdf.open(pdf)
            npages = doc.page_count
            print('=== ward %d pages %d' % (w, npages), flush=True)
            for pno in range(npages):
                page_no = pno + 1
                if (w, page_no) in done:
                    continue
                gray = render_gray(doc[pno])
                cells = detect_cells(gray)
                if not cells:
                    continue
                blobs = photo_blobs(gray)
                if not blobs:
                    continue
                # keep only cells containing a photo blob
                kept = []
                for (x0, y0, x1, y1) in cells:
                    inside = [b for b in blobs
                              if x0 <= b[0] + b[2] / 2 <= x1 and y0 <= b[1] + b[3] / 2 <= y1]
                    if inside:
                        kept.append(((x0, y0, x1, y1), max(inside, key=lambda b: b[2] * b[3])))
                if not kept:
                    continue
                # page header check: purak pages have no EPIC column
                head = gray[0:640, :]
                htxt = tess(head, 6)
                if 'EPIC' in htxt.upper():
                    continue
                if not re.search(r'पु?रक|परिवर्धन|घटक', htxt):
                    continue
                print('ward %d page %d: purak, %d cells' % (w, page_no, len(kept)), flush=True)
                # reading order
                kept.sort(key=lambda c: (c[0][1], c[0][0]))
                rows = []
                cur = []
                row_y = None
                for c in kept:
                    if cur and c[0][1] - row_y > 60:
                        rows.append(cur); cur = []
                    if not cur:
                        row_y = c[0][1]
                    cur.append(c)
                if cur:
                    rows.append(cur)
                ordered = []
                for row in rows:
                    ordered.extend(sorted(row, key=lambda c: c[0][0]))
                # serial: OCR each serial box then calibrate by median offset
                reads = []
                for (cell, blob) in ordered:
                    x0, y0, x1, y1 = cell
                    crop = gray[max(0, y0 + 2):y0 + 80, x0 + 6:min(x1, x0 + 400)]
                    txt = tess(crop, 7, lang='eng', whitelist='0123456789')
                    m = re.search(r'\d+', txt)
                    reads.append(int(m.group()) if m else None)
                valid = [(r - i) for i, r in enumerate(reads) if r is not None]
                s0 = int(round(np.median(valid))) if valid else None
                for idx, ((cell, blob), read) in enumerate(zip(ordered, reads)):
                    x0, y0, x1, y1 = cell
                    bx, by, bw, bh = blob
                    serial = (s0 + idx) if s0 is not None else None
                    serial_src = 'seq' if s0 is not None else 'none'
                    if read is not None and serial is not None and abs(read - serial) <= 2:
                        serial = read
                        serial_src = 'ocr'
                    # text block: left of photo
                    tx1 = max(x0 + 200, min(bx - 6, x1 - 4))
                    block = gray[y0 + 6:y1 - 4, x0 + 8:tx1]
                    tlines = tess_tsv(block, 6) if block.size else []
                    fields = parse_cell_lines(tlines)
                    # locality heading above cell
                    head2 = gray[max(0, y0 - 84):max(1, y0 - 4), x0:min(x1, x0 + 1500)]
                    locality = ''
                    if head2.size:
                        h2 = tess(head2, 6).strip().replace('\n', ' ')
                        h2 = re.sub(r'\s+', ' ', h2)
                        if h2 and not re.match(r'^[\d\s:।]+$', h2):
                            locality = h2
                    # photo crop
                    cx0 = max(0, bx + 8); cy0 = max(0, by + 8)
                    cx1 = min(gray.shape[1], bx + bw - 8); cy1 = min(gray.shape[0], by + bh - 8)
                    sub = gray[cy0:cy1, cx0:cx1]
                    t = trim_ink(sub)
                    if t is not None:
                        r0, r1, c0, c1 = t
                        sub = sub[r0:r1 + 1, c0:c1 + 1]
                    # upscale small crops so exports are ~146x182 like the rest
                    ph, pw = sub.shape
                    if ph < 182 or pw < 146:
                        scale = max(182 / ph, 146 / pw)
                        sub = cv2.resize(sub, (int(pw * scale), int(ph * scale)),
                                         interpolation=cv2.INTER_CUBIC)
                    crop_path = None
                    if serial is not None:
                        crop_path = os.path.join(CROP_DIR, 'ward%d-s%d.png' % (w, serial))
                        Image.fromarray(sub).save(crop_path)
                    rec = dict(ward=w, page=page_no, serial=serial, serial_src=serial_src,
                               ocr_serial=read, photo=crop_path,
                               box=[x0, y0, x1, y1], photo_box=[bx, by, bw, bh],
                               locality=locality, **fields)
                    out.write(json.dumps(rec, ensure_ascii=False) + '\n')
                    out.flush()
                    print('  s%s %s %s/%s h=%s a=%s g=%s loc=%s' %
                          (serial, fields['name'], fields['relation'], fields['rel_name'],
                           fields['house'], fields['age'], fields['gender'],
                           locality[:24]), flush=True)
            doc.close()
    finally:
        out.close()
    print('DONE')

if __name__ == '__main__':
    main()
