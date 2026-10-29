# PT-210 58 mm thermal printing

Direct printing from the admin voter-slip modal to a GOOJPRT PT-210-class
58 mm Bluetooth thermal printer.

> **Hardware status: not physically validated.**
> This implementation was written against documented ESC/POS behaviour and
> community-reported PT-210 GATT profiles. No PT-210 was connected during
> development. The software tests pass, but print quality, the exact firmware
> profile of a particular unit, status reporting, feed length, and Windows
> Bluetooth reliability still need the hardware checklist at the end of this
> document.

The feature is additive. The existing HTML slip, A4 sheet, `window.print()`,
WhatsApp text, and browser PDF flows are unchanged. If direct printing is not
available, the operator can still use the original print buttons.

## What was added

| Area | File |
| --- | --- |
| Printer panel inside the voter slip | `admin/src/components/voters/printer-panel.tsx` |
| Slip integration | `admin/src/components/voters/voter-slip.tsx` |
| Printer state machine, queue, duplicate guard | `admin/src/lib/printer/controller.ts` |
| Web Bluetooth transport | `admin/src/lib/printer/ble.ts` |
| Web Serial transport | `admin/src/lib/printer/serial.ts` |
| Known PT-210 GATT profiles | `admin/src/lib/printer/profiles.ts` |
| ESC/POS payload builder | `admin/src/lib/printer/escpos.ts` |
| 384-dot slip renderer | `admin/src/lib/printer/thermal-slip.ts` |
| Bitmap and dithering helpers | `admin/src/lib/printer/raster.ts` |
| Grapheme-aware wrapping | `admin/src/lib/printer/text.ts` |
| Error mapping | `admin/src/lib/printer/errors.ts` |
| Public types | `admin/src/lib/printer/types.ts` |
| Minimal browser API typings | `admin/src/types/web-printer-apis.d.ts` |
| Panel styles and print hiding | `admin/src/app/globals.css` |
| Tests | `admin/src/lib/printer/__tests__/` |
| Relation label on the HTML slip | `admin/src/lib/roll/slip.ts` |

There are no server routes, database changes, or authentication changes. All
rendering and transport happen in the browser.

## Current scope and limitations

- The direct panel is in the **single voter-slip modal**. The batch sheet and
  A4 layout still use the browser print flow; batch direct printing is not
  implemented.
- There is no silent reconnect and no native Android helper. Each connection
  goes through the browser's device chooser.
- **Only the four known BLE profiles are supported.** Unknown firmware is not
  auto-probed. Web Bluetooth can only grant access to services named before the
  chooser, so supporting a new unit requires a code change (see below), not a
  guessed write.
- Jobs are never retried automatically. `uncertain` always requires an
  operator decision.
- The printer has no cutter command; the slip ends with about 10 mm of blank
  feed.
- Hardware validation is outstanding (see the checklist at the end).

## Verified facts vs assumptions

This feature mixes official protocol documentation, manufacturer material, and
reverse-engineered community reports. They are not equivalent evidence.

| Claim | Evidence | Confidence |
| --- | --- | --- |
| 384 dots per line, 48 mm printable width | PT-210 listings, a related MPT-II manual, third-party SDK constants, community drivers | High |
| ESC/POS `GS v 0` raster format | Epson command reference, an accessible OEM command manual, third-party drivers | High |
| 24-row raster strips | Third-party `goojprt-pt210-sdk` default | Medium-high |
| `18F0`/`2AF1` can be a print channel | Community Arduino library support plus a separate author who reports testing a PT-210 | Medium |
| ISSC `8841` can be a print channel | One public teardown that printed through it | Medium |
| PT-210 ignores `ESC d` for line feed | Community Arduino library explicitly says so and feeds with blank raster rows | Medium |
| 128-byte acknowledged BLE writes | One community Web Bluetooth gist | Low-medium; must be tested |
| `DLE EOT` answers on the notify channel | Not confirmed on a PT-210 | Unverified |

### Documented / protocol-level

