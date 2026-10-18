/**
 * The panel's half of the per-device account lock — the mirror of
 * `mobile/lib/device.ts`, because the two surfaces enforce the SAME rule:
 *
 *   one account → one bound device. A sign-in anywhere else locks the
 *   account and ends its session; only a super admin unlocks, and the
 *   unlock drops the binding so the rightful device re-binds.
 *
 * One deliberate asymmetry, mirrored in `firestore.rules §users`: a
 * SUPER ADMIN is not device-bound. They rebind this browser instead of
 * locking themselves out — the account that unlocks everyone else must
 * never end up hostage to a single laptop. A deliberate admin lock still
 * applies to them.
 *
 * The fingerprint lives in `localStorage` (the web analogue of the app's
 * SecureStore UUID): stable per browser profile, re-minted by an incognito
 * window or a cleared cache — which correctly counts as "a new device", the
 * safe direction to fail in.
 *
 * The lock NOTICE has to outlive the sign-out that follows it, so the login
 * page can say why the previous session died instead of silently accepting
 * credentials the rules will keep refusing.
 *
 * Enforcement itself runs from `providers.tsx` on every profile snapshot,
 * right after `applyProfile` — same three states, same order as the app:
 * already locked → foreign device → first bind.
 */
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';

const DEVICE_KEY = 'campaignhq.deviceId';
const NOTICE_KEY = 'campaignhq.lockNotice';

/** Why an account was locked — the enum firestore.rules validates. */
export type LockReason = 'device_change' | 'admin';

export interface LockNotice {
  reason: LockReason;
  at: number;
}

/** The four keys `firestore.rules::validDevice` accepts — byte for byte. */
export interface DeviceFingerprint {
  id: string;
  name: string;
  platform: string;
  lastActiveAt: number;
}

/** Best-effort browser platform label, limited to the rules' vocabulary. */
function platformOf(): DeviceFingerprint['platform'] {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  return 'web';
}

function platformLabel(platform: DeviceFingerprint['platform']): string {
  const labels: Record<string, string> = {
    ios: 'iOS browser',
    android: 'Android browser',
    macos: 'macOS',
    windows: 'Windows',
    web: 'Web',
  };
  return labels[platform] ?? 'Web';
}

/** This browser's stable id — minted once, then read back forever. */
export function panelDevice(): DeviceFingerprint {
  let id = '';
  try {
    id = localStorage.getItem(DEVICE_KEY) ?? '';
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
  } catch {
    // Private-mode storage refusal: fall back to a per-session id — a
    // restart then looks like a new device, which locks (safely) rather
    // than lets every tab bind something different (impossible anyway).
    id = crypto.randomUUID();
  }
  const platform = platformOf();
  return {
    id,
    name: platformLabel(platform).slice(0, 120),
    platform,
    lastActiveAt: Date.now(),
  };
}

export function noteLock(reason: LockReason): void {
  try {
    localStorage.setItem(
      NOTICE_KEY,
      JSON.stringify({ reason, at: Date.now() } satisfies LockNotice)
    );
  } catch {
    // Notice is UX only — never let it break the sign-out it decorates.
  }
}

export function readLockNotice(): LockNotice | null {
  try {
    const raw = localStorage.getItem(NOTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockNotice>;
    if (parsed.reason !== 'device_change' && parsed.reason !== 'admin') return null;
    return { reason: parsed.reason, at: typeof parsed.at === 'number' ? parsed.at : 0 };
  } catch {
    return null;
  }
}

export function clearLockNotice(): void {
  try {
    localStorage.removeItem(NOTICE_KEY);
  } catch {
    // Same as above — the clear is cosmetic.
  }
}

/** Reads the bound-device map defensively (malformed = "no binding"). */
function bindingOf(data: Record<string, unknown>): DeviceFingerprint | null {
  const value = data.device;
  if (!value || typeof value !== 'object') return null;
  const map = value as Record<string, unknown>;
  if (typeof map.id !== 'string' || !map.id) return null;
  return {
    id: map.id,
    name: typeof map.name === 'string' ? map.name : '',
    platform: typeof map.platform === 'string' ? map.platform : '',
    lastActiveAt: typeof map.lastActiveAt === 'number' ? map.lastActiveAt : 0,
  };
}

/**
 * Enforces the lock for THIS browser against the freshly read `users/{uid}`
 * document. Fire-and-forget from the session effect (`void …`): every branch
 * either signs out or writes a rule-validated patch, and a failure degrades
 * to "stay bound or stay signed in" — the rules still gate every capability
 * server-side either way.
 */
export async function enforceDeviceLock(
  uid: string,
  data: Record<string, unknown> | null
): Promise<void> {
  if (!data) return;

  // 1. Locked (by an admin, or by this account's own earlier foreign
  //    sign-in): end the session and explain it on the login screen.
  if (data.locked === true) {
    const reason: LockReason =
      data.lockedReason === 'device_change' ? 'device_change' : 'admin';
    noteLock(reason);
    await firebaseSignOut(auth);
    return;
  }

  const mine = panelDevice();
  const bound = bindingOf(data);

  // 2a. Super admins are not device-bound (see the file header and
  //     firestore.rules §users): rebind this browser — first bind or a
  //     swap — and stay signed in. The rules allow a device write from a
  //     `superAdmin` profile on any write, not just the first.
  if (data.role === 'superAdmin') {
    if (!bound || bound.id !== mine.id) {
      try {
        await updateDoc(doc(db, 'users', uid), {
          device: mine,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Offline — the next snapshot retries; no lock either way.
      }
    }
    clearLockNotice();
    return;
  }

  // 2. A different browser holds the binding: lock the account through the
  //    OWNER path (the only lock a non-admin write can create) and leave.
  if (bound && bound.id !== mine.id) {
    noteLock('device_change');
    try {
      await updateDoc(doc(db, 'users', uid), {
        locked: true,
        lockedReason: 'device_change',
        lockedAt: Date.now(),
        // 'system' = nobody pressed a button; a foreign device walked in.
        lockedBy: 'system',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Offline or already locked — the sign-out below runs regardless.
    }
    await firebaseSignOut(auth);
    return;
  }

  // 3. No binding: first visit from this browser — bind it. Rules only
  //    allow a device write while none exists, so a later swap is refused
  //    server-side even by a modified client.
  if (!bound) {
    try {
      await updateDoc(doc(db, 'users', uid), {
        device: mine,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // First-bind raced or was rejected — next snapshot retries.
    }
  }

  // Normal path: bound to THIS browser, so any lock notice left by a past
  // lockout no longer describes the current state.
  clearLockNotice();
}