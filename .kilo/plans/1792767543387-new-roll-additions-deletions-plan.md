# Plan: Extract additions & deletions from the 2026 ward PDFs and update the roll

## Goal
Process the 13 new `data/Ward No- {1..13}.pdf` rolls (Oct-2026 edition) to (a) identify new voters (परिवर्धन सूची) and add them to the per-ward CSVs/records, (b) identify struck voters (विलोपन सूची) and mark `deleted: true`, (c) crop B&W portraits for new voters, and (d) regenerate bundles, photo-maps, and docs. Keep the existing deleted-stamp model (deleted rows stay in the roll, flagged).

## Context gathered
- New PDFs are scanned (no text layer), A4, 3-col × 9-row record grid — same geometry as `data/veernagar-1.pdf`.
- Structure per PDF: cover → map → main roll (counts match our CSVs exactly: ward 9 = 196, ward 1 = 648) → भाग 1 परिवर्धन (additions) → भाग 2 विलोपन (deletions, EPIC-level) → भाग 3 संशोधन + summary tables.
- DELETED marker in these PDFs is baked into scan pixels (no shared stamp xref), so detection relies on OCR of the additions/deletions tables, not image-xref tricks.
- Existing pipeline: `tools/extract_roll/` (parse4 + repairs + write_csv + photos_by_epic + deleted_flags), `mobile/scripts/generate-ward-bundles.ts`, `data/photos/manifest.json`.

## Decisions (open → to resolve in phase 1)
1. **Serial numbering for additions**: use the serial printed in the new roll's additions section (likely continuing after main-roll last serial) — verify in phase 1; do not renumber.
2. **Deletions scope**: mark existing rows `deleted:true` (keep in roll) — consistent with Step 8 model. New-roll deletions that reference EPICs not in our roll are logged, not fatal.
3. **New-voter photos**: crop from the new PDF record cells (same 146×182 pt portrait geometry) and add to `data/photos/` + mobile/admin assets, named by EPIC where recoverable else `ward{W}-serial{S}`.
4. **House-number policy**: apply same digits-or-empty rule to additions.

## Phases

### Phase 1 — Reconnaissance (no writes except scratchpad)
- OCR page titles/headers of every PDF to map page ranges: main roll / additions / deletions / summary, per ward. Record counts from cover tables.
- Render additions page 1 of wards 1, 9 at 300 dpi; OCR with tesseract to confirm serial continuity, EPIC format, deleted-mark appearance, and that grid geometry matches (COL_EDGES, row pitch).
- Check whether any addition record carries a baked DELETED stamp (visual probe).
- Output: `scratchpad/newward/page_map.json` (ward → {main:[], additions:[], deletions:[], summary:[]} and expected counts).

### Phase 2 — OCR + parse additions (reuse parse4 approach)
- Render all pages of all 13 PDFs at 300 dpi into `ocr_pages_new/` (or reuse a per-ward subdir to avoid clobbering old `ocr_pages/`).
- Tesseract hin+eng --psm 6 TSV for each.
- Adapt parse4 geometry to the new PDFs; extract records from additions pages only. Reuse slice_ocr/cell_ocr repair for problem rows.
- Write `data/rajasthan/.../additions_2026.json` (list of new voter records with ward, serial, epic, name, relation, father, house, age, gender, locality, pdf_page) and a problems list.

### Phase 3 — Parse deletions table
- OCR the विलोपन pages; extract EPIC (and serial if present) per struck voter.
- Cross-check each against `records_final.json` + our CSVs; produce match report (matched / not-in-roll / EPIC-mismatch).
- Output `data/rajasthan/.../deletions_2026.json`.

### Phase 4 — Reconcile & update data
- Append addition records to each ward CSV (sorted by serial), update `wards-summary.csv` counts and `records_final.json`.
- Update `deleted.json` to union existing 107 + new deletions (dedup by EPIC; keep stamp provenance where available, else source='2026-roll').
- Apply house-number policy to additions.

### Phase 5 — Photos
- Crop portraits from new PDF record cells for addition voters; update `data/photos/manifest.json` (new entries, provenance); export to mobile `assets/photos/` and admin `public/photos/`; regenerate photo-maps (`npm run photos:maps`).

### Phase 6 — Bundles & UI
- Run `mobile/scripts/generate-ward-bundles.ts`; copy bundles to `admin/public/roll/`.
- Verify `RollVoter.deleted` flows (already wired).

### Phase 7 — Docs & validation
- Update `EXTRACTION.md` with Step 9 (2026 additions/deletions).
- Run: mobile tsc + eslint + jest; admin tsc + eslint + vitest; next build.
- Validate: per-ward count = cover अंतिम; serials contiguous; EPIC format; gender totals match cover; deleted count sanity; bundle HTTP check.

## Risks
- OCR quality on the new scanned PDFs may differ (font/scan resolution); may need per-page repair passes (as in Step 4).
- Additions serials may overlap or restart numbering — must verify before writing CSVs.
- New voters may reuse EPICs already in roll (transfers) — detect and decide (keep both? mark old deleted?).
- Photo crop coordinates must be re-measured for the new PDFs (may differ from veernagar-1.pdf).

## Open question
Should additions be merged into the main ward lists (single contiguous serial range) or kept as a separate supplement section in the app? Recommendation: merge into main list with their printed serials, consistent with how the official roll presents them; the app already sorts by serial_no.

## Out of scope
- Changing mobile/admin UI beyond existing deleted badge (already shipped).
- Re-extracting the original 6855 records (they are verified; only additions/deletions are new).