- The print head is **384 dots wide** in the 58 mm class, with about 48 mm
  printable at roughly 8 dots/mm (marketed as 203 dpi). The related MPT-II
  manual lists the same 384-dot line and 48 mm print width.
- The printer accepts **ESC/POS raster** (`GS v 0`): a normal-mode header,
  little-endian width in bytes and height in rows, row-major data, eight pixels
  per byte, MSB = leftmost pixel, `1` = black. The accessible OEM command
  manual documents this layout; Epson's canonical reference is linked below but
  blocked automated fetches from this environment.
- The third-party `goojprt-pt210-sdk` splits a raster into **24-row strips** by
  default. Consecutive strips are separate `GS v 0` commands and should join
  seamlessly on paper. This implementation uses the same 24-row size.
- `ESC @` resets the printer. There is **no cutter** on this class of printer.
- The built-in character set is **ASCII / GB18030**, not Devanagari. The slip is
  therefore sent as a bitmap, not as ESC/POS text.
- Web Bluetooth requires a **secure context** (HTTPS or localhost) and a
  **user gesture** for `requestDevice()`. Chrome documents support on ChromeOS,
  Android, macOS, and Windows 10 (Chrome 70+); Linux and older Windows versions
  need an experimental flag. `getDevices()` and `watchAdvertisements()` remain
  behind a flag in current Chrome.
- `acceptAllDevices: true` still requires every service the page wants to use
  to be listed in `optionalServices`. A service that is not listed is not
  accessible later. There is no wildcard service request.
- Web Serial is a desktop Chromium API. Since Chrome 117, desktop Chrome can
  also expose paired Bluetooth Classic RFCOMM/SPP ports. **Standard SPP**
  (service class `0x1101`) is allowed by default; a unit using a custom RFCOMM
  service class needs `allowedBluetoothServiceClassIds`. This panel calls
  `requestPort()` with no options, so it supports standard SPP only.
- A thermal printer accepting bytes does **not** prove that paper came out.
  `DLE EOT` is a status query, not a paper scan.

### Community-reported GATT layouts

The GATT layout is not consistent across PT-210 units and clones. The profiles
implemented here, in priority order, are:

| Priority | Profile | Service | Write | Notify |
| --- | --- | --- | --- | --- |
| 1 | ISSC / BT module | `49535343-fe7d-4ae5-8fa9-9fafd205e455` | `49535343-8841-43f4-a8d4-ecbe34729bb3` | `49535343-1e4d-4bd9-ba61-23c647249616` |
| 2 | GOOJPRT / MTP-II 18F0 (community) | `000018f0-0000-1000-8000-00805f9b34fb` | `00002af1-0000-1000-8000-00805f9b34fb` | `00002af0-0000-1000-8000-00805f9b34fb` |
| 3 | Vendor FF00 | `0000ff00-0000-1000-8000-00805f9b34fb` | `0000ff02-0000-1000-8000-00805f9b34fb` | `0000ff01-0000-1000-8000-00805f9b34fb` |
| 4 | HM-10-style FFE0 | `0000ffe0-0000-1000-8000-00805f9b34fb` | `0000ffe1-0000-1000-8000-00805f9b34fb` | same characteristic |

The `18F0` label needs care. It is **not** the standard Battery Service; the
SIG Battery Service is `180F`. `2AF0`/`2AF1` are nominally SIG Electric Current
characteristics. Several PT-210 drivers nevertheless use `18F0` + `2AF1` as a
print pipe, including a community Arduino library and a sketch whose author
reports testing a PT-210 running MPT-II firmware. Treat the label as a
community convention, not an official GOOJPRT profile.

One public teardown found both `18F0` and ISSC on the same unit and printed
through ISSC. Its article calls `18F0` a battery service, which is inaccurate,
and its custom `e7810a71-…` service advertised a write property that rejected
writes. That is why this code prefers ISSC when both are present, keeps `18F0`
as the next fallback, and never writes to an arbitrary vendor characteristic
just to test it.

### BLE chunking is not standardised

The BLE transport uses 128-byte blocks when the characteristic supports
write-with-response, and 100-byte blocks with a short settle delay when it only
supports write-without-response. Those sizes are a heuristic from one community
Web Bluetooth gist. Other evidence disagrees:

