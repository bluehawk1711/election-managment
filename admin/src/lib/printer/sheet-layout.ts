/**
 * Sheet layout for batch voter-slip printing.
 *
 * The build used to hard-code 2 × 6 on A4 and pin `@page { size: A4;
 * margin: 10mm }` — so picking A3 in the print dialog centred the A4 block
 * in the middle of a much larger sheet (the giant borders operators saw),
 * and no other grid (2 × 4, 3 × 5, 3 × 7, …) was possible at all.
 *
 * This module owns the numbers behind the picker in `VoterSlipsBatchModal`:
 * paper, columns × rows, and the resulting cell metrics. The modal sets
 * `--slip-sheet-*` / `--slip-scale` custom properties from `sheetMetrics()`
 * and injects an `@page` rule for the chosen paper, so screen preview,
 * pagination and print share one source of truth.
 */

export type SheetPaper = "A4" | "A3";

export interface SlipSheetLayout {
  readonly paper: SheetPaper;
  /** Slips across the sheet. */
  readonly cols: number;
  /** Slips down the sheet. */
  readonly rows: number;
}

/** Paper sizes in mm, portrait. */
const PAPER_MM: Record<SheetPaper, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
};

/**
 * The margin the batch dialog injects into `@page`. The old stylesheet used
 * 10mm on top of every printer's own ~4-5mm unprintable band, which read as
 * wasted paper; 6mm still clears the hardware band on typical laser/inkjet
 * printers while giving the grid most of the sheet.
 */
export const SHEET_MARGIN_MM = 6;

/** Gutter between cells, on both axes. */
export const SHEET_GUTTER_MM = 2;

/** The compact slip's design box: 2 × 6 on A4 at the old 10mm margin. */
const BASE_CELL_MM = { width: 94, height: 44.3 };

/**
 * Grids offered in the picker. Every entry must be physically plausible for
 * its paper — the metrics below are what the preview and print actually get.
 */
export const SHEET_LAYOUT_PRESETS: readonly SlipSheetLayout[] = [
  { paper: "A4", cols: 2, rows: 4 },
  { paper: "A4", cols: 2, rows: 5 },
  { paper: "A4", cols: 2, rows: 6 },
  { paper: "A4", cols: 3, rows: 4 },
  { paper: "A4", cols: 3, rows: 5 },
  { paper: "A4", cols: 3, rows: 6 },
  { paper: "A4", cols: 3, rows: 7 },
  { paper: "A3", cols: 2, rows: 5 },
  { paper: "A3", cols: 2, rows: 6 },
  { paper: "A3", cols: 3, rows: 7 },
  { paper: "A3", cols: 3, rows: 8 },
  { paper: "A3", cols: 3, rows: 9 },
];

export function defaultSheetLayout(paper: SheetPaper): SlipSheetLayout {
  return paper === "A3"
    ? { paper, cols: 3, rows: 7 }
    : { paper, cols: 2, rows: 6 };
}

export const DEFAULT_SHEET_LAYOUT: SlipSheetLayout = defaultSheetLayout("A4");

export function presetsForPaper(paper: SheetPaper): SlipSheetLayout[] {
  return SHEET_LAYOUT_PRESETS.filter((preset) => preset.paper === paper);
}

/**
 * Resolve (paper, cols, rows) to a real preset — falling back to that
 * paper's default so switching papers can never select a grid the picker
 * does not offer.
 */
export function sheetLayoutFor(
  paper: SheetPaper,
  cols: number,
  rows: number,
): SlipSheetLayout {
  return (
    presetsForPaper(paper).find(
      (preset) => preset.cols === cols && preset.rows === rows,
    ) ?? defaultSheetLayout(paper)
  );
}

export interface SheetMetrics {
  /** Printable box = paper − 2 × margin; what `@page` exposes. */
  pageWidth: number;
  pageHeight: number;
  cellWidth: number;
  cellHeight: number;
  /** Slips per sheet. */
  perPage: number;
  /**
   * Uniform scale for the compact slip inside one cell: the better fit of
   * width and height against the 94 × 44.3mm design box. It is multiplied
   * into every font-size and dimension via `calc()`, so text grows on A3
   * and shrinks on 3 × 7 while staying vector-sharp — never `transform`,
   * which would blur print output and break pagination.
   */
  scale: number;
}

export function sheetMetrics(layout: SlipSheetLayout): SheetMetrics {
  const paper = PAPER_MM[layout.paper];
  const pageWidth = paper.width - SHEET_MARGIN_MM * 2;
  const pageHeight = paper.height - SHEET_MARGIN_MM * 2;
  const cellWidth =
    (pageWidth - SHEET_GUTTER_MM * (layout.cols - 1)) / layout.cols;
  const cellHeight =
    (pageHeight - SHEET_GUTTER_MM * (layout.rows - 1)) / layout.rows;
  const scale = Math.min(
    cellWidth / BASE_CELL_MM.width,
    cellHeight / BASE_CELL_MM.height,
  );
  return {
    pageWidth,
    pageHeight,
    cellWidth,
    cellHeight,
    perPage: layout.cols * layout.rows,
    scale,
  };
}

/* ------------------------------- saved pick ------------------------------- */

const STORAGE_KEY = "slip.batch.sheetLayout";

/** Pure: parse a stored payload; anything stale or corrupt → the default. */
export function parseSheetLayout(
  raw: string | null | undefined,
): SlipSheetLayout {
  if (!raw) return DEFAULT_SHEET_LAYOUT;
  try {
    const parsed = JSON.parse(raw) as Partial<SlipSheetLayout>;
    if (parsed.paper !== "A4" && parsed.paper !== "A3") {
      return DEFAULT_SHEET_LAYOUT;
    }
    return sheetLayoutFor(parsed.paper, Number(parsed.cols), Number(parsed.rows));
  } catch {
    return DEFAULT_SHEET_LAYOUT;
  }
}

/**
 * A manager printing forty sheets from one laptop should not re-pick the
 * grid every time — same promise as the saved रंगदर्शक colour.
 */
export function loadSheetLayout(): SlipSheetLayout {
  if (typeof window === "undefined") return DEFAULT_SHEET_LAYOUT;
  try {
    return parseSheetLayout(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SHEET_LAYOUT;
  }
}

export function saveSheetLayout(layout: SlipSheetLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage unavailable (private mode) — the pick then lives for this
    // dialog only, which is a degraded but correct outcome.
  }
}
