/**
 * Generates the square icon variants `app.json` points at.
 *
 * `logo.png` is 1049×1008 — a real logo, not an icon canvas — and Expo's
 * config schema requires `icon`, `android.adaptiveIcon.foregroundImage` and
 * `android.adaptiveIcon.monochromeImage` to be **square**, which is exactly
 * what `npx expo-doctor` flags:
 *
 *   Field: icon - image should be square, but the file at './assets/images/logo.png'
 *          has dimensions 1049x1008.
 *
 * Hand-cropping it once would leave the fix unrepeatable the next time the
 * logo changes, so the three variants are derived instead (this is the plan
 * `app.config.ts` sketches in its "Asset variants: NOT YET DERIVED" note):
 *
 *   icon-1024.png                1024², logo contained and centred, transparent
 *   adaptive-foreground-1024.png 1024², logo inside the 66 % safe zone Android
 *                                masks a launcher icon down to — a full-bleed
 *                                logo gets cropped to whatever survives the
 *                                circle, which reads as a tiny mark
 *   adaptive-monochrome-1024.png 1024², white silhouette for Android 13+
 *                                themed icons, same safe zone
 *
 * The monochrome shape comes from the logo's own alpha when it has one, and
 * otherwise from colour-keying the corner pixel, so a logo exported on a white
 * background still yields a mark rather than a solid white square.
 *
 * Run: `pnpm run brand:assets` (no native deps — `pngjs` is pure JS).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(ROOT, 'assets/images/logo.png');
const OUT = (name) => path.join(ROOT, 'assets/images', name);

/** Android masks launcher icons to a circle/squircle; keep the mark inside it. */
const SAFE_ZONE = 0.66;
const SIZE = 1024;

const source = PNG.sync.read(readFileSync(SOURCE));
const { width: sw, height: sh, data: sd } = source;
console.log(`source: ${sw}x${sh}`);

/** Bilinear resample — nearest-neighbour would stair-step a 1049px logo down. */
function resample(src, dw, dh) {
  const out = { width: dw, height: dh, data: Buffer.alloc(dw * dh * 4) };
  const { data: s, width: sw2, height: sh2 } = src;
  const xr = (sw2 - 1) / Math.max(1, dw - 1);
  const yr = (sh2 - 1) / Math.max(1, dh - 1);
  for (let y = 0; y < dh; y += 1) {
    const fy = y * yr;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh2 - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x += 1) {
      const fx = x * xr;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw2 - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const p00 = s[(y0 * sw2 + x0) * 4 + c];
        const p10 = s[(y0 * sw2 + x1) * 4 + c];
        const p01 = s[(y1 * sw2 + x0) * 4 + c];
        const p11 = s[(y1 * sw2 + x1) * 4 + c];
        const top = p00 + (p10 - p00) * wx;
        const bottom = p01 + (p11 - p01) * wx;
        out.data[o + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return out;
}

/** The logo scaled to fit `box`, drawn centred on a transparent SIZE² canvas. */
function contained(box, { monochrome = false, keyColor = null } = {}) {
  const scale = Math.min(box / sw, box / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const scaled = resample(source, dw, dh);
  const canvas = new PNG({ width: SIZE, height: SIZE });
  const ox = Math.floor((SIZE - dw) / 2);
  const oy = Math.floor((SIZE - dh) / 2);

  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const s = (y * dw + x) * 4;
      const d = ((y + oy) * SIZE + (x + ox)) * 4;
      const r = scaled.data[s];
      const g = scaled.data[s + 1];
      const b = scaled.data[s + 2];
      let a = scaled.data[s + 3];

      if (monochrome) {
        // White silhouette: shape from alpha, or from "differs from the
        // background" when the source is opaque.
        if (keyColor) {
          const dist = Math.max(
            Math.abs(r - keyColor[0]),
            Math.abs(g - keyColor[1]),
            Math.abs(b - keyColor[2])
          );
          // 24 → fully background, 64 → fully mark, linear in between, so a
          // soft edge (anti-aliased logo) keeps its anti-aliasing.
          a = Math.round(255 * Math.min(1, Math.max(0, (dist - 24) / 40)));
        }
        canvas.data[d] = 255;
        canvas.data[d + 1] = 255;
        canvas.data[d + 2] = 255;
        canvas.data[d + 3] = a;
      } else {
        canvas.data[d] = r;
        canvas.data[d + 1] = g;
        canvas.data[d + 2] = b;
        canvas.data[d + 3] = a;
      }
    }
  }
  return canvas;
}

/** True when the source actually carries transparency (not just 255 alpha). */
const hasAlpha =
  sd.some((_, i) => (i & 3) === 3 && sd[i] !== 255);

/** Background colour to key out for the monochrome variant, if opaque. */
const keyColor = hasAlpha
  ? null
  : [sd[0], sd[1], sd[2]]; // top-left pixel of the source

const targets = [
  ['icon-1024.png', SIZE],
  ['adaptive-foreground-1024.png', Math.round(SIZE * SAFE_ZONE)],
  [
    'adaptive-monochrome-1024.png',
    Math.round(SIZE * SAFE_ZONE),
    { monochrome: true, keyColor },
  ],
];

for (const [name, box, opts] of targets) {
  const png = contained(box, opts ?? {});
  writeFileSync(OUT(name), PNG.sync.write(png));
  console.log(`wrote ${name}: ${png.width}x${png.height}`);
}

console.log(
  hasAlpha
    ? 'source has transparency -> monochrome shape taken from its alpha'
    : `source is opaque -> monochrome shape keyed from corner colour rgb(${keyColor.join(',')})`
);
