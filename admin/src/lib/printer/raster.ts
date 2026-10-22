/**
 * RGBA canvas pixels → the 1-bit, MSB-first bitmap a thermal printer eats.
 *
 * The printer has exactly two tones, so anti-aliased canvas text must be
 * thresholded. Photographs are different: a hard threshold turns a portrait
 * into a black blob, so the thermal slip pre-dithers the photo region with
 * Floyd–Steinberg before it is drawn, while text keeps a crisp threshold.
 * `mode: "bayer"` is available for callers that want an ordered dither.
 */

export interface RasterBitmap {
  width: number;
  height: number;
  /** Row-major, `ceil(width / 8)` bytes per row, MSB = leftmost dot. */
  data: Uint8Array;
}

export interface RgbaImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type RasterMode = "threshold" | "bayer";

export interface RasterizeOptions {
  /** Luminance below this becomes black. Default 170 for text. */
  threshold?: number;
  /**
   * `threshold` keeps anti-aliased text crisp; `bayer` approximates
   * mid-tones and is useful for graphics. Photos should be pre-dithered.
   */
  mode?: RasterMode;
}

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
] as const;

function assertImage(image: RgbaImageLike): void {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new RangeError("Image needs positive integer dimensions");
  }
  if (image.data.length < image.width * image.height * 4) {
    throw new RangeError("RGBA data is shorter than the image dimensions");
  }
}

/** Composite one RGBA pixel onto white, then convert to luminance. */
function luminanceAt(
  data: Uint8ClampedArray | Uint8Array,
  offset: number,
): number {
  const alpha = data[offset + 3] / 255;
  const raw =
    data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  // Transparent pixels are paper-white, not black.
  return raw * alpha + 255 * (1 - alpha);
}

/**
 * Convert RGBA pixels to a packed bitmap.
 *
 * Rows are padded to a byte boundary with zero bits (white), so a 9px-wide
 * image uses two bytes per row and the unused seven bits stay off.
 */
export function rgbaToBitmap(
  image: RgbaImageLike,
  options: RasterizeOptions = {},
): RasterBitmap {
  assertImage(image);
  const threshold = Math.max(0, Math.min(255, options.threshold ?? 170));
  const mode = options.mode ?? "threshold";
  const bytesPerRow = Math.ceil(image.width / 8);
  const output = new Uint8Array(bytesPerRow * image.height);
  const cutoffScale = threshold / 128;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const luminance = luminanceAt(image.data, offset);
      let black: boolean;

      if (mode === "bayer") {
        const ordered =
          (BAYER_4X4[(y & 3) * 4 + (x & 3)] + 0.5) * 16 * cutoffScale;
        black = luminance < ordered;
      } else {
        black = luminance < threshold;
      }

      if (black) {
        output[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return { width: image.width, height: image.height, data: output };
}

/**
 * Floyd–Steinberg dithering, in place, on RGBA pixels.
 *
 * Used only for the portrait region before it is drawn onto the slip. The
 * error buffer is kept separate from the pixel values so already-visited
 * neighbours do not corrupt the diffusion.
 */
export function ditherImageData(
  image: RgbaImageLike,
  threshold = 128,
): void {
  assertImage(image);
  const { width, height, data } = image;
  const limit = Math.max(0, Math.min(255, threshold));
  const luminance = new Float32Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    luminance[index] = luminanceAt(data, index * 4);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const oldValue = luminance[index];
      const newValue = oldValue < limit ? 0 : 255;
      const error = oldValue - newValue;
      luminance[index] = newValue;

      if (x + 1 < width) luminance[index + 1] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) luminance[index + width - 1] += (error * 3) / 16;
        luminance[index + width] += (error * 5) / 16;
        if (x + 1 < width) luminance[index + width + 1] += error / 16;
      }
    }
  }

  for (let index = 0; index < width * height; index += 1) {
    const value = luminance[index] < 128 ? 0 : 255;
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
}
