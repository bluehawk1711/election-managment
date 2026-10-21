"use client";

/**
 * The voter slip — the field artefact, as a modal (mock:
 * `admin/public/clipboard-image.png`, reference print:
 * `admin/public/मतदाता_पर्ची_गंगा_2.pdf`).
 *
 * Structure is the pasted `VoterSlip.tsx` kept whole — the dashed slip paper
 * (`SlipPaper` below is that component's markup, field for field) — wrapped
 * in the chrome the mock adds around it:
 *
 *   header      orange bar: title + election line, collapse (→) and close (X)
 *   toolbar     WhatsApp number + send, पर्ची निकालें (print), पर्ची / A4
 *               सिस्टम (full-sheet print), copy-slip-text, and the
 *               "ब्राउज़र में पीडीएफ देखना प्रारंभ करें" link
 *   paper       the slip itself — the ONLY thing `@media print` lets out
 *   status bar  मतदाता स्थिति chip, रंगदर्शक colour picker (prints as the
 *               slip's top strip, so a paper stack can be colour-sorted),
 *               बूथ पता देखें toggler
 *   shortcuts   "ESC से बंद करें | पर्ची पर प्रिंट निकालें" + बंद करें
 *
 * PRINT MECHANICS
 * The whole dialog is rendered through a portal directly under <body>. That
 * is what makes printing reliable: the print stylesheet can hide every other
 * child of <body> (`body > *:not(.slip-overlay)`) without caring how deep or
 * how tall the app shell / page wrappers are. Previously the dialog lived
 * inside the shell, whose height / transform / grid sizing survived into
 * print and produced several blank pages.
 *
 * `window.print()` is called with `data-print-mode` on the root —
 * `slip` keeps the 420pt cut-out, `a4` stretches to the A4 sheet the
 * reference PDF was made at.
 *
 * The workgroup number and the colour mark persist per browser + per voter
 * (localStorage): a manager printing forty slips from one laptop should not
 * retype the number forty times, and a colour mark that forgot itself
 * between opens would silently mis-sort the stack.
 *
 * STYLING: plain global classes named `slip-*`, defined in `app/globals.css`
 * (the block at the end of that file). Not a CSS module — the module's export
 * map resolved empty here and the dialog rendered unstyled.
 */
import {
  Check,
  ChevronRight,
  Copy,
  FileText,
  MessageCircle,
  Printer,
  Vote,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/stores/toast";
import { slipMessageText, type VoterSlipData } from "@/lib/roll/slip";

/* ------------------------------------------------------------- persistence */

const PHONE_KEY = "slip.workgroupPhone";
const rangKey = (voterId: string) => `slip.rang.${voterId}`;

/** localStorage is a browser API — every read is guarded for SSR/sandbox. */
function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: the value simply does not survive a reload.
  }
}

/**
 * `9876543210` → `919876543210` — wa.me wants country code, no `+`.
 * Ten digits is an Indian mobile; anything else is dialled as typed so an
 * already-complete number is never double-prefixed.
 */
function waNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

/** The रंगदर्शक options — the colour a paper stack gets sorted by. */
const RANG: { value: string; label: string; color: string }[] = [
  { value: "green", label: "हरा", color: "#22c55e" },
  { value: "yellow", label: "पीला", color: "#eab308" },
  { value: "red", label: "लाल", color: "#ef4444" },
  { value: "blue", label: "नीला", color: "#3b82f6" },
  { value: "orange", label: "नारंगी", color: "#f97316" },
];

/* ------------------------------------------------------------------- modal */

