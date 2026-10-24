# -*- coding: utf-8 -*-
"""Detect the voter-cell grid on a scanned additions page via ruled lines.

Each additions page draws the voter cells as a table of ruled boxes. The
portrait sits inside each box, so recovering the box grid is what lets the
cropper pull one face per voter instead of guessing pixel offsets.
"""
import numpy as np
from PIL import Image
import pymupdf


def render_gray(pdf_path, page_index, dpi=300):
    """Rasterise one PDF page to a grayscale array."""
    doc = pymupdf.open(pdf_path)
    page = doc[page_index]
    pix = page.get_pixmap(dpi=dpi)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L")
    doc.close()
    return np.array(img)


def _runs(mask, min_len):
    """Contiguous True runs of at least min_len, as (start, end) pairs."""
    out = []
    start = None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(mask) - start >= min_len:
        out.append((start, len(mask)))
    return out


def detect_grid(arr, dark_threshold=160, min_run_frac=0.10):
    """Find horizontal/vertical ruled lines and the cells they form.

    Returns (cells, hlines, vlines) where cells is a list of
    (x0, y0, x1, y1) pixel boxes in reading order.
    """
    h, w = arr.shape
    dark = arr < dark_threshold
    min_h_run = int(w * min_run_frac)
    min_v_run = int(h * min_run_frac)

    h_lines = []
    for y in range(h):
        for s, e in _runs(dark[y], min_h_run):
            h_lines.append((y, s, e))
    v_lines = []
    for x in range(w):
        for s, e in _runs(dark[:, x], min_v_run):
            v_lines.append((x, s, e))

    ys = sorted({y for y, _, _ in h_lines})
    xs = sorted({x for x, _, _ in v_lines})
    ys = _merge_close(ys, tol=6)
    xs = _merge_close(xs, tol=6)

    cells = []
    for i in range(len(ys) - 1):
        for j in range(len(xs) - 1):
            x0, x1 = xs[j], xs[j + 1]
            y0, y1 = ys[i], ys[i + 1]
            if x1 - x0 < w * 0.15 or y1 - y0 < h * 0.04:
                continue
            cells.append((x0, y0, x1, y1))
    cells.sort(key=lambda b: (b[1], b[0]))
    return cells, h_lines, v_lines


def _merge_close(vals, tol=6):
    """Collapse near-duplicate coordinates (thick/aliased ruled lines)."""
    out = []
    for v in vals:
        if out and v - out[-1] <= tol:
            continue
        out.append(v)
    return out


if __name__ == "__main__":
    import sys
    pdf, pno = sys.argv[1], int(sys.argv[2]) - 1
    arr = render_gray(pdf, pno)
    cells, _, _ = detect_grid(arr)
    print(f"{pdf} p{pno + 1}: {arr.shape[1]}x{arr.shape[0]} -> {len(cells)} cells")
    for c in cells:
        print("  ", c)