- a community Arduino library uses 20-byte write-without-response blocks with a
  short pause for the PT-210;
- the third-party Python SDK makes its chunks MTU-aware and uses
  write-without-response;
- the Web Bluetooth gist reports 128-byte acknowledged blocks.

Chunk size, pacing, and the negotiated ATT MTU therefore remain hardware
validation items. A successful write only means the browser accepted the bytes.

### Not verified without hardware

- Which profile a specific unit exposes, and whether it exposes BLE, Classic
  SPP, or both.
- Whether the unit honours `DLE EOT` and what bytes it returns. This code does
  not interpret status bits for that reason.
- Actual darkness, contrast, photo quality, feed length, and long-run
  reliability.
- Whether the unit accepts 128-byte BLE writes reliably.
- Windows Bluetooth-stack behaviour with a particular adapter/driver.
- Whether a given clone needs energy/darkness commands or different chunking.

## How it works

1. The operator opens a voter slip. The panel renders the slip data to an
   in-memory 384-dot canvas and shows a preview.
2. Connect opens the browser device chooser. For BLE, the adapter connects to
   GATT, discovers the four known services, and picks the first profile with a
   writable characteristic. It does not fall back to an unknown service. The
   selected service/write/notify UUIDs are shown in the panel.
3. Printing rasterises the canvas to a 1-bit bitmap, builds one ESC/POS job,
   queues it, and writes it in chunks. Only one job runs at a time.
4. The result is reported from what the transport actually knows: bytes handed
   to the stack, plus an optional status acknowledgement. It never claims that
   paper was physically printed.

### Rendering details

- Canvas width: **384 dots**. Side margins: 14 dots (1.75 mm) each.
- The layout is the flat reference mock: four short centred cut dashes above a
  dashed rectangle, then nine left-aligned `label : value` rows inside it —
  वार्ड नंबर, मतदाता क्रम नंबर, नाम, आई कार्ड, व्यवसाय (printed blank; the roll
  has no occupation field), लिंग, संबंधित नाम, बूथ नंबर, बूथ.
- No badge, title, photo, EPIC/booth boxes, footer or date/time are drawn — the
  reference mock has none. `VoterSlipData` still carries those fields for the
  HTML slip and the WhatsApp message. The optional rank/colour label
  (`rangLabel`) is accepted by the renderer but not printed.
- Long values (names, booth addresses) wrap by grapheme cluster
  (`Intl.Segmenter` when available), so a Devanagari matra is not split from
  its consonant; continuation lines stay flush left.
- Text uses the app's next/font Devanagari face
  (`--font-devanagari` on `<body>`), falling back to Mangal/Nirmala/system
  sans. Font loading is awaited before drawing, but a font failure does not
  block printing.
- The canvas is thresholded to 1-bit with a hard cutoff (default luminance
  180) so text and dashes keep crisp edges. The renderer no longer loads or
  dithers photos.
- The rendered bitmap excludes the feed, which is added by the ESC/POS builder.
  Default feed is **80 blank raster rows**, about 10 mm at 8 dots/mm. The exact
  distance depends on the mechanism and paper, so treat it as approximate.
- Maximum render height is 2400 dots (about 300 mm). An unexpectedly tall slip
  fails with a render error rather than allocating without bound.

### ESC/POS payload

```
ESC @                   1B 40          initialise
GS v 0 0 xL xH yL yH   1D 76 30 00 …  one 24-row raster strip
… repeated for each 24-row strip …
GS v 0 … blank rows     1D 76 30 00 …  about 10 mm of blank feed
```

No font, code-page, darkness, energy, or cutter command is sent. Darkness and
energy commands vary between clones and are not needed for a first hardware
validation.

**There is no `ESC d`.** The third-party Python SDK defines a feed helper, but
the community Arduino library explicitly reports that the PT-210 has no
feed-by-line command and advances paper by printing blank 1×1 `GS v 0` rows.
This implementation follows the latter, with a full-width blank raster so the
feed is not dependent on a narrow-strip implementation. If the unit does honour
`ESC d`, the blank-raster approach still advances paper and remains harmless.

