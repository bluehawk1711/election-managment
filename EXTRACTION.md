# EXTRACTION.md — Hindi voter-roll PDF → per-ward CSVs

How `data/veernagar-1.pdf` (मतदाता सूची, 306 pages, 13 wards, 6855 voters) was converted
into one CSV per ward. Written so the same pipeline can be reused on another
part-1 / part-2 roll PDF.

**Outputs**

| File | Contents |
|---|---|
| `data/rajasthan/jodhpur/jhanwar/veernagar/ward-01.csv` … `ward-13.csv` | one row per voter (6855 total), UTF-8 **with BOM** so Excel renders Devanagari |
| `data/rajasthan/jodhpur/jhanwar/veernagar/wards-summary.csv` | per-ward counts (verified vs cover), delimitation text, booth/room, page range |
| `data/rajasthan/jodhpur/jhanwar/veernagar/records_final.json` | same records + ward metadata as JSON (machine-readable master) |
| `data/rajasthan/jodhpur/jhanwar/veernagar/deleted.json` | the 107 records the photos PDF stamps DELETED (Step 8) |
| `verification.md` (repo root) | every OCR-sourced / corrected / suspicious value, listed for human check |

Ward CSV columns: `serial_no, epic_id, name, relation, father_or_husband_name,
house_no, age, gender, locality, pdf_page`.

`house_no` follows the **house policy** (see Step 5b): 1..6 digits, nothing
else — text with a number in it keeps its number (`जे-36` → `36`), and a
record whose printed `मकान संख्या:` cell carries no number is stored EMPTY
(listed in `verification.md` §D, the rows awaiting a manual read).

---

## Why not plain text extraction?

The PDF has **13 Devanagari subset fonts with broken ToUnicode CMaps**: `page.get_text()`
returns readable *digits and Latin* but garbled Devanagari
(`रररर कमरनक` for `वार्ड क्रमांक`). Decoding the cmap / glyph ids directly was tried
and failed (the cmap itself is wrong, and a glyph-id → unicode map of the embedded
font still produced `अररतर`-style garbage).

So the pipeline is **image OCR for the text, raw text layer for structure and digits**:

* Raw layer (reliable): serial numbers, EPIC IDs, ages, house digits, cover count
  tables, booth number, room number, ward number, line/column *geometry*.
* OCR (Tesseract) on 300-dpi renders: names, relation labels, locality headers,
  text house numbers, gender.

Because both layers give the same geometry (identical page boxes), words from the two
sources can be merged by position.

---

## Toolchain

* Python `3.14` (Windows path used: `C:\Users\Dell\AppData\Local\Programs\Python\Python314\python.exe`)
  with `pymupdf` and `Pillow`.
* Tesseract `C:\Program Files\Tesseract-OCR\tesseract.exe`, languages `hin+eng`.
* Bash (Git Bash on Windows). Run every script with **cwd = repo root** — all paths are
  relative (`data/…`, `ocr_pages/…`). Set `PYTHONIOENCODING=utf-8`.
* All pipeline scripts live in **`tools/extract_roll/`** and are run from the repo root:

  | script | step |
  |---|---|
  | `ocr.py` / `ocr_one.sh` / `tsv_one.sh` | 1–2 render + OCR helpers |
  | `parse4.py` | 3 geometric parser (raw layer + OCR TSV) |
  | `slice_ocr.py` | 4a 4-band re-OCR repair → `ocr_tsv2/` |
  | `cell_ocr.py`, `repair_mata.py` | 4b single-cell re-OCR repairs |
  | `fix_final.py` | 5 corrections + `verification.md` + `records_final.json` |
  | `align_houses.py` | 5b the house policy — digits-or-empty, cell-OCR ground truth for disagreements (`जे-36` → `36`, no number → empty) |
  | `write_csv.py` | 6 per-ward CSVs |
  | `deleted_flags.py` | 8 the DELETED list (`deleted.json`) lifted from the photos PDF |
  | `records_v4c.json` | pre-fix snapshot (source of the “was” values in `verification.md`) |
  | `problems.json` | rows that still miss a field after step 3 (repair input) |

---

## Step 1 — Render pages (300 dpi)

```python
import pymupdf
doc = pymupdf.open('data/veernagar-1.pdf')
for i, page in enumerate(doc, 1):
    page.get_pixmap(dpi=300).save('ocr_pages/page-%04d.png' % i)
```

