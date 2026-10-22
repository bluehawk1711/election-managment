/**
 * Web Serial transport — the Windows escape hatch.
 *
 * Two supported shapes:
 *   - a USB serial adapter exposed as a COM port;
 *   - Chrome 117+ Web Serial over a paired Bluetooth Classic SPP/RFCOMM port.
 *
 * The second is why Windows has a real alternative to BLE: if a PT-210 clone
 * exposes only SPP, pair it in Windows Settings and choose the outgoing COM
 * port in Chrome's serial chooser. Android Chrome does not expose Web Serial
 * for this use case, so the panel hides this option there.
 *
 * `requestPort()` with no options grants the standard SPP service class
 * (0x1101) by default. A unit that advertises a custom RFCOMM service class
 * would need `allowedBluetoothServiceClassIds`; this UI deliberately does not
 * ask for arbitrary classes, and the test unit is expected to use standard SPP.
 *
 * Web Serial has no notify channel here: no status acknowledgement is
 * possible, so a completed write is reported as `sent`, never `confirmed`.
 */
import { asPrinterError, PrinterError } from "./errors";
import type { PrinterDeviceInfo, PrinterTransport } from "./types";

export const DEFAULT_BAUD_RATE = 9600;

/** Serial writes are a stream, not a packet API; 4 KB keeps progress smooth. */
const SERIAL_CHUNK = 4096;

function hex4(value: number): string {
  return value.toString(16).padStart(4, "0").toUpperCase();
}

function describePort(port: WebSerialPort, baudRate: number): string {
  const parts: string[] = ["Web Serial"];
  try {
    const info = port.getInfo();
    if (info.bluetoothServiceClassId) {
      parts.push("Bluetooth RFCOMM/SPP");
    } else if (info.usbVendorId !== undefined) {
      parts.push(
        `USB ${hex4(info.usbVendorId)}:${hex4(info.usbProductId ?? 0)}`,
      );
    }
  } catch {
    // getInfo is optional on older implementations.
  }
  parts.push(`${baudRate} baud`);
  return parts.join(" • ");
}

export class SerialPrinterTransport implements PrinterTransport {
  readonly kind = "serial" as const;

  private port: WebSerialPort | null = null;
  private readonly baudRate: number;
  private infoValue: PrinterDeviceInfo;

  constructor(baudRate: number = DEFAULT_BAUD_RATE) {
    this.baudRate =
      Number.isFinite(baudRate) && baudRate > 0
        ? Math.trunc(baudRate)
        : DEFAULT_BAUD_RATE;
    this.infoValue = {
      kind: "serial",
      name: "Serial / COM printer",
      detail: `Web Serial • ${this.baudRate} baud`,
    };
  }

  get info(): PrinterDeviceInfo {
    return this.infoValue;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  async connect(): Promise<void> {
    const serial =
      typeof navigator === "undefined" ? undefined : navigator.serial;
    if (!serial) {
      throw new PrinterError("unsupported", "navigator.serial is unavailable");
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw new PrinterError(
        "permission",
        "Web Serial requires a secure context",
      );
    }

    let port: WebSerialPort;
    try {
      port = await serial.requestPort();
    } catch (error) {
      throw asPrinterError(error, "chooser");
    }

    try {
      await port.open({ baudRate: this.baudRate, bufferSize: 8192 });
    } catch (error) {
      throw asPrinterError(error, "connect");
    }

    this.port = port;
    this.infoValue = {
      kind: "serial",
      name: "Serial / COM printer",
      detail: describePort(port, this.baudRate),
      notifyUuid: null,
    };
  }

  async write(
    data: Uint8Array,
    onProgress?: (bytesWritten: number) => void,
  ): Promise<void> {
    const port = this.port;
    if (!port) {
      throw new PrinterError("disconnected", "Serial port is not open");
    }
    if (!port.writable) {
      throw new PrinterError(
        "no-write",
        "Serial port has no writable stream (another app may hold it)",
      );
    }

    const writer = port.writable.getWriter();
    try {
      for (let offset = 0; offset < data.length; offset += SERIAL_CHUNK) {
        const end = Math.min(offset + SERIAL_CHUNK, data.length);
        await writer.write(data.slice(offset, end));
        onProgress?.(end);
      }
      writer.releaseLock();
    } catch (error) {
      // Release the stream lock BEFORE close(); closing a locked port throws
      // and would leave the port open with no reference to it.
      this.port = null;
      try {
        writer.releaseLock();
      } catch {
        // Already released.
      }
      try {
        await port.close();
      } catch {
        // The cable/port is already gone.
      }
      throw asPrinterError(error, "write");
    }
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    if (!port) return;
    try {
      await port.close();
    } catch {
      // Closing an unplugged port throws InvalidStateError; nothing to do.
    }
  }

  /** Web Serial has no link-loss event in the main API. */
  onDisconnect(): () => void {
    return () => undefined;
  }
}
