import { describe, expect, it } from "vitest";
import {
  asPrinterError,
  classifyError,
  failureFor,
  PrinterError,
} from "../errors";

describe("classifyError", () => {
  it("distinguishes a cancelled chooser from a missing service", () => {
    const cancelled = new DOMException("User cancelled", "NotFoundError");
    expect(classifyError(cancelled, "chooser")).toBe("cancelled");
    expect(classifyError(cancelled, "discover")).toBe("no-service");
    expect(classifyError(cancelled, "connect")).toBe("connection");
  });

  it("maps permission and link failures", () => {
    expect(
      classifyError(new DOMException("blocked", "SecurityError"), "connect"),
    ).toBe("permission");
    expect(
      classifyError(new DOMException("lost", "NetworkError"), "write"),
    ).toBe("disconnected");
    expect(
      classifyError(new DOMException("lost", "NetworkError"), "connect"),
    ).toBe("connection");
  });

  it("maps unsupported APIs and timeout-shaped errors", () => {
    expect(
      classifyError(new DOMException("nope", "NotSupportedError"), "connect"),
    ).toBe("unsupported");
    expect(
      classifyError(new DOMException("slow", "TimeoutError"), "status"),
    ).toBe("timeout");
  });

  it("maps a missing serial port selection to cancelled", () => {
    expect(classifyError(new Error("No port selected"), "chooser")).toBe(
      "cancelled",
    );
  });

  it("preserves a PrinterError code", () => {
    expect(
      classifyError(new PrinterError("duplicate", "already sent"), "write"),
    ).toBe("duplicate");
  });
});

describe("asPrinterError", () => {
  it("returns the same typed error", () => {
    const typed = new PrinterError("no-write", "missing");
    expect(asPrinterError(typed, "write")).toBe(typed);
  });

  it("wraps native errors with the stage-derived code", () => {
    const wrapped = asPrinterError(new Error("boom"), "discover");
    expect(wrapped).toBeInstanceOf(PrinterError);
    expect(wrapped.code).toBe("no-service");
  });
});

describe("failureFor", () => {
  it("marks duplicates as non-retryable and not uncertain", () => {
    const failure = failureFor("duplicate");
    expect(failure.retryable).toBe(false);
    expect(failure.uncertain).toBe(false);
    expect(failure.title).toContain("पर्ची");
  });

  it("allows callers to mark a partial write uncertain", () => {
    const failure = failureFor("write", "link lost", {
      uncertain: true,
      retryable: false,
    });
    expect(failure.uncertain).toBe(true);
    expect(failure.retryable).toBe(false);
  });

  it("trims technical text and never requires a raw message", () => {
    const failure = failureFor("unknown", "  a\n b  ");
    expect(failure.technical).toBe("a b");
    expect(failureFor("unknown").technical).toBeUndefined();
  });

  it("does not warn about a partial slip when zero bytes were written", () => {
    const disconnected = failureFor("disconnected");
    const write = failureFor("write", "nothing written", { uncertain: false });
    expect(disconnected.hint).toContain("पहले प्रिंटर कनेक्ट करें");
    expect(write.hint).toContain("कुछ नहीं छपा");
    expect(failureFor("write", "link lost", { uncertain: true }).hint).toContain(
      "पूरी नहीं छपी",
    );
  });
});