2480×3505 px images; page box 595×841 pt → scale ≈ 4.168 px/pt.
(`python tools/extract_roll/ocr.py --render` does exactly this.)

## Step 2 — OCR every page (txt + word boxes)

```bash
for f in ocr_pages/page-*.png; do
  b=$(basename "$f" .png)
  "/c/Program Files/Tesseract-OCR/tesseract.exe" "$f" "ocr_text/$b" -l hin+eng --psm 6
  "/c/Program Files/Tesseract-OCR/tesseract.exe" "$f" "ocr_tsv/$b"  -l hin+eng --psm 6 tsv
done
```

`--psm 6` (uniform block) is important: the roll is a regular grid, `--psm 3` shuffled
column order. The **TSV** output (word + confidence + bbox) is what the parser consumes;
the txt is only for debugging. (`ocr_one.sh` / `tsv_one.sh` in `tools/extract_roll/`
do this per image and skip files that already exist.)

## Step 3 — Parse: raw layer + OCR TSV merged by geometry (`tools/extract_roll/parse4.py`)

Record layout (same on every record page):

* Grid: **3 columns**, x edges in pt `[0, 203.5, 375.5, 600]`; 9 record lines per page.
* Each record = **5 stacked lines**:
  1. `serial + EPIC` (a line containing an EPIC-like token starts a record)
  2. `नाम:` … — the line also contains “Photo is”
  3. `पिता का नाम:` / `पति का नाम:` / `माता का नाम:` / `अन्य:` — contains “Available”
  4. `मकान संख्या:`
  5. `आयु: NN लिंग: …`
* The photo occupies the right part of each cell → **OCR text is clipped right of
  x = 145 / 318 / 492 pt** (per column) for the name and father lines.
* A line between records that is pure Devanagari and has no field label = **locality
  header** (`<mohalla>,सांगरिया`), carried forward onto the records below it.

Merging rules used:

* Raw words filtered to the grid band `138 ≤ y ≤ 812`, clustered into lines.
* OCR TSV words joined into the same lines by centre-y (tolerance) and column x-range.
* Confidence ladder `(conf ≥ 40, tol 8) → (≥ 15, tol 10) → (≥ 0, tol 12)`: retry at
  lower confidence until the field is non-empty.
* Fallbacks to the raw layer whenever OCR gives nothing: age digits, house digits,
  serial, EPIC, gender token.
* Relation is taken from the label **inside the same column** (`RELATION_RE =
  (अन्य|पति|पिता)`; `माता का नाम` rows are repaired in step 5).

**Ward structure** (1-based page numbers):

```
covers = [1, 29, 62, 96, 131, 163, 178, 193, 207, 218, 229, 255, 284]
```

Each cover is followed by a नक्शा page; record pages are the rest (e.g. ward 1 =
pages 3–28). Ward number comes from the raw regex `कमरनक\s*:\s*(\d+)` (→ `वार्ड क्रमांक`).
Cover count table = raw digits with `y > 690` sorted by x →
`[?, अंतिम, पुरूष, स्त्री, तृतीय, योग]`, expected total **6855**.

Booth / room on the cover come from the raw layer (digits are exact):

* booth: the unique bare line `^\s*(\d{1,3}) - <school…>` (the number is **not** on the
  same line as the `पतर :` label).
* room: `कमर\w*\s*न\.?\s*(\d+)` inside `(कमरा न. N)`.

## Step 4 — Repair passes for pages OCR got wrong

Two targeted re-OCR passes, both driven by `tools/extract_roll/problems.json`
(rows with a missing field):

1. **`tools/extract_roll/slice_ocr.py`** — cut each problem page into 4 *overlapping horizontal bands*,
   re-OCR each band separately (Tesseract reads a half-page grid much better than a
   whole page), dedup word boxes by text/x/y buckets → `ocr_tsv2/page-NNNN.tsv`.
   The parser gives `ocr_tsv2/` priority over `ocr_tsv/`. This fixed 4 of 6 problems.
2. **`tools/extract_roll/cell_ocr.py` / `repair_mata.py`** — crop the *single cell* (column × line) of the
   remaining records, upscale 3–6×, OCR with `--psm 6/7/11`. Fixed the last 2 records
   (`बिंदू`, house `SANGARIYA`) and recovered 6 mother names that only had the
   `माता का नाम` label.

