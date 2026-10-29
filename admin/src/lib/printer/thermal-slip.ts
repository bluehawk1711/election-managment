/**
 * 58 mm thermal slip renderer.
 *
 * 384 dots wide at 203 dpi (48 mm printable). Everything is drawn to a canvas
 * and thresholded to 1 bit; no ESC/POS font command is used, because the
 * printer's built-in fonts cannot shape Devanagari.
 *
 * The layout is the flat reference mock: four short cut dashes above a dashed
 * rectangle, then nine `label : value` rows inside it —
 *
 *   वार्ड नंबर / मतदाता क्रम नंबर / नाम / आई कार्ड / व्यवसाय / लिंग /
 *   संबंधित नाम / बूथ नंबर / बूथ
 *
 * `व्यवसाय` is deliberately printed blank: the roll carries no occupation
 * field and the mock shows the label with an empty value. The mock has no
 * badge, title, photo, EPIC/booth boxes, footer or date/time, so none of them
 * are drawn — `VoterSlipData` still carries those fields for the HTML slip and
 * the WhatsApp message, which this renderer simply ignores.
 *
 * The renderer is browser-only (canvas, fonts). Layout math is delegated to
 * `wrapText` so the wrapping rules stay unit-testable.
 */
import type { VoterSlipData } from "@/lib/roll/slip";
import { DEFAULT_FEED_ROWS } from "./escpos";
import { rgbaToBitmap, type RasterBitmap } from "./raster";
import { wrapText } from "./text";

export const THERMAL_WIDTH_DOTS = 384;
const MARGIN = 14;
const CONTENT_WIDTH = THERMAL_WIDTH_DOTS - MARGIN * 2;
const MAX_HEIGHT = 2400;

/** Uniform row typography — the mock has no label/value weight contrast. */
const ROW_FONT_PX = 15;
const ROW_LINE_HEIGHT = 21;
const BOX_PAD_X = 10;
const BOX_PAD_Y = 9;
/** Cut marks sit above the box; the box starts below them. */
const CUT_MARK_Y = 10;
const BOX_TOP = 26;
const BOX_BOTTOM_GAP = 10;

const FALLBACK_FONT =
  "'Noto Sans Devanagari', 'Mangal', 'Nirmala UI', sans-serif";

export interface ThermalSlipOptions {
  /**
   * The रंगदर्शक label. Accepted so callers keep compiling, but NOT printed:
   * the reference layout has no colour/rank line.
   */
  rangLabel?: string;
  feedRows?: number;
  /** Luminance cutoff for text. Default 180. */
  threshold?: number;
}

export interface ThermalSlipRender {
  /** PNG data URL for the in-modal preview. Never persisted or logged. */
  dataUrl: string;
  bitmap: RasterBitmap;
  width: number;
  height: number;
  feedRows: number;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  return context;
}

function resolveFontFamily(): string {
  if (typeof document === "undefined") return FALLBACK_FONT;
  try {
    // next/font puts the CSS variable on <body> (see app/layout.tsx), and CSS
    // custom properties do not inherit upward from body to html.
    const host = document.body ?? document.documentElement;
    const value = getComputedStyle(host)
      .getPropertyValue("--font-devanagari")
      .trim();
    return value || FALLBACK_FONT;
  } catch {
    return FALLBACK_FONT;
  }
}

async function waitForFonts(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const sample = "मतदाता पर्ची 0123456789";
  try {
    await Promise.all([
      document.fonts.load(`400 ${ROW_FONT_PX}px ${family}`, sample),
      document.fonts.load(`700 20px ${family}`, sample),
    ]);
    await document.fonts.ready;
  } catch {
    // A font failure falls through to the system fallback; never block print.
  }
}

function setFont(
  context: CanvasRenderingContext2D,
  family: string,
  weight: number,
  size: number,
): void {
  context.font = `${weight} ${size}px ${family}`;
}

function lineCount(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  return wrapText(text, maxWidth, (value) => context.measureText(value).width);
}

function drawLines(
  context: CanvasRenderingContext2D,
  lines: readonly string[],
  x: number,
  y: number,
  lineHeight: number,
  align: CanvasTextAlign = "left",
): number {
  context.textAlign = align;
  let cursor = y;
  for (const line of lines) {
    context.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  context.textAlign = "left";
  return cursor;
}

/** The dashed rectangle the reference mock draws around every slip. */
function dashedBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.restore();
}

/**
 * Four short dashes, centred above the box — the mock's cut/tear mark.
 * 46 dots wide with a 7-on/5-off pattern lands exactly four dashes.
 */
function cutMarks(context: CanvasRenderingContext2D, y: number): void {
  const width = 46;
  const x0 = (THERMAL_WIDTH_DOTS - width) / 2;
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.setLineDash([7, 5]);
  context.beginPath();
  context.moveTo(x0, y + 0.5);
  context.lineTo(x0 + width, y + 0.5);
  context.stroke();
  context.restore();
}

/**
 * The nine `label : value` rows of the reference mock, in order.
 *
 * `व्यवसाय` is always blank (the roll carries no occupation field) and the
 * line is still printed, exactly as the mock shows it. Kept separate from the
 * canvas so the contract is unit-testable without a DOM.
 */
export function thermalSlipRows(data: VoterSlipData): string[] {
  return [
    `वार्ड नंबर : ${data.voter.wardSerial}`,
    `मतदाता क्रम नंबर : ${data.voter.voterSerial}`,
    `नाम : ${data.voter.name}`,
    `आई कार्ड : ${data.voter.epic}`,
    "व्यवसाय :",
    `लिंग : ${data.voter.gender}`,
    `संबंधित नाम : ${data.voter.fatherName}`,
    `बूथ नंबर : ${data.booth.number}`,
    `बूथ : ${data.booth.name}`,
  ];
}

/**
 * Render one voter slip. The returned bitmap includes the cut marks, the
 * dashed box and all rows, but not the feed rows; `feedRows` is returned so
 * the caller can pass it to the ESC/POS payload builder.
 */
export async function renderThermalSlip(
  data: VoterSlipData,
  options: ThermalSlipOptions = {},
): Promise<ThermalSlipRender> {
  if (typeof document === "undefined") {
    throw new Error("Thermal slip rendering requires a browser document");
  }

  const family = resolveFontFamily();
  await waitForFonts(family);

  const canvas = canvasOf(THERMAL_WIDTH_DOTS, MAX_HEIGHT);
  const context = contextOf(canvas);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, THERMAL_WIDTH_DOTS, MAX_HEIGHT);
  context.fillStyle = "#000";
  context.textBaseline = "top";

  // The nine rows of the reference mock, in order.
  setFont(context, family, 400, ROW_FONT_PX);
  const rows = thermalSlipRows(data);
  // A row that measures wider than the box wraps; continuation lines stay
  // flush left exactly like the mock's second बूथ line.
  const lines = rows.flatMap((row) =>
    lineCount(context, row, CONTENT_WIDTH - BOX_PAD_X * 2),
  );

  const boxHeight = lines.length * ROW_LINE_HEIGHT + BOX_PAD_Y * 2;
  const height = Math.ceil(BOX_TOP + boxHeight + BOX_BOTTOM_GAP);
  if (height > MAX_HEIGHT) {
    throw new Error("Thermal slip is taller than the render canvas");
  }

  cutMarks(context, CUT_MARK_Y);
  dashedBox(context, MARGIN, BOX_TOP, CONTENT_WIDTH, boxHeight);
  drawLines(
    context,
    lines,
    MARGIN + BOX_PAD_X,
    BOX_TOP + BOX_PAD_Y,
    ROW_LINE_HEIGHT,
  );

  const output = canvasOf(THERMAL_WIDTH_DOTS, height);
  const outputContext = contextOf(output);
  outputContext.fillStyle = "#fff";
  outputContext.fillRect(0, 0, THERMAL_WIDTH_DOTS, height);
  outputContext.drawImage(
    canvas,
    0,
    0,
    THERMAL_WIDTH_DOTS,
    height,
    0,
    0,
    THERMAL_WIDTH_DOTS,
    height,
  );

  const pixels = outputContext.getImageData(
    0,
    0,
    THERMAL_WIDTH_DOTS,
    height,
  );
  const bitmap = rgbaToBitmap(pixels, {
    threshold: options.threshold ?? 180,
    mode: "threshold",
  });

  return {
    dataUrl: output.toDataURL("image/png"),
    bitmap,
    width: THERMAL_WIDTH_DOTS,
    height,
    feedRows: options.feedRows ?? DEFAULT_FEED_ROWS,
  };
}