When a notify characteristic is available, the controller optionally sends
`DLE EOT 1`, then 2-4, after the raster. Any non-empty response is treated as
"the printer answered", producing `confirmed`. The bits are deliberately not
interpreted. A transparent BLE module could also echo a command rather than
return a genuine status, which is another reason `confirmed` is not a paper
proof. No notify channel means the best possible result is `sent`.

### Transports and platform support

| Platform | BLE (Web Bluetooth) | Web Serial (SPP / USB COM) | Browser system print |
| --- | --- | --- | --- |
| Android Chrome | Yes, if the unit exposes BLE | Not supported for this workflow | Yes |
| Windows Chrome / Edge (Chromium) | Yes on Windows 10+ with a working Bluetooth adapter | Yes, including Chrome 117+ paired Bluetooth Classic SPP | Yes |
| macOS Chrome | Yes | Yes | Yes |
| Firefox / Safari | No | No | Yes |

Edge is Chromium-based and exposes the same APIs, but Edge should still be
included in hardware validation rather than assumed identical to Chrome.

The panel detects `navigator.bluetooth` and `navigator.serial`; unsupported
buttons are hidden or disabled. It also refuses to start when the page is not a
secure context. Nothing is simulated: if the API or device is missing, the
panel says so.

## Setup

### Android Chrome (BLE)

1. Install a current Chrome from the Play Store. Chrome (not an in-app browser)
   must host the page.
2. Open the admin site over **HTTPS** or `localhost`. A plain-HTTP LAN address
   is not a secure context.
3. Turn on Bluetooth. If Android/Chrome asks for **Nearby devices** or Location
   permission, allow it.
4. Power on the printer, load paper, and make sure no other phone or printer
   app is connected to it.
5. Open a voter slip, expand **थर्मल प्रिंटर**, press **Bluetooth (BLE) से जोड़ें**,
   and choose the printer in Chrome's chooser. Names vary (`PT-210`, `MTP-II`,
   `BlueTooth Printer`, or no name), so the chooser deliberately shows all
   nearby devices.
6. Confirm the panel shows a device, a profile, and service/write UUIDs. If it
   reports that no printing profile was found, see Troubleshooting.

### Windows Chrome / Edge (BLE)

1. Use Windows 10 or later with a working Bluetooth adapter.
2. Pair the printer in **Settings > Bluetooth & devices > Add device** if
   Windows does not discover it automatically.
3. Open the site in Chrome or Edge over HTTPS/localhost.
4. Use **Bluetooth (BLE) से जोड़ें**, exactly as on Android.
5. If the unit exposes only Classic SPP, use the Web Serial path below instead.

### Windows SPP / USB serial

1. Pair the printer in Windows Bluetooth settings.
2. Open **Device Manager > Ports (COM & LPT)** and look for an **outgoing**
   COM port for the printer. Some drivers create it automatically; otherwise
   use **More Bluetooth options > COM Ports > Add > Outgoing**. Chrome 117+
   can also enumerate a paired RFCOMM/SPP service directly, so an outgoing COM
   port is not always required.
3. In the printer panel choose **USB / COM**. In Chrome's serial chooser pick
   the matching port (or the paired SPP service, if Chrome lists it directly).
   The panel shows whether the port reports itself as Bluetooth RFCOMM/SPP or
   USB, plus the selected baud rate.
4. Default baud is **9600**. Try **19200 / 38400 / 57600 / 115200** only if the
   printer produces nothing or garbage at 9600. Change baud only while
   disconnected. RFCOMM/SPP links often ignore the baud setting; it matters
   most for a USB-serial adapter.
5. Close other programs that hold the COM port (printer drivers, POS tools,
   Arduino IDE, etc.) before connecting.

For a USB cable, the same USB/COM path works when the OS exposes the printer as
a COM port. The printer's USB port is not a mass-storage device.

`requestPort()` with no options requests standard SPP. If a unit advertises a
custom RFCOMM service class, this panel will not show it; adding that support
would require passing `allowedBluetoothServiceClassIds` and validating the
specific class. That is a deliberate restriction, not a missing browser
feature.

