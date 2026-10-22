/**
 * The tiny ESC/POS subset this feature needs.
 *
 *   ESC @                  initialise
 *   GS v 0 0 xL xH …       raster bit image, 1 bit/pixel, MSB first
 *   GS v 0 … blank rows    feed paper by printing white raster rows
 *   DLE EOT n              real-time status request (n = 1..4)
 *
 * No font, code-page, darkness, or cutter commands are used. Fonts on a
 * PT-210 are ASCII/GB18030, so Devanagari must arrive as a bitmap; darkness
 * and energy commands differ between clones and are intentionally avoided.
 *
 * Feed uses blank raster rows rather than `ESC d`: a hardware-tested PT-210
 * driver (bitbank2/Thermal_Printer) reports that the PT-210 has no
 * feed-by-line command, and advances paper with 1×1 blank `GS v 0` strips.
 * `ESC d` is therefore deliberately absent from this payload.
 *
 * References: Epson ESC/POS `GS v 0` ("Raster bit image") and `DLE EOT`
 * ("Real-time status transmission"); an accessible OEM command manual is
 * linked from docs/pt-210-printing.md because Epson's pages block automated
 * fetches.
 */
import type { RasterBitmap } from "./raster";

export const ESC = 0x1b;
export const GS = 0x1d;
export const DLE = 0x10;
export const EOT = 0x04;

export const DEFAULT_STRIP_ROWS = 24;
/**
 * Blank rows appended after the raster: 80 dots at the PT-210's ~8 dots/mm is
 * about 10 mm of tear-off margin. Blank raster rows advance the paper exactly
 * like printed rows, without depending on an `ESC d` implementation.
 */
export const DEFAULT_FEED_ROWS = 80;

export function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** `ESC @` — reset the printer before every job. */
export function initCommand(): Uint8Array {
  return Uint8Array.from([ESC, 0x40]);
}

/** `DLE EOT n` — 1: printer, 2: offline cause, 3: error cause, 4: paper. */
export function statusQuery(n: 1 | 2 | 3 | 4): Uint8Array {
  return Uint8Array.from([DLE, EOT, n]);
}

function assertBitmap(bitmap: RasterBitmap): void {
  if (
    !Number.isInteger(bitmap.width) ||
    !Number.isInteger(bitmap.height) ||
    bitmap.width <= 0 ||
    bitmap.height <= 0
  ) {
    throw new RangeError("Raster bitmap needs positive integer dimensions");
  }
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  if (bitmap.data.length < bytesPerRow * bitmap.height) {
    throw new RangeError("Raster bitmap data is shorter than its dimensions");
  }
}

function header(widthBytes: number, height: number): Uint8Array {
  return Uint8Array.from([
    GS,
    0x76, // 'v'
    0x30, // '0'
    0x00, // normal mode
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);
}

/**
 * Encode one bitmap as one or more `GS v 0` strips.
 *
 * Strips are capped at 24 rows: the third-party PT-210 Python driver defaults
 * to 24-row strips, and keeping each raster command small avoids firmware
 * buffer limits. Each strip repeats the header; the printer concatenates them
 * seamlessly.
 */
export function rasterCommand(
  bitmap: RasterBitmap,
  stripRows: number = DEFAULT_STRIP_ROWS,
): Uint8Array {
  assertBitmap(bitmap);
  const widthBytes = Math.ceil(bitmap.width / 8);
  const rowsPerStrip = Math.max(
    1,
    Math.min(255, Math.trunc(stripRows) || DEFAULT_STRIP_ROWS),
  );

  const chunks: Uint8Array[] = [];
  for (let top = 0; top < bitmap.height; top += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, bitmap.height - top);
    chunks.push(header(widthBytes, rows));
    chunks.push(
      bitmap.data.subarray(top * widthBytes, (top + rows) * widthBytes),
    );
  }
  return concatBytes(...chunks);
}

/**
 * Feed paper with blank raster rows.
 *
 * `GS v 0` advances one dot row per declared bitmap row, even when every dot
 * is white. `widthDots` should normally be the job width, which keeps the
 * blank image aligned with the real raster and avoids relying on a narrow
 * strip implementation. A zero-row request emits nothing.
 */
export function blankFeed(rows: number, widthDots = 8): Uint8Array {
  const count = Math.max(0, Math.min(255, Math.trunc(rows) || 0));
  if (count === 0) return new Uint8Array(0);
  const width = Math.max(8, Math.min(4096, Math.trunc(widthDots) || 8));
  return rasterCommand({
    width,
    height: count,
    data: new Uint8Array(Math.ceil(width / 8) * count),
  });
}

export interface PrintPayloadOptions {
  feedRows?: number;
  stripRows?: number;
}

/**
 * One complete job: reset → raster strips → blank raster feed. There is
 * deliberately no cut command (the PT-210 has no cutter) and no `ESC d`.
 */
export function buildPrintPayload(
  bitmap: RasterBitmap,
  options: PrintPayloadOptions = {},
): Uint8Array {
  return concatBytes(
    initCommand(),
    rasterCommand(bitmap, options.stripRows ?? DEFAULT_STRIP_ROWS),
    blankFeed(options.feedRows ?? DEFAULT_FEED_ROWS, bitmap.width),
  );
}
