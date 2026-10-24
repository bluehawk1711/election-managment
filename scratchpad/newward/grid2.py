# -*- coding: utf-8 -*-
"""Robust cell-grid detector for scanned additions pages.

The additions tables draw a border around each row of voter cells. Text
strokes fragment naive line detection, so we build the "ink" mask only from
pixels that sit inside a long run (the ruled lines), then project to find row
and column boundaries.
"""
import numpy as np
from PIL import Image
import pymupdf


def render_gray(pdf_path, page_index, dpi=300):
    doc = pymupdf.open(pdf_path)
    page = doc[page_index]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L")
    doc.close()
    return np.array(img)


def _long_runs_minmax(mask, min_len):
    """For each row, the (min,max) extent of runs >= min_len; else None."""
    h, w = mask.shape
    out = np.full(h, -1, dtype=int)
    lo = np.full(h, -1, dtype=int)
    hi = np.full(h, -1, dtype=int)
    for y in range(h):
        row = mask[y]
        idx = np.flatnonzero(row)
        if idx.size == 0:
            continue
        # split into runs
        splits = np.flatnonzero(np.diff(idx) > 1)
        starts = np.r_[idx[0], idx[splits + 1]]
        ends = np.r_[idx[splits], idx[-1]]
        lens = ends - starts + 1
        keep = lens >= min_len
        if keep.any():
            lo[y] = starts[keep].min()
            hi[y] = ends[keep].max()
            out[y] = lens[keep].max()
    return out, lo, hi


def find_row_bands(arr, dark_thr=200, min_frac=0.06):
    """Row bands of the tables: contiguous rows holding a long horizontal line."""
    h, w = arr.shape
    mask = arr < dark_thr
    longest, lo, hi = _long_runs_minmax(mask, int(w * min_frac))
    inline = longest >= 0
    bands = []
    start = None
    for y in range(h):
        if inline[y] and start is None:
            start = y
        elif not inline[y] and start is not None:
            if y - start > 4:
                bands.append((start, y))
            start = None
    if start is not None:
        bands.append((start, h))
    return bands, lo, hi


def detect_cells(arr, dark_thr=200):
    """Return list of (x0, y0, x1, y1) voter-cell boxes in reading order."""
    h, w = arr.shape
    bands, lo, hi = find_row_bands(arr, dark_thr=dark_thr)
    cells = []
    for (ys, ye) in bands:
        # horizontal line pixels spanning this band -> column boundaries
        seg = (arr[ys:ye + 1] < dark_thr)
        colcount = seg.sum(axis=0)
        thresh = max(3, (ye - ys) // 3)
        cols = np.flatnonzero(colcount >= thresh)
        if cols.size < 2:
            continue
        # group into columns
        groups = _group(cols, gap=max(6, w // 200))
        if len(groups) < 2:
            continue
        # cells are the spans between consecutive column groups, if the band
        # is tall enough to be a data row (not a heading)
        if ye - ys < h * 0.04:
            continue
        for i in range(len(groups) - 1):
            x0 = groups[i][-1]
            x1 = groups[i + 1][0]
            if x1 - x0 < w * 0.12:
                continue
            cells.append((int(x0), int(ys), int(x1), int(ye)))
    cells.sort(key=lambda b: (b[1], b[0]))
    return cells


def _group(vals, gap=6):
    groups = []
    for v in vals:
        if groups and v - groups[-1][-1] <= gap:
            groups[-1].append(v)
        else:
            groups.append([int(v)])
    return groups


if __name__ == "__main__":
    import sys
    pdf, pno = sys.argv[1], int(sys.argv[2]) - 1
    arr = render_gray(pdf, pno)
    cells = detect_cells(arr)
    print(f"{pdf} p{pno + 1}: {len(cells)} cells")
    for c in cells:
        print("  ", c, "w=%d h=%d" % (c[2] - c[0], c[3] - c[1]))
