import { describe, expect, it } from "vitest";
import { ditherImageData, rgbaToBitmap } from "../raster";

function rgba(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { width, height, data };
}

describe("rgbaToBitmap", () => {
  it("turns white paper into zero bits", () => {
    const bitmap = rgbaToBitmap(
      rgba(8, 2, () => [255, 255, 255, 255]),
    );
    expect(Array.from(bitmap.data)).toEqual([0, 0]);
  });

  it("packs the first black pixel as the high bit", () => {
    const bitmap = rgbaToBitmap(
      rgba(8, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
    );
    expect(Array.from(bitmap.data)).toEqual([0x80]);
  });

  it("treats transparent pixels as paper-white", () => {
    const bitmap = rgbaToBitmap(rgba(8, 1, () => [0, 0, 0, 0]));
    expect(Array.from(bitmap.data)).toEqual([0]);
  });

  it("pads rows wider than eight pixels without bleeding", () => {
    const bitmap = rgbaToBitmap(
      rgba(9, 2, (x, y) =>
        x === 8 && y === 1 ? [0, 0, 0, 255] : [255, 255, 255, 255],
      ),
    );
    expect(bitmap.data.length).toBe(4);
    expect(Array.from(bitmap.data)).toEqual([0, 0, 0, 0x80]);
  });

  it("honours the luminance threshold", () => {
    const grey = rgba(1, 1, () => [120, 120, 120, 255]);
    expect(
      Array.from(rgbaToBitmap(grey, { threshold: 170 }).data),
    ).toEqual([0x80]);
    expect(
      Array.from(rgbaToBitmap(grey, { threshold: 100 }).data),
    ).toEqual([0]);
  });

  it("ordered-dithers a mid grey instead of flattening it", () => {
    const grey = rgba(16, 16, () => [128, 128, 128, 255]);
    const bitmap = rgbaToBitmap(grey, { mode: "bayer", threshold: 128 });
    const black = Array.from(bitmap.data).reduce((total, byte) => {
      let count = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        if (byte & (1 << bit)) count += 1;
      }
      return total + count;
    }, 0);
    expect(black).toBeGreaterThan(0);
    expect(black).toBeLessThan(16 * 16);
  });

  it("rejects malformed pixel buffers", () => {
    expect(() =>
      rgbaToBitmap({ width: 8, height: 1, data: new Uint8ClampedArray(4) }),
    ).toThrow(RangeError);
  });
});

describe("ditherImageData", () => {
  it("converts a flat grey field to both black and white, with opaque alpha", () => {
    const image = rgba(16, 16, () => [120, 120, 120, 255]);
    ditherImageData(image, 128);

    const values = new Set<number>();
    for (let index = 0; index < 16 * 16; index += 1) {
      const offset = index * 4;
      expect(image.data[offset + 3]).toBe(255);
      expect(image.data[offset]).toBe(image.data[offset + 1]);
      expect(image.data[offset]).toBe(image.data[offset + 2]);
      values.add(image.data[offset]);
    }
    expect(values.has(0)).toBe(true);
    expect(values.has(255)).toBe(true);
  });
});
