import { describe, expect, it } from "vitest";
import { PrinterController, fingerprintOf } from "../controller";
import { PrinterError } from "../errors";
import type { RasterBitmap } from "../raster";
import type {
  PrinterDeviceInfo,
  PrinterTransport,
} from "../types";

function smallBitmap(): RasterBitmap {
  return { width: 8, height: 1, data: Uint8Array.from([0x80]) };
}

function largeBitmap(): RasterBitmap {
  return {
    width: 384,
    height: 4,
    data: new Uint8Array(48 * 4),
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeTransport implements PrinterTransport {
  readonly kind = "ble" as const;
  info: PrinterDeviceInfo = {
    kind: "ble",
    name: "Fake PT-210",
    detail: "test profile",
    serviceUuid: "000018f0-0000-1000-8000-00805f9b34fb",
    writeUuid: "00002af1-0000-1000-8000-00805f9b34fb",
    notifyUuid: "00002af0-0000-1000-8000-00805f9b34fb",
  };
  connected = false;
  writes: Uint8Array[] = [];
  failAt: number | null = null;
  connectError: Error | null = null;
  status: number[] | null = [0x12];
  gate: Promise<void> | null = null;
  connectCalls = 0;
  disconnectCalls = 0;
  private readonly listeners = new Set<() => void>();

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.connectError) throw this.connectError;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    for (const listener of [...this.listeners]) listener();
  }

  onDisconnect(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async write(
    data: Uint8Array,
    onProgress?: (bytesWritten: number) => void,
  ): Promise<void> {
    if (this.gate) await this.gate;
    for (let offset = 0; offset < data.length; offset += 10) {
      if (this.failAt !== null && offset >= this.failAt) {
        throw new PrinterError("write", "fake write failure");
      }
      const end = Math.min(offset + 10, data.length);
      this.writes.push(data.slice(offset, end));
      onProgress?.(end);
    }
  }

  async probeStatus(): Promise<number[] | null> {
    return this.status;
  }

  drop(): void {
    this.connected = false;
    for (const listener of [...this.listeners]) listener();
  }
}

function makeController(
  transport: FakeTransport,
  options: {
    now?: () => number;
    createSerial?: (baudRate: number) => PrinterTransport;
  } = {},
): PrinterController {
  return new PrinterController({
    createBle: () => transport,
    createSerial: options.createSerial ?? (() => transport),
    now: options.now,
    statusProbe: true,
  });
}

describe("fingerprintOf", () => {
  it("changes with the key or payload", () => {
    const payload = Uint8Array.from([1, 2, 3]);
    expect(fingerprintOf("a", payload)).toBe(fingerprintOf("a", payload));
    expect(fingerprintOf("a", payload)).not.toBe(
      fingerprintOf("b", payload),
    );
    expect(fingerprintOf("a", payload)).not.toBe(
      fingerprintOf("a", Uint8Array.from([1, 2, 4])),
    );
  });
});

describe("PrinterController connection", () => {
  it("connects, exposes the selected interface, and disconnects", async () => {
    const fake = new FakeTransport();
    const controller = makeController(fake);

    const result = await controller.connect("ble");
    expect(result.ok).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      connection: "connected",
      device: { name: "Fake PT-210" },
      error: null,
    });

    await controller.disconnect();
    expect(controller.getSnapshot().connection).toBe("disconnected");
    expect(controller.getSnapshot().device).toBeNull();
  });

  it("maps a connection failure without leaving a transport behind", async () => {
    const fake = new FakeTransport();
    fake.connectError = new DOMException("no link", "NetworkError");
    const controller = makeController(fake);

    const result = await controller.connect("ble");
    expect(result.ok).toBe(false);
    expect(controller.getSnapshot().connection).toBe("disconnected");
    expect(controller.getSnapshot().error?.code).toBe("connection");
  });

  it("passes the chosen baud rate to the serial factory", async () => {
    const fake = new FakeTransport();
    fake.info = { kind: "serial", name: "COM", detail: "test" };
    let seen = 0;
    const controller = makeController(fake, {
      createSerial: (baudRate) => {
        seen = baudRate;
        return fake;
      },
    });

    await controller.connect("serial", { baudRate: 115200 });
    expect(seen).toBe(115200);
    await controller.dispose();
  });
});