## Step 5 — Final pass + verification report (`tools/extract_roll/fix_final.py`)

* `माता का नाम` / `ता का नाम:` labels → `relation = माता`, label stripped from the
  father column (77 rows; a real name like `माता प्रसाद शर्मा` is *not* touched —
  the label regex requires `का` right after `माता`).
* **Age and house digits are re-read from the raw text layer** cell-by-cell and
  compared with the OCR values; mismatches are corrected (raw digits are proven
  exact: every serial, EPIC and cover total matched). History is kept for
  `verification.md`: 89 ages, 266 house numbers, 1 name.
* Ward metadata rebuilt: booth, room, booth address (OCR), delimitation text
  (OCR; word-level crop OCR used where full-page OCR disagreed).
* Writes `verification.md` (sections A–M) and `records_final.json`.

## Step 5b — the house-number policy (`tools/extract_roll/align_houses.py`)

`house_no` is normalised to one rule: **the printed cell either carries a
number or it does not.**

* Value has a 1…6-digit run → the digits, text around them dropped
  (`34,प्रेम नागर` → `34`, `B-25 परसवानाथ` → `25`, `जे-36` → `36`).
* A 7+-digit run is never a house number — those are EPIC-digit / age-column
  merges from earlier bad passes (`4946992` = the EPIC's own digits).
* Unsettled rows (a partial earlier pass touched them, or no run survives)
  are re-read from the **single house cell** — cropped from the PDF at
  900/1800 dpi, OCR'd with a digit whitelist, majority-voted across variants.
  The raw text layer is deliberately NOT consulted here: `cell_fixes.json`
  § `sample_mismatches` shows it decodes the printed `| … |` rules around
  the number as a leading `1` (raw `128` where the print says `28`).
* No digits anywhere → EMPTY. Nothing is silently kept as text — OCR
  garbage (`az`, `rfe`, `के`, `पलाट नं.`) and genuine but numberless
  entries (`जे सेकंड फ्लोर`) both end up in §D for a human to read.

The pass finishes by syncing `records_final.json`'s `house` back FROM the
CSVs and rebuilding `verification.md` §D as the list of numberless rows — so
`validate.py`'s CSV-vs-records parity and its strict house check
(`^\d{1,6}$` or empty) describe the same data.

## Step 6 — Write CSVs (`tools/extract_roll/write_csv.py`)

One CSV per ward sorted by `serial_no`, plus `wards-summary.csv` with
`ward_no, voters, male, female, third_gender, ward_delimitation, booth_no, room_no,
booth_address, pdf_pages`.

---

## Step 7 — Voter photos from `data/VeerNagar-photos.pdf` (`tools/extract_roll/photos_by_epic.py`)

The photos PDF (346 pages) repeats the same record layout but draws a real
portrait (146×182 px) in every cell instead of the "Photo is Available" text.
Photos are named by EPIC ID via three identification tiers:

1. **Geometry + EPIC text** (7080 files): the EPIC token from the raw layer in
   the *same column* nearest by centre-y — photo centre sits ~32.8 pt below
   its record's EPIC-line centre (observed 32.79–32.87 pt over the whole doc;
   row pitch ≈ 72.35 pt, `MAX_ROW_DIST = 40`).
2. **Ward + serial fallback**: rows on supplement/new-voter pages (29, 65, 139,
   140, 175, 193, 211, 228, 242, 243, 285, 286, 317, 343) have an **empty EPIC
   line in the source** (no text, no ink — verified with a dark-pixel probe).
   Their serial is still on line 1 (centre ≈ photo_top − 4.4 pt) and the page
   header has the ward, so `(ward, serial)` is looked up in `records_final.json`.
3. **`ward{W}-serial{S}.{ext}`**: rows whose serial is also beyond the older
   roll's range (new voters in this edition) — EPIC unrecoverable anywhere in
   the repo, file named by official coordinates instead (137 files).

Other image kinds: 107 × 106×76 px stamps in record cells' text area (kept as
`<EPIC>_pNNN.<ext>`, never shadowing the portrait) and 13 × 565×800 full-page
cover scans (excluded, listed as `leftovers`). Old-format EPIC
`RJ/24/185/…` → filename `RJ-24-185-….png`. Duplicate EPIC occurrences (109
tokens printed on two pages) → `<EPIC>.png` + `<EPIC>_pNNN.png`.

