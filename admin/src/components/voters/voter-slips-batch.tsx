"use client";

/**
 * Multi-slip printing — the batch sibling of `VoterSlipModal`.
 *
 * The field ask is a sheet, not a pile: 3 slips across × 7 down = 21 per A4
 * page. The single slip is designed to be cut out and handed over; at 21 per
 * page it has to become a COMPACT artefact (≈62 × 38 mm), so this file renders
 * a dedicated `CompactSlip` rather than shrinking the full slip's DOM. The
 * data contract is shared (`VoterSlipData`), so the fields that print are the
 * same ones the single slip prints — only the presentation is tighter.
 *
 * Print mechanics mirror `VoterSlipModal`: a portal directly under <body>,
 * the overlay carries the `slip-overlay` class (the print stylesheet hides
 * every other body child), and `@media print` turns `.slip-batch-page` into a
 * fixed 3 × 7 grid. Pages after the first break with `break-after: page`, so
 * 22 slips are two sheets, not one overflowing sheet.
 */
import { Printer, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { savedRangColor } from "@/components/voters/voter-slip";
import type { VoterSlipData } from "@/lib/roll/slip";

/** How many slips fit on one A4 sheet: 3 columns × 7 rows. */
const PER_PAGE = 21;

export interface BatchSlipItem {
  /** Stable voter id — keys the photo fallback and the saved colour mark. */
  id: string;
  data: VoterSlipData;
}

interface Props {
  items: BatchSlipItem[];
  onClose: () => void;
}

/** `items` → pages of at most 21, in the order the voter list selected them. */
function paginate(items: readonly BatchSlipItem[]): BatchSlipItem[][] {
  const pages: BatchSlipItem[][] = [];
  for (let index = 0; index < items.length; index += PER_PAGE) {
    pages.push(items.slice(index, index + PER_PAGE));
  }
  return pages;
}

export function VoterSlipsBatchModal({ items, onClose }: Props) {
  const pages = useMemo(() => paginate(items), [items]);

  // ESC closes — same promise the single slip's shortcut strip makes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

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
      >
        <div className="slip-header slip-batch-header">
          <span className="slip-headerIcon">
            <Printer className="size-4.5" />
          </span>
          <div className="slip-headerText">
            <div className="slip-headerTitle">मतदाता पर्ची — एक साथ प्रिंट</div>
            <div className="slip-headerSub">
              {items.length.toLocaleString()} पर्चियाँ · {pages.length.toLocaleString()} A4 पेज ·
              हर पेज पर 3 × 7
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
          <span>
            हर पेज पर 3 कॉलम × 7 पंक्तियाँ (कुल 21 पर्चियाँ)। A4 पेपर पर प्रिंट करें।
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
 * the decorative divider and the long footer slogan — at 62 × 38 mm those are
 * the first things that would push the EPIC or the booth off the paper.
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
            <span className="slip-compact-label">पिता: </span>
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