## Using the panel

- **Connect / Disconnect**: one transport at a time. The Disconnect button is
  disabled while a job is sending. If the link drops mid-job, the result is
  `uncertain`; the panel never pretends the job succeeded.
- **Selected interface**: the panel prints the device name, transport kind,
  profile label, write mode, notification availability, and short
  service/write UUIDs. Hover the UUID line for the full values.
- **Preview**: a PNG preview of the exact 384-dot bitmap, with its dot/mm
  dimensions and the approximate 10 mm feed note. The preview is an in-memory
  data URL and is not persisted.
- **Print**: disabled until a transport is connected and the preview is ready.
  It is also disabled after an `uncertain` result; the operator must use the
  explicit two-click reprint action there.
- **Retry**: offered only when a failed job wrote **zero** bytes, so retrying
  cannot duplicate a partial slip.
- **Print again**: after `sent`, `confirmed`, `uncertain`, or a duplicate
  refusal. For `uncertain`, the button turns into a second-click confirmation
  ("पुष्टि: फिर प्रिंट करें") so the operator must acknowledge the warning and
  check the paper first. Nothing is ever reprinted automatically.
- **Clear/dismiss**: connection errors, preview errors, and failed results can
  be dismissed. A `sent`/`confirmed`/`uncertain` result stays visible so the
  operator can see what happened.
- **Troubleshooting**: an expandable list of the most common PT-210 problems is
  built into the panel.

### Result states

| State | Meaning | What to do |
| --- | --- | --- |
| `confirmed` | All bytes were written and the printer answered at least one `DLE EOT` query. | Still look at the paper. A status answer is not a print scan. |
| `sent` | All bytes were handed to the browser/OS transport. No status channel, or the printer did not answer. | Look at the paper. |
| `uncertain` | Some bytes were written, then the write or link failed. A partial slip may exist. | Check the paper. Fix the link/paper. Reprint only deliberately. |
| `failed` | No bytes were written (or the duplicate guard refused). | Retry is safe when the guard did not refuse; otherwise use the explicit reprint action. |

### Duplicate guard

The controller remembers a short FNV-1a fingerprint of the voter key plus the
exact ESC/POS payload for **10 seconds**. This is a cache key, not a
cryptographic hash and not a print history. A second identical job inside that
window is refused and shows "यही पर्ची अभी-अभी भेजी गई है". The UI offers
**फिर भी प्रिंट करें** for a deliberate override.

The window includes `uncertain` jobs, not just successful ones. A partial
print may already be on the paper, so a non-forced retry is refused even when
the caller bypasses the UI. The guard is in memory only and stores no voter
data.

## Privacy and security

- No voter data is sent to a new server endpoint. The slip is rendered and
  printed in the browser. Photos come from the site's existing same-origin
  `/photos/...` paths.
- The preview data URL stays in component state. It is not written to
  localStorage, IndexedDB, cookies, or the server.
- The printer controller stores only an opaque caller key and an FNV-1a
  fingerprint in memory. Its types and error strings contain no name, EPIC,
  address, or photo.
- There are no `console.log`/`console.error` calls in the printer library.
  Browser error text in the expandable technical line is limited to 240
  characters and contains transport messages, not voter fields.
- The feature adds no client-side authentication bypass. Voter data is already
  gated by the existing admin session and loaded by the existing pages; the
  printer panel only consumes the slip data it is given.
- Web Bluetooth/Serial permission prompts are browser-controlled. The app does
  not silently reconnect, and it does not call `getDevices()`/`getPorts()` to
  bypass the chooser.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| "इस ब्राउज़र में Web Bluetooth/Serial नहीं है" | Firefox/Safari, an old browser, an in-app browser, or a non-secure page | Use current Chrome/Edge over HTTPS or localhost. On Android use Chrome, not an in-app webview. |
