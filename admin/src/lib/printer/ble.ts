/**
 * Web Bluetooth transport.
 *
 * Flow: `requestDevice` (user gesture) → GATT connect → discover known
 * services → choose one writable endpoint → optionally subscribe to its notify
 * characteristic. Writes are chunked because BLE characteristics have a much
 * smaller payload limit than the ~25–40 KB raster job.
 *
 * There is no silent reconnect: Web Bluetooth's device chooser is deliberately
 * gated on a user gesture, and `getDevices()` is not available without an
 * experimental flag. A dropped link therefore returns to "disconnected" and
 * the operator must choose the printer again.
 */
import { statusQuery } from "./escpos";
import { asPrinterError, PrinterError } from "./errors";
import {
  chooseBleEndpoint,
  normalizeUuid,
  PT210_OPTIONAL_SERVICES,
  type BleEndpoint,
  type GattServiceSummary,
} from "./profiles";
import type { PrinterDeviceInfo, PrinterTransport } from "./types";

/**
 * Chunking is the least portable part of BLE printing.
 *
 * 128-byte acknowledged blocks come from one community Web Bluetooth PT-210
 * gist; bitbank2's hardware-tested PT-210 library instead uses 20-byte
 * write-without-response blocks with a short delay. The third-party Python SDK
 * makes the size MTU-aware. These values are therefore a heuristic, not a
 * PT-210 specification, and must be checked on the target unit.
 */
const CHUNK_WITH_RESPONSE = 128;
const CHUNK_WITHOUT_RESPONSE = 100;
const WITHOUT_RESPONSE_SETTLE_MS = 15;
const STATUS_TIMEOUT_MS = 700;
const STATUS_FOLLOWUP_TIMEOUT_MS = 450;
const STATUS_SETTLE_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverServices(
  server: WebBluetoothRemoteGATTServer,
): Promise<GattServiceSummary[]> {
  const services = new Map<string, WebBluetoothRemoteGATTService>();

  // With `optionalServices` granted this returns everything the origin may
  // access. Some stacks throw here; the known-service pass below then covers
  // the profiles we actually need.
  try {
    for (const service of await server.getPrimaryServices()) {
      services.set(normalizeUuid(service.uuid), service);
    }
  } catch {
    // Ignore and fall through to explicit service lookups.
  }

  for (const uuid of PT210_OPTIONAL_SERVICES) {
    if (services.has(normalizeUuid(uuid))) continue;
    try {
      services.set(normalizeUuid(uuid), await server.getPrimaryService(uuid));
    } catch {
      // This profile is simply not present on the selected device.
    }
  }

  const summaries: GattServiceSummary[] = [];
  for (const service of services.values()) {
    try {
      const characteristics = await service.getCharacteristics();
      summaries.push({
        uuid: service.uuid,
        characteristics: characteristics.map((characteristic) => ({
          uuid: characteristic.uuid,
          write: characteristic.properties.write,
          writeWithoutResponse:
            characteristic.properties.writeWithoutResponse,
          notify: characteristic.properties.notify,
          indicate: characteristic.properties.indicate,
        })),
      });
    } catch {
      // A service with unreadable characteristics cannot be a print channel.
    }
  }
  return summaries;
}

export class BlePrinterTransport implements PrinterTransport {
  readonly kind = "ble" as const;

  private device: WebBluetoothDevice | null = null;
  private writeCharacteristic: WebBluetoothRemoteGATTCharacteristic | null =
    null;
  private notifyCharacteristic: WebBluetoothRemoteGATTCharacteristic | null =
    null;
  private endpoint: BleEndpoint | null = null;
  private infoValue: PrinterDeviceInfo = {
    kind: "ble",
    name: "Bluetooth printer",
    detail: "BLE",
  };
  private readonly disconnectListeners = new Set<() => void>();
  private statusWaiter: ((bytes: number[]) => void) | null = null;
  private manualDisconnect = false;

  get info(): PrinterDeviceInfo {
    return this.infoValue;
  }

  get connected(): boolean {
    return (
      this.device !== null &&
      this.device.gatt?.connected === true &&
      this.writeCharacteristic !== null
    );
  }

  private readonly onNotification = (): void => {
    const value = this.notifyCharacteristic?.value;
    if (!value || !this.statusWaiter) return;
    const waiter = this.statusWaiter;
    this.statusWaiter = null;
    waiter(
      Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
    );
  };

  private readonly onGattDisconnected = (): void => {
    if (this.manualDisconnect) return;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    this.device = null;
    this.endpoint = null;
    this.statusWaiter = null;
    for (const listener of this.disconnectListeners) listener();
  };

