/**
 * Locale-aware formatting — Hindi and English.
 *
 * Everything goes through `Intl`, which Hermes ships (full ICU on Android,
 * native on iOS). Relative durations use a small private bilingual table
 * instead of `Intl.RelativeTimeFormat`, which older Hermes builds lack — and
 * so the lib stays free of an i18next dependency (it must stay unit-testable
 * without a React tree).
 */

function localeOf(lang?: string | null): string {
  return lang?.toLowerCase().startsWith('hi') ? 'hi-IN' : 'en-IN';
}

export function isHindiLocale(lang?: string | null): boolean {
  return lang?.toLowerCase().startsWith('hi') ?? false;
}

export function formatNumber(
  value: number,
  lang?: string | null,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(localeOf(lang), options).format(value);
}

/** ₹1,20,000 — Indian digit grouping in both languages. */
export function formatCurrency(
  value: number,
  lang?: string | null,
  maximumFractionDigits = 0
): string {
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits,
  }).format(value);
}

/** ₹1.2L / ₹34K for compact metric tiles. */
export function formatCompactCurrency(value: number, lang?: string | null): string {
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(
  millis: number,
  lang?: string | null,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }
): string {
  return new Intl.DateTimeFormat(localeOf(lang), options).format(new Date(millis));
}

/** 'OCT 05' — the dashboard date chip. */
export function formatMonthChip(millis: number, lang?: string | null): {
  month: string;
  day: string;
} {
  const formatted = new Intl.DateTimeFormat(localeOf(lang), {
    month: 'short',
    day: '2-digit',
  }).format(new Date(millis));

  const [month, day] = formatted.split(' ');
  return { month: (month ?? '').toUpperCase(), day: day ?? '' };
}

export function formatTime(millis: number, lang?: string | null): string {
  return new Intl.DateTimeFormat(localeOf(lang), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(millis));
}

export function formatDateTime(millis: number, lang?: string | null): string {
  return `${formatDate(millis, lang, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} · ${formatTime(millis, lang)}`;
}

export function formatWeekday(millis: number, lang?: string | null): string {
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short' }).format(
    new Date(millis)
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const RELATIVE_UNITS: { limit: number; ms: number; en: string; hi: string }[] = [
  { limit: HOUR, ms: MINUTE, en: 'min', hi: 'मिनट' },
  { limit: DAY, ms: HOUR, en: 'hr', hi: 'घंटा' },
  { limit: WEEK, ms: DAY, en: 'day', hi: 'दिन' },
  { limit: MONTH, ms: WEEK, en: 'wk', hi: 'सप्ताह' },
  { limit: YEAR, ms: MONTH, en: 'mo', hi: 'माह' },
  { limit: Infinity, ms: YEAR, en: 'yr', hi: 'वर्ष' },
];

/**
 * '12m' / '2h' / '3d' style token; pair with the `common.ago` translation.
 * Absolute-ish future values render the same shape ('in 2h' handled by the
 * caller with `common.in`).
 */
export function formatDuration(
  deltaMs: number,
  lang?: string | null
): string {
  const hindi = isHindiLocale(lang);
  const absolute = Math.abs(deltaMs);

  if (absolute < MINUTE) return hindi ? 'अभी' : 'now';

  const unit = RELATIVE_UNITS.find((entry) => absolute < entry.limit)!;
  const value = Math.round(absolute / unit.ms);
  return hindi ? `${value} ${unit.hi}` : `${value}${unit.en}`;
}

/** '12 min' / '2 hr' with the unit spelled out (activity feed). */
export function formatDurationLong(
  deltaMs: number,
  lang?: string | null
): string {
  const hindi = isHindiLocale(lang);
  const absolute = Math.abs(deltaMs);

  if (absolute < MINUTE) return hindi ? 'अभी' : 'just now';

  const unit = RELATIVE_UNITS.find((entry) => absolute < entry.limit)!;
  const value = Math.round(absolute / unit.ms);

  if (hindi) return `${value} ${unit.hi} पहले`;

  const spelled: Record<string, string> = {
    min: value === 1 ? 'minute' : 'minutes',
    hr: value === 1 ? 'hour' : 'hours',
    day: value === 1 ? 'day' : 'days',
    wk: value === 1 ? 'week' : 'weeks',
    mo: value === 1 ? 'month' : 'months',
    yr: value === 1 ? 'year' : 'years',
  };

  return `${value} ${spelled[unit.en] ?? unit.en} ago`;
}
