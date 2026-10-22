/**
 * 58 mm thermal slip renderer.
 *
 * 384 dots wide at 203 dpi (48 mm printable). Everything is drawn to a canvas
 * and thresholded to 1 bit; no ESC/POS font command is used, because the
 * printer's built-in fonts cannot shape Devanagari.
 *
 * The renderer is browser-only (canvas, image decoding, fonts). Layout math is
 * delegated to `wrapText` so the wrapping rules stay unit-testable.
 */
import type { VoterSlipData } from "@/lib/roll/slip";
import { DEFAULT_FEED_ROWS } from "./escpos";
import { ditherImageData, rgbaToBitmap, type RasterBitmap } from "./raster";
import { wrapText } from "./text";

export const THERMAL_WIDTH_DOTS = 384;
const MARGIN = 14;
const CONTENT_WIDTH = THERMAL_WIDTH_DOTS - MARGIN * 2;
const MAX_HEIGHT = 2400;
const PHOTO_WIDTH = 104;
const PHOTO_HEIGHT = 126;
const PHOTO_GAP = 10;

const FALLBACK_FONT =
  "'Noto Sans Devanagari', 'Mangal', 'Nirmala UI', sans-serif";

export interface ThermalSlipOptions {
  /** The रंगदर्शक label, printed as text because thermal paper is monochrome. */
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
  photoIncluded: boolean;
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
      document.fonts.load(`400 14px ${family}`, sample),
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

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, height / 2, width / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function dashedRule(
  context: CanvasRenderingContext2D,
  y: number,
): void {
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.setLineDash([5, 4]);
  context.beginPath();
  context.moveTo(MARGIN, y + 0.5);
  context.lineTo(THERMAL_WIDTH_DOTS - MARGIN, y + 0.5);
  context.stroke();
  context.restore();
}

function loadPhoto(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 4500);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

/**
 * Cover-fit the portrait into the photo box, then Floyd–Steinberg dither it.
 * Drawing an already 1-bit image keeps the final text threshold crisp.
 */
function ditheredPhoto(
  image: HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
  const canvas = canvasOf(width, height);
  const context = contextOf(canvas);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  try {
    const pixels = context.getImageData(0, 0, width, height);
    ditherImageData(pixels, 138);
    context.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    // Cross-origin taint: a photo is optional, the slip is not.
    return null;
  }
}

function drawPhotoBox(
  context: CanvasRenderingContext2D,
  family: string,
  x: number,
  y: number,
  photo: HTMLCanvasElement | null,
): void {
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, PHOTO_WIDTH - 1, PHOTO_HEIGHT - 1);
  if (photo) {
    context.drawImage(photo, x + 2, y + 2, PHOTO_WIDTH - 4, PHOTO_HEIGHT - 4);
  } else {
    context.setLineDash([4, 3]);
    context.strokeRect(x + 6.5, y + 6.5, PHOTO_WIDTH - 13, PHOTO_HEIGHT - 13);
    context.setLineDash([]);
    setFont(context, family, 400, 11);
    context.fillStyle = "#000";
    context.textAlign = "center";
    context.fillText("फोटो", x + PHOTO_WIDTH / 2, y + PHOTO_HEIGHT / 2 - 6);
  }
  context.restore();
}

