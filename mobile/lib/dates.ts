/**
 * Calendar/date maths — pure, epoch-millis in and out.
 *
 * All values are local-timezone based; seeded due dates and event times are
 * stored as absolute timestamps so the campaign day never drifts.
 */

export const DAY_MS = 86_400_000;

export function startOfDay(millis: number): number {
  const date = new Date(millis);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfDay(millis: number): number {
  return startOfDay(millis) + DAY_MS - 1;
}

export function addDays(millis: number, days: number): number {
  const date = new Date(millis);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function startOfMonth(millis: number): number {
  const date = new Date(millis);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfMonth(millis: number): number {
  const date = new Date(millis);
  date.setMonth(date.getMonth() + 1, 0);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function isToday(millis: number, now = Date.now()): boolean {
  return isSameDay(millis, now);
}

/** Days between two instants, counting calendar days (not 24h blocks). */
export function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** Monday-first weekday index: 0 = Monday … 6 = Sunday. */
export function weekdayIndex(millis: number): number {
  return (new Date(millis).getDay() + 6) % 7;
}

/** 6 × 7 grid of day instants covering the month of `millis` (Monday first). */
export function monthGrid(millis: number): number[] {
  const first = startOfMonth(millis);
  const offset = weekdayIndex(first);
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** Midnight of the date an input should keep when edited. */
export function dayStartOrNow(millis: number | null | undefined): number {
  return millis == null ? startOfDay(Date.now()) : startOfDay(millis);
}
