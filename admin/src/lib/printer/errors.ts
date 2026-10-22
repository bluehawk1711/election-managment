/**
 * Error normalisation for a very uneven browser API surface.
 *
 * Web Bluetooth and Web Serial throw `DOMException`s whose `name` is the only
 * reliable part (`NotFoundError` means "user cancelled the chooser" at
 * `requestDevice` but "service absent" at `getPrimaryService`). The adapter
 * passes the stage it failed in, so the same native error becomes the right
 * user-facing failure.
 *
 * Messages contain no voter data: only browser error text and our own
 * constants. Nothing in this file logs.
 */
import type {
  PrinterErrorCode,
  PrinterFailure,
  PrinterTransportKind,
} from "./types";

export type PrinterStage =
  | "chooser"
  | "connect"
  | "discover"
  | "write"
  | "status"
  | "disconnect";

/** A small typed error thrown across module boundaries. */
export class PrinterError extends Error {
  readonly code: PrinterErrorCode;

  constructor(code: PrinterErrorCode, technical: string) {
    super(technical);
    this.name = "PrinterError";
    this.code = code;
  }
}

const COPY: Record<
  PrinterErrorCode,
  { title: string; hint: string; retryable: boolean }
> = {
  unsupported: {
    title: "यह ब्राउज़र सीधे प्रिंटर से नहीं जुड़ सकता",
    hint:
      "Chrome या Edge का नया संस्करण, HTTPS (या localhost) और चालू Bluetooth इस्तेमाल करें। Android पर Web Bluetooth; Windows पर Web Bluetooth या Web Serial।",
    retryable: false,
  },
  cancelled: {
    title: "डिवाइस नहीं चुना गया",
    hint: "डिवाइस चुनने का डायलॉग बंद हो गया। प्रिंटर चालू करके दोबारा कनेक्ट करें।",
    retryable: true,
  },
  permission: {
    title: "ब्राउज़र ने अनुमति नहीं दी",
    hint:
      "साइट की सेटिंग्स में Bluetooth/Serial अनुमति दें। पेज HTTPS पर होना चाहिए; Android पर Location भी चालू रखें।",
    retryable: true,
  },
  connection: {
    title: "प्रिंटर से कनेक्शन नहीं बना",
    hint:
      "प्रिंटर चालू, पास में और किसी दूसरे फ़ोन/ऐप से कनेक्ट नहीं हो, यह जाँचें। फिर दोबारा कोशिश करें।",
    retryable: true,
  },
  "no-service": {
    title: "प्रिंटर का प्रिंटिंग प्रोफ़ाइल नहीं मिला",
    hint:
      "यह PT-210 का दूसरा फर्मवेयर हो सकता है। Windows पर USB/COM (SPP) आज़माएँ; अन्यथा सिस्टम प्रिंट का उपयोग करें।",
    retryable: false,
  },
  "no-write": {
    title: "प्रिंटर में लिखने योग्य चैनल नहीं मिला",
    hint:
      "कनेक्शन बना लेकिन डेटा भेजने का characteristic नहीं मिला। डिवाइस दोबारा चुनें या USB/Serial आज़माएँ।",
    retryable: false,
  },
  disconnected: {
    title: "प्रिंटर डिस्कनेक्ट हो गया",
    hint:
      "लिंक बीच में टूटा। अधूरी पर्ची छप सकती है — पेपर जाँचें, फिर जानबूझकर दोबारा प्रिंट करें।",
    retryable: false,
  },
  write: {
    title: "डेटा भेजते समय त्रुटि हुई",
    hint:
      "पर्ची पूरी नहीं छपी हो सकती। प्रिंटर/केबल जाँचें; अपने आप दोबारा नहीं भेजा जाएगा।",
    retryable: false,
  },
  timeout: {
    title: "प्रिंटर ने समय पर उत्तर नहीं दिया",
    hint:
      "डेटा भेजा जा चुका हो सकता है। प्रिंटर का पेपर/लाइट जाँचें और ज़रूरत हो तो जानबूझकर दोबारा प्रिंट करें।",
    retryable: true,
  },
  busy: {
    title: "एक प्रिंट पहले से चल रहा है",
    hint: "मौजूदा प्रिंट पूरा होने का इंतज़ार करें।",
    retryable: true,
  },
  duplicate: {
    title: "यही पर्ची अभी-अभी भेजी गई है",
    hint:
      "दोहरा प्रिंट रोकने के लिए नज़रअंदाज़ किया गया। जानबूझकर दोबारा छापना हो तो 'फिर भी प्रिंट करें' दबाएँ।",
    retryable: false,
  },
  render: {
    title: "पर्ची की इमेज नहीं बन सकी",
    hint:
      "प्रीव्यू रीफ्रेश करें। बार-बार विफल हो तो ब्राउज़र प्रिंट (पर्ची निकालें) का उपयोग करें।",
    retryable: true,
  },
  unknown: {
    title: "प्रिंटर में अज्ञात त्रुटि",
    hint: "कनेक्शन दोबारा बनाएँ। समस्या बनी रहे तो ब्राउज़र प्रिंट का उपयोग करें।",
    retryable: true,
  },
};

