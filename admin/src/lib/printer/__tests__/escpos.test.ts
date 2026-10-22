import { describe, expect, it } from "vitest";
import {
  blankFeed,
  buildPrintPayload,
  concatBytes,
  DEFAULT_FEED_ROWS,
  initCommand,
  rasterCommand,
  statusQuery,
} from "../escpos";
import type { RasterBitmap } from "../raster";

function blankBitmap(width: number, height: number): RasterBitmap {
  return {
    width,
    height,
    data: new Uint8Array(Math.ceil(width / 8) * height),
  };
}

describe("ESC/POS commands", () => {
  it("initialises with the standard bytes", () => {
    expect(Array.from(initCommand())).toEqual([0x1b, 0x40]);
  });

  it("builds real-time status requests for n=1..4", () => {
    expect(Array.from(statusQuery(1))).toEqual([0x10, 0x04, 1]);
    expect(Array.from(statusQuery(4))).toEqual([0x10, 0x04, 4]);
  });

  it("concatenates without mutating the inputs", () => {
    const left = Uint8Array.from([1, 2]);
    const right = Uint8Array.from([3]);
    expect(Array.from(concatBytes(left, right))).toEqual([1, 2, 3]);
    expect(Array.from(left)).toEqual([1, 2]);
    expect(Array.from(right)).toEqual([3]);
  });
});

describe("GS v 0 raster", () => {
  it("writes a one-row, one-byte image with an MSB-first pixel", () => {
    const command = rasterCommand({
      width: 8,
      height: 1,
      data: Uint8Array.from([0x80]),
    });
    expect(Array.from(command)).toEqual([
      0x1d, 0x76, 0x30, 0x00, // GS v 0 0
      0x01, 0x00, // width bytes = 1
      0x01, 0x00, // height = 1
      0x80,
    ]);
  });

  it("repeats the header for every 24-row strip", () => {
    const command = rasterCommand(blankBitmap(384, 25), 24);
    expect(command.length).toBe(8 + 48 * 24 + 8 + 48);
    expect(Array.from(command.slice(0, 8))).toEqual([
      0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0x18, 0x00,
    ]);
    expect(Array.from(command.slice(8 + 48 * 24, 8 + 48 * 24 + 8))).toEqual([
      0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0x01, 0x00,
    ]);
  });

  it("encodes width and height little-endian", () => {
    const command = rasterCommand(blankBitmap(16, 260), 255);
    // First strip is capped at 255 rows, so the header says 0x00ff.
    expect(Array.from(command.slice(4, 8))).toEqual([0x02, 0x00, 0xff, 0x00]);
    const secondHeader = 8 + 2 * 255;
    expect(Array.from(command.slice(secondHeader + 4, secondHeader + 8))).toEqual(
      [0x02, 0x00, 0x05, 0x00],
    );
  });

  it("rejects an undersized buffer", () => {
    expect(() =>
      rasterCommand({ width: 8, height: 2, data: Uint8Array.from([0]) }),
    ).toThrow(RangeError);
    expect(() =>
      rasterCommand({ width: 0, height: 1, data: new Uint8Array() }),
    ).toThrow(RangeError);
  });
});

describe("blank-raster feed", () => {
  it("advances by printing white raster rows", () => {
    const feed = blankFeed(4, 8);
    expect(Array.from(feed)).toEqual([
      0x1d, 0x76, 0x30, 0x00, // GS v 0 0
      0x01, 0x00, // width bytes = 1
      0x04, 0x00, // height = 4 rows
      0, 0, 0, 0,
    ]);
  });

  it("uses the full job width when asked", () => {
    const feed = blankFeed(2, 384);
    expect(Array.from(feed.slice(4, 8))).toEqual([0x30, 0x00, 0x02, 0x00]);
    expect(feed.length).toBe(8 + 48 * 2);
  });

  it("emits nothing for zero rows", () => {
    expect(blankFeed(0).length).toBe(0);
    expect(blankFeed(-3).length).toBe(0);
  });

  it("splits the default feed into 24-row strips", () => {
    const feed = blankFeed(DEFAULT_FEED_ROWS, 8);
    // 80 rows = 24 + 24 + 24 + 8, each with an 8-byte header.
    expect(feed.length).toBe(4 * 8 + 80);
  });
});

describe("print payload", () => {
  it("builds init → raster → blank feed and never uses ESC d", () => {
    const payload = buildPrintPayload(blankBitmap(8, 1), { feedRows: 4 });

    expect(Array.from(payload.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(payload[2]).toBe(0x1d);
    expect(payload[3]).toBe(0x76);
    expect(Array.from(payload.slice(-12))).toEqual([
      0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x04, 0x00, 0, 0, 0, 0,
    ]);

    for (let index = 0; index < payload.length - 1; index += 1) {
      expect(
        payload[index] === 0x1b && payload[index + 1] === 0x64,
        `unexpected ESC d at byte ${index}`,
      ).toBe(false);
    }
  });

  it("can omit the feed for a caller that supplies its own", () => {
    const payload = buildPrintPayload(blankBitmap(8, 1), { feedRows: 0 });
    expect(payload.length).toBe(2 + 9);
  });
});