describe("PrinterController print outcomes", () => {
  it("marks a completed job confirmed when the printer answers", async () => {
    const fake = new FakeTransport();
    const controller = makeController(fake);
    await controller.connect("ble");

    const result = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
    });

    expect(result.state).toBe("confirmed");
    expect(result.acknowledged).toBe(true);
    expect(result.bytesWritten).toBe(result.totalBytes);
    expect(fake.writes.length).toBeGreaterThan(0);
    expect(controller.getSnapshot()).toMatchObject({
      job: "confirmed",
      progress: 1,
      error: null,
    });
  });

  it("reports sent when there is no status channel", async () => {
    const fake = new FakeTransport();
    fake.info = { ...fake.info, notifyUuid: null };
    const controller = makeController(fake);
    await controller.connect("ble");

    const result = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
    });
    expect(result.state).toBe("sent");
    expect(result.acknowledged).toBe(false);
  });

  it("reports sent when the status query times out", async () => {
    const fake = new FakeTransport();
    fake.status = null;
    const controller = makeController(fake);
    await controller.connect("ble");

    const result = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
    });
    expect(result.state).toBe("sent");
    expect(result.acknowledged).toBe(false);
  });

  it("marks a mid-write failure uncertain and never retries it", async () => {
    const fake = new FakeTransport();
    fake.failAt = 100;
    const controller = makeController(fake);
    await controller.connect("ble");

    const result = await controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
    });

    expect(result.state).toBe("uncertain");
    expect(result.bytesWritten).toBe(100);
    expect(result.error?.uncertain).toBe(true);
    expect(result.error?.retryable).toBe(false);
    expect(fake.writes.length).toBe(10);
    expect(controller.getSnapshot().job).toBe("uncertain");
  });

  it("marks a failure before any bytes as a retryable failed job", async () => {
    const fake = new FakeTransport();
    fake.failAt = 0;
    const controller = makeController(fake);
    await controller.connect("ble");

    const result = await controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
    });
    expect(result.state).toBe("failed");
    expect(result.bytesWritten).toBe(0);
    expect(result.error?.retryable).toBe(true);
    expect(controller.getSnapshot().job).toBe("failed");
  });

  it("requires an explicit force after an uncertain job", async () => {
    const fake = new FakeTransport();
    fake.failAt = 100;
    const controller = makeController(fake, { now: () => 1000 });
    await controller.connect("ble");

    const first = await controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
    });
    expect(first.state).toBe("uncertain");
    const writesAfterFailure = fake.writes.length;

    const retry = await controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
    });
    expect(retry.state).toBe("failed");
    expect(retry.duplicate).toBe(true);
    expect(retry.bytesWritten).toBe(0);
    expect(fake.writes.length).toBe(writesAfterFailure);

    const forced = await controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
      force: true,
    });
    expect(forced.state).toBe("uncertain");
    expect(fake.writes.length).toBeGreaterThan(writesAfterFailure);
  });

  it("returns failed immediately when disconnected", async () => {
    const fake = new FakeTransport();
    const controller = makeController(fake);

    const result = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
    });
    expect(result.state).toBe("failed");
    expect(result.error?.code).toBe("disconnected");
    expect(fake.writes).toHaveLength(0);
  });

  it("turns an unexpected link drop into uncertain", async () => {
    const fake = new FakeTransport();
    const gate = deferred();
    fake.gate = gate.promise;
    const controller = makeController(fake);
    await controller.connect("ble");

    const pending = controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
    });
    await Promise.resolve();
    fake.drop();

    expect(controller.getSnapshot().connection).toBe("disconnected");
    expect(controller.getSnapshot().job).toBe("uncertain");

    gate.resolve();
    const result = await pending;
    expect(result.state).toBe("uncertain");
    expect(result.bytesWritten).toBeGreaterThan(0);
  });
});

describe("PrinterController duplicate guard", () => {
  it("refuses an identical job inside the window, then allows a forced reprint", async () => {
    const fake = new FakeTransport();
    const controller = makeController(fake, { now: () => 1000 });
    await controller.connect("ble");

    const first = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
    });
    const firstWrites = fake.writes.length;
    const second = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
    });

    expect(first.state).toBe("confirmed");
    expect(second.state).toBe("failed");
    expect(second.duplicate).toBe(true);
    expect(second.bytesWritten).toBe(0);
    expect(fake.writes.length).toBe(firstWrites);

    const forced = await controller.print({
      key: "w1-1",
      bitmap: smallBitmap(),
      force: true,
    });
    expect(forced.state).toBe("confirmed");
    expect(fake.writes.length).toBeGreaterThan(firstWrites);
  });

  it("does not treat a different voter's identical payload as a duplicate", async () => {
    const fake = new FakeTransport();
    const controller = makeController(fake, { now: () => 1000 });
    await controller.connect("ble");

    await controller.print({ key: "w1-1", bitmap: smallBitmap() });
    const second = await controller.print({
      key: "w1-2",
      bitmap: smallBitmap(),
    });
    expect(second.state).toBe("confirmed");
  });

  it("drops only the oldest fingerprints when the cache is full", async () => {
    const fake = new FakeTransport();
    const controller = makeController(fake, { now: () => 1000 });
    await controller.connect("ble");

    for (let index = 0; index < 65; index += 1) {
      await controller.print({ key: `w1-${index}`, bitmap: smallBitmap() });
    }

    const recent = await controller.print({
      key: "w1-64",
      bitmap: smallBitmap(),
    });
    expect(recent.duplicate).toBe(true);

    const oldest = await controller.print({
      key: "w1-0",
      bitmap: smallBitmap(),
    });
    expect(oldest.state).toBe("confirmed");
  });
});

describe("PrinterController queue and cleanup", () => {
  it("serialises two jobs and reports the queued length", async () => {
    const fake = new FakeTransport();
    const gate = deferred();
    fake.gate = gate.promise;
    const controller = makeController(fake);
    await controller.connect("ble");

    const first = controller.print({
      key: "w1-1",
      bitmap: largeBitmap(),
    });
    const second = controller.print({
      key: "w1-2",
      bitmap: largeBitmap(),
    });

    expect(controller.getSnapshot().queueLength).toBe(1);
    gate.resolve();
    const [one, two] = await Promise.all([first, second]);
    expect(one.state).toBe("confirmed");
    expect(two.state).toBe("confirmed");
    expect(controller.getSnapshot().queueLength).toBe(0);
  });

  it("clears an error without discarding the last result", async () => {
    const fake = new FakeTransport();
    fake.failAt = 0;
    const controller = makeController(fake);
    await controller.connect("ble");

    await controller.print({ key: "w1-1", bitmap: largeBitmap() });
    expect(controller.getSnapshot().error).not.toBeNull();
    controller.clearError();
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().lastResult?.state).toBe("failed");
  });

  it("dismisses a finished result banner", async () => {
    const fake = new FakeTransport();
    fake.failAt = 0;
    const controller = makeController(fake);
    await controller.connect("ble");

    await controller.print({ key: "w1-1", bitmap: largeBitmap() });
    expect(controller.getSnapshot().lastResult).not.toBeNull();

    controller.dismissResult();
    expect(controller.getSnapshot().lastResult).toBeNull();
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().connection).toBe("connected");
  });
});
