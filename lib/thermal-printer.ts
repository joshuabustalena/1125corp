/// <reference types="web-bluetooth" />

// Bluetooth thermal receipt printing via the Web Bluetooth API.
//
// Only works in Chrome/Edge on Android or desktop — Safari (iOS/macOS) has no
// Web Bluetooth support at all, regardless of what the printer's own box or
// native app claims. The user must trigger printing from a real click (Web
// Bluetooth requires a user gesture to open the device picker).
//
// Cheap BLE thermal printers (GOOJPRT, ZJiang, and most similar clones) don't
// publish a standardized GATT service — they use one of a handful of common
// "serial-over-BLE" UUIDs depending on the internal chipset. Since the exact
// one for this printer hasn't been confirmed against real hardware, we ask
// for ALL nearby devices (so the printer shows up by name in the picker no
// matter which chipset it uses) but only request access to this list of
// known candidate service UUIDs, then probe each connected service for a
// writable characteristic. If pairing succeeds but nothing writable is
// found, the error will name the discovered services so the correct UUID
// can be added here.
const CANDIDATE_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb', // common thermal-printer profile
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / generic BLE-serial clones
  '0000ff00-0000-1000-8000-00805f9b34fb', // another common serial-over-BLE UUID
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/ISSC BLE UART service
];

let cachedCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
let cachedDevice: BluetoothDevice | null = null;

// Remembers which physical printer was picked, so future prints can
// reconnect silently instead of showing the device chooser every time.
// Web Bluetooth's requestDevice() (the chooser popup) can't be skipped on
// the very first pairing — that's a browser security requirement — but
// once a device has been granted, Chrome's getDevices() can hand back a
// reference to it without asking again, as long as it's still in range.
const REMEMBERED_DEVICE_KEY = '1125corp_thermal_printer_device_id';

async function getRememberedDevice(): Promise<BluetoothDevice | null> {
  const rememberedId = localStorage.getItem(REMEMBERED_DEVICE_KEY);
  if (!rememberedId || !navigator.bluetooth.getDevices) return null;
  try {
    const devices = await navigator.bluetooth.getDevices();
    return devices.find(d => d.id === rememberedId) ?? null;
  } catch {
    return null;
  }
}

async function findWritableCharacteristic(server: BluetoothRemoteGATTServer): Promise<BluetoothRemoteGATTCharacteristic> {
  const triedServices: string[] = [];
  for (const serviceUuid of CANDIDATE_SERVICE_UUIDS) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      triedServices.push(serviceUuid);
      const characteristics = await service.getCharacteristics();
      const writable = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (writable) return writable;
    } catch {
      // This device doesn't expose this particular service — try the next one.
    }
  }
  throw new Error(
    triedServices.length > 0
      ? `Connected, but no writable characteristic was found on: ${triedServices.join(', ')}. This printer may use a different service UUID.`
      : 'Connected, but none of the known printer service UUIDs were found on this device.'
  );
}

export async function connectThermalPrinter(): Promise<BluetoothRemoteGATTCharacteristic> {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge on Android or desktop.');
  }

  if (cachedCharacteristic && cachedDevice?.gatt?.connected) {
    return cachedCharacteristic;
  }

  // Try to silently reconnect to whichever printer was picked last time,
  // with no chooser popup, before falling back to asking the user to pick
  // again (e.g. first-ever use, or the remembered device is out of range).
  let device = await getRememberedDevice();
  if (device) {
    try {
      const server = await device.gatt?.connect();
      if (server) {
        const characteristic = await findWritableCharacteristic(server);
        cachedDevice = device;
        cachedCharacteristic = characteristic;
        device.addEventListener('gattserverdisconnected', () => {
          cachedCharacteristic = null;
          cachedDevice = null;
        });
        return characteristic;
      }
    } catch {
      // Fall through to the full picker below.
    }
  }

  device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: CANDIDATE_SERVICE_UUIDS,
  });
  localStorage.setItem(REMEMBERED_DEVICE_KEY, device.id);

  const server = await device.gatt?.connect();
  if (!server) throw new Error('Could not open a connection to the printer.');

  const characteristic = await findWritableCharacteristic(server);
  cachedDevice = device;
  cachedCharacteristic = characteristic;

  device.addEventListener('gattserverdisconnected', () => {
    cachedCharacteristic = null;
    cachedDevice = null;
  });

  return characteristic;
}

// ESC/POS byte builders — plain-text formatting only (no raster/image
// printing), since text commands are far more consistently supported across
// clone thermal printers than image printing, which needs exact dot-width
// alignment per model.
const ESC = 0x1b;
const GS = 0x1d;
// Standard column count for 58mm thermal paper at normal (non-bold) weight,
// Font A. An earlier attempt narrowed this to 24 based on the bold, centered
// header appearing to reach the paper's edge — but bold/emphasized mode
// prints noticeably wider per character on this printer than normal weight,
// so that measurement didn't hold for the plain-weight two-column rows
// (Branch/OR Number/Date/etc.), which were still falling short of the true
// right edge. Centering and right-alignment are both based on this
// constant, so recalibrating it here fixes both at once.
const LINE_WIDTH = 32;

