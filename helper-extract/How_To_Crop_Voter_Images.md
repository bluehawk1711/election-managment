# Ward No-1 Voter Records — Cropping Guide

This document explains how to crop the image of any specific voter from `Ward No- 1.pdf`.

---

## 1. File Layout Overview

The PDF has **34 pages**:

| Pages | Content |
|-------|---------|
| 1     | Cover page with ward summary (district, panchayat, polling station, voter counts) |
| 2     | Ward map (hand-drawn boundary map, no voter records) |
| 3 – 27 | **Main voter records list** (~27 records per page, 3-column × 9-row grid) |
| 28    | Last 2 main-list records |
| 29 – 30 | **Section 1 — List of Changes** (additions / new voters) |
| 31    | Statistical summary (polling-station level voter counts) |
| 32 – 33 | **Section 3 — Amendment List** (corrections / deletions) |
| 34    | Blank back cover |

Total voters extracted: **see "Voter Records" sheet of `Ward_No_1_Voter_Records.xlsx`**.

---

## 2. Voter Record Table Layout (pages 3 onward)

Each voter-records page is a **3-column × 9-row grid**, so **~27 records per page**.

```
+--------------+--------------+--------------+
|   Column 1   |   Column 2   |   Column 3   |
|  x ≈ 100–470 |  x ≈ 470–810 |  x ≈ 810–1150|
+--------------+--------------+--------------+
|  Sl 1 (top)  |  Sl 2        |  Sl 3        |  ← y ≈ 215 (norm)
+--------------+--------------+--------------+
|  Sl 4        |  Sl 5        |  Sl 6        |  ← y ≈ 290
+--------------+--------------+--------------+
|  Sl 7        |  Sl 8        |  Sl 9        |  ← y ≈ 373
... 9 rows total
+--------------+--------------+--------------+
```

Each record cell contains:
- **Photo** — right side of the cell (~65×70 px in 200-DPI image)
- **Text fields** — left side of the cell, stacked vertically:
  1. Sl No (serial number)
  2. EPIC No (Voter ID, 10-char alphanumeric)
  3. नाम (Voter Name)
  4. पिता / पति का नाम (Father's / Husband's Name)
  5. मकान संख्या (House No)
  6. आयु (Age)
  7. लिंग (Gender)

Records are numbered **left-to-right, top-to-bottom**: row 1 = Sl 1, 2, 3; row 2 = Sl 4, 5, 6; etc.

---

## 3. Source Files (where things live)

| File | Path | Description |
|------|------|-------------|
| Original PDF | `/home/z/my-project/upload/Ward No- 1.pdf` | Source — 34 pages, A4 (595×842 pt) |
| Page renders (200 DPI) | `/home/z/my-project/scripts/page_hi_01.png` … `page_hi_34.png` | 1653×2338 px each, used for cropping |
| Aggregated records | `/home/z/my-project/download/all_voter_records.json` | All voter records with bbox coords |
| Excel workbook | `/home/z/my-project/download/Ward_No_1_Voter_Records.xlsx` | 4 sheets: records, page summary, crop instructions, raw OCR |
| Cropping script | `/home/z/my-project/download/crop_voter.py` | Reusable Python script |
| Sample crops | `/home/z/my-project/download/sample_voter_crops/` | 5 sample voter images (first, 25%, 50%, 75%, last) |

---

## 4. How to Crop a Specific Voter

### Method A — Use the provided Python script (recommended)

```bash
# Crop a specific voter by PDF page + Sl No
python3 /home/z/my-project/download/crop_voter.py 3 1 my_voter.png

# Crop ALL voters into a folder
python3 /home/z/my-project/download/crop_voter.py --all-records /home/z/my-project/download/voter_crops/
```

The script reads `all_voter_records.json`, finds the entry matching the page + Sl No, and crops the corresponding region from `page_hi_NN.png`.

### Method B — Manual Python one-liner (Pillow)

```python
from PIL import Image

page = 3   # PDF page number
img = Image.open(f'/home/z/my-project/scripts/page_hi_{page:02d}.png')  # 1653x2338
# Bounding box from all_voter_records.json (example: Sl No 1 on page 3)
bbox = (170, 502, 624, 678)   # x1, y1, x2, y2 in pixels
img.crop(bbox).save('my_voter.png')
```

