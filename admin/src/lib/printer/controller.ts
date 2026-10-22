/**
 * The printer state machine shared by the slip UI.
 *
 * Design rules:
 *   - One transport at a time; one job at a time, with an explicit FIFO queue.
 *   - No automatic retries. A job that wrote some bytes and then failed is
 *     `uncertain`, because the paper may already show half a slip.
 *   - A repeat of the same payload within `duplicateWindowMs` is refused unless
 *     the caller explicitly forces it. The UI turns that refusal into a
 *     deliberate "print again" action.
 *   - Connection and result state are observable via `useSyncExternalStore`.
 *
 * The controller never sees, stores, or logs a voter's name/EPIC/photo. Its
 * duplicate key is a hash of the caller's opaque voter id plus the payload.
 */
import { BlePrinterTransport } from "./ble";
import { buildPrintPayload, DEFAULT_FEED_ROWS } from "./escpos";
import { asPrinterError, failureFor, PrinterError } from "./errors";
import type { RasterBitmap } from "./raster";
import { SerialPrinterTransport, DEFAULT_BAUD_RATE } from "./serial";
import type {
  ConnectOptions,
  ConnectResult,
  PrinterConnectionState,
  PrinterFailure,
  PrinterSnapshot,
  PrinterTransport,
  PrinterTransportKind,
  PrintResult,
} from "./types";

export interface PrintRequest {
  /** Opaque stable id; the UI passes the voter row id. */
  key: string;
  bitmap: RasterBitmap;
  feedRows?: number;
  /** Bypass the duplicate guard after an explicit user confirmation. */
  force?: boolean;
}

export interface PrinterControllerOptions {
  createBle?: () => PrinterTransport;
  createSerial?: (baudRate: number) => PrinterTransport;
  now?: () => number;
  duplicateWindowMs?: number;
  /** Set false only in tests that do not want a status probe. */
  statusProbe?: boolean;
}

const INITIAL_SNAPSHOT: PrinterSnapshot = {
  connection: "disconnected",
  device: null,
  job: "idle",
  progress: 0,
  bytesWritten: 0,
  totalBytes: 0,
  queueLength: 0,
  lastResult: null,
  error: null,
};

const DEFAULT_DUPLICATE_WINDOW_MS = 10_000;

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Key + payload → a short hash identity for duplicate checks. */
export function fingerprintOf(key: string, payload: Uint8Array): string {
  return `${fnv1a(key)}:${payload.length}:${hashBytes(payload)}`;
}

interface QueuedPrint {
  request: PrintRequest;
  payload: Uint8Array;
  fingerprint: string;
  resolve: (result: PrintResult) => void;
}

export class PrinterController {
  private snapshotValue: PrinterSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private transport: PrinterTransport | null = null;
  private unsubscribeTransport: (() => void) | null = null;
  private readonly queue: QueuedPrint[] = [];
  private pumping = false;
  private readonly pendingFingerprints = new Set<string>();
  /**
   * Successful and uncertain jobs, keyed by payload fingerprint. An uncertain
   * entry is a safety guard, not a claim that paper was printed: it forces the
   * operator's explicit reprint action.
   */
  private readonly recentPrints = new Map<string, number>();
  private readonly createBle: () => PrinterTransport;
  private readonly createSerial: (baudRate: number) => PrinterTransport;
  private readonly now: () => number;
  private readonly duplicateWindowMs: number;
  private readonly statusProbe: boolean;

