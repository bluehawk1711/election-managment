"use client";

/**
 * The thermal-printer control surface inside the voter slip modal.
 *
 * It is additive: the existing HTML slip and `window.print()` buttons remain
 * untouched. This panel connects to a PT-210 (BLE or Web Serial), previews the
 * 384-dot raster, prints it, and reports exactly what is known:
 *
 *   confirmed  printer answered a status query (not a scan of the paper)
 *   sent       all bytes reached the transport (no status channel)
 *   uncertain  some bytes were written, then the link/job failed
 *   failed     nothing was written (or the duplicate guard refused)
 *
 * Nothing here persists voter data. The preview is an in-memory data URL and
 * the controller only keeps an opaque key/hash for duplicate detection.
 */
import {
  Bluetooth,
  ChevronDown,
  CircleCheck,
  Info,
  LoaderCircle,
  Printer,
  RefreshCw,
  Send,
  TriangleAlert,
  Unplug,
  Usb,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { printerController } from "@/lib/printer/controller";
import { failureFor } from "@/lib/printer/errors";
import {
  renderThermalSlip,
  type ThermalSlipRender,
} from "@/lib/printer/thermal-slip";
import type { PrinterFailure, PrintResult } from "@/lib/printer/types";
import type { VoterSlipData } from "@/lib/roll/slip";
import { toast } from "@/stores/toast";

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;

interface Environment {
  mounted: boolean;
  bluetooth: boolean;
  serial: boolean;
  secure: boolean;
}

function shortUuid(uuid: string): string {
  const match = /^0000([0-9a-f]{4})-/i.exec(uuid);
  if (match) return match[1].toUpperCase();
  return uuid.length > 18 ? `${uuid.slice(0, 8)}…${uuid.slice(-4)}` : uuid;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDots(height: number): string {
  // 203 dpi = 8 dots per millimetre.
  return `${(height / 8).toFixed(1)} mm`;
}

function resultCopy(result: PrintResult): {
  title: string;
  hint: string;
  tone: "ok" | "sent" | "warn" | "bad";
} {
  switch (result.state) {
    case "confirmed":
      return {
        title: "प्रिंटर ने स्टेटस उत्तर दिया",
        hint:
          "डेटा भेज दिया गया और प्रिंटर जवाब दे रहा है। यह कागज़ पर पूरी पर्ची छपने की 100% पुष्टि नहीं है — निकली पर्ची देख लें।",
        tone: "ok",
      };
    case "sent":
      return {
        title: "डेटा प्रिंटर को भेज दिया गया",
        hint:
          "इस कनेक्शन पर प्रिंटर की स्टेटस पुष्टि उपलब्ध नहीं है। पर्ची निकली है या नहीं, यह देख लें।",
        tone: "sent",
      };
    case "uncertain":
      return {
        title: "अधूरा प्रिंट हो सकता है",
        hint:
          "कुछ डेटा भेजा गया, फिर लिंक/जॉब विफल हुआ। अपने आप दोबारा नहीं भेजा जाएगा — पेपर जाँचकर जानबूझकर फिर प्रिंट करें।",
        tone: "warn",
      };
    case "failed":
    default:
      return {
        title: result.error?.title ?? "प्रिंट नहीं हुआ",
        hint: result.error?.hint ?? "कनेक्शन और प्रिंटर जाँचें, फिर कोशिश करें।",
        tone: "bad",
      };
  }
}

export function ThermalPrinterPanel({
  data,
  voterId,
  rangLabel,
}: {
  data: VoterSlipData;
  voterId: string;
  /** The रंगदर्शक selection, printed as text because paper is monochrome. */
  rangLabel?: string;
}) {
  const snapshot = useSyncExternalStore(
    printerController.subscribe,
    printerController.getSnapshot,
    printerController.getServerSnapshot,
  );

  // This component is only rendered after the operator opens a slip, which is
  // necessarily client-side; reading the capabilities during render is safe.
  const environment = useMemo<Environment>(() => {
    if (typeof window === "undefined") {
      return { mounted: false, bluetooth: false, serial: false, secure: true };
    }
    return {
      mounted: true,
      bluetooth: Boolean(navigator.bluetooth),
      serial: Boolean(navigator.serial),
      secure: window.isSecureContext,
    };
  }, []);
  const [preview, setPreview] = useState<ThermalSlipRender | null>(null);
  const [rendering, setRendering] = useState(true);
  const [previewError, setPreviewError] = useState<PrinterFailure | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [reprintArmed, setReprintArmed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    // Opening a slip should not show a previous voter's print failure. An
    // in-flight job is left alone.
    if (printerController.getSnapshot().job !== "sending") {
      printerController.clearError();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Yield before the first state update; the effect itself should only
      // start the async render, not cause a synchronous cascading render.
      await Promise.resolve();
      if (cancelled) return;
      setRendering(true);
      // Never leave a previous voter's preview visible while the next one is
      // being rasterised.
      setPreview(null);
      setPreviewError(null);

      try {
        const result = await renderThermalSlip(data, { rangLabel });
        if (cancelled) return;
        setPreview(result);
        setRendering(false);
      } catch (error: unknown) {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(failureFor("render", String(error)));
        setRendering(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [data, rangLabel, renderNonce]);

  const connected = snapshot.connection === "connected";
  const connecting = snapshot.connection === "connecting";
  const disconnecting = snapshot.connection === "disconnecting";
  const printing = snapshot.job === "sending";
  const result =
    snapshot.lastResult?.key === voterId ? snapshot.lastResult : null;
  const resultView = result ? resultCopy(result) : null;
  // A result from a previous voter is hidden by the `result` guard above, but
  // a current connection/disconnect error must still be visible on this slip.
  // Suppress only the exact error object already carried by `lastResult`.
  const standaloneError =
    snapshot.error && snapshot.error !== snapshot.lastResult?.error
      ? snapshot.error
      : null;

  const connect = useCallback(
    async (kind: "ble" | "serial") => {
      setReprintArmed(false);
      const outcome = await printerController.connect(kind, {
        baudRate,
      });
      if (!outcome.ok && outcome.error && outcome.error.code !== "cancelled") {
        toast.error(outcome.error.title, outcome.error.hint);
      }
    },
    [baudRate],
  );

  const disconnect = useCallback(async () => {
    setReprintArmed(false);
    await printerController.disconnect();
  }, []);

  const runPrint = useCallback(
    async (force: boolean) => {
      if (!preview) return;
      setReprintArmed(false);
      const outcome = await printerController.print({
        key: voterId,
        bitmap: preview.bitmap,
        feedRows: preview.feedRows,
        force,
      });
      if (outcome.state === "confirmed" || outcome.state === "sent") {
        toast.success(
          outcome.state === "confirmed"
            ? "थर्मल प्रिंट भेजा गया"
            : "थर्मल प्रिंट भेजा गया (स्टेटस पुष्टि नहीं)",
          outcome.state === "confirmed"
            ? "प्रिंटर ने स्टेटस उत्तर दिया। निकली पर्ची देख लें।"
            : "डेटा भेज दिया गया; भौतिक प्रिंट की पुष्टि नहीं है।",
        );
      }
    },
    [preview, voterId],
  );

  const clearErrors = useCallback(() => {
    setPreviewError(null);
    printerController.clearError();
  }, []);

  const dismissResult = useCallback(() => {
    printerController.dismissResult();
  }, []);

  const stateLabel = printing
    ? snapshot.progress >= 1
      ? "पुष्टि का इंतज़ार…"
      : "भेजा जा रहा है…"
    : connecting
      ? "कनेक्ट हो रहा है…"
      : disconnecting
        ? "डिस्कनेक्ट…"
        : connected
          ? "तैयार"
          : "कनेक्ट नहीं";

  const stateTone = printing
    ? "busy"
    : connected
      ? "ok"
      : connecting || disconnecting
        ? "busy"
        : "off";

  const canUsePrinter =
    environment.mounted &&
    environment.secure &&
    (environment.bluetooth || environment.serial);

  const percent = Math.round(Math.min(1, Math.max(0, snapshot.progress)) * 100);

  const retrySafely =
    result?.state === "failed" &&
    result.bytesWritten === 0 &&
    !result.duplicate;
  const forceReprint =
    result &&
    (result.state === "uncertain" ||
      result.state === "sent" ||
      result.state === "confirmed" ||
      result.duplicate === true);

  const previewMeta = useMemo(() => {
    if (!preview) return null;
    return `${preview.width} × ${preview.height} dots • ${formatDots(
      preview.height,
    )}`;
  }, [preview]);

  return (
    <details
      className="slip-printer"
      open={panelOpen}
      onToggle={(event) => setPanelOpen(event.currentTarget.open)}
      aria-label="थर्मल प्रिंटर (58mm)"
    >
      <summary className="slip-printerHead">
        <span className="slip-printerTitle">
          <Printer className="size-4" />
          थर्मल प्रिंटर
          <small>58mm • 384 dots</small>
        </span>
        <span
          className={`slip-printerState slip-printerState--${stateTone}`}
          aria-live="polite"
        >
          {stateLabel}
        </span>
        <ChevronDown className="slip-printerChevron size-4" aria-hidden />
      </summary>

      <div className="slip-printerBody">
      {!environment.mounted ? (
        <div className="slip-printerHint">ब्राउज़र की क्षमता जाँची जा रही है…</div>
      ) : null}

      {environment.mounted && !environment.secure ? (
        <div className="slip-printerWarn">
          <TriangleAlert className="size-4" />
          सीधा प्रिंटर कनेक्शन के लिए HTTPS (या localhost) आवश्यक है। फिलहाल
          ब्राउज़र प्रिंट का उपयोग करें।
        </div>
      ) : null}

      {environment.mounted && !canUsePrinter && environment.secure ? (
        <div className="slip-printerHint">
          <Info className="size-4" />
          इस ब्राउज़र में Web Bluetooth/Serial नहीं है। नीचे “पर्ची निकालें” से
          सिस्टम प्रिंट करें, या Android/Windows पर नया Chrome/Edge खोलें।
        </div>
      ) : null}

      {environment.mounted ? (
        <>
          {connected ? (
            <div className="slip-printerDevice">
              <div className="slip-printerDeviceRow">
                <span className="slip-printerDeviceName">
                  {snapshot.device?.name ?? "प्रिंटर"}
                </span>
                <span className="slip-printerKind">
                  {snapshot.device?.kind === "serial" ? "USB / SPP" : "BLE"}
                </span>
                <button
                  type="button"
                  className="slip-printerBtn"
                  onClick={() => void disconnect()}
                  disabled={printing || disconnecting}
                >
                  <Unplug className="size-3.5" />
                  डिस्कनेक्ट
                </button>
              </div>
              <span>{snapshot.device?.detail}</span>
              {snapshot.device?.serviceUuid ? (
                <code
                  title={`service ${snapshot.device.serviceUuid}\nwrite ${snapshot.device.writeUuid ?? "—"}\nnotify ${snapshot.device.notifyUuid ?? "—"}`}
                >
                  service {shortUuid(snapshot.device.serviceUuid)} • write{" "}
                  {shortUuid(snapshot.device.writeUuid ?? "")} • notify{" "}
                  {snapshot.device.notifyUuid ? "on" : "off"}
                </code>
              ) : null}
            </div>
          ) : (
            <div className="slip-printerConnectRow">
              <button
                type="button"
                className="slip-printerBtn slip-printerBtnPrimary"
                onClick={() => void connect("ble")}
                disabled={
                  !environment.bluetooth ||
                  !environment.secure ||
                  connecting ||
                  disconnecting ||
                  printing
                }
              >
                <Bluetooth className="size-4" />
                Bluetooth (BLE) से जोड़ें
              </button>

              {environment.serial ? (
                <span className="slip-printerSerial">
                  <label className="slip-printerBaud">
                    Baud
                    <select
                      value={baudRate}
                      onChange={(event) =>
                        setBaudRate(Number(event.target.value))
                      }
                      disabled={connecting || printing}
                      aria-label="Serial baud rate"
                    >
                      {BAUD_RATES.map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="slip-printerBtn"
                    onClick={() => void connect("serial")}
                    disabled={
                      !environment.secure ||
                      connecting ||
                      disconnecting ||
                      printing
                    }
                  >
                    <Usb className="size-4" />
                    USB / COM
                  </button>
                </span>
              ) : null}
            </div>
          )}

          {connecting || disconnecting ? (
            <div className="slip-printerHint">
              <LoaderCircle className="size-3.5 animate-spin" />
              {connecting
                ? "ब्राउज़र के डिवाइस चुनने वाले डायलॉग में PT-210 चुनें…"
                : "कनेक्शन बंद किया जा रहा है…"}
            </div>
          ) : null}

          <div className="slip-printerPreviewRow">
            <div className="slip-printerPreview">
              {rendering ? (
                <span className="slip-printerPreviewEmpty">
                  <LoaderCircle className="size-4 animate-spin" />
                  इमेज बन रही है…
                </span>
              ) : preview ? (
                // In-memory data URL; never persisted. Voter data stays local.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.dataUrl}
                  alt="58mm थर्मल पर्ची का प्रीव्यू"
                  width={preview.width}
                  height={preview.height}
                />
              ) : (
                <span className="slip-printerPreviewEmpty">
                  प्रीव्यू उपलब्ध नहीं
                </span>
              )}
            </div>
            <div className="slip-printerPreviewMeta">
              <b>प्रीव्यू</b>
              <span>{previewMeta ?? "384 dots चौड़ाई"}</span>
              <span>
                {preview
                  ? preview.photoIncluded
                    ? "फोटो शामिल • 1-bit थर्मल"
                    : "फोटो शामिल नहीं • 1-bit थर्मल"
                  : "पर्ची डेटा से बनाया जाएगा"}
              </span>
              <span>नीचे लगभग 1 cm खाली कागज़ (टियर-ऑफ के लिए) जोड़ा जाएगा।</span>
              <button
                type="button"
                className="slip-printerBtn"
                onClick={() => setRenderNonce((value) => value + 1)}
                disabled={rendering}
              >
                <RefreshCw className="size-3.5" />
                प्रीव्यू रीफ्रेश
              </button>
            </div>
          </div>

          {previewError ? (
            <div className="slip-printerResult slip-printerResult--bad" role="alert">
              <b>{previewError.title}</b>
              <span>{previewError.hint}</span>
              <span className="slip-printerTechnical">
                {previewError.technical}
              </span>
              <div className="slip-printerResultActions">
                <button
                  type="button"
                  className="slip-printerBtn"
                  onClick={() => setRenderNonce((value) => value + 1)}
                >
                  <RefreshCw className="size-3.5" />
                  फिर बनाएँ
                </button>
                <button
                  type="button"
                  className="slip-printerBtn"
                  onClick={clearErrors}
                >
                  <X className="size-3.5" />
                  हटाएँ
                </button>
              </div>
            </div>
          ) : null}

          <div className="slip-printerPrintRow">
            <button
              type="button"
              className="slip-printerPrintBtn"
              onClick={() => void runPrint(false)}
              disabled={
                !connected ||
                printing ||
                !preview ||
                rendering ||
                result?.state === "uncertain"
              }
            >
              {printing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {printing ? "भेजा जा रहा है…" : "थर्मल पर्ची प्रिंट करें"}
            </button>
            {!connected ? (
              <span className="slip-printerHint">
                पहले प्रिंटर कनेक्ट करें।
              </span>
            ) : !preview ? (
              <span className="slip-printerHint">
                प्रीव्यू तैयार होने पर प्रिंट सक्रिय होगा।
              </span>
            ) : result?.state === "uncertain" ? (
              <span className="slip-printerHint">
                पहले निकली पर्ची जाँचें; फिर नीचे “जाँच के बाद फिर प्रिंट करें”
                दबाएँ।
              </span>
            ) : null}
          </div>

          {printing ? (
            <div className="slip-printerProgressWrap">
              <div
                className="slip-printerBar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label="थर्मल प्रिंट प्रगति"
              >
                <div
                  className="slip-printerBarFill"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span>
                {percent}% • {formatKb(snapshot.bytesWritten)} /{" "}
                {formatKb(snapshot.totalBytes)}
                {snapshot.progress >= 1 ? " • स्टेटस जाँच" : ""}
              </span>
            </div>
          ) : null}

          {resultView ? (
            <div
              className={`slip-printerResult slip-printerResult--${resultView.tone}`}
              role="status"
              aria-live="polite"
            >
              <b>
                {resultView.tone === "ok" ? (
                  <CircleCheck className="size-4" />
                ) : resultView.tone === "warn" || resultView.tone === "bad" ? (
                  <TriangleAlert className="size-4" />
                ) : (
                  <Info className="size-4" />
                )}
                {resultView.title}
              </b>
              <span>{resultView.hint}</span>
              {result?.error?.technical ? (
                <span className="slip-printerTechnical">
                  {result.error.technical}
                </span>
              ) : null}
              <div className="slip-printerResultActions">
                {retrySafely ? (
                  <button
                    type="button"
                    className="slip-printerBtn"
                    onClick={() => void runPrint(false)}
                    disabled={!connected || printing}
                  >
                    फिर कोशिश करें
                  </button>
                ) : null}
                {result?.state === "failed" ? (
                  <button
                    type="button"
                    className="slip-printerBtn"
                    onClick={dismissResult}
                    disabled={printing}
                  >
                    <X className="size-3.5" />
                    हटाएँ
                  </button>
                ) : null}
                {forceReprint ? (
                  result?.state === "uncertain" ? (
                    <button
                      type="button"
                      className="slip-printerBtn slip-printerBtnDanger"
                      onClick={() => {
                        if (!reprintArmed) {
                          setReprintArmed(true);
                          return;
                        }
                        void runPrint(true);
                      }}
                      disabled={!connected || printing}
                    >
                      {reprintArmed
                        ? "पुष्टि: फिर प्रिंट करें"
                        : "जाँच के बाद फिर प्रिंट करें"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="slip-printerBtn"
                      onClick={() => void runPrint(true)}
                      disabled={!connected || printing}
                    >
                      {result?.duplicate
                        ? "फिर भी प्रिंट करें"
                        : "फिर प्रिंट करें"}
                    </button>
                  )
                ) : null}
                {!connected ? (
                  <span className="slip-printerHint">
                    दोबारा प्रिंट के लिए प्रिंटर फिर कनेक्ट करें।
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {standaloneError ? (
            <div className="slip-printerResult slip-printerResult--bad" role="alert">
              <b>
                <TriangleAlert className="size-4" />
                {standaloneError.title}
              </b>
              <span>{standaloneError.hint}</span>
              {standaloneError.technical ? (
                <span className="slip-printerTechnical">
                  {standaloneError.technical}
                </span>
              ) : null}
              <div className="slip-printerResultActions">
                <button
                  type="button"
                  className="slip-printerBtn"
                  onClick={clearErrors}
                >
                  <X className="size-3.5" />
                  त्रुटि हटाएँ
                </button>
              </div>
            </div>
          ) : null}

          <details className="slip-printerHelp">
            <summary>समस्या हल करें (PT-210)</summary>
            <ul>
              <li>
                सिर्फ़ नया Chrome/Edge, HTTPS/localhost. Android Chrome में
                Bluetooth + Location चालू रखें; Windows में प्रिंटर पहले
                Bluetooth settings से pair करें।
              </li>
              <li>
                BLE सूची में प्रिंटर न दिखे: प्रिंटर चालू/चार्ज है, किसी दूसरे
                फ़ोन या प्रिंट ऐप से कनेक्ट नहीं है, यह जाँचें। कुछ units सिर्फ़
                Classic SPP देते हैं — Windows पर USB/COM चुनें।
              </li>
              <li>
                Windows SPP: Bluetooth pair के बाद Device Manager → Ports में
                “Outgoing” COM देखें; Chrome 117+ कभी paired SPP सीधे भी दिखा
                देता है। Chrome में USB/COM → वही port/service चुनें। आम baud
                9600 है, पर हर firmware अलग हो सकता है।
              </li>
              <li>
                खाली/टेढ़ा/धुँधला या मिरर प्रिंट: paper की thermal (coated)
                side print head की ओर रखें और paper सीधा करें; battery पर्याप्त
                हो। प्रिंटर को 2–3 सेकंड रुककर दोबारा आज़माएँ। इस ऐप में
                darkness command नहीं भेजी जाती।
              </li>
              <li>
                “अनिश्चित” का मतलब है कि कुछ डेटा जा चुका है। ऐप अपने आप दोबारा
                नहीं भेजेगा; पर्ची निकालकर, पेपर ठीक करके, फिर बटन से प्रिंट
                करें।
              </li>
              <li>
                BLE service न मिले तो unit का firmware दूसरा हो सकता है।
                USB/Serial या नीचे “पर्ची निकालें” (सिस्टम प्रिंट) इस्तेमाल
                करें। पूरी गाइड: <code>docs/pt-210-printing.md</code>.
              </li>
            </ul>
          </details>

          <p className="slip-printerPrivacy">
            पर्ची का डेटा सर्वर पर नहीं भेजा जाता — रेंडरिंग और प्रिंट इसी
            ब्राउज़र में होते हैं। फोटो उसी साइट से लोड होती है।
          </p>
        </>
      ) : null}
      </div>
    </details>
  );
}