function clipboardSafe(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function failureFor(
  code: PrinterErrorCode,
  technical?: string,
  overrides: Partial<Pick<PrinterFailure, "uncertain" | "retryable">> = {},
): PrinterFailure {
  const copy = COPY[code] ?? COPY.unknown;
  const uncertain = overrides.uncertain ?? false;

  // The generic disconnected/write copy warns about a partial slip. When the
  // caller knows zero bytes were written, that warning is false and could
  // provoke an unnecessary reprint; say what actually happened instead.
  let hint = copy.hint;
  if (code === "disconnected" && !uncertain) {
    hint = "प्रिंटर कनेक्ट नहीं है। पहले प्रिंटर कनेक्ट करें, फिर प्रिंट करें।";
  } else if (code === "write" && !uncertain) {
    hint =
      "डेटा भेजना शुरू नहीं हुआ; कुछ नहीं छपा। कनेक्शन जाँचें और फिर कोशिश करें।";
  }

  return {
    code,
    title: copy.title,
    hint,
    retryable: overrides.retryable ?? copy.retryable,
    uncertain,
    technical: clipboardSafe(technical),
  };
}

function nameOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name?: unknown }).name ?? "");
  }
  return "";
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return "";
}

/**
 * Map a native failure to one code, using the stage to disambiguate.
 * Kept pure so it can be tested without a browser.
 */
export function classifyError(
  error: unknown,
  stage: PrinterStage,
): PrinterErrorCode {
  if (error instanceof PrinterError) return error.code;

  const name = nameOf(error);
  const message = messageOf(error).toLowerCase();

  if (name === "AbortError") return "cancelled";
  if (name === "NotFoundError") {
    if (stage === "chooser") return "cancelled";
    if (stage === "discover") return "no-service";
    return "connection";
  }
  if (name === "SecurityError" || message.includes("permission")) {
    return "permission";
  }
  if (name === "NotSupportedError" || message.includes("not supported")) {
    return "unsupported";
  }
  if (name === "NetworkError" || message.includes("network")) {
    return stage === "write" || stage === "status" ? "disconnected" : "connection";
  }
  if (name === "InvalidStateError") {
    return stage === "write" ? "disconnected" : "connection";
  }
  if (name === "TimeoutError" || message.includes("timed out")) {
    return "timeout";
  }
  if (
    message.includes("no port selected") ||
    message.includes("user cancelled") ||
    message.includes("user canceled")
  ) {
    return "cancelled";
  }
  if (message.includes("no services") || message.includes("service not found")) {
    return "no-service";
  }

  switch (stage) {
    case "chooser":
      return "cancelled";
    case "connect":
      return "connection";
    case "discover":
      return "no-service";
    case "write":
      return "write";
    case "status":
      return "timeout";
    case "disconnect":
      return "disconnected";
    default:
      return "unknown";
  }
}

/** Native error → the typed error the controller/adapters pass upward. */
export function asPrinterError(error: unknown, stage: PrinterStage): PrinterError {
  if (error instanceof PrinterError) return error;
  return new PrinterError(classifyError(error, stage), messageOf(error));
}

/** A capability string for the panel, not an error. */
export function unsupportedMessage(kind: PrinterTransportKind): string {
  if (kind === "ble") {
    return "Web Bluetooth उपलब्ध नहीं है। Chrome/Edge का नया संस्करण और HTTPS आवश्यक है।";
  }
  return "Web Serial उपलब्ध नहीं है। यह सुविधा मुख्यतः Windows/Mac/Linux डेस्कटॉप Chrome/Edge में है; Android पर उपलब्ध नहीं।";
}
