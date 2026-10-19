import { electionCountdown } from '@/lib/election';
import { addDays, startOfDay } from '@/lib/dates';

/** A fixed "now" so a test can never be time-of-day dependent. */
const NOW = new Date(2027, 1, 10, 9, 30).getTime(); // 10 Feb 2027, morning

describe('electionCountdown', () => {
  it('is unset when nobody has configured a date', () => {
    expect(electionCountdown(NOW, null)).toEqual({ kind: 'unset' });
    // `undefined` is how a half-loaded campaign document reads; it must not
    // fall through to the day maths and divide by nothing.
    expect(electionCountdown(NOW, undefined)).toEqual({ kind: 'unset' });
  });

  it('counts the remaining calendar days, not 24-hour blocks', () => {
    const day = startOfDay(addDays(NOW, 3));
    // Mid-day on polling day and the same calendar day at midnight must give
    // the same answer — a campaign runs on dates, not on 24-hour blocks.
    expect(electionCountdown(NOW, day)).toEqual({ kind: 'future', days: 3 });
    expect(electionCountdown(startOfDay(day), day)).toEqual({ kind: 'today' });
    // One minute before the eve closes is the last night *before* polling
    // day, so it counts 1 — it is not voting day until the day itself opens.
    expect(electionCountdown(day - 1, day)).toEqual({ kind: 'future', days: 1 });
  });

  it('says today when the configured date is today', () => {
    expect(electionCountdown(NOW, startOfDay(NOW))).toEqual({ kind: 'today' });
    // Even when the stored instant is noon rather than midnight: the picker
    // writes a local noon so no timezone rounds the date either way.
    expect(electionCountdown(NOW, new Date(2027, 1, 10, 12).getTime())).toEqual({
      kind: 'today',
    });
  });

  it('counts up, and reports the date as passed, once the day is behind us', () => {
    expect(electionCountdown(NOW, startOfDay(addDays(NOW, -1)))).toEqual({
      kind: 'passed',
      days: 1,
    });
    expect(electionCountdown(NOW, startOfDay(addDays(NOW, -30)))).toEqual({
      kind: 'passed',
      days: 30,
    });
    // One minute after the day opened is still the day itself — the banner
    // must not flip to "passed" at midnight-plus-a-second.
    expect(electionCountdown(startOfDay(NOW) + 60_000, startOfDay(NOW))).toEqual({
      kind: 'today',
    });
  });

  it('turns a tomorrow date into a one-day countdown', () => {
    expect(electionCountdown(NOW, startOfDay(addDays(NOW, 1)))).toEqual({
      kind: 'future',
      days: 1,
    });
  });
});
