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

/**
 * WhatsApp deep link, message pre-filled ONLY when the caller asks.
 *
 * `wa.me/<digits>?text=…` opens the chat with the composer already holding
 * the message — the karykarta picks the contact and sends, instead of
 * copying the text from somewhere else first. URL-encoded because a body in
 * Devanagari with newlines is not something any URL parser survives raw.
 *
 * There is NO default message any more, and that absence is deliberate. The
 * app used to attach a fixed campaign manifesto (`CAMPAIGN_MESSAGE`) to
 * every WhatsApp button, so a volunteer who wanted to write "namaste, your
 * water connection is due on Tuesday" had that whole manifesto sitting in
 * the composer first, and deleting it was the first chore of every message.
 * The compose sheet (`components/roll/whatsapp-compose.tsx`) now owns the
 * text: whatever the user typed — including nothing — is what goes out, so
 * an empty message here correctly produces a bare `wa.me` link that just
 * opens the chat.
 */
export function whatsappUrl(raw: string, text?: string): string | null {
  const phone = e164(raw);
  if (!phone) return null;
  const digits = phone.replace(/^\+/, '');
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;
}

/** `maps:q=lat,lng` on iOS/Android, falling back to a web URL. */
export function mapsUrl(lat: number, lng: number): string {
  const query = `${lat},${lng}`;
  return Platform.OS === 'ios'
    ? `maps://?ll=${query}&q=${query}`
    : `geo:${lat},${lng}?q=${query}`;
}

/**
 * The always-works web URL for the same fix.
 *
 * `maps:`/`geo:` need `canOpenURL` to say yes, and on Android 11+ the package
 * visibility rules make that depend on a `<queries>` declaration the manifest
 * does not carry — so `openExternal(mapsUrl(...))` can silently return false
 * and the button does nothing. This URL needs no declaration at all: the
 * browser (or the Maps app itself, once installed as the handler) takes it.
 */
export function mapsWebUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * Opens the native maps scheme, falling back to the web URL when the platform
 * refuses it. Returns `false` only when *both* fail, so a caller can still
 * surface an error rather than swallow it.
 */
export async function openMaps(lat: number, lng: number): Promise<boolean> {
  if (await openExternal(mapsUrl(lat, lng))) return true;
  return openExternal(mapsWebUrl(lat, lng));
}

/** Opens a URL, returning `false` when no app can handle it.
 *
 * `Linking.openURL` **without** a `canOpenURL` pre-check, and that omission is
 * load-bearing. On Android 11+ `canOpenURL` only answers `true` for schemes
 * declared in the manifest's `<queries>` block — which this prebuild does not
 * carry for `tel:` / `sms:` / `geo:` — so the old check-then-open flow
 * returned `false` for perfectly dialable numbers: Call and Message looked
 * dead on every modern Android. `openURL` itself is not subject to package
 * visibility, and it throws when nothing handles the URL, which is exactly
 * the signal `canOpenURL` was being asked for.
 */
export async function openExternal(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