// Most cheap thermal printers only support CP437/ASCII text — non-ASCII
// characters (like the ₱ peso sign) either print as garbage or get dropped
// by the firmware entirely, which was silently eating the digit right next
// to it. Replace known symbols with plain-ASCII equivalents before encoding.
function sanitizeForPrinter(text: string): string {
  return text
    .replace(/₱/g, 'P')
    .replace(/[^\x00-\x7F]/g, '?');
}

function textToBytes(text: string): number[] {
  return Array.from(sanitizeForPrinter(text)).map(ch => ch.charCodeAt(0) & 0xff);
}

function twoColumns(label: string, value: string): string {
  const space = LINE_WIDTH - label.length - value.length;
  return space >= 0 ? label + ' '.repeat(space) + value : `${label} ${value}`;
}

export interface ThermalReceiptLine {
  text: string;
  align?: 'left' | 'center';
  bold?: boolean;
  doubleSize?: boolean;
}

export function buildReceiptBytes(lines: ThermalReceiptLine[]): Uint8Array {
  const bytes: number[] = [];
  bytes.push(ESC, 0x40); // initialize printer

  for (const line of lines) {
    // Centering is left entirely to the printer's own ESC a 1 command below
    // — it already knows its true pixel width (including how much narrower
    // double-size characters make a line), so it centers correctly on its
    // own. Manually pre-padding with guessed spacing on top of that was
    // double-centering the text, shifting it off-center instead of fixing it.
    bytes.push(ESC, 0x61, line.align === 'center' ? 1 : 0);
    bytes.push(ESC, 0x45, line.bold ? 1 : 0);
    bytes.push(GS, 0x21, line.doubleSize ? 0x11 : 0x00);
    bytes.push(...textToBytes(line.text));
    bytes.push(0x0a); // line feed
  }

  bytes.push(GS, 0x21, 0x00); // reset size
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a); // feed extra blank lines for manual tear
  return new Uint8Array(bytes);
}

export function buildPaymentReceiptLines(data: {
  orNumber: string;
  dateText: string;
  timeText?: string;
  loanNumber?: string;
  releaseDateText?: string;
  dueDateText?: string;
  customerName: string;
  branchName?: string;
  locationText?: string;
  collectorName?: string;
  amountPaid: string;
  daysCoveredText?: string;
  remainingBalance: string;
}): ThermalReceiptLine[] {
  const bar = '='.repeat(LINE_WIDTH);
  const rule = '-'.repeat(LINE_WIDTH);

  const lines: ThermalReceiptLine[] = [];
  lines.push({ text: bar, align: 'left' });
  lines.push({ text: '1125 CREDIT COLLECTION SERVICES', align: 'center', bold: true });
  lines.push({ text: bar, align: 'left' });
  lines.push({ text: 'ACKNOWLEDGEMENT RECEIPT', align: 'center', bold: true });
  lines.push({ text: rule, align: 'left' });
  if (data.branchName) lines.push({ text: twoColumns('Branch:', data.branchName), align: 'left' });
  lines.push({ text: twoColumns('OR Number:', data.orNumber), align: 'left', bold: true });
  lines.push({ text: twoColumns('Date:', data.dateText), align: 'left' });
  if (data.timeText) lines.push({ text: twoColumns('Time:', data.timeText), align: 'left' });
  if (data.loanNumber) lines.push({ text: twoColumns('Loan #:', data.loanNumber), align: 'left' });
  if (data.releaseDateText) lines.push({ text: twoColumns('Release Date:', data.releaseDateText), align: 'left' });
  if (data.dueDateText) lines.push({ text: twoColumns('Due Date:', data.dueDateText), align: 'left' });
  lines.push({ text: rule, align: 'left' });
  lines.push({ text: twoColumns('Customer:', data.customerName), align: 'left' });
  if (data.locationText) lines.push({ text: twoColumns('Location:', data.locationText), align: 'left' });
  if (data.collectorName) lines.push({ text: twoColumns('Collector:', data.collectorName), align: 'left' });
  lines.push({ text: rule, align: 'left' });
  lines.push({ text: '', align: 'left' });
  lines.push({ text: 'AMOUNT PAID', align: 'center' });
  lines.push({ text: '', align: 'left' });
  lines.push({ text: data.amountPaid, align: 'center', bold: true, doubleSize: true });
  if (data.daysCoveredText) lines.push({ text: data.daysCoveredText, align: 'center' });
  lines.push({ text: '', align: 'left' });
  lines.push({ text: rule, align: 'left' });
  lines.push({ text: twoColumns('Remaining Balance:', data.remainingBalance), align: 'left', bold: true });
  lines.push({ text: bar, align: 'left' });
  lines.push({ text: '', align: 'left' });
  lines.push({ text: 'Thank you for your payment!', align: 'center', bold: true });
  lines.push({ text: 'This receipt is system-generated', align: 'center' });
  return lines;
}

// Chunked into small packets with a short delay between each — cheap
// BLE-serial modules (the kind used in these clone printers) can silently
// drop bytes if writes are sent back-to-back faster than their internal
// UART buffer drains, which was causing random missing characters.
export async function writeToPrinter(characteristic: BluetoothRemoteGATTCharacteristic, data: Uint8Array): Promise<void> {
  const chunkSize = 16;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
