/**
 * Minimal Web Bluetooth / Web Serial declarations.
 *
 * TypeScript's `lib.dom` does not ship Web Bluetooth, and Web Serial is still
 * absent from many DOM builds. Declaring only the surface this feature uses
 * keeps the adapters typed without adding a runtime polyfill or a dependency.
 * Names are prefixed `Web…` so they cannot collide with future lib.dom types.
 */

interface WebBluetoothCharacteristicProperties {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
  readonly authenticatedSignedWrites: boolean;
  readonly reliableWrite: boolean;
  readonly writableAuxiliaries: boolean;
}

type WebBluetoothValue = ArrayBufferView | ArrayBuffer;

interface WebBluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: WebBluetoothCharacteristicProperties;
  readonly value: DataView | null;
  writeValue(value: WebBluetoothValue): Promise<void>;
  writeValueWithResponse?(value: WebBluetoothValue): Promise<void>;
  writeValueWithoutResponse?(value: WebBluetoothValue): Promise<void>;
  startNotifications(): Promise<WebBluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<WebBluetoothRemoteGATTCharacteristic>;
}

interface WebBluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristics(): Promise<WebBluetoothRemoteGATTCharacteristic[]>;
  getCharacteristic(uuid: string): Promise<WebBluetoothRemoteGATTCharacteristic>;
}

interface WebBluetoothRemoteGATTServer {
  readonly connected: boolean;
  readonly device: WebBluetoothDevice;
  connect(): Promise<WebBluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(service?: string): Promise<WebBluetoothRemoteGATTService[]>;
  getPrimaryService(service: string): Promise<WebBluetoothRemoteGATTService>;
}

interface WebBluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: WebBluetoothRemoteGATTServer;
}

interface WebBluetoothRequestDeviceOptions {
  acceptAllDevices?: boolean;
  filters?: Array<{
    name?: string;
    namePrefix?: string;
    services?: string[];
  }>;
  optionalServices?: string[];
}

interface WebBluetooth {
  requestDevice(
    options: WebBluetoothRequestDeviceOptions,
  ): Promise<WebBluetoothDevice>;
  getAvailability?(): Promise<boolean>;
}

interface WebSerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  /** 16-bit Bluetooth service class UUID (number or string, per browser). */
  bluetoothServiceClassId?: string | number;
}

interface WebSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): WebSerialPortInfo;
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
    bufferSize?: number;
    flowControl?: "none" | "hardware";
  }): Promise<void>;
  close(): Promise<void>;
}

interface WebSerial {
  requestPort(options?: {
    filters?: Array<{
      usbVendorId?: number;
      usbProductId?: number;
      bluetoothServiceClassId?: string | number;
    }>;
    /** Required only for custom RFCOMM service classes. */
    allowedBluetoothServiceClassIds?: Array<string | number>;
  }): Promise<WebSerialPort>;
  getPorts(): Promise<WebSerialPort[]>;
}

interface Navigator {
  readonly bluetooth?: WebBluetooth;
  readonly serial?: WebSerial;
}
