"""Render PDF pages to high-res PNGs and OCR them with tesseract (hin+eng)."""
import os, sys, subprocess, argparse

PY = sys.executable
TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def render(pdf, outdir, dpi=300, first=1, last=None):
    os.makedirs(outdir, exist_ok=True)
    code = f"""
import pymupdf, os, sys
pdf = pymupdf.open({pdf!r})
outdir = {outdir!r}
first = {first}
last = {last} or pdf.page_count
done = 0
for i in range(first-1, min(last, pdf.page_count)):
    out = os.path.join(outdir, f"page-{{i+1:04d}}.png")
    if os.path.exists(out) and os.path.getsize(out) > 10000:
        done += 1
        continue
    pix = pdf[i].get_pixmap(dpi={dpi})
    pix.save(out)
    done += 1
print(f"rendered {{done}} pages", flush=True)
"""
    subprocess.run([PY, "-c", code], check=True)


def ocr(img, lang="hin+eng", psm=6):
    r = subprocess.run([TESS, img, "stdout", "-l", lang, "--psm", str(psm)],
                       capture_output=True)
    return r.stdout.decode("utf-8", errors="replace")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--ocr", action="store_true")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--psm", type=int, default=6)
    a = ap.parse_args()
    if a.render:
        render("data/veernagar-1.pdf", "ocr_pages", dpi=a.dpi,
               first=1, last=a.page if a.page else None)
    if a.ocr:
        img = f"ocr_pages/page-{a.page:04d}.png"
        print(ocr(img, psm=a.psm))
