/**
 * The release gate the app reads before anything else works.
 *
 * `appConfig/general` (firestore.rules gives it an unauthenticated read on
 * purpose — an outdated build must be able to learn WHY it is locked, even
 * before sign-in):
 *
 *   requiredVersion  the hard floor — a build below it renders nothing but
 *                    the update modal (components/update-gate.tsx)
 *   latestVersion    informational, shown on the modal and in the panel
 *   supportPhone     the WhatsApp line the modal's button opens
 *
 * The build's OWN version comes from `app.json → expo.version`, baked into
 * the binary at build time — comparing that against the live floor is what
 * lets a super admin remotely shut off builds that predate a feature.
 *
 * Failure policy: **fail open.** A missing doc, an offline launch or a
 * malformed value all resolve to `null` → no gate. Locking every user out
 * because Firestore was unreachable would be a far worse failure than
 * letting one stale build run a little longer — the rules server-side still
 * reject whatever the old client cannot understand.
 */
import Constants from 'expo-constants';
import { getDoc } from '@/lib/db';

/** `appConfig/general` — read before anything else works. */
const GATE_PATH = 'appConfig/general';

export interface VersionGateConfig {
  /** Newest published version (`1.2.0`) — displayed, informational. */
  latestVersion: string;
  /** Oldest build still allowed to work (`1.1.0`) — the hard floor. */
  requiredVersion: string;
  /** WhatsApp support line, digits only with country code; `''` = unset. */
  supportPhone: string;
}

/** This binary's version — `app.json → expo.version` at build time. */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '1.0.0';

/**
 * Numeric per-segment compare: `1.10.0 > 1.9.0` (a string compare would say
 * the opposite), missing segments count as 0 so `1` equals `1.0`. Returns
 * negative / 0 / positive like a comparator, so `< 0` reads as "older than".
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split(/[.-]/)[0].split('.').map((part) => Number(part) || 0);
  const right = b.split(/[.-]/)[0].split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Fetches the gate config, or null when there is nothing to gate on. */
export async function fetchVersionGate(): Promise<VersionGateConfig | null> {
  try {
    const snapshot = await getDoc(GATE_PATH);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    const requiredVersion =
      typeof data.requiredVersion === 'string' ? data.requiredVersion.trim() : '';
    if (!requiredVersion) return null;
    return {
      latestVersion:
        typeof data.latestVersion === 'string' ? data.latestVersion.trim() : '',
      requiredVersion,
      supportPhone:
        typeof data.supportPhone === 'string' ? data.supportPhone.replace(/\D/g, '') : '',
    };
  } catch {
    // Offline / rules / malformed — fail open (file header).
    return null;
  }
}

/** `true` when this build sits BELOW the configured floor. */
export function needsUpdate(config: VersionGateConfig): boolean {
  return compareVersions(APP_VERSION, config.requiredVersion) < 0;
}