  async connect(): Promise<void> {
    const bluetooth =
      typeof navigator === "undefined" ? undefined : navigator.bluetooth;
    if (!bluetooth) {
      throw new PrinterError(
        "unsupported",
        "navigator.bluetooth is unavailable",
      );
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw new PrinterError(
        "permission",
        "Web Bluetooth requires a secure context",
      );
    }

    let device: WebBluetoothDevice;
    try {
      // Accept all devices: clone names vary and some modules do not advertise
      // a name at all. The operator picks the printer in Chrome's chooser.
      device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [...PT210_OPTIONAL_SERVICES],
      });
    } catch (error) {
      throw asPrinterError(error, "chooser");
    }

    const gatt = device.gatt;
    if (!gatt) {
      throw new PrinterError("no-service", "Device exposes no GATT server");
    }

    let server: WebBluetoothRemoteGATTServer;
    try {
      server = await gatt.connect();
    } catch (error) {
      throw asPrinterError(error, "connect");
    }

    try {
      const summaries = await discoverServices(server);
      const endpoint = chooseBleEndpoint(summaries);
      if (!endpoint) {
        throw new PrinterError(
          "no-service",
          "No writable GATT endpoint found among accessible services",
        );
      }

      const service = await server.getPrimaryService(endpoint.serviceUuid);
      const writeCharacteristic = await service.getCharacteristic(
        endpoint.writeUuid,
      );

      let notifyCharacteristic: WebBluetoothRemoteGATTCharacteristic | null =
        null;
      if (endpoint.notifyUuid) {
        try {
          const candidate = await service.getCharacteristic(endpoint.notifyUuid);
          if (
            candidate.properties.notify ||
            candidate.properties.indicate
          ) {
            candidate.addEventListener(
              "characteristicvaluechanged",
              this.onNotification,
            );
            await candidate.startNotifications();
            notifyCharacteristic = candidate;
          }
        } catch {
          // Notifications are an enhancement, never a prerequisite.
        }
      }

      this.device = device;
      this.writeCharacteristic = writeCharacteristic;
      this.notifyCharacteristic = notifyCharacteristic;
      this.endpoint = endpoint;
      this.manualDisconnect = false;
      device.addEventListener(
        "gattserverdisconnected",
        this.onGattDisconnected,
      );
      this.infoValue = {
        kind: "ble",
        name: device.name || "Bluetooth printer (unnamed)",
        detail: [
          endpoint.profileLabel,
          endpoint.writeWithoutResponse
            ? "write without response"
            : "write with response",
          notifyCharacteristic ? "status notifications on" : "no status channel",
        ].join(" • "),
        serviceUuid: endpoint.serviceUuid,
        writeUuid: endpoint.writeUuid,
        notifyUuid: notifyCharacteristic ? endpoint.notifyUuid : null,
      };
    } catch (error) {
      try {
        gatt.disconnect();
      } catch {
        // The link is already gone.
      }
      throw asPrinterError(error, "discover");
    }
  }

  private async send(data: Uint8Array): Promise<void> {
    const characteristic = this.writeCharacteristic;
    if (!characteristic) {
      throw new PrinterError("no-write", "No write characteristic selected");
    }

    if (
      characteristic.properties.write &&
      typeof characteristic.writeValueWithResponse === "function"
    ) {
      await characteristic.writeValueWithResponse(data);
      return;
    }
    if (
      characteristic.properties.writeWithoutResponse &&
      typeof characteristic.writeValueWithoutResponse === "function"
    ) {
      await characteristic.writeValueWithoutResponse(data);
      return;
    }
    await characteristic.writeValue(data);
  }

  async write(
    data: Uint8Array,
    onProgress?: (bytesWritten: number) => void,
  ): Promise<void> {
    if (!this.connected || !this.endpoint) {
      throw new PrinterError("disconnected", "BLE link is not connected");
    }
    if (data.length === 0) return;

    const withoutResponse = this.endpoint.writeWithoutResponse;
    const chunkSize = withoutResponse
      ? CHUNK_WITHOUT_RESPONSE
      : CHUNK_WITH_RESPONSE;

    for (let offset = 0; offset < data.length; offset += chunkSize) {
      if (!this.connected) {
        throw new PrinterError("disconnected", "BLE link dropped mid-job");
      }
      const end = Math.min(offset + chunkSize, data.length);
      // `slice` gives the browser its own ArrayBuffer; some implementations
      // do not copy a subarray before the async write settles.
      await this.send(data.slice(offset, end));
      if (withoutResponse) await delay(WITHOUT_RESPONSE_SETTLE_MS);
      onProgress?.(end);
    }
  }

  private queryStatus(n: 1 | 2 | 3 | 4, timeoutMs: number): Promise<number[] | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: number[] | null) => {
        if (settled) return;
        settled = true;
        this.statusWaiter = null;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);

      this.statusWaiter = (bytes) => finish(bytes);
      void this.send(statusQuery(n)).catch(() => finish(null));
    });
  }

  /**
   * Ask the printer for its real-time status.
   *
   * The bytes are intentionally NOT interpreted: clone firmware disagrees on
   * bit meanings. A non-empty answer means the printer is alive and received
   * the command; it does not prove the preceding raster was physically
   * printed. If any query times out we report "not acknowledged" rather than
   * guessing.
   */
  async probeStatus(): Promise<number[] | null> {
    if (!this.connected || !this.notifyCharacteristic) return null;
    await delay(STATUS_SETTLE_MS);

    const first = await this.queryStatus(1, STATUS_TIMEOUT_MS);
    if (!first || first.length === 0) return null;

    const responses = [...first];
    for (const n of [2, 3, 4] as const) {
      const next = await this.queryStatus(n, STATUS_FOLLOWUP_TIMEOUT_MS);
      if (next?.length) responses.push(...next);
    }
    return responses;
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    const notify = this.notifyCharacteristic;

    this.manualDisconnect = true;
    this.device = null;
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    this.endpoint = null;
    this.statusWaiter = null;

    if (notify) {
      try {
        notify.removeEventListener(
          "characteristicvaluechanged",
          this.onNotification,
        );
        await notify.stopNotifications();
      } catch {
        // Best-effort cleanup; the link may already be down.
      }
    }

    if (device) {
      device.removeEventListener(
        "gattserverdisconnected",
        this.onGattDisconnected,
      );
      try {
        device.gatt?.disconnect();
      } catch {
        // Already disconnected.
      }
    }

    this.manualDisconnect = false;
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }
}