| "HTTPS आवश्यक है" | Page is on plain HTTP (not localhost) | Serve the admin site over HTTPS. Browser print still works. |
| Chooser shows no printer | Printer off/asleep, already connected elsewhere, Bluetooth off, missing Android Nearby devices/Location permission, or the name is hidden | Power-cycle the printer, disconnect other apps, enable Bluetooth and permissions, then reopen the chooser. The chooser intentionally shows all devices. |
| "प्रिंटिंग प्रोफ़ाइल नहीं मिला" | This unit's BLE service is not one of the four known profiles, or it exposes only Classic SPP | On Windows pair it and use **USB / COM**. Otherwise use browser print. To support a new profile, add it to `profiles.ts` (see below). |
| Connected but no write characteristic | GATT service is present but the expected characteristic is not writable | Re-select the device; try the Windows SPP/USB path. Do not write to an unknown characteristic just to test it. |
| Connected but nothing prints | The selected profile may not be wired to the print head, paper may be reversed, or the unit uses a different channel | Check paper orientation and battery first. Record the shown UUIDs. Try Windows SPP or browser print; do not blindly write to other characteristics. |
| Windows COM port is missing | Printer not paired, no outgoing COM port, or another program holds it | Pair again and reopen the chooser: Chrome 117+ may list the SPP service directly. Otherwise check Device Manager > Ports and create an outgoing COM port; close competing apps. |
| Serial output is blank or garbled | Wrong baud rate, wrong COM port, or printer is not ESC/POS on that channel | Try 9600 first, then 115200; confirm the port is the printer, not a phone/other device. |
| Print is blank or extremely faint | Paper loaded with the thermal side facing the wrong way, low battery, or printer asleep | Flip the paper so the heat-sensitive side faces the print head. Charge the printer. Reversed paper can also look horizontally mirrored; fix the paper, do not mirror the data or add density commands. |
| Print is clipped on the right | Bitmap wider than 384 dots or paper misaligned | The bundled renderer always uses 384 dots. Check that the paper is seated straight and the unit is a 58 mm/384-dot model. |
| Feed is too short to tear off | The blank-raster feed is approximate and mechanics vary | Use the browser print flow if the slip tears badly, or treat the blank-row count as a hardware-tuning item. Do not assume `ESC d` will fix it on this model. |
| "अधूरा प्रिंट हो सकता है" | Link dropped or a write failed after some bytes | Inspect the paper, reconnect, then use the deliberate reprint button. Do not assume the slip is complete. |
| Status never becomes `confirmed` | No notify characteristic, firmware ignores `DLE EOT`, or notifications need a subscription that failed | `sent` is the honest result. Check the paper. Do not treat this as a software failure. |
| Duplicate refused | Same voter/payload printed (or left uncertain) within 10 seconds | Check the output tray, then use **फिर भी प्रिंट करें** only if a second copy is really needed. |
| Preview fails / "पर्ची की इमेज नहीं बन सकी" | Canvas/font failure or slip taller than the 2400-dot cap | Refresh the preview. If it persists, use the existing browser print/A4 flow. |

## Adding a new BLE firmware profile

1. Use `chrome://bluetooth-internals` (or nRF Connect) to inspect the unit's
   services and characteristics.
2. Add a `BleProfile` to `admin/src/lib/printer/profiles.ts` with the service,
   writable characteristic, and optional notify characteristic.
3. Add it to `PT210_BLE_PROFILES` in priority order. `PT210_OPTIONAL_SERVICES`
   is derived from that list, which matters because Chrome only grants access
   to services named in `optionalServices`.
4. Confirm the write characteristic is actually writable; some vendor services
   advertise a write property on a characteristic that rejects writes.
5. Add or update a profile test in
   `admin/src/lib/printer/__tests__/profiles.test.ts`, then run the checks below.
6. Hardware-test with a small raster before trusting a production slip.

If the unit only exposes Classic SPP, no BLE profile will help; use the
Windows Web Serial path. Android has no equivalent fallback in this feature.

## Disabling or removing the feature

The direct printer is self-contained and additive. To disable it:

- Remove the `ThermalPrinterPanel` import and its element from
  `admin/src/components/voters/voter-slip.tsx`.
