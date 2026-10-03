#!/bin/bash
img="$1"
base=$(basename "$img" .png)
out="ocr_text/${base}.txt"
if [ -s "$out" ]; then exit 0; fi
"/c/Program Files/Tesseract-OCR/tesseract.exe" "$img" "${out%.txt}" -l hin+eng --psm 6 2>/dev/null