### Method C — ImageMagick

```bash
# After looking up bbox (x1=170, y1=502, x2=624, y2=678) from the Excel sheet:
# width = 624-170 = 454, height = 678-502 = 176, top-left = +170+502
convert /home/z/my-project/scripts/page_hi_03.png -crop 454x176+170+502 my_voter.png
```

### Method D — Direct from the PDF (PyMuPDF, no pre-render needed)

```python
import fitz

doc = fitz.open('/home/z/my-project/upload/Ward No- 1.pdf')
page = doc[2]  # 0-indexed; PDF page 3 → index 2

# PDF page is 595.08 × 841.68 points.
# Pixel-to-PDF-point conversion: divide by (200 DPI / 72) = 2.778
# E.g. pixel (170, 502, 624, 678) → PDF point (61.2, 180.7, 224.6, 244.1)

# IMPORTANT: use a non-destructive clip via get_pixmap(clip=...)
clip_rect = fitz.Rect(61.2, 180.7, 224.6, 244.1)
pix = page.get_pixmap(dpi=200, clip=clip_rect)
pix.save('my_voter.png')
```

### Method E — Crop just the voter's photo

```bash
# The 'Photo BBox' column in the Excel sheet gives the photo-only bounding box.
python3 -c "
from PIL import Image
img = Image.open('/home/z/my-project/scripts/page_hi_03.png')
img.crop((857, 503, 1024, 668)).save('voter_photo.png')
"
```

---

## 5. Finding a Voter's Coordinates

Open `Ward_No_1_Voter_Records.xlsx` → **Voter Records** sheet:

| Column | What it contains |
|--------|------------------|
| **Sl No** | Serial number as printed on the page |
| **EPIC No** | The voter's 10-character Voter ID (e.g., `CTK4949558`) |
| **Voter Name (Hindi / English)** | Use Ctrl+F to search |
| **PDF Page** | Which PDF page (1–34) the record is on |
| **Row on Page** | Which row (1–9) within the page grid |
| **Column on Page** | Which column (1, 2, or 3) within the page grid |
| **Crop BBox (px)** | `x1,y1,x2,y2` — pixel coordinates in `page_hi_NN.png` for the full record cell |
| **Photo BBox (px)** | `x1,y1,x2,y2` — pixel coordinates of just the voter's photo |
| **Page Image File** | The exact PNG filename to open |
| **Page Image Size** | Image dimensions (1653×2338) |
| **Confidence Flag** | `ok` = high-confidence OCR; `review` = uncertain (verify manually) |

**Quick recipe to crop voter with EPIC `CTK4949558`:**
1. Open the Excel sheet, Ctrl+F → search `CTK4949558`
2. Read the row: PDF Page = 3, Sl No = 1, Crop BBox = `170,502,624,678`
3. Run: `python3 /home/z/my-project/download/crop_voter.py 3 1 my_voter.png`

---

## 6. OCR Accuracy Note

The PDF was OCR'd using a vision model on Hindi (Devanagari) text. Most fields are accurate, but expect some spelling variants in names. Always cross-reference:
- The cropped image (Method A–E above)
- The original page render in `/home/z/my-project/scripts/page_hi_NN.png`

For uncertain cells, the **Confidence Flag** column is set to `review`. The **OCR Raw Text** sheet preserves the full per-page VLM output for traceability.

---

## 7. Reproducing the Extraction

If you need to re-run the entire pipeline:

```bash
# 1. Render all 34 pages at 200 DPI
python3 -c "
import fitz
doc = fitz.open('/home/z/my-project/upload/Ward No- 1.pdf')
for i in range(len(doc)):
    doc[i].get_pixmap(dpi=200).save(f'/home/z/my-project/scripts/page_hi_{i+1:02d}.png')
"

# 2. Run VLM extraction on each page (one-at-a-time, ~80s each)
bash /home/z/my-project/scripts/batch_extract.sh

# 3. Parse and aggregate
python3 /home/z/my-project/scripts/parse_and_aggregate.py

# 4. Generate the Excel workbook
python3 /home/z/my-project/scripts/generate_xlsx.py
```
