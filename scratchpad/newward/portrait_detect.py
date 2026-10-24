# -*- coding: utf-8 -*-
"""Detect portrait photo boxes directly on a scanned additions page.

Ruled-line detection on these scans is unreliable (text strokes fragment the
runs), so instead we find the portraits themselves: a passport photo is a
solid, mid-tone, roughly square block, whereas text is thin dark strokes on
white. We threshold at a high brightness to catch the photo's grey fill,
then keep connected blobs whose size and ink density match a photo.
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


def _components(mask):
    """4-connected component labelling via iterative flood fill.

    Returns a list of (ys, xs) index arrays, one per blob.
    """
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y in range(h):
        row = mask[y]
        for x in np.flatnonzero(row):
            if seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            pix = []
            while stack:
                cy, cx = stack.pop()
                pix.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            ys = np.array([p[0] for p in pix])
            xs = np.array([p[1] for p in pix])
            out.append((ys, xs))
    return out


def detect_portraits(arr, dpi=300, min_frac=0.02, max_frac=0.30):
    """Find portrait boxes. min/max_frac are fractions of page width/height.

    The density floor is deliberately low (0.35 was too strict): several
    portraits on these scans are lightly photocopied, so their fill reads as
    a sparse speckle rather than a solid block. Size + aspect + density
    together still separate a passport photo from a table cell or a block of
    text.
    """
    h, w = arr.shape
    # A photo's fill is mid-grey; text is near-black strokes on near-white.
    # Binarise on "not white" to capture the photo block as one solid blob.
    mask = arr < 235
    # Close small gaps so a dithered face reads as one blob.
    mask = _dilate(mask, 3)
    blobs = _components(mask)

    boxes = []
    for ys, xs in blobs:
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        bw, bh = x1 - x0, y1 - y0
        if bw <= 0 or bh <= 0:
            continue
        if not (min_frac * w <= bw <= max_frac * w):
            continue
        if not (min_frac * h <= bh <= max_frac * h):
            continue
        aspect = bw / bh
        if not (0.5 <= aspect <= 1.6):
            continue
        # Calibrated on ward 3 p34: a scanned passport photo has an ink
        # fraction (pixels < 235) of 0.34-0.49 from its mid-grey fill, while a
        # block of roll text measures ~0.13. The band below keeps the faintest
        # photo (0.34) and drops text well clear of it.
        sub = arr[y0:y1 + 1, x0:x1 + 1]
        ink = float((sub < 235).mean())
        if not (0.25 <= ink <= 0.98):
            continue
        boxes.append((x0, y0, x1, y1))
    # reading order
    boxes.sort(key=lambda b: (b[1], b[0]))
    return boxes


def _dilate(mask, r):
    """Binary dilation by a (2r+1) square, via cumulative shifts."""
    out = mask.copy()
    h, w = mask.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            ys0, ys1 = max(0, dy), min(h, h + dy)
            xs0, xs1 = max(0, dx), min(w, w + dx)
            out[ys0:ys1, xs0:xs1] |= mask[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


if __name__ == "__main__":
    import sys
    pdf, pno = sys.argv[1], int(sys.argv[2]) - 1
    arr = render_gray(pdf, pno)
    boxes = detect_portraits(arr)
    print(f"{pdf} p{pno + 1}: {arr.shape[1]}x{arr.shape[0]} -> {len(boxes)} portraits")
    for b in boxes:
        print("  ", b, f"w={b[2]-b[0]} h={b[3]-b[1]}")