Outputs: `data/photos/` (7217 files + `manifest.json` with per-file provenance,
leftovers and validation counters).

Validation: cross-check photo→identity against `(ward, serial)` on the known
roll — **7063 agree / 17 beyond-known-roll / 0 disagree**; printed EPIC vs
known roll — **6964 agree / 17 out-of-range / 0 disagree**; every plain
`<EPIC>.<ext>` file verified to be a 146×182 portrait; manifest ↔ directory
symmetric difference 0. 8 EPIC tokens have no photo drawn at all
(`AVX3780418, IYN1301571, JHP2010262, JHP2013563, TNM1438811, UQP2295814,
WEE2101913, WLK3063823`).

---

## Step 8 — DELETED flags from `data/VeerNagar-photos.pdf` (`tools/extract_roll/deleted_flags.py`)

107 record cells in the photos PDF carry one extra image: the 106×76 px
diagonal **DELETED** stamp drawn over the record (the only non-portrait,
non-scan image kind in the document — all 107 placements are the same xref,
so the marker is unambiguous). The script reads `data/photos/manifest.json`
(Step 7), keeps `kind == 'aux'`, and validates every placement against the
roll: `(ward, serial)` must resolve in `records_final.json` **and** that
record's EPIC must equal the one the manifest gave the stamp — geometry+EPIC
text vs the roll lookup, the same two-identification cross-check used in
Step 7, agreeing on **107/107**.

Output: `deleted.json` — `{ ward, serial, epic_id, photos_pdf_page,
stamp_bbox_pt }` per struck voter, sorted by ward and serial. Per ward:
`1:3  2:9  3:13  4:9  5:12  6:17  7:10  8:8  9:1  11:12  12:11  13:2`
(ward 10 has none), 107 distinct EPICs — no voter stamped twice.

`mobile/scripts/generate-ward-bundles.ts` merges this file at bundle time,
setting `deleted: true` on those rows only (absent otherwise), and aborts if
a marker's EPIC disagrees with its row or points at a serial that does not
exist — so the mobile card and the admin panel can only ever badge a voter
the marker actually named. `RollVoter.deleted` carries it into the UI, where
the card layers a big diagonal DELETED badge over itself
(`mobile/components/roll/voter-card.tsx`, `admin/src/app/voters/page.tsx`).

---

## Validation (all PASSED — re-run these after any change)

1. **Count** per ward == cover-page अंतिम count → 13/13 wards, 6855/6855 rows.
2. **Serials** continuous `1..N` per ward: no gaps, no duplicates.
3. **EPIC IDs**: `^[A-Z]{3}\d{7}$` (6802) + old `RJ/\d{2}/\d{3}/\d{6}` (53) — 100%.
4. **Gender**: per-ward पुरूष/स्त्री totals match the cover table **exactly** on all
   13 wards — this proves every cell was read from the correct grid line.
5. **Core fields** (name, gender, age) non-empty on all 6855 rows; `house_no`
   is `^\d{1,6}$` or empty (the house policy — empty rows are §D).
6. **Age vs raw text layer** — 0 remaining mismatches.
7. No label residue (`पिता का नाम:` etc.) left inside any value column.
8. **DELETED markers** — bundle runs print `deleted flags: 107/107 rows
   marked`: every stamp in `deleted.json` resolves to a roll row with the
   matching EPIC, and no EPIC is stamped twice.

## What is *not* fully machine-verified

Names, father/husband names, relation labels, locality headers and text-form house
numbers exist **only in the OCR layer** (the raw Devanagari is unreadable), so they are
listed in `verification.md` for human checking:

| section | what |
|---|---|
| A / C / C2 | values auto-corrected (age, house, name) — check the “was” value |
| B | ages outside 18–100 |
| D | rows with NO house number — kept empty per the house policy (digits-only rule) |
| E / F | names / father names with OCR-artifact characters |
| G | `माता का नाम` rows (relation + 6 recovered mother names) |
| I | locality headers per ward |
| J | ward metadata: booth, room, delimitation text, booth address |
| K | old-format EPIC IDs |
| L / M | per-column provenance; everything that was kept as OCR read it |

Nothing is ever dropped: a bad OCR value stays in the CSV and is listed in
`verification.md` instead.
