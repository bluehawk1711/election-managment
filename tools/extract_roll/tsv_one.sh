#!/bin/bash
img="$1"
base=$(basename "$img" .png)
out="ocr_tsv/${base}.tsv"
if [ -s "$out" ]; then exit 0; fi
"/c/Program Files/Tesseract-OCR/tesseract.exe" "$img" "ocr_tsv/${base}" -l hin+eng --psm 6 tsv 2>/dev/null
