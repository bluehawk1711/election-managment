/**
 * Election-day countdown — pure, epoch-millis in and out.
 *
 * The date itself lives once, in `campaigns/active.electionDate`, and the whole
 * team counts down to the same day: a karykarta opening the dashboard and a
 * super admin confirming it in Settings must never disagree about whether
 * today *is* voting day. So the arithmetic lives here (and is tested) rather
 * than inline in the banner, where "what do we show on the day itself" would
 * quietly become two slightly different answers in two files.
 *
 * Four states, and only four:
 *
 *   unset     no date configured yet — the banner offers to take one
 *   future    days > 0 — the countdown the user asked for
 *   today     days == 0 — "Voting day", no number anywhere near it
 *   passed    days < 0 — kept on screen as a record rather than hidden
 *
 * Day-counting is calendar-based (`daysBetween` normalises both instants to
 * local midnight), so a date entered as noon does not drift a day depending on
 * when the phone was unlocked.
 */
import { daysBetween } from '@/lib/dates';

export type ElectionCountdown =
  | { kind: 'unset' }
  | { kind: 'future'; days: number }
  | { kind: 'today' }
  | { kind: 'passed'; days: number };

/**
 * How `now` sits relative to the configured election day.
 *
 * `electionDate` is whatever is stored — `null` means nobody has set it yet,
 * which is a state of its own rather than a missing number to divide by.
 */
export function electionCountdown(
  now: number,
  electionDate: number | null | undefined
): ElectionCountdown {
  if (electionDate == null) return { kind: 'unset' };

  const days = daysBetween(now, electionDate);
  if (days > 0) return { kind: 'future', days };
  if (days === 0) return { kind: 'today' };
  return { kind: 'passed', days: -days };
}