  constructor(options: PrinterControllerOptions = {}) {
    this.createBle =
      options.createBle ?? (() => new BlePrinterTransport());
    this.createSerial =
      options.createSerial ??
      ((baudRate) => new SerialPrinterTransport(baudRate));
    this.now = options.now ?? (() => Date.now());
    this.duplicateWindowMs =
      options.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS;
    this.statusProbe = options.statusProbe ?? true;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PrinterSnapshot => this.snapshotValue;

  /** Stable server snapshot: the panel renders the same before hydration. */
  getServerSnapshot = (): PrinterSnapshot => INITIAL_SNAPSHOT;

  private emit(patch: Partial<PrinterSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    for (const listener of this.listeners) listener();
  }

  private fail(
    key: string,
    failure: PrinterFailure,
    totalBytes = 0,
    duplicate = false,
  ): PrintResult {
    return {
      state: "failed",
      key,
      bytesWritten: 0,
      totalBytes,
      acknowledged: false,
      duplicate,
      error: failure,
      finishedAt: this.now(),
    };
  }

  private pruneRecent(now: number): void {
    for (const [fingerprint, at] of this.recentPrints) {
      if (now - at > this.duplicateWindowMs * 2) {
        this.recentPrints.delete(fingerprint);
      }
    }
    // Bound memory by dropping the oldest entries, not the whole cache.
    while (this.recentPrints.size > 64) {
      const oldest = this.recentPrints.keys().next();
      if (oldest.done) break;
      this.recentPrints.delete(oldest.value);
    }
  }

  async connect(
    kind: PrinterTransportKind,
    options: ConnectOptions = {},
  ): Promise<ConnectResult> {
    if (
      this.snapshotValue.connection === "connecting" ||
      this.snapshotValue.connection === "disconnecting"
    ) {
      return { ok: false, error: failureFor("busy") };
    }
    if (this.snapshotValue.job === "sending") {
      return { ok: false, error: failureFor("busy") };
    }
    if (this.transport) await this.disconnect();

    this.emit({
      connection: "connecting",
      device: null,
      job: "idle",
      progress: 0,
      bytesWritten: 0,
      totalBytes: 0,
      lastResult: null,
      error: null,
    });

    let transport: PrinterTransport;
    try {
      transport =
        kind === "ble"
          ? this.createBle()
          : this.createSerial(options.baudRate ?? DEFAULT_BAUD_RATE);
    } catch (error) {
      const failure = failureFor(
        asPrinterError(error, "connect").code,
        String(error),
      );
      this.emit({
        connection: "disconnected",
        device: null,
        error: failure,
      });
      return { ok: false, error: failure };
    }

    try {
      await transport.connect();
      this.transport = transport;
      this.unsubscribeTransport = transport.onDisconnect(() => {
        this.handleUnexpectedDisconnect(transport);
      });
      this.emit({
        connection: "connected",
        device: transport.info,
        job: "idle",
        progress: 0,
        bytesWritten: 0,
        totalBytes: 0,
        error: null,
      });
      return { ok: true };
    } catch (error) {
      this.transport = null;
      const unsubscribe = this.unsubscribeTransport;
      this.unsubscribeTransport = null;
      unsubscribe?.();
      const typed = asPrinterError(error, "connect");
      const failure = failureFor(typed.code, typed.message);
      try {
        await transport.disconnect();
      } catch {
        // Best-effort cleanup of a half-open link.
      }
      this.emit({
        connection: "disconnected",
        device: null,
        job: "idle",
        progress: 0,
        bytesWritten: 0,
        totalBytes: 0,
        lastResult: null,
        error: failure,
      });
      return { ok: false, error: failure };
    }
  }

  private handleUnexpectedDisconnect(transport: PrinterTransport): void {
    if (transport !== this.transport) return;
    this.transport = null;
    const unsubscribe = this.unsubscribeTransport;
    this.unsubscribeTransport = null;
    unsubscribe?.();

    const wasSending = this.snapshotValue.job === "sending";
    const failure = failureFor(
      "disconnected",
      "The printer link dropped",
      { uncertain: wasSending },
    );
    this.emit({
      connection: "disconnected",
      device: null,
      job: wasSending ? "uncertain" : this.snapshotValue.job,
      progress: wasSending ? this.snapshotValue.progress : 0,
      error: failure,
    });
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    const unsubscribe = this.unsubscribeTransport;
    this.unsubscribeTransport = null;
    unsubscribe?.();

    const wasSending = this.snapshotValue.job === "sending";
    this.emit({ connection: "disconnecting", device: null });
    try {
      await transport?.disconnect();
    } catch {
      // The link is being torn down anyway.
    }
    this.emit({
      connection: "disconnected",
      device: null,
      job: wasSending ? "uncertain" : this.snapshotValue.job,
      progress: wasSending ? this.snapshotValue.progress : 0,
      error: wasSending
        ? failureFor("disconnected", "Disconnected during a job", {
            uncertain: true,
          })
        : null,
    });
  }

  clearError(): void {
    this.emit({ error: null });
  }

  /**
   * Dismiss a finished result banner (for example, a failed job the operator
   * has read and wants to clear). An in-flight job is never dismissed.
   */
  dismissResult(): void {
    if (this.snapshotValue.job === "sending") return;
    this.emit({ lastResult: null, error: null });
  }

  /**
   * Queue one print. Resolves with the job outcome; never rejects for a printer
   * failure (the UI reads the snapshot and the result).
   */
  async print(request: PrintRequest): Promise<PrintResult> {
    let payload: Uint8Array;
    try {
      payload = buildPrintPayload(request.bitmap, {
        feedRows: request.feedRows ?? DEFAULT_FEED_ROWS,
      });
    } catch (error) {
      const failure = failureFor("render", String(error));
      const result = this.fail(request.key, failure);
      this.emit({
        error: failure,
        lastResult: result,
        job:
          this.snapshotValue.job === "sending"
            ? this.snapshotValue.job
            : "failed",
      });
      return result;
    }

    const fingerprint = fingerprintOf(request.key, payload);
    const now = this.now();
    this.pruneRecent(now);

    const recentAt = this.recentPrints.get(fingerprint);
    const duplicate =
      !request.force &&
      (this.pendingFingerprints.has(fingerprint) ||
        (recentAt !== undefined &&
          now - recentAt < this.duplicateWindowMs));

    if (duplicate) {
      const failure = failureFor("duplicate");
      const result = this.fail(request.key, failure, payload.length, true);
      this.emit({
        error: failure,
        lastResult: result,
        job:
          this.snapshotValue.job === "sending"
            ? this.snapshotValue.job
            : "failed",
      });
      return result;
    }

    const transport = this.transport;
    if (!transport || this.snapshotValue.connection !== "connected") {
      const failure = failureFor("disconnected");
      const result = this.fail(request.key, failure, payload.length);
      this.emit({
        error: failure,
        lastResult: result,
        job:
          this.snapshotValue.job === "sending"
            ? this.snapshotValue.job
            : "failed",
      });
      return result;
    }

    this.pendingFingerprints.add(fingerprint);
    return new Promise<PrintResult>((resolve) => {
      this.queue.push({ request, payload, fingerprint, resolve });
      this.emit({ queueLength: this.queue.length });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift() as QueuedPrint;
        this.emit({ queueLength: this.queue.length });
        const result = await this.run(item);
        item.resolve(result);
      }
    } finally {
      this.pumping = false;
      if (this.queue.length > 0) void this.pump();
    }
  }

  private async run(item: QueuedPrint): Promise<PrintResult> {
    const transport = this.transport;
    const { request, payload, fingerprint } = item;

    if (!transport || !transport.connected) {
      if (this.transport) {
        this.transport = null;
        const unsubscribe = this.unsubscribeTransport;
        this.unsubscribeTransport = null;
        unsubscribe?.();
      }
      const failure = failureFor("disconnected");
      const result = this.fail(request.key, failure, payload.length);
      this.pendingFingerprints.delete(fingerprint);
      this.emit({
        error: failure,
        lastResult: result,
        job: "failed",
        connection: "disconnected",
        device: null,
      });
      return result;
    }

    let written = 0;
    this.emit({
      job: "sending",
      progress: 0,
      bytesWritten: 0,
      totalBytes: payload.length,
      error: null,
    });

    try {
      await transport.write(payload, (bytes) => {
        written = bytes;
        this.emit({
          bytesWritten: bytes,
          progress:
            payload.length > 0
              ? Math.min(1, bytes / payload.length)
              : 1,
        });
      });

      if (written < payload.length) {
        throw new PrinterError(
          "write",
          "Transport reported fewer bytes than the payload",
        );
      }
      if (!transport.connected) {
        throw new PrinterError(
          "disconnected",
          "The link dropped after the final chunk",
        );
      }

      let acknowledged = false;
      if (
        this.statusProbe &&
        transport.probeStatus &&
        transport.info.notifyUuid
      ) {
        try {
          const status = await transport.probeStatus();
          acknowledged = Boolean(status && status.length > 0);
        } catch {
          // A status timeout is not a print failure; it only removes the ack.
          acknowledged = false;
        }
      }

      const state = acknowledged ? "confirmed" : "sent";
      const result: PrintResult = {
        state,
        key: request.key,
        bytesWritten: written,
        totalBytes: payload.length,
        acknowledged,
        finishedAt: this.now(),
      };
      this.recentPrints.set(fingerprint, this.now());
      this.pendingFingerprints.delete(fingerprint);
      this.emit({
        job: state,
        progress: 1,
        bytesWritten: payload.length,
        totalBytes: payload.length,
        lastResult: result,
        error: null,
      });
      return result;
    } catch (error) {
      const typed = asPrinterError(error, "write");
      const uncertain = written > 0;
      const failure = failureFor(typed.code, typed.message, {
        uncertain,
        retryable: !uncertain,
      });
      const state = uncertain ? "uncertain" : "failed";
      const result: PrintResult = {
        state,
        key: request.key,
        bytesWritten: written,
        totalBytes: payload.length,
        acknowledged: false,
        error: failure,
        finishedAt: this.now(),
      };

      this.pendingFingerprints.delete(fingerprint);
      // An uncertain job may already have put part of the slip on paper.
      // Treat it like a completed print for the duplicate window, so even a
      // direct controller caller cannot retry accidentally; the UI/operator
      // must explicitly force the reprint.
      if (uncertain) this.recentPrints.set(fingerprint, this.now());
      const linked = transport.connected;
      if (!linked) {
        const unsubscribe = this.unsubscribeTransport;
        this.unsubscribeTransport = null;
        unsubscribe?.();
        this.transport = null;
      }
      this.emit({
        job: state,
        bytesWritten: written,
        totalBytes: payload.length,
        lastResult: result,
        error: failure,
        ...(linked
          ? {}
          : { connection: "disconnected" as PrinterConnectionState, device: null }),
      });
      return result;
    }
  }

  /** Release the singleton at app teardown / between tests. */
  async dispose(): Promise<void> {
    const queued = this.queue.splice(0);
    for (const item of queued) {
      const failure = failureFor("busy", "Printer controller disposed");
      item.resolve(this.fail(item.request.key, failure, item.payload.length));
      this.pendingFingerprints.delete(item.fingerprint);
    }
    await this.disconnect();
    this.listeners.clear();
  }
}

/**
 * One controller for the browser tab. The slip modal remounts per voter, but
 * the printer connection should survive that.
 */
export const printerController = new PrinterController();