- Optionally remove the `.slip-printer*` rules from `admin/src/app/globals.css`
  and the `admin/src/lib/printer/` tree.
- Leave the existing HTML slip and print buttons in place; they are independent.

There is no environment flag and no server-side switch. A deployment that does
not want Web Bluetooth/Serial can simply omit the panel; the browser APIs are
only requested after a user presses Connect.

## Development checks

From `admin/`:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

Current software results (no hardware attached):

- `pnpm typecheck` - passes.
- `pnpm test` - **79 tests in 8 files pass**.
- `pnpm build` - production build passes (Next.js 16.4.2, Turbopack).
- Targeted ESLint on the printer files and the changed slip files - clean.
- Full `pnpm lint` still reports pre-existing errors in unrelated files
  (`settings/page.tsx`, `tasks/page.tsx`, `users/page.tsx`,
  `voter-drawer.tsx`, `use-live.ts`). Those are not introduced by this
  feature; see the command output before changing them.

The tests cover:

- ESC/POS init, raster headers, 24-row strips, bit order, blank-raster feed,
  payload composition, and the absence of `ESC d`.
- Bitmap thresholding, Bayer mode, alpha handling, dithering, and range checks.
- Grapheme-aware wrapping, long-word breaks, newlines, and whitespace.
- The thermal slip's nine `label : value` rows in the reference-mock order,
  including the blank `व्यवसाय` line, no heading/footer leaking into the flat
  field list, and a loud failure when no browser document exists.
- GATT profile priority (ISSC over 18F0), profile fallbacks, UUID
  normalisation, standard-service exclusion, and refusal to guess at unknown
  vendor services.
- Error classification and user-facing failure copy.
- Controller connect/disconnect, confirmed/sent/uncertain/failed outcomes,
  queue serialisation, duplicate guard including uncertain jobs, baud plumbing,
  cleanup, and result dismissal.

## Hardware validation checklist

Run this on a real unit before calling the feature field-ready:

- [ ] Record the exact model label, firmware/version if shown, and whether the
      unit advertises BLE, Classic SPP, or both.
- [ ] On Android Chrome over HTTPS, connect through **Bluetooth (BLE)**.
      Record the chooser name and the service/write/notify UUIDs shown in the
      panel. Confirm they match one of the known profiles or document the new
      one.
- [ ] If both ISSC and 18F0 are present, record which profile the code chose
      (ISSC) and whether printing works. If it does not, record whether 18F0
      would have been the working channel; do not ship a blind fallback based
      on that result.
- [ ] On Windows Chrome and Edge on Windows 10/11, repeat the BLE connection.
      Note any driver/stack failures.
- [ ] On Windows, pair the unit and test **USB / COM** over SPP. Record the
      outgoing COM port and the working baud rate (9600 first).
- [ ] Print a normal slip. Check: 384-dot width, left/right margins,
      Devanagari shaping, name/EPIC/booth legibility, the four cut dashes, the
      dashed box, the roughly 10 mm blank feed, and no cut attempt.
- [ ] Print a voter with a very long name and a long booth address. Confirm
      rows wrap flush left with no clipped text.
- [ ] Print with the paper reversed deliberately. Confirm the faint/mirrored
      symptom and that flipping the paper fixes it without code changes.
- [ ] Power the printer off during a job. Confirm the UI reports `uncertain`
      (not `sent`/`confirmed`), does not auto-retry, and offers a deliberate
      reprint.
- [ ] Press the normal print button after an `uncertain` result. Confirm it is
      disabled and the two-click reprint is the only path.
- [ ] Print the same voter twice within 10 seconds. Confirm the duplicate guard
      refuses the second job and the override prints only after an explicit
      action.
- [ ] Remove the printer's notify channel or use a unit without one. Confirm the
      result is `sent`, not `confirmed`.
- [ ] If the unit answers `DLE EOT`, record the bytes and whether `confirmed`
      appears. Do not infer paper output from them.
- [ ] Run a 20-30 slip batch and check for dropped BLE blocks, buffer stalls,
      overheating, and battery behaviour. Record whether 128-byte chunks are
      sufficient; also try the 100-byte no-response path if the unit offers it.