export function VoterSlipModal({
  data,
  voterId,
  onClose,
}: {
  data: VoterSlipData;
  /** Stable row id — keys the per-voter localStorage entries. */
  voterId: string;
  onClose: () => void;
}) {
  // Lazy seeds — the workgroup number and colour mark are read ONCE per
  // mount. The caller keys this modal on `voterId`, so switching voter
  // remounts and every piece of per-voter state (incl. `photoFailed`)
  // resets itself.
  const [phone, setPhone] = useState(() => readLocal(PHONE_KEY) ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const [showBooth, setShowBooth] = useState(false);
  const [printMode, setPrintMode] = useState<"slip" | "a4">("slip");
  const [rang, setRang] = useState(
    () => readLocal(rangKey(voterId)) ?? "green",
  );
  const [photoFailed, setPhotoFailed] = useState(false);

  // ESC closes — the shortcut strip promises it, so it must be true.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const print = useCallback((mode: "slip" | "a4") => {
    setPrintMode(mode);
    // Let React paint the mode attribute before the dialog snapshots the
    // page, or Chrome prints the previous mode's layout.
    requestAnimationFrame(() => window.print());
  }, []);

  const sendWhatsapp = useCallback(() => {
    const target = waNumber(phone);
    if (target.length < 10) {
      toast.error(
        "नंबर दर्ज करें",
        "WhatsApp भेजने के लिए 10 अंकों का मोबाइल नंबर चाहिए।",
      );
      return;
    }
    writeLocal(PHONE_KEY, phone);
    const url = `https://wa.me/${target}?text=${encodeURIComponent(slipMessageText(data))}`;
    window.open(url, "_blank", "noopener");
  }, [phone, data]);

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(slipMessageText(data));
      toast.success(
        "पर्ची कॉपी हो गई",
        "टेक्स्ट क्लिपबोर्ड पर है — कहीं भी पेस्ट करें।",
      );
    } catch {
      toast.error("कॉपी नहीं हुआ", "ब्राउज़र ने क्लिपबोर्ड की अनुमति नहीं दी।");
    }
  }, [data]);

  const onRang = useCallback(
    (value: string) => {
      setRang(value);
      writeLocal(rangKey(voterId), value);
    },
    [voterId],
  );

  const rangColor = RANG.find((option) => option.value === rang)?.color;

  // The modal only mounts after a click, so `document` exists; the guard
  // just keeps an accidental server render from throwing.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="slip-overlay"
      data-print-mode={printMode}
      // Backdrop click cancels — the drawer's own contract.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`slip-modal${collapsed ? " slip-collapsed" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="मतदाता पर्ची"
      >
        {/* ── header ─────────────────────────────────────────────── */}
        <div className="slip-header">
          <span className="slip-headerIcon">
            <Vote className="size-4.5" />
          </span>
          <div className="slip-headerText">
            <div className="slip-headerTitle">मतदाता पर्ची (Voter Slip)</div>
            <div className="slip-headerSub">{data.title}</div>
          </div>
          <button
            type="button"
            className="slip-headerBtn slip-collapseBtn"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "पर्ची बढ़ाएँ" : "पर्ची समेटें"}
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            className="slip-headerBtn"
            onClick={onClose}
            aria-label="बंद करें"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="slip-body">
          {/* ── toolbar ──────────────────────────────────────────── */}
          <div className="slip-toolbar">
            <input
              className="slip-phoneInput"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              placeholder="कार्यसमूह मोबाइल नंबर दर्ज करें (क्लिकेबल)"
              aria-label="कार्यसमूह मोबाइल नंबर"
            />
            <div className="slip-btnRow">
              <button
                type="button"
                className="slip-btnWhatsapp"
                onClick={sendWhatsapp}
              >
                <MessageCircle className="size-4" />
                WhatsApp पर भेजें
              </button>
              <button
                type="button"
                className="slip-printBtn"
                onClick={() => print("slip")}
              >
                <Printer className="size-4" />
                पर्ची निकालें
              </button>
              <button
                type="button"
                className="slip-a4Btn"
                onClick={() => print("a4")}
              >
                <FileText className="size-4" />
                पर्ची / A4 सिस्टम
              </button>
              <button
                type="button"
                className="slip-copyBtn"
                onClick={() => void copyText()}
                aria-label="पर्ची टेक्स्ट कॉपी करें"
              >
                <Copy className="size-4" />
              </button>
            </div>
            <button
              type="button"
              className="slip-pdfLink"
              onClick={() => print("a4")}
            >
              ब्राउज़र में पीडीएफ देखना प्रारंभ करें
            </button>
          </div>

          {/* ── the slip — the only printed surface ───────────────── */}
          <div className="slip-slipWrap">
            <SlipPaper
              data={data}
              rangColor={rangColor}
              photoFailed={photoFailed}
              onPhotoFail={() => setPhotoFailed(true)}
            />
          </div>

          {/* ── status bar ───────────────────────────────────────── */}
          <div className="slip-statusBar">
            <span>
              मतदाता स्थिति: <span className="slip-statusChip">बाकी है</span>
            </span>
            <label>
              रंगदर्शक:{" "}
              <select
                className="slip-rangSelect"
                value={rang}
                onChange={(event) => onRang(event.target.value)}
                aria-label="रंगदर्शक"
              >
                {RANG.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} चुनें
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="slip-boothBtn"
              onClick={() => setShowBooth((current) => !current)}
            >
              <Check className="size-4" />
              बूथ पता देखें
            </button>
          </div>

          {showBooth ? (
            <div className="slip-boothPanel">
              <b>बूथ {data.booth.number}</b> — {data.booth.name}
              <br />
              <a
                className="slip-boothPanelMap"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${data.booth.name} ${data.booth.number}`,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                नक्शे पर देखें
              </a>
            </div>
          ) : null}

          {/* ── shortcut strip ───────────────────────────────────── */}
          <div className="slip-shortcutBar">
            <span>
              कीबोर्ड शॉर्टकट: ESC से बंद करें | पर्ची पर प्रिंट निकालें
            </span>
            <button type="button" className="slip-closeBtn" onClick={onClose}>
              बंद करें
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------- the paper */

/**
 * The slip itself — the pasted component's markup, kept field for field so
 * the printed output matches the reference PDF. Pure: all data arrives in
 * `data`, the only state is the photo's 404 fallback (a placeholder box is
 * honest; a broken-image glyph on a printed slip is not).
 */
function SlipPaper({
  data,
  rangColor,
  photoFailed,
  onPhotoFail,
}: {
  data: VoterSlipData;
  rangColor?: string;
  photoFailed: boolean;
  onPhotoFail: () => void;
}) {
  const { voter, booth } = data;

  return (
    <div className="slip-slip" id="voter-slip-print-area">
      {rangColor ? (
        <div className="slip-colorStrip" style={{ background: rangColor }} />
      ) : null}

      <div className="slip-badgeRow">
        <span className="slip-badge">
          {data.badgeText ?? "मतदाता सूचना पर्ची (VOTER SLIP)"}
        </span>
      </div>

      <h1 className="slip-title">{data.title}</h1>

      <div className="slip-divider">
        <span>------------------ वोटर सूचना ------------------</span>
      </div>

      <div className="slip-rollRow">
        <span className="slip-rollChip">
          {data.rollLabel ?? "निर्वाचक नामावली"}
        </span>
        {data.wardLabel ? (
          <span className="slip-wardChip">{data.wardLabel}</span>
        ) : null}
      </div>

      <div className="slip-voterBlock">
        <div className="slip-voterInfo">
          <div className="slip-row">
            <span className="slip-label">नाम (Name) :</span>
            <span className="slip-nameValue">
              {voter.name}
              {/* The roll carries an English copy of every Hindi name — shown
                  small under it, the way the bilingual slip reads. */}
              <span className="slip-nameEn">{data.nameEn ?? ""}</span>
            </span>
          </div>
          <div className="slip-row">
            <span className="slip-label">पिता का नाम :</span>
            <span className="slip-value">{voter.fatherName}</span>
          </div>
          <div className="slip-row">
            <span className="slip-label">वार्ड क्रमांक :</span>
            <span className="slip-wardNo">
              {String(voter.wardSerial).padStart(2, "0")}
            </span>
            <span className="slip-label">मतदाता क्रमांक :</span>
            <span className="slip-voterNo">{voter.voterSerial}</span>
          </div>
        </div>

        <div className="slip-photoBox">
          {voter.photoUrl && !photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={voter.photoUrl}
              alt={voter.name}
              className="slip-voterPhoto"
              onError={onPhotoFail}
            />
          ) : (
            <div className="slip-photoPlaceholder">फोटो</div>
          )}
          {voter.serialNo !== undefined ? (
            <div className="slip-photoCaption">क्र. सं. {voter.serialNo}</div>
          ) : null}
        </div>
      </div>

      <div className="slip-rowBordered">
        <span className="slip-label">मतदान कार्ड संख्या (EPIC) :</span>
        <span className="slip-epic">{voter.epic}</span>
      </div>
      <div className="slip-rowBordered">
        <span className="slip-label">मकान नंबर :</span>
        <span className="slip-value">{voter.houseNo}</span>
        <span className="slip-label">आयु / लिंग :</span>
        <span className="slip-value">
          {voter.age} वर्ष / {voter.gender}
        </span>
      </div>

      <div className="slip-booth">
        <div className="slip-boothLabel">मतदान बूथ संख्या व पता :</div>
        <div className="slip-boothValue">
          {booth.number} - {booth.name}
        </div>
      </div>

      <div className="slip-footer">
        <div className="slip-footerMsg">
          ★{" "}
          {data.footerMessage ??
            "लोकतंत्र के इस महापर्व में अपने अमूल्य मत का प्रयोग अवश्य करें"}{" "}
          ★
        </div>
        {data.votingDate ? (
          <div className="slip-footerTime">मतदान दिनांक: {data.votingDate}</div>
        ) : null}
        <div className="slip-footerTime">
          मतदान का समय: {data.votingTime ?? "7:00 am से 06:00 pm"}
        </div>
      </div>
    </div>
  );
}
