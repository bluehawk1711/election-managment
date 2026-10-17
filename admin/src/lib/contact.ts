/**
 * Phone normalization and contact URLs — the panel has no `Linking`, so every
 * helper here returns a plain `http`/`tel:` URL the browser can open directly.
 * Normalization is byte-identical to `mobile/lib/contact.ts`'s `normalizePhone`
 * so a number grouped on the phone and a number grouped on the panel group the
 * the same way.
 */

/** Strips everything that is not a digit or a leading `+`. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, '');
  // A leading '+' survives only if it is the first character.
  return digits.replace(/(?!^)\+/g, '');
}

/**
 * Adds India's country code when the number is local: a 10-digit number is
 * assumed to be Indian (the roll is a Jodhpur roll). Anything already carrying
 * a country code, a leading `+`, or a non-10-digit length is left alone.
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

export function whatsappUrl(raw: string): string | null {
  const phone = e164(raw);
  return phone ? `https://wa.me/${phone.replace(/^\+/, '')}` : null;
}

/** Always-works map URL — the `maps:`/`geo:` app schemes are mobile-only. */
export function mapsWebUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}