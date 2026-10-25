import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHEET_LAYOUT,
  loadSheetLayout,
  parseSheetLayout,
  presetsForPaper,
  SHEET_LAYOUT_PRESETS,
  SHEET_MARGIN_MM,
  sheetLayoutFor,
  sheetMetrics,
} from "../sheet-layout";

describe("sheetMetrics", () => {
  it("keeps the classic A4 2 × 6 budget at the reduced margin", () => {
    const metrics = sheetMetrics({ paper: "A4", cols: 2, rows: 6 });
    // The old border complaint started at the stylesheet's own 10mm.
    expect(SHEET_MARGIN_MM).toBeLessThan(10);
    expect(metrics.pageWidth).toBe(198);
    expect(metrics.pageHeight).toBe(285);
    expect(metrics.cellWidth).toBeCloseTo(98, 3);
    expect(metrics.cellHeight).toBeCloseTo(45.833, 3);
    expect(metrics.perPage).toBe(12);
    // Both cell dimensions still clear the 94 × 44.3mm design box.
    expect(metrics.scale).toBeGreaterThanOrEqual(1);
  });

  it("fits a 3 × 7 A4 grid inside the printable box", () => {
    const metrics = sheetMetrics({ paper: "A4", cols: 3, rows: 7 });
    expect(metrics.perPage).toBe(21);
    expect(metrics.cellWidth * 3 + 2 * 2).toBeLessThanOrEqual(metrics.pageWidth);
    expect(metrics.cellHeight * 7 + 2 * 6).toBeLessThanOrEqual(
      metrics.pageHeight,
    );
    // Denser than the design size, so the compact slip scales down.
    expect(metrics.scale).toBeLessThan(1);
  });

  it("gives bigger cells (and therefore bigger slips) on A3", () => {
    const a3 = sheetMetrics({ paper: "A3", cols: 2, rows: 5 });
    const a4 = sheetMetrics({ paper: "A4", cols: 2, rows: 5 });
    expect(a3.pageHeight).toBe(408);
    expect(a3.scale).toBeGreaterThan(a4.scale);
  });
});

describe("presets and lookup", () => {
  it("offers every requested grid on A4", () => {
    const offered = presetsForPaper("A4").map((p) => `${p.cols}x${p.rows}`);
    for (const combo of ["2x5", "3x5", "3x4", "2x4", "3x7", "2x6"]) {
      expect(offered).toContain(combo);
    }
  });

  it("falls back to the paper default for a grid it does not offer", () => {
    expect(sheetLayoutFor("A4", 4, 9)).toEqual({
      paper: "A4",
      cols: 2,
      rows: 6,
    });
    expect(sheetLayoutFor("A3", 4, 9)).toEqual({
      paper: "A3",
      cols: 3,
      rows: 7,
    });
    // …but keeps a preset that exists on the target paper.
    expect(sheetLayoutFor("A3", 3, 7)).toEqual({
      paper: "A3",
      cols: 3,
      rows: 7,
    });
  });

  it("keeps presets unique per paper", () => {
    const keys = SHEET_LAYOUT_PRESETS.map(
      (p) => `${p.paper}:${p.cols}x${p.rows}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("saved layout parsing", () => {
  it("defaults on empty, corrupt or stale payloads", () => {
    expect(parseSheetLayout(null)).toEqual(DEFAULT_SHEET_LAYOUT);
    expect(parseSheetLayout("{oops")).toEqual(DEFAULT_SHEET_LAYOUT);
    expect(
      parseSheetLayout(JSON.stringify({ paper: "A5", cols: 2, rows: 6 })),
    ).toEqual(DEFAULT_SHEET_LAYOUT);
    expect(
      parseSheetLayout(JSON.stringify({ paper: "A4", cols: 9, rows: 9 })),
    ).toEqual(DEFAULT_SHEET_LAYOUT);
  });

  it("round-trips a stored preset", () => {
    const layout = { paper: "A3", cols: 3, rows: 8 } as const;
    expect(parseSheetLayout(JSON.stringify(layout))).toEqual(layout);
  });

  it("returns the default where localStorage does not exist (node/SSR)", () => {
    expect(loadSheetLayout()).toEqual(DEFAULT_SHEET_LAYOUT);
  });
});