- [ ] In DevTools, confirm no voter fields appear in console output, no new
  third-party requests are made, and the preview is not persisted. The thermal
  renderer loads no photos at all; the HTML slip's own same-origin photo path
  (`/photos/.../<voterId>.jpg`) is existing slip behaviour, not a new data
  flow.
- [ ] Verify the existing browser print/A4 path still produces the unchanged
      slip and that the printer panel is absent from the printed page.

Until this checklist is complete, treat direct printing as a tested software
path with unverified hardware behaviour, not as a guaranteed replacement for
the browser print fallback.

## Sources

### Official / manufacturer

- Chrome Web Bluetooth guide (secure context, user gesture, platform support,
  `acceptAllDevices` + `optionalServices`):
  https://developer.chrome.com/docs/capabilities/bluetooth
- Chrome Web Serial guide:
  https://developer.chrome.com/docs/capabilities/serial
- Chrome 117 Bluetooth Classic RFCOMM/SPP over Web Serial:
  https://developer.chrome.com/blog/serial-over-bluetooth
- MDN `Bluetooth.getDevices()` (availability):
  https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/getDevices
- Web Bluetooth implementation status (`getDevices` /
  `watchAdvertisements` behind a flag):
  https://github.com/whatwg/bluetooth/blob/main/implementation-status.md
- Bluetooth SIG assigned numbers (Battery Service `180F`, Electric Current
  characteristics `2AF0`/`2AF1`):
  https://www.bluetooth.com/specifications/assigned-numbers/
- Epson ESC/POS `GS v 0` raster reference (canonical; automated fetches may be
  blocked):
  https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html
- Epson ESC/POS `DLE EOT` real-time status reference (canonical; automated
  fetches may be blocked):
  https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/dle_eot.html
- Accessible OEM ESC/POS command manual used to cross-check `GS v 0` and
  `DLE EOT`:
  https://aures-support.com/DATA/drivers/Imprimantes/Commande%20ESCPOS.pdf
- Related MPT-II user manual (384 dots, 48 mm print width, ESC/POS, GB18030):
  https://www.ht-instruments.it/media/filer_public/f0/4e/f04e8540-41bc-46d3-ae45-10e98973ab45/mpt-ii_user_manual.pdf
- PT-210 manual copy (reseller copy; may block automated fetches):
  https://manuals.plus/goojprt/pt-210-58mm-mini-portable-bluetooth-printer-manual
- Microsoft Windows Bluetooth pairing:
  https://support.microsoft.com/en-us/windows/hardware/bluetooth/pair-a-bluetooth-device-in-windows

### Third-party / community

- `goojprt-pt210-sdk` (third-party Python driver by Filip Sedivy, not an
  official GOOJPRT SDK) - constants, commands, raster strips:
  https://goojprt-pt210-sdk.readthedocs.io/en/latest/api/constants.html
  https://goojprt-pt210-sdk.readthedocs.io/en/latest/api/commands.html
  https://goojprt-pt210-sdk.readthedocs.io/en/latest/api/raster.html
- CitrusDev PT-210 teardown (384 dots, ESC/POS, GB18030, GATT dump, ISSC print
  path, 18F0 label caveat):
  https://citrusdev.com.ua/portable-bluetooth-thermal-printer-goojprt-pt-210/
- bitbank2 `Thermal_Printer` Arduino library (PT-210 branch, `18F0`/`2AF1`,
  blank-raster feed, chunking note):
  https://github.com/bitbank2/Thermal_Printer
- MYCAMEL222 `ArduinoBLE_MPTII_ThermalPrinters` (author reports testing a
  GOOJPRT PT-210 running MPT-II firmware):
  https://github.com/MYCAMEL222/ArduinoBLE_MPTII_ThermalPrinters
- JakubAndrysek PT-210 Web Bluetooth gist (18F0/2AF1/2AF0, 384 px, 128-byte
  acknowledged blocks, paper-orientation note; single community source):
  https://gist.github.com/JakubAndrysek/caf19af777b460c420612f692e9f16e8
