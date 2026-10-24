# -*- coding: utf-8 -*-
"""Detect voter cells and crop their portraits from a scanned additions page.

The ward supplement PDFs are scans (no text layer). Each additions page lays
out a grid of voter cells; inside every cell the portrait sits to the right of
the serial/name text block. We render the page, find the cell grid from the
ruled table lines, then crop the right-hand portion of each cell as the photo.
"""
import os
import sys

import pymupdf
from PIL import Image

# Fraction of the cell width (from the right) that holds the portrait. The
# serial+name text occupies the left portion; the photo is a near-square block
# in the right portion, centred vertically with a small margin.
PHOTO_LEFT_FRACTION = 0.60
PHOTO_TOP_MARGIN = 0.10
PHOTO_BOTTOM_MARGIN = 0.10
PHOTO_RIGHT_MARGIN = 0.03


def page_to_image(page, dpi=300):
    pix = page.get_pixmap(dpi=dpi)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples), pix.width, pix.height


def crop_cell_portrait(cell_box, page_w, page_h):
    """Return the portrait sub-rectangle of one voter cell (in pixels)."""
    x0, y0, x1, y1 = cell_box
    cell_w = x1 - x0
    cell_h = y1 - y0
    photo_x0 = x0 + cell_w * PHOTO_LEFT_FRACTION
    photo_x1 = x1 - cell_w * PHOTO_RIGHT_MARGIN
    photo_y0 = y0 + cell_h * PHOTO_TOP_MARGIN
    photo_y1 = y1 - cell_h * PHOTO_BOTTOM_MARGIN
    return (int(photo_x0), int(photo_y0), int(photo_x1), int(photo_y1))


def crop_page(pdf_path, page_index, cell_boxes, out_dir, serials=None, dpi=300):
    """Crop each cell's portrait on one page; return list of saved file paths."""
    doc = pymupdf.open(pdf_path)
    page = doc[page_index]
    img, page_w, page_h = page_to_image(page, dpi=dpi)
    doc.close()

    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(pdf_path))[0].replace(" ", "_")
    saved = []
    for i, box in enumerate(cell_boxes):
        px0, py0, px1, py1 = crop_cell_portrait(box, page_w, page_h)
        crop = img.crop((px0, py0, px1, py1))
        serial = serials[i] if serials and i < len(serials) else f"cell{i}"
        name = f"{stem}_p{page_index + 1:02d}_{serial}.png"
        path = os.path.join(out_dir, name)
        crop.save(path)
        saved.append(path)
    return saved


if __name__ == "__main__":
    print("Import this module; see crop_wards.py for the driver.")
