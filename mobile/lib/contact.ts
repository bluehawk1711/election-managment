/**
 * Contact links for a voter (plan-voters.md §6.2).
 *
 * The roll carries no phone numbers, so every one of these is fed by the
 * user-entered `phone` on the overlay. Each helper returns `null` when there
 * is nothing to dial, and the caller hides the control rather than showing a
 * button that cannot work.
 *
 * `Linking.openURL` is used rather than an SMS/phone library: the schemes are
 * stable, the platform handles routing to whichever app is installed, and
 * nothing else needs to be added to the bundle.
 */
import { Linking, Platform } from 'react-native';

/** Strips everything that is not a digit or a leading `+`. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  // A leading '+' survives only if it is the first character.
  return digits.replace(/(?!^)\+/g, '');
}

/**
 * Adds India's country code when the number is local.
 *
 * A 10-digit number is assumed to be Indian (the roll is a Jodhpur roll), so
 * `9876543210` dials correctly from anywhere. Anything already carrying a
 * country code, a leading `+`, or a non-10-digit length is left alone —
 * guessing would be worse than dialing what was typed.
 */
export function e164(raw: string): string | null {
  const digits = normalizePhone(raw);
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  return digits;
}

export function telUrl(raw: string): string | null {
  const phone = e164(raw);
  return phone ? `tel:${phone}` : null;
}

export function smsUrl(raw: string): string | null {
  const phone = e164(raw);
  return phone
    ? Platform.OS === 'ios'
      ? `sms:${phone}&body=`
      : `sms:${phone}?body=`
    : null;
}

export function whatsappUrl(raw: string): string | null {
  const phone = e164(raw);
  if (!phone) return null;
  return `https://wa.me/${phone.replace(/^\+/, '')}`;
}

/** `maps:q=lat,lng` on iOS/Android, falling back to a web URL. */
export function mapsUrl(lat: number, lng: number): string {
  const query = `${lat},${lng}`;
  return Platform.OS === 'ios'
    ? `maps://?ll=${query}&q=${query}`
    : `geo:${lat},${lng}?q=${query}`;
}

/** Opens a URL, returning `false` when no app can handle it. */
export async function openExternal(url: string): Promise<boolean> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
