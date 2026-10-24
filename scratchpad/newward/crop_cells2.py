# -*- coding: utf-8 -*-
"""Per-cell portrait cropping for scanned additions pages.

Strategy: pair horizontal ruled lines into row bands, split each band into
cells by its vertical borders, then crop the right-hand portion of each cell
where the passport photo always sits. Because the crop is per-cell, faint
faces are never dropped by blob heuristics.
"""
import os
import sys

import numpy as np
from PIL import Image
import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def render_gray(pdf_path, page_index, dpi=300):
    doc = pymupdf.open(pdf_path)
    page = doc[page_index]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L")
    doc.close()
    return np.array(img)


def _hline_rows(arr, thr=210, min_frac=0.05):
    """y indices where a long horizontal dark run exists."""
    h, w = arr.shape
    mask = arr < thr
    min_len = int(w * min_frac)
    rows = []
    for y in range(h):
        idx = np.flatnonzero(mask[y])
        if idx.size == 0:
            continue
        splits = np.flatnonzero(np.diff(idx) > 2)
        starts = np.r_[idx[0], idx[splits + 1]]
        ends = np.r_[idx[splits], idx[-1]]
        if (ends - starts + 1).max() >= min_len:
            rows.append(y)
    return rows


def _group(vals, gap):
    groups = []
    for v in vals:
        if groups and v - groups[-1][-1] <= gap:
            groups[-1].append(int(v))
        else:
            groups.append([int(v)])
    return [int(np.mean(g)) for g in groups]


def row_bands(hlines, h, min_h=120):
    """Pair ruled lines into bands tall enough to be a data row."""
    ys = _group(hlines, gap=8)
    bands = []
    for i in range(len(ys) - 1):
        y0, y1 = ys[i], ys[i + 1]
        if y1 - y0 >= min_h:
            bands.append((y0, y1))
    return bands


def cells_in_band(arr, y0, y1, thr=210, col_frac=0.85, min_w=250):
    """Column borders inside a row band -> cell x-spans."""
    h, w = arr.shape
    seg = arr[y0:y1 + 1] < thr
    colcount = seg.sum(axis=0)
    need = max(3, int((y1 - y0) * col_frac))
    cols = np.flatnonzero(colcount >= need)
    if cols.size == 0:
        return []
    groups = _group(cols, gap=12)
    cells = []
    for i in range(len(groups) - 1):
        x0, x1 = groups[i], groups[i + 1]
        if x1 - x0 >= min_w:
            cells.append((x0, y0, x1, y1))
    return cells


def detect_cells(arr):
    h, w = arr.shape
    hlines = _hline_rows(arr)
    bands = row_bands(hlines, h)
    cells = []
    for (y0, y1) in bands:
        cells.extend(cells_in_band(arr, y0, y1))
    cells.sort(key=lambda b: (b[1], b[0]))
    return cells


def crop_photos(pdf_path, page_index, out_dir, dpi=300, save_sheet=False):
    """Crop the photo region of every cell on one page.

    The photo occupies the right 34% of each cell, vertically inset by 6%.
    Returns list of (cell, crop_array).
    """
    arr = render_gray(pdf_path, page_index, dpi=dpi)
    cells = detect_cells(arr)
    crops = []
    for (x0, y0, x1, y1) in cells:
        cw, ch = x1 - x0, y1 - y0
        px0 = x0 + int(cw * 0.66)
        px1 = x1 - int(cw * 0.02)
        py0 = y0 + int(ch * 0.06)
        py1 = y1 - int(ch * 0.06)
        crop = arr[py0:py1, px0:px1]
        crops.append(((x0, y0, x1, y1), crop))

    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(pdf_path))[0].replace(" ", "")
    saved = []
    for i, (cell, crop) in enumerate(crops):
        p = os.path.join(out_dir, f"{stem}_p{page_index + 1:02d}_c{i:02d}.png")
        Image.fromarray(crop).save(p)
        saved.append((cell, p))

    if save_sheet:
        sheet = Image.fromarray(arr).convert("RGB")
        from PIL import ImageDraw
        dr = ImageDraw.Draw(sheet)
        for (x0, y0, x1, y1) in cells:
            dr.rectangle((x0, y0, x1, y1), outline=(255, 0, 0), width=4)
            dr.rectangle((x0 + int((x1 - x0) * 0.66), y0 + int((y1 - y0) * 0.06),
                          x1 - int((x1 - x0) * 0.02), y1 - int((y1 - y0) * 0.06)),
                         outline=(0, 160, 255), width=4)
        sheet.thumbnail((1000, 1400))
        sp = os.path.join(out_dir, f"{stem}_p{page_index + 1:02d}_sheet.png")
        sheet.save(sp)
        saved.append((None, sp))
    return saved


if __name__ == "__main__":
    pdf = sys.argv[1]
    pno = int(sys.argv[2]) - 1
    out = sys.argv[3] if len(sys.argv) > 3 else "scratchpad/newward/cells_out"
    res = crop_photos(pdf, pno, out, save_sheet=True)
    print(f"{pdf} p{pno + 1}: {len(res)} outputs")
    for cell, p in res:
        print("  ", cell, p)
