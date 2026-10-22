/**
 * PT-210 BLE profiles.
 *
 * "PT-210" is a reused model name: GOOJPRT/MTP-II units and clones ship more
 * than one Bluetooth module/firmware. The four profiles below are
 * community-reported constants, not a GOOJPRT promise:
 *
 *   - ISSC / BT module  service 49535343-…, write 8841…, notify 1e4d…
 *   - GOOJPRT / MTP-II  service 18f0, write 2af1, notify 2af0
 *   - Vendor FF00       service ff00, write ff02, notify ff01
 *   - HM-10 style       service ffe0, write/notify ffe1
 *
 * The ISSC transparent-UART profile is first because the one public teardown
 * that exposed both ISSC and 18F0 printed through ISSC. 18F0 is also used by
 * hardware-tested PT-210 drivers, so it remains the next fallback. Neither
 * ordering is guaranteed on an arbitrary clone.
 *
 * Web Bluetooth can only see services named in `optionalServices` at chooser
 * time; there is no wildcard. This module therefore does not guess at unknown
 * vendor services. Supporting a new firmware means adding a profile here and
 * adding its service to `PT210_OPTIONAL_SERVICES`.
 *
 * Discovery is deliberately not name-based: clone names vary ("PT-210",
 * "MTP-II", "BlueTooth Printer", …), and Chrome's chooser may hide a device
 * that does not advertise a name. We ask for all devices, then match the GATT
 * services the user actually selected.
 */
import type { PrinterTransportKind } from "./types";

export interface BleProfile {
  id: string;
  label: string;
  service: string;
  write: string;
  notify?: string;
}

const BASE = "0000%s-0000-1000-8000-00805f9b34fb";

function short(hex: string): string {
  return BASE.replace("%s", hex);
}

/**
 * Community name for the 18F0 channel.
 *
 * 18F0 is not in the current Bluetooth SIG service list, and 2AF0/2AF1 are
 * nominally SIG "Electric Current" characteristics. Several PT-210 drivers
 * nevertheless use this service/characteristic pair as a print pipe; the
 * label records that usage, not an official profile.
 */
export const BLE_PROFILE_GOOJPRT: BleProfile = {
  id: "goojprt-18f0",
  label: "GOOJPRT / MTP-II 18F0 (community)",
  service: short("18f0"),
  write: short("2af1"),
  notify: short("2af0"),
};

export const BLE_PROFILE_ISSC: BleProfile = {
  id: "issc-49535343",
  label: "ISSC / BT module (49535343)",
  service: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  write: "49535343-8841-43f4-a8d4-ecbe34729bb3",
  notify: "49535343-1e4d-4bd9-ba61-23c647249616",
};

export const BLE_PROFILE_FF00: BleProfile = {
  id: "vendor-ff00",
  label: "Vendor serial bridge (FF00)",
  service: short("ff00"),
  write: short("ff02"),
  notify: short("ff01"),
};

export const BLE_PROFILE_FFE0: BleProfile = {
  id: "hm10-ffe0",
  label: "HM-10 style module (FFE0)",
  service: short("ffe0"),
  write: short("ffe1"),
  notify: short("ffe1"),
};

/** Order matters: the first known profile with a writable characteristic wins. */
export const PT210_BLE_PROFILES: readonly BleProfile[] = [
  BLE_PROFILE_ISSC,
  BLE_PROFILE_GOOJPRT,
  BLE_PROFILE_FF00,
  BLE_PROFILE_FFE0,
];

/** Every service that must be requested up front for GATT access. */
export const PT210_OPTIONAL_SERVICES: readonly string[] = Array.from(
  new Set(PT210_BLE_PROFILES.map((profile) => profile.service)),
);

export interface GattCharacteristicSummary {
  uuid: string;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}

export interface GattServiceSummary {
  uuid: string;
  characteristics: readonly GattCharacteristicSummary[];
}

export interface BleEndpoint {
  /** One of the known profile ids. Unknown services are never auto-selected. */
  profileId: string;
  profileLabel: string;
  serviceUuid: string;
  writeUuid: string;
  notifyUuid: string | null;
  /** Use `writeValueWithoutResponse`; otherwise write with response. */
  writeWithoutResponse: boolean;
}

/** Chrome returns full UUIDs, but tests and some platforms use short forms. */
export function normalizeUuid(uuid: string): string {
  const value = uuid.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(value)) return short(value);
  if (/^[0-9a-f]{8}$/.test(value)) {
    return `${value}-0000-1000-8000-00805f9b34fb`;
  }
  return value;
}

function isWritable(characteristic: GattCharacteristicSummary): boolean {
  return characteristic.write || characteristic.writeWithoutResponse;
}

function canNotify(characteristic: GattCharacteristicSummary): boolean {
  return characteristic.notify || characteristic.indicate;
}

function endpointFor(
  service: GattServiceSummary,
  write: GattCharacteristicSummary,
  profile: BleProfile,
): BleEndpoint {
  let notifyCharacteristic: GattCharacteristicSummary | undefined;

  if (profile.id === "hm10-ffe0" && canNotify(write)) {
    notifyCharacteristic = write;
  } else if (profile.notify) {
    const notifyUuid = normalizeUuid(profile.notify);
    notifyCharacteristic = service.characteristics.find(
      (characteristic) =>
        characteristic.uuid === notifyUuid && canNotify(characteristic),
    );
  }

  const notifyUuid = notifyCharacteristic?.uuid ?? null;

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    serviceUuid: normalizeUuid(service.uuid),
    writeUuid: normalizeUuid(write.uuid),
    notifyUuid: notifyUuid ? normalizeUuid(notifyUuid) : null,
    writeWithoutResponse: !write.write && write.writeWithoutResponse,
  };
}

/**
 * Pick the one known endpoint to write ESC/POS to.
 *
 * The function only matches the four profiles above, verifying the
 * characteristic properties. It never writes to a discovered endpoint just to
 * test it, and it never falls back to an arbitrary writable characteristic:
 * the printer chooser has no way to grant access to an unknown service, so
 * such a fallback would be a guess rather than support.
 *
 * Returning an endpoint only means "this looks writable". The user still sees
 * the chosen service/UUIDs in the panel and must press print.
 */
export function chooseBleEndpoint(
  services: readonly GattServiceSummary[],
): BleEndpoint | null {
  const normalized = services.map((service) => ({
    ...service,
    uuid: normalizeUuid(service.uuid),
    characteristics: service.characteristics.map((characteristic) => ({
      ...characteristic,
      uuid: normalizeUuid(characteristic.uuid),
    })),
  }));

  for (const profile of PT210_BLE_PROFILES) {
    const service = normalized.find(
      (candidate) => candidate.uuid === normalizeUuid(profile.service),
    );
    if (!service) continue;
    const write = service.characteristics.find(
      (characteristic) =>
        characteristic.uuid === normalizeUuid(profile.write) &&
        isWritable(characteristic),
    );
    if (write) return endpointFor(service, write, profile);
  }

  return null;
}

/** UI label for a transport kind; keeps copy out of the adapter. */
export function transportLabel(kind: PrinterTransportKind): string {
  return kind === "ble" ? "Bluetooth LE" : "USB / Serial (SPP)";
}
