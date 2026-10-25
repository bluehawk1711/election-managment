"use client";

/**
 * Multi-slip printing — the batch sibling of `VoterSlipModal`.
 *
 * The field ask is a sheet, not a pile: a selectable grid (2-3 columns ×
 * 4-7 rows on A4 or A3) of COMPACT slips. The single slip is designed to be
 * cut out and handed over; at 8-27 per page it has to become a compact
 * artefact (≈94 × 44mm at the 2 × 6 design size, scaled by the layout), so
 * this file renders a dedicated `CompactSlip` rather than shrinking the
 * full slip's DOM. The data contract is shared (`VoterSlipData`), so the
 * fields that print are the same ones the single slip prints — only the
 * presentation is tighter.
 *
 * Print mechanics mirror `VoterSlipModal`: a portal directly under <body>,
 * the overlay carries the `slip-overlay` class (the print stylesheet hides
 * every other body child), and `@media print` turns `.slip-batch-page` into
 * the chosen grid through the `--slip-sheet-*` custom properties set here.
 * Pages after the first break with `break-after: page`, so 13 slips on a
 * 10-up layout are two sheets, not one overflowing sheet.
 *
 * Paper: while this dialog is open an `@page { size; margin }` rule is
 * injected for the chosen paper (6mm). That is what fixes the old giant
 * borders: the stylesheet used to pin A4/10mm, so an A3 sheet printed the
 * A4-sized block floating in the middle of the paper — on top of every
 * printer's own ~4-5mm unprintable band, which no CSS can remove.
 */
