# -*- coding: utf-8 -*-
"""
Simple extractor: OCR all pages, extract EPICs, match against known roll.
Assumes any voter not in records_final.json is a new voter.
"""

import os
import re
import json
import pytesseract
from PIL import Image
import pymupdf


# ── Configuration ──────────────────────────────────────────────────────────
DATA_DIR = os.path.join('data', 'rajasthan', 'jodhpur', 'jhanwar', 'veernagar')
RECORDS_JSON = os.path.join(DATA_DIR, 'records_final.json')
NEW_VOTERS_OUTPUT = os.path.join(DATA_DIR, 'new_voters.json')
NEW_DELETIONS_OUTPUT = os.path.join(DATA_DIR, 'new_deletions.json')

COL_EDGES = [0.0, 203.5, 375.5, 600.0]

EPIC_PATTERN = re.compile(r'[A-Z]{3}\d{3,7}')
SERIAL_PATTERN = re.compile(r'^\d{1,4}$')


# ── Helpers ────────────────────────────────────────────────────────────────

def column_of(x_center):
    for i in range(3):
        if COL_EDGES[i] <= x_center < COL_EDGES[i + 1]:
            return i
    return None


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    with open(RECORDS_JSON, encoding='utf-8') as f:
        records_data = json.load(f)

    # Build lookup: (ward, serial) -> epic
    by_ws = {}
    for r in records_data['records']:
        by_ws[(r['ward'], r['serial'])] = r['epic']

    known_ws = set(by_ws.keys())

    all_new_records = []
    all_deletion_records = []

    pdf_dir = 'data'
    pdf_files = sorted(
        f for f in os.listdir(pdf_dir)
        if f.startswith('Ward No- ') and f.endswith('.pdf')
    )

    for pdf_name in pdf_files:
        pdf_path = os.path.join(pdf_dir, pdf_name)
        ward_match = re.search(r'Ward No- (\d+)\.pdf', pdf_name)
        if not ward_match:
            continue
        filename_ward = int(ward_match.group(1))

        print(f'Processing {pdf_name}')

        doc = pymupdf.open(pdf_path)

        for pno in range(doc.page_count):
            if pno >= 30:  # Skip very late pages - unlikely to have new data
                continue

            page = doc[pno]

            # OCR the page at 150 DPI (fast enough)
            pix = page.get_pixmap(dpi=150)
            img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
            ocr_data = pytesseract.image_to_data(img, lang='hin+eng',
                                                 output_type=pytesseract.Output.DICT)

            # Get OCR text
            txt = ''
            for t in ocr_data['text']:
                txt += t + ' '
            txt_utf8 = txt.encode('utf-8', errors='replace').decode('utf-8')

            # Extract EPICs from this page
            epics = []
            for t in ocr_data['text']:
                t_stripped = t.strip()
                if not t_stripped:
                    continue
                m = EPIC_PATTERN.search(t_stripped)
                if m:
                    epic = m.group(0)
                    if len(epic) >= 6:
                        epics.append(epic)

            # For each unique EPIC, determine if it's a new voter
            for epic in set(epics):
                # Find the OCR position of this EPIC
                epic_idx = None
                for i, t in enumerate(ocr_data['text']):
                    if epic in t.strip():
                        epic_idx = i
                        break
                
                if epic_idx is None:
                    continue
                
                left = ocr_data['left'][epic_idx]
                top = ocr_data['top'][epic_idx]
                width = ocr_data['width'][epic_idx]
                height = ocr_data['height'][epic_idx]
                cx = left + width / 2
                cy = top + height / 2

                # Find serial number near this position
                # Look for standalone numbers (serials) in the OCR output
                serial = None
                for j, t in enumerate(ocr_data['text']):
                    t_stripped = t.strip()
                    if SERIAL_PATTERN.match(t_stripped):
                        t_left = ocr_data['left'][j]
                        t_top = ocr_data['top'][j]
                        t_width = ocr_data['width'][j]
                        t_height = ocr_data['height'][j]
                        t_cx = t_left + t_width / 2
                        t_cy = t_top + t_height / 2
                        
                        # Check if this serial is near the EPIC (same area)
                        if abs(t_cx - cx) < 150 and abs(t_cy - cy) < 80:
                            if t_stripped.isdigit():
                                serial = int(t_stripped)
                                break
                
                if serial and filename_ward:
                    # Check if (ward, serial) is in the known roll
                    known_epic = by_ws.get((filename_ward, serial))
                    
                    if known_epic is None:
                        # NEW voter — not in the existing roll
                        all_new_records.append({
                            'ward': filename_ward,
                            'serial': serial,
                            'epic': epic,
                            'pdf_page': pno + 1,
                            'source_pdf': pdf_name,
                        })
                        print(f'  NEW: ward={filename_ward} serial={serial} epic={epic} p={pno+1}')
                    elif known_epic != epic:
                        print(f'  MISMATCH: ward={filename_ward} serial={serial} known={known_epic} found={epic}')

        doc.close()

    # ── Write outputs ────────────────────────────────────────────────────
    os.makedirs(DATA_DIR, exist_ok=True)

    with open(NEW_VOTERS_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump({'new_records': all_new_records}, f, ensure_ascii=False, indent=2)
    print(f'\nWrote {len(all_new_records)} new voters')

    with open(NEW_DELETIONS_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump({'deletion_records': all_deletion_records}, f, ensure_ascii=False, indent=2)
    print(f'Wrote {len(all_deletion_records)} deletion records')

    print(f'\n=== Summary ===')
    print(f'New voters: {len(all_new_records)}')
    print(f'Deletion records: {len(all_deletion_records)}')


if __name__ == '__main__':
    main()