/**
 * Render one voter slip. The returned bitmap includes all text/rules/photo but
 * not the feed rows; `feedRows` is returned so the caller can pass it to the
 * ESC/POS payload builder.
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

  const wantsPhoto = Boolean(data.voter.photoUrl);
  const photo = wantsPhoto
    ? await loadPhoto(data.voter.photoUrl as string)
    : null;
  const preparedPhoto = photo
    ? ditheredPhoto(photo, PHOTO_WIDTH, PHOTO_HEIGHT)
    : null;

  const canvas = canvasOf(THERMAL_WIDTH_DOTS, MAX_HEIGHT);
  const context = contextOf(canvas);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, THERMAL_WIDTH_DOTS, MAX_HEIGHT);
  context.fillStyle = "#000";
  context.textBaseline = "top";

  let y = 10;

  // Badge.
  const badgeText = data.badgeText ?? "मतदाता सूचना पर्ची";
  setFont(context, family, 700, 11);
  const badgeWidth = Math.min(
    CONTENT_WIDTH,
    Math.ceil(context.measureText(badgeText).width) + 24,
  );
  const badgeX = (THERMAL_WIDTH_DOTS - badgeWidth) / 2;
  context.fillStyle = "#000";
  roundedRect(context, badgeX, y, badgeWidth, 21, 10.5);
  context.fill();
  context.fillStyle = "#fff";
  setFont(context, family, 700, 11);
  context.textAlign = "center";
  context.fillText(badgeText, THERMAL_WIDTH_DOTS / 2, y + 5);
  context.textAlign = "left";
  context.fillStyle = "#000";
  y += 29;

  // Title.
  setFont(context, family, 700, 20);
  const titleLines = lineCount(context, data.title, CONTENT_WIDTH);
  y = drawLines(
    context,
    titleLines,
    THERMAL_WIDTH_DOTS / 2,
    y,
    26,
    "center",
  );
  y += 4;
  dashedRule(context, y);
  y += 10;

  // Roll / ward / colour label. Both sides wrap so a long ward name cannot
  // overlap the roll label; the row grows to the taller side.
  const rightText = [
    data.wardLabel,
    options.rangLabel ? `रंग: ${options.rangLabel}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  setFont(context, family, 600, 11);
  const rightLines = rightText ? lineCount(context, rightText, 150) : [];
  const rightWidth = rightLines.reduce(
    (width, line) => Math.max(width, context.measureText(line).width),
    0,
  );
  const leftWidth = Math.max(90, CONTENT_WIDTH - rightWidth - 8);
  const rollTop = y;
  const leftLines = data.rollLabel
    ? lineCount(context, data.rollLabel, leftWidth)
    : [];
  const leftBottom = drawLines(context, leftLines, MARGIN, y, 15);
  const rightBottom = rightLines.length
    ? drawLines(
        context,
        rightLines,
        THERMAL_WIDTH_DOTS - MARGIN,
        rollTop,
        15,
        "right",
      )
    : rollTop;
  y = Math.max(leftBottom, rightBottom) + 8;

  // Voter name + photo.
  const blockTop = y;
  const textWidth = wantsPhoto
    ? CONTENT_WIDTH - PHOTO_WIDTH - PHOTO_GAP
    : CONTENT_WIDTH;
  const photoX = THERMAL_WIDTH_DOTS - MARGIN - PHOTO_WIDTH;

  if (wantsPhoto) {
    drawPhotoBox(context, family, photoX, blockTop, preparedPhoto);
    if (data.voter.serialNo !== undefined) {
      setFont(context, family, 500, 10);
      context.textAlign = "center";
      context.fillText(
        `क्र. सं. ${data.voter.serialNo}`,
        photoX + PHOTO_WIDTH / 2,
        blockTop + PHOTO_HEIGHT + 4,
      );
      context.textAlign = "left";
    }
  }

  setFont(context, family, 600, 11);
  context.fillText("नाम (Name)", MARGIN, y);
  y += 14;

  setFont(context, family, 700, 23);
  const nameLines = lineCount(context, data.voter.name, textWidth);
  y = drawLines(context, nameLines, MARGIN, y, 28);

  if (data.nameEn) {
    setFont(context, family, 400, 12);
    const englishLines = lineCount(context, data.nameEn, textWidth);
    y = drawLines(context, englishLines, MARGIN, y, 15);
  }

  y += 4;
  setFont(context, family, 600, 11);
  context.fillText(
    `${data.voter.relationLabel?.trim() || "पिता"} का नाम:`,
    MARGIN,
    y,
  );
  y += 14;
  setFont(context, family, 400, 15);
  const fatherLines = lineCount(context, data.voter.fatherName, textWidth);
  y = drawLines(context, fatherLines, MARGIN, y, 20);

  y += 5;
  setFont(context, family, 600, 13);
  const wardLine = `वार्ड क्रमांक: ${String(data.voter.wardSerial).padStart(
    2,
    "0",
  )}    मतदाता क्रमांक: ${data.voter.voterSerial}`;
  const wardLines = lineCount(context, wardLine, textWidth);
  y = drawLines(context, wardLines, MARGIN, y, 18);

  if (wantsPhoto) {
    const photoBottom =
      blockTop + PHOTO_HEIGHT + (data.voter.serialNo !== undefined ? 18 : 6);
    y = Math.max(y, photoBottom);
  }
  y += 8;

  // EPIC box.
  const epicHeight = 48;
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.strokeRect(MARGIN + 0.5, y + 0.5, CONTENT_WIDTH - 1, epicHeight - 1);
  context.restore();
  setFont(context, family, 600, 10);
  context.fillText("मतदान कार्ड संख्या (EPIC)", MARGIN + 8, y + 6);
  setFont(context, family, 700, 17);
  context.fillText(data.voter.epic, MARGIN + 8, y + 22);
  y += epicHeight + 10;

  // House / age / gender.
  setFont(context, family, 400, 14);
  const details = `मकान नंबर: ${data.voter.houseNo}    आयु / लिंग: ${data.voter.age} वर्ष / ${data.voter.gender}`;
  const detailLines = lineCount(context, details, CONTENT_WIDTH);
  y = drawLines(context, detailLines, MARGIN, y, 19);
  y += 6;

  // Booth box.
  setFont(context, family, 400, 14);
  const boothLines = lineCount(
    context,
    `${data.booth.number} - ${data.booth.name}`,
    CONTENT_WIDTH - 16,
  );
  const boothHeight = 10 + 14 + 4 + boothLines.length * 19 + 8;
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = 1;
  context.strokeRect(
    MARGIN + 0.5,
    y + 0.5,
    CONTENT_WIDTH - 1,
    boothHeight - 1,
  );
  context.restore();
  setFont(context, family, 700, 11);
  context.fillText("मतदान बूथ संख्या व पता", MARGIN + 8, y + 5);
  setFont(context, family, 400, 14);
  drawLines(context, boothLines, MARGIN + 8, y + 21, 19);
  y += boothHeight + 10;

  dashedRule(context, y);
  y += 8;

  // Footer.
  const footer =
    data.footerMessage ??
    "लोकतंत्र के इस महापर्व में अपने अमूल्य मत का प्रयोग अवश्य करें";
  setFont(context, family, 600, 12);
  const footerLines = lineCount(context, footer, CONTENT_WIDTH);
  y = drawLines(
    context,
    footerLines,
    THERMAL_WIDTH_DOTS / 2,
    y,
    17,
    "center",
  );
  y += 2;

  if (data.votingDate) {
    setFont(context, family, 500, 11);
    context.textAlign = "center";
    context.fillText(
      `मतदान दिनांक: ${data.votingDate}`,
      THERMAL_WIDTH_DOTS / 2,
      y,
    );
    context.textAlign = "left";
    y += 15;
  }
  setFont(context, family, 500, 11);
  context.textAlign = "center";
  context.fillText(
    `मतदान का समय: ${data.votingTime ?? "7:00 am से 06:00 pm"}`,
    THERMAL_WIDTH_DOTS / 2,
    y,
  );
  context.textAlign = "left";
  y += 18;

  const height = Math.ceil(y + 8);
  if (height > MAX_HEIGHT) {
    throw new Error("Thermal slip is taller than the render canvas");
  }

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
    photoIncluded: preparedPhoto !== null,
    feedRows: options.feedRows ?? DEFAULT_FEED_ROWS,
  };
}
