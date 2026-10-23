# -*- coding: utf-8 -*-
"""
Extractor: OCR only the last 5 pages of each ward PDF.
Additions/deletions sections are always at the end of the PDF.
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

EPIC_PATTERN = re.compile(r'[A-Z]{3}\d{3,7}')
SERIAL_PATTERN = re.compile(r'^\d{1,4}$')
WARD_HINDI = re.compile(r'कमर')


# ── Helpers ────────────────────────────────────────────────────────────────

def find_ward_from_ocr(txt_utf8):
    """Extract ward number from OCR text (Hindi: कमर...)."""
    m = WARD_HINDI.search(txt_utf8)
    if m:
        after = txt_utf8[m.start():m.start()+20]
        n = re.search(r'\d+', after)
        if n:
            return int(n.group(0))
    return None


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    with open(RECORDS_JSON, encoding='utf-8') as f:
        records_data = json.load(f)

    by_ws = {}
    for r in records_data['records']:
        by_ws[(r['ward'], r['serial'])] = r['epic']

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

        # Only OCR the last 5 pages
        start_page = max(0, doc.page_count - 5)

        for pno in range(start_page, doc.page_count):
            page = doc[pno]

            pix = page.get_pixmap(dpi=150)
            img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
            ocr_data = pytesseract.image_to_data(img, lang='hin+eng',
                                                 output_type=pytesseract.Output.DICT)

            try:
                txt_utf8 = ' '.join(t.strip() for t in ocr_data['text']).encode('utf-8', errors='replace').decode('utf-8')
            except:
                txt_utf8 = ''

            has_additions = 'परिवर्धन' in txt_utf8
            has_deletions = any(kw in txt_utf8 for kw in ['विलोपन', 'E-Deleted', 'Deletion'])

            if not has_additions and not has_deletions:
                continue

            page_ward = find_ward_from_ocr(txt_utf8) or filename_ward

            print(f'  Page {pno+1}: additions={has_additions}, deletions={has_deletions} (ward={page_ward})')

            if has_additions:
                for t in ocr_data['text']:
                    t_stripped = t.strip()
                    if not t_stripped:
                        continue
                    m = EPIC_PATTERN.search(t_stripped)
                    if m:
                        epic = m.group(0)
                        if len(epic) >= 6:
                            # Find serial near this EPIC
                            idx = ocr_data['text'].index(t)
                            left = ocr_data['left'][idx]
                            top = ocr_data['top'][idx]
                            width = ocr_data['width'][idx]
                            height = ocr_data['height'][idx]
                            cx = left + width / 2
                            cy = top + height / 2

                            serial = None
                            for j, t2 in enumerate(ocr_data['text']):
                                t2_stripped = t2.strip()
                                if SERIAL_PATTERN.match(t2_stripped):
                                    t2_left = ocr_data['left'][j]
                                    t2_top = ocr_data['top'][j]
                                    t2_cx = t2_left + ocr_data['width'][j] / 2
                                    t2_cy = t2_top + ocr_data['height'][j] / 2
                                    if abs(t2_cx - cx) < 150 and abs(t2_cy - cy) < 80:
                                        if t2_stripped.isdigit():
                                            serial = int(t2_stripped)
                                            break

                            if serial and page_ward:
                                known_epic = by_ws.get((page_ward, serial))
                                if known_epic is None:
                                    all_new_records.append({
                                        'ward': page_ward,
                                        'serial': serial,
                                        'epic': epic,
                                        'pdf_page': pno + 1,
                                        'source_pdf': pdf_name,
                                    })

            if has_deletions:
                for t in ocr_data['text']:
                    t_stripped = t.strip()
                    if not t_stripped:
                        continue
                    m = re.search(r'[Ss]\s+(\d+)\s+([A-Z]{3}\d{3,7})', t_stripped)
                    if m:
                        del_serial = int(m.group(1))
                        del_epic = m.group(2)
                        all_deletion_records.append({
                            'ward': page_ward,
                            'serial': del_serial,
                            'epic': del_epic,
                            'pdf_page': pno + 1,
                            'source_pdf': pdf_name,
                            'reason': 'from deletion summary',
                        })

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