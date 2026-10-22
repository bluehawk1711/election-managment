import { describe, expect, it } from "vitest";
import {
  BLE_PROFILE_FF00,
  BLE_PROFILE_FFE0,
  BLE_PROFILE_GOOJPRT,
  BLE_PROFILE_ISSC,
  chooseBleEndpoint,
  normalizeUuid,
  PT210_OPTIONAL_SERVICES,
  type GattCharacteristicSummary,
  type GattServiceSummary,
} from "../profiles";

function characteristic(
  uuid: string,
  overrides: Partial<GattCharacteristicSummary> = {},
): GattCharacteristicSummary {
  return {
    uuid,
    write: false,
    writeWithoutResponse: false,
    notify: false,
    indicate: false,
    ...overrides,
  };
}

function service(
  uuid: string,
  characteristics: GattCharacteristicSummary[],
): GattServiceSummary {
  return { uuid, characteristics };
}

const GOOJPRT_SERVICE = service(BLE_PROFILE_GOOJPRT.service, [
  characteristic(BLE_PROFILE_GOOJPRT.write, {
    write: true,
    writeWithoutResponse: true,
  }),
  characteristic(BLE_PROFILE_GOOJPRT.notify as string, { notify: true }),
]);

const ISSC_SERVICE = service(BLE_PROFILE_ISSC.service, [
  characteristic(BLE_PROFILE_ISSC.write, { writeWithoutResponse: true }),
  characteristic(BLE_PROFILE_ISSC.notify as string, { notify: true }),
]);

describe("normalizeUuid", () => {
  it("expands 16-bit Bluetooth UUIDs", () => {
    expect(normalizeUuid("ff00")).toBe(
      "0000ff00-0000-1000-8000-00805f9b34fb",
    );
  });

  it("lowercases full UUIDs", () => {
    expect(normalizeUuid(BLE_PROFILE_GOOJPRT.service.toUpperCase())).toBe(
      BLE_PROFILE_GOOJPRT.service,
    );
  });
});

describe("chooseBleEndpoint", () => {
  it("prefers ISSC when a unit exposes both ISSC and 18F0", () => {
    const endpoint = chooseBleEndpoint([GOOJPRT_SERVICE, ISSC_SERVICE]);

    expect(endpoint).toMatchObject({
      profileId: "issc-49535343",
      writeUuid: BLE_PROFILE_ISSC.write,
      notifyUuid: BLE_PROFILE_ISSC.notify,
      writeWithoutResponse: true,
    });
  });

  it("selects the 18F0 profile when ISSC is absent", () => {
    const endpoint = chooseBleEndpoint([GOOJPRT_SERVICE]);

    expect(endpoint).toMatchObject({
      profileId: "goojprt-18f0",
      writeUuid: BLE_PROFILE_GOOJPRT.write,
      notifyUuid: BLE_PROFILE_GOOJPRT.notify,
      writeWithoutResponse: false,
    });
  });

  it("falls through to the next known profile when a profile is incomplete", () => {
    const endpoint = chooseBleEndpoint([
      service(BLE_PROFILE_ISSC.service, [
        characteristic(BLE_PROFILE_ISSC.notify as string, {
          notify: true,
        }),
      ]),
      GOOJPRT_SERVICE,
    ]);

    expect(endpoint?.profileId).toBe("goojprt-18f0");
  });

  it("expands short FF00/FF02/FF01 UUIDs from discovery", () => {
    const endpoint = chooseBleEndpoint([
      service("ff00", [
        characteristic("ff02", { write: true }),
        characteristic("ff01", { notify: true }),
      ]),
    ]);
    expect(endpoint).toMatchObject({
      profileId: "vendor-ff00",
      serviceUuid: BLE_PROFILE_FF00.service,
      writeUuid: BLE_PROFILE_FF00.write,
      notifyUuid: "0000ff01-0000-1000-8000-00805f9b34fb",
    });
  });

  it("uses the shared FFE1 write/notify characteristic for HM-10 modules", () => {
    const endpoint = chooseBleEndpoint([
      service("ffe0", [
        characteristic("ffe1", { write: true, notify: true }),
      ]),
    ]);

    expect(endpoint).toMatchObject({
      profileId: "hm10-ffe0",
      writeUuid: BLE_PROFILE_FFE0.write,
      notifyUuid: normalizeUuid("ffe1"),
    });
  });

  it("never guesses at an unknown vendor writable characteristic", () => {
    // Web Bluetooth cannot grant access to a service that was not named in
    // optionalServices, so this shape is not a supportable auto fallback.
    expect(
      chooseBleEndpoint([
        service("12345678-1234-1234-1234-1234567890ab", [
          characteristic("12345678-1234-1234-1234-000000000002", {
            writeWithoutResponse: true,
            notify: true,
          }),
        ]),
      ]),
    ).toBeNull();
  });

  it("never selects a standard GATT service", () => {
    expect(
      chooseBleEndpoint([
        service("0000180f-0000-1000-8000-00805f9b34fb", [
          characteristic("00002a19-0000-1000-8000-00805f9b34fb", {
            write: true,
            notify: true,
          }),
        ]),
      ]),
    ).toBeNull();
  });

  it("returns null when the known profile has no writable characteristic", () => {
    expect(
      chooseBleEndpoint([
        service(BLE_PROFILE_GOOJPRT.service, [
          characteristic(BLE_PROFILE_GOOJPRT.notify as string, {
            notify: true,
          }),
        ]),
      ]),
    ).toBeNull();
  });

  it("requests every known service at chooser time", () => {
    expect(new Set(PT210_OPTIONAL_SERVICES)).toEqual(
      new Set([
        BLE_PROFILE_ISSC.service,
        BLE_PROFILE_GOOJPRT.service,
        BLE_PROFILE_FF00.service,
        BLE_PROFILE_FFE0.service,
      ]),
    );
  });
});
