/**
 * The printer layer's public vocabulary.
 *
 * Everything here is transport-agnostic. The BLE and Web Serial adapters in
 * this folder implement `PrinterTransport`; `controller.ts` owns the state
 * machine and queue; the slip modal renders against `PrinterSnapshot`.
 *
 * A note on honesty: a thermal printer that accepts bytes has not necessarily
 * printed them. `sent` therefore means "all bytes were handed to the OS /
 * Bluetooth stack", and `confirmed` means only "the printer answered a status
 * query". Neither is a scan of the paper. `uncertain` is the state for a job
 * that may have been partially printed — it is never retried automatically.
 */

export type PrinterTransportKind = "ble" | "serial";

export type PrinterConnectionState =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting";

export type PrinterJobState =
  | "idle"
  | "sending"
  | "sent"
  | "confirmed"
  | "uncertain"
  | "failed";

export type PrinterErrorCode =
  | "unsupported"
  | "cancelled"
  | "permission"
  | "connection"
  | "no-service"
  | "no-write"
  | "disconnected"
  | "write"
  | "timeout"
  | "busy"
  | "duplicate"
  | "render"
  | "unknown";

/** A user-facing failure. `technical` is for the panel/docs, never PII. */
export interface PrinterFailure {
  code: PrinterErrorCode;
  title: string;
  hint: string;
  /** Safe to retry without risking a duplicate print. */
  retryable: boolean;
  /** A partial job may have reached the paper. */
  uncertain: boolean;
  technical?: string;
}

/** The selected device and the exact GATT/serial endpoint in use. */
export interface PrinterDeviceInfo {
  kind: PrinterTransportKind;
  name: string;
  detail: string;
  serviceUuid?: string;
  writeUuid?: string;
  notifyUuid?: string | null;
}

export interface PrintResult {
  state: Exclude<PrinterJobState, "idle" | "sending">;
  /** The caller's opaque key (voter id). Never rendered or logged as data. */
  key: string;
  bytesWritten: number;
  totalBytes: number;
  /** The printer answered at least one `DLE EOT` query. */
  acknowledged: boolean;
  /** True when the duplicate guard produced this result. */
  duplicate?: boolean;
  error?: PrinterFailure;
  finishedAt: number;
}

export interface PrinterSnapshot {
  connection: PrinterConnectionState;
  device: PrinterDeviceInfo | null;
  job: PrinterJobState;
  /** 0..1, by bytes handed to the transport. */
  progress: number;
  bytesWritten: number;
  totalBytes: number;
  queueLength: number;
  lastResult: PrintResult | null;
  error: PrinterFailure | null;
}

/**
 * One connected printer. Implementations must be idempotent on disconnect and
 * must stop emitting after it. `probeStatus` returns raw response bytes, or
 * null when the transport has no readable side / the printer did not answer
 * within the timeout. It must never be treated as proof of paper output.
 */
export interface PrinterTransport {
  readonly kind: PrinterTransportKind;
  readonly connected: boolean;
  readonly info: PrinterDeviceInfo;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  write(
    data: Uint8Array,
    onProgress?: (bytesWritten: number) => void,
  ): Promise<void>;
  /** Only BLE with a notify characteristic can implement this honestly. */
  probeStatus?(): Promise<number[] | null>;
  /** Fires only for an unexpected link loss. */
  onDisconnect(listener: () => void): () => void;
}

export interface ConnectOptions {
  /** Web Serial only; BLE ignores it. */
  baudRate?: number;
}

export interface ConnectResult {
  ok: boolean;
  error?: PrinterFailure;
}
