/**
 * The device identity this install reports to `users/{uid}.device`.
 *
 * The per-device account lock (database.rules.json §users) works on three facts,
 * all of them client-reported because rules cannot see the device:
 *
 *   1. a stable per-install fingerprint — a UUID minted once into SecureStore
 *      and never re-minted (losing it on reinstall is exactly what makes a
 *      reinstall a "new device", which is the safe direction to fail in);
 *   2. a human label — brand + model + platform, what a super admin needs to
 *      answer "which device is this account on";
 *   3. a lock notice that has to outlive the sign-out that follows it, so the
 *      sign-in screen can say WHY the account refused to open.
 *
 * Everything here is fire-and-forget plumbing: the auth provider never blocks
 * a session on it, and a failure degrades to "no binding yet", never to a
 * locked-out user.
 */
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const FINGERPRINT_KEY = 'device.fingerprint.id';
const LOCK_NOTICE_KEY = 'auth.lockNotice';

/** The four keys `database.rules.json` accepts on `device` — byte for byte. */
export interface DeviceInfo {
  /** Stable per-install UUID (36 chars — rules demand 8..128). */
  id: string;
  /** Brand + model, e.g. "Xiaomi Redmi Note 12". */
  name: string;
  /** `Platform.OS`, one of the six the rules allow. */
  platform: string;
  /** Epoch millis of THIS write — the bind time. */
  lastActiveAt: number;
}

/** Why an account was locked — the same enum database.rules.json validates. */
export type LockReason = 'device_change' | 'admin';

/** The lock message shown on the sign-in screen after a forced sign-out. */
export interface LockNotice {
  reason: LockReason;
  at: number;
}

/** The install's stable id — minted once, then read back forever. */
export async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(FINGERPRINT_KEY);
  if (existing) return existing;
  const minted = Crypto.randomUUID();
  await SecureStore.setItemAsync(FINGERPRINT_KEY, minted);
  return minted;
}

/** Everything `users/{uid}.device` stores for this install. */
export async function deviceInfo(): Promise<DeviceInfo> {
  const id = await deviceId();
  const parts = [Device.brand, Device.modelName].filter(Boolean);
  const name = parts.join(' ').trim() || 'Unknown device';
  return {
    id,
    // Rules cap the label at 120 chars; some Android builders report absurd
    // model strings.
    name: name.slice(0, 120),
    platform: Platform.OS,
    lastActiveAt: Date.now(),
  };
}

/**
 * Leaves the reason on the sign-in screen after `firebaseSignOut()` —
 * SecureStore survives the session, which is the whole point: the user who
 * gets locked out must be told why on the very screen they land on.
 */
export async function noteLock(reason: LockReason): Promise<void> {
  const notice: LockNotice = { reason, at: Date.now() };
  await SecureStore.setItemAsync(LOCK_NOTICE_KEY, JSON.stringify(notice));
}

export async function readLockNotice(): Promise<LockNotice | null> {
  try {
    const raw = await SecureStore.getItemAsync(LOCK_NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockNotice>;
    if (parsed.reason !== 'device_change' && parsed.reason !== 'admin') {
      return null;
    }
    return { reason: parsed.reason, at: typeof parsed.at === 'number' ? parsed.at : 0 };
  } catch {
    return null;
  }
}

/** Cleared once a sign-in succeeds — the notice describes a PAST lockout. */
export async function clearLockNotice(): Promise<void> {
  await SecureStore.deleteItemAsync(LOCK_NOTICE_KEY).catch(() => undefined);
}