import { Printer, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { savedRangColor } from "@/components/voters/voter-slip";
import {
  loadSheetLayout,
  presetsForPaper,
  saveSheetLayout,
  SHEET_MARGIN_MM,
  sheetLayoutFor,
  sheetMetrics,
  type SheetPaper,
  type SlipSheetLayout,
} from "@/lib/printer/sheet-layout";
import type { VoterSlipData } from "@/lib/roll/slip";

export interface BatchSlipItem {
  /** Stable voter id — keys the photo fallback and the saved colour mark. */
  id: string;
  data: VoterSlipData;
}

interface Props {
  items: BatchSlipItem[];
  /** Optional source label — "selected voters" vs "full ward N". */
  label?: string;
  onClose: () => void;
}

/** `items` → pages of at most `perPage`, in the order the list selected them. */
function paginate(
  items: readonly BatchSlipItem[],
  perPage: number,
): BatchSlipItem[][] {
  const pages: BatchSlipItem[][] = [];
  for (let index = 0; index < items.length; index += perPage) {
    pages.push(items.slice(index, index + perPage));
  }
  return pages;
}

/** Tailwind classes for the two toolbar selects (the rest is `slip-*` CSS). */
const SELECT_CLASS =
  "rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] " +
  "font-semibold text-gray-800 hover:border-gray-400 focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-orange-500";

export function VoterSlipsBatchModal({ items, label, onClose }: Props) {
  const [layout, setLayout] = useState<SlipSheetLayout>(loadSheetLayout);
  const metrics = useMemo(() => sheetMetrics(layout), [layout]);
  const pages = useMemo(
    () => paginate(items, metrics.perPage),
    [items, metrics.perPage],
  );

  // ESC closes — same promise the single slip's shortcut strip makes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The sheet's page box: the chosen paper at SHEET_MARGIN_MM. Injected last
  // into <head>, so it overrides the stylesheet's static A4/10mm @page, and
  // removed on close so the single-slip print path falls back to it.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-slip-sheet-page", "");
    style.textContent = `@page { size: ${layout.paper}; margin: ${SHEET_MARGIN_MM}mm; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [layout.paper]);

  const applyLayout = (next: SlipSheetLayout) => {
    setLayout(next);
    saveSheetLayout(next);
  };

  const applyPaper = (paper: SheetPaper) =>
    // Keep the current grid if the new paper offers that preset, otherwise
    // fall back to the paper's default (never a phantom combination).
    applyLayout(sheetLayoutFor(paper, layout.cols, layout.rows));

  const applyPreset = (value: string) => {
    const [cols, rows] = value.split("x").map(Number);
    applyLayout(sheetLayoutFor(layout.paper, cols, rows));
  };

  if (typeof document === "undefined") return null;

  // The grid vars every `.slip-batch-page` (preview AND print) reads.
  const sheetStyle = {
    "--slip-sheet-cols": String(layout.cols),
    "--slip-sheet-rows": String(layout.rows),
    "--slip-sheet-w": `${metrics.pageWidth}mm`,
    "--slip-sheet-h": `${metrics.pageHeight}mm`,
    "--slip-scale": metrics.scale.toFixed(4),
  } as CSSProperties;

  return createPortal(
    <div
      className="slip-overlay slip-batch-overlay"
      data-print-mode="batch"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="slip-batch-modal"
        role="dialog"
        aria-modal="true"
        aria-label="मतदाता पर्ची — एक साथ प्रिंट"
        style={sheetStyle}
      >
        <div className="slip-header slip-batch-header">
          <span className="slip-headerIcon">
            <Printer className="size-4.5" />
          </span>
          <div className="slip-headerText">
            <div className="slip-headerTitle">मतदाता पर्ची — एक साथ प्रिंट</div>
            <div className="slip-headerSub">
              {label ? `${label} · ` : ''}
              {items.length.toLocaleString()} पर्चियाँ ·{' '}
              {pages.length.toLocaleString()} पेज ·{' '}
              {layout.paper} {layout.cols} × {layout.rows}
            </div>
          </div>
          <button
            type="button"
            className="slip-headerBtn"
            onClick={onClose}
            aria-label="बंद करें"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="slip-batch-toolbar">
          <label>
            <span>पेपर</span>
            <select
              className={SELECT_CLASS}
              aria-label="पेपर साइज़"
              value={layout.paper}
              onChange={(event) => applyPaper(event.target.value as SheetPaper)}
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>

          <label>
            <span>लेआउट</span>
            <select
              className={SELECT_CLASS}
              aria-label="प्रिंट लेआउट"
              value={`${layout.cols}x${layout.rows}`}
              onChange={(event) => applyPreset(event.target.value)}
            >
              {presetsForPaper(layout.paper).map((preset) => (
                <option
                  key={`${preset.cols}x${preset.rows}`}
                  value={`${preset.cols}x${preset.rows}`}
                >
                  {preset.cols} × {preset.rows} — {preset.cols * preset.rows}{' '}
                  पर्चियाँ
                </option>
              ))}
            </select>
          </label>

          <span>
            हर पेज पर {layout.cols} × {layout.rows} (कुल {metrics.perPage}{' '}
            पर्चियाँ)। प्रिंट डायलॉग में पेपर साइज़ {layout.paper} और मार्जिन
            &quot;Default&quot; रखें।
          </span>

          <button
            type="button"
            className="slip-printBtn"
            onClick={() => window.print()}
          >
            <Printer className="size-4" />
            सभी पर्चियाँ प्रिंट करें
          </button>
        </div>

        <div className="slip-batch-body">
          {pages.map((page, pageIndex) => (
            <div className="slip-batch-page" key={pageIndex}>
              {page.map((item) => (
                <div className="slip-batch-cell" key={item.id}>
                  <CompactSlip item={item} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------ the compact slip */

/**
 * One slip at batch scale. It carries the same facts as the full slip, minus
 * the decorative divider and the long footer slogan — at ~94 × 44mm those are
 * the first things that would push the EPIC or the booth off the paper.
 *
 * Every dimension below is the design value × `var(--slip-scale, 1)`, so the
 * slip grows into bigger cells (A3, 2 × 4) and shrinks into denser ones
 * (3 × 7) without reflow surprises.
 *
 * The title is clipped to two lines and the booth address to two; every other
 * line is single-line with an ellipsis, so a long name can never reflow the
 * grid and steal height from the row below it.
 */
function CompactSlip({ item }: { item: BatchSlipItem }) {
  const { data } = item;
  const { voter, booth } = data;
  const [photoFailed, setPhotoFailed] = useState(false);
  const rangColor = savedRangColor(item.id);

  return (
    <div className="slip-compact">
      {rangColor ? (
        <div className="slip-compact-strip" style={{ background: rangColor }} />
      ) : null}

      <div className="slip-compact-head">
        <span className="slip-compact-badge">मतदाता पर्ची</span>
        <span className="slip-compact-ward">
          {data.wardLabel ?? `वार्ड ${String(voter.wardSerial).padStart(2, "0")}`}
        </span>
      </div>

      <div className="slip-compact-title">{data.title}</div>

      <div className="slip-compact-main">
        <div className="slip-compact-fields">
          <div className="slip-compact-name">
            {voter.name}
            {data.nameEn ? (
              <span className="slip-compact-nameEn">{data.nameEn}</span>
            ) : null}
          </div>
          <div className="slip-compact-line">
            <span className="slip-compact-label">
              {voter.relationLabel?.trim() || "पिता"}:{" "}
            </span>
            <b>{voter.fatherName}</b>
          </div>
          <div className="slip-compact-line">
            <span className="slip-compact-label">क्रमांक: </span>
            <b>{voter.voterSerial}</b>
          </div>
        </div>

        <div className="slip-compact-photoBox">
          {voter.photoUrl && !photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={voter.photoUrl}
              alt={voter.name}
              className="slip-compact-photo"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <div className="slip-compact-photo slip-compact-photoPlaceholder">
              फोटो
            </div>
          )}
        </div>
      </div>

      <div className="slip-compact-row">
        <span className="slip-compact-label">EPIC: </span>
        <b className="slip-compact-epic">{voter.epic}</b>
      </div>

      <div className="slip-compact-row">
        <span className="slip-compact-label">मकान: </span>
        <b>{voter.houseNo}</b>
        <span className="slip-compact-label">आयु/लिंग: </span>
        <b>
          {voter.age} / {voter.gender}
        </b>
      </div>

      <div className="slip-compact-booth">
        <span className="slip-compact-label">बूथ: </span>
        {booth.number} - {booth.name}
      </div>

      <div className="slip-compact-footer">
        {data.votingDate ? <span>{data.votingDate}</span> : null}
        {data.votingTime ? <span> · {data.votingTime}</span> : null}
      </div>
    </div>
  );
}
