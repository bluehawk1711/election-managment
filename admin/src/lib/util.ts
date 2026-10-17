/**
 * `cn` — class-name joiner.
 *
 * No clsx dependency: every conditional in this app is a single boolean
 * ternary, and a 10-line local function beats a package for that.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Epoch millis (or a Firestore Timestamp-like) → `12 Mar 2026, 4:05 PM`. */
export function formatWhen(value: unknown): string {
  const millis =
    typeof value === 'number'
      ? value
      : typeof value === 'object' &&
          value !== null &&
          'toMillis' in value &&
          typeof (value as { toMillis: () => number }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis()
        : null;
  if (!millis || !Number.isFinite(millis)) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(millis));
}

/** Epoch millis → a relative phrase (`just now`, `3h ago`, `12 Mar`). */
export function formatAgo(value: unknown): string {
  const millis =
    typeof value === 'number'
      ? value
      : typeof value === 'object' &&
          value !== null &&
          'toMillis' in value &&
          typeof (value as { toMillis: () => number }).toMillis === 'function'
        ? (value as { toMillis: () => number }).toMillis()
        : null;
  if (!millis || !Number.isFinite(millis)) return '—';

  const delta = Date.now() - millis;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatWhen(millis);
}

/** `2026-03-12` form value → epoch millis at local midnight, or null. */
export function dateInputToMillis(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

/** Inverse of `dateInputToMillis` for seeding an `<input type="date">`. */
export function millisToDateInput(value: number | null): string {
  if (!value) return '';
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}