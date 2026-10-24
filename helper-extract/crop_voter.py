#!/usr/bin/env python3
"""
crop_voter.py — Crop a specific voter's record image from the PDF page images.

Usage:
  python3 crop_voter.py <page> <sl_no> [output.png]
  python3 crop_voter.py --all-records [output_dir]    # crop every voter (use ALL_RECORDS_JSON env var or default path)

Examples:
  python3 crop_voter.py 3 1            # Crop voter with Sl No 1 from page 3
  python3 crop_voter.py 5 42 my_voter.png
  python3 crop_voter.py --all-records ./voter_crops

Requirements:
  - Pillow (PIL): pip install Pillow
  - The page render PNGs at /home/z/my-project/scripts/page_hi_NN.png (200 DPI)
  - The aggregated records JSON at /home/z/my-project/download/all_voter_records.json
"""

import sys
import json
import os
from pathlib import Path
from PIL import Image

# ===== Configuration =====
SCRIPTS_DIR   = Path("/home/z/my-project/scripts")
DOWNLOAD_DIR   = Path("/home/z/my-project/download")
RECORDS_JSON   = DOWNLOAD_DIR / "all_voter_records.json"
DEFAULT_PAD    = 5  # padding around the bbox (pixels)

def page_image_path(page, hi_res=True):
    """Return the path to the rendered page image."""
    name = f"page_hi_{page:02d}.png" if hi_res else f"page_{page:02d}.png"
    return SCRIPTS_DIR / name

def load_records():
    if not RECORDS_JSON.exists():
        sys.exit(f"ERROR: records file not found at {RECORDS_JSON}")
    return json.loads(RECORDS_JSON.read_text())

def find_record(records, page, sl_no):
    """Find a record by PDF page number and serial number (Sl No)."""
    for r in records["records"]:
        if r.get("pdf_page") == page and str(r.get("sl_no")) == str(sl_no):
            return r
    return None

def crop_one(record, output_path, pad=DEFAULT_PAD):
    """Crop one record's bbox from its source page image and save."""
    page = record["pdf_page"]
    page_img_path = page_image_path(page, hi_res=True)
    if not page_img_path.exists():
        page_img_path = page_image_path(page, hi_res=False)
        if not page_img_path.exists():
            raise FileNotFoundError(f"Source page image not found for page {page}")
        scale = 1240.0 / 1653  # 150/200 ratio
    else:
        scale = 1.0
    img = Image.open(page_img_path)
    x1 = max(0, int((record["col_x_left"]   or 0) * scale) - pad)
    y1 = max(0, int((record["row_y_top"]    or 0) * scale) - pad)
    x2 = min(img.width,  int((record["col_x_right"]  or 0) * scale) + pad)
    y2 = min(img.height, int((record["row_y_bottom"] or 0) * scale) + pad)
    crop = img.crop((x1, y1, x2, y2))
    crop.save(output_path)
    print(f"Saved {output_path} ({crop.width}x{crop.height}) from page {page}")
    return crop

def crop_photo(record, output_path, pad=DEFAULT_PAD):
    """Crop just the voter's photo from the record."""
    page = record["pdf_page"]
    page_img_path = page_image_path(page, hi_res=True)
    if not page_img_path.exists():
        page_img_path = page_image_path(page, hi_res=False)
    img = Image.open(page_img_path)
    x1 = max(0, (record.get("photo_x_left")  or 0) - pad)
    y1 = max(0, (record.get("photo_y_top")    or 0) - pad)
    x2 = min(img.width,  (record.get("photo_x_right")  or 0) + pad)
    y2 = min(img.height, (record.get("photo_y_bottom") or 0) + pad)
    crop = img.crop((x1, y1, x2, y2))
    crop.save(output_path)
    print(f"Saved photo {output_path} ({crop.width}x{crop.height})")

def crop_all_records(output_dir):
    """Crop every voter record and save to output_dir."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    records = load_records()
    n = len(records["records"])
    print(f"Cropping {n} records to {output_dir} ...")
    for i, rec in enumerate(records["records"], 1):
        sl = rec.get("sl_no", "?")
        page = rec.get("pdf_page", 0)
        out = output_dir / f"voter_p{page:02d}_sl{sl}.png"
        try:
            crop_one(rec, out)
        except Exception as e:
            print(f"  ! record {i} (page {page}, sl {sl}) failed: {e}")
        if i % 50 == 0:
            print(f"  ... {i}/{n} done")
    print(f"Done. Cropped {n} records.")

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    if args[0] == "--all-records":
        out_dir = args[1] if len(args) > 1 else str(DOWNLOAD_DIR / "voter_crops")
        crop_all_records(out_dir)
        return

    if len(args) < 2:
        print("Usage: python3 crop_voter.py <page> <sl_no> [output.png]")
        print("       python3 crop_voter.py --all-records [output_dir]")
        return

    page = int(args[0])
    sl_no = args[1]
    out_path = args[2] if len(args) > 2 else f"voter_p{page:02d}_sl{sl_no}.png"

    records = load_records()
    rec = find_record(records, page, sl_no)
    if not rec:
        sys.exit(f"Voter record not found: page={page}, sl_no={sl_no}")
    crop_one(rec, out_path)
    print(f"  Name: {rec.get('voter_name_en')} / {rec.get('voter_name_hindi')}")
    print(f"  Father/Husband: {rec.get('relation_name_en')} ({rec.get('relation_type')})")
    print(f"  House No: {rec.get('house_no')}, Age: {rec.get('age')}, Gender: {rec.get('gender')}")
    print(f"  EPIC: {rec.get('epic_no')}")
    print(f"  Location: page {rec.get('pdf_page')}, row {rec.get('row_on_page')}, col {rec.get('col_on_page')}")

if __name__ == "__main__":
    main()
