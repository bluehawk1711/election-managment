# -*- coding: utf-8 -*-
"""Find the PDF's embedded image objects and save them under data/images/.

Discovery is done with **pdf-inspector** (`extract_text_with_positions`
reports every drawn image as an `item_type == 'image'` item with its page
and bbox); the raw bytes are then pulled with PyMuPDF, because
pdf-inspector exposes no image-byte API.

The roll's record pages carry no photos (each cell just prints the text
"Photo is Available"), so the only image objects in the whole file live on
the 13 ward नक्शा (map) pages — one per ward, cover+1. Every ward's copy is
byte-identical (the same scan was embedded 13 times); the manifest records
that.

Writes:
  data/images/ward-NN_pPPP_xrefN.png   (13 files)
  data/images/manifest.json             (identification + provenance)

Run from repo root:  python tools/extract_roll/pdf_images.py
"""
import hashlib
import json
import os

import pdf_inspector.pdf_inspector as inspector
import pymupdf

PDF = 'data/veernagar-1.pdf'
OUT_DIR = os.path.join('data', 'images')

# 1-based page of each ward's नक्शा page (cover + 1), see EXTRACTION.md.
COVERS = [1, 29, 62, 96, 131, 163, 178, 193, 207, 218, 229, 255, 284]
MAP_PAGE_TO_WARD = {c + 1: i + 1 for i, c in enumerate(COVERS)}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # 1. pdf-inspector: where are the images drawn?
    items = inspector.extract_text_with_positions(PDF)
    image_items = [i for i in items if i.item_type == 'image']
    print('pdf-inspector: %d image item(s) of %d total items'
          % (len(image_items), len(items)))

    # 2. PyMuPDF: the actual bytes, per page/xref.
    doc = pymupdf.open(PDF)
    entries = []
    for pno in range(doc.page_count):
        for im in doc[pno].get_images(full=True):
            xref, smask = im[0], im[1]
            info = doc.extract_image(xref)
            blob = info['image']
            sha = hashlib.sha1(blob).hexdigest()
            ward = MAP_PAGE_TO_WARD.get(pno + 1)
            name = 'ward-%02d_p%03d_xref%d.%s' % (ward, pno + 1, xref,
                                                  info['ext'])
            path = os.path.join(OUT_DIR, name)
            with open(path, 'wb') as f:
                f.write(blob)
            # placement on the page (pdf-inspector bbox, points)
            placed = [i for i in image_items if i.page == pno + 1]
            entries.append({
                'file': name,
                'ward_no': ward,
                'pdf_page': pno + 1,
                'xref': xref,
                'width': info['width'],
                'height': info['height'],
                'ext': info['ext'],
                'bytes': len(blob),
                'sha1': sha,
                'page': ('ward %d नक्शा (map) page' % ward
                         if ward else 'page %d' % (pno + 1)),
                'bbox_pt': [{'x': round(i.x, 1), 'y': round(i.y, 1),
                             'w': round(i.width, 1), 'h': round(i.height, 1)}
                            for i in placed],
                'smask_xref': smask or None,
            })
            print('saved', path, '%dx%d' % (info['width'], info['height']),
                  'ward', ward)

    # 3. Dedup note: identical bytes across wards?
    by_sha = {}
    for e in entries:
        by_sha.setdefault(e['sha1'], []).append(e['file'])
    identical = {k[:12]: v for k, v in by_sha.items()}

    # pdf-inspector cross-check: every discovered item got extracted
    missing = len(image_items) - len(entries)

    manifest = {
        'source_pdf': PDF,
        'found_by': 'pdf-inspector extract_text_with_positions '
                    '(item_type="image"), bytes via PyMuPDF',
        'image_objects_in_pdf': len(entries),
        'pdf_inspector_image_items': len(image_items),
        'extracted': len(entries),
        'missing': missing,
        'all_ward_map_pages': True,
        'voter_photos_in_pdf': False,
        'voter_photos_note':
            'The record pages contain no photo images: each cell prints the '
            'text "Photo is Available" instead. These 13 objects are the '
            'ward नक्शा/notice scans embedded on cover+1 pages — they belong '
            'to a whole ward, not to an individual voter, hence the '
            'ward-level file names.',
        'identical_content_groups': identical,
        'images': entries,
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w',
              encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('saved', os.path.join(OUT_DIR, 'manifest.json'))
    print('total:', len(entries), '| unique blobs:', len(by_sha),
          '| inspector missing:', missing)


if __name__ == '__main__':
    main()
