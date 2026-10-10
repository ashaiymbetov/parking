import { validateBookingPeriod } from './booking-period';

const NOW = new Date('2026-10-05T08:00:20Z'); // 20 s into the minute
const MIN = 60_000;
const at = (offsetMs: number) =>
  new Date(Date.parse('2026-10-05T08:00:00Z') + offsetMs);

function check(from: Date, to: Date) {
  return validateBookingPeriod({ from, to, now: NOW });
}

describe('validateBookingPeriod (D-008, D-026)', () => {
  it('accepts a regular booking', () => {
    expect(check(at(60 * MIN), at(120 * MIN))).toBeNull();
  });

  describe('duration: 15 minutes … 24 hours', () => {
    it.each([
      ['exactly 15 minutes', 15 * MIN, null],
      ['14 minutes', 14 * MIN, 'TOO_SHORT'],
      ['exactly 24 hours', 24 * 60 * MIN, null],
      ['24 hours + 1 minute', (24 * 60 + 1) * MIN, 'TOO_LONG'],
    ])('%s', (_c, duration, expected) => {
      expect(check(at(60 * MIN), at(60 * MIN + duration))).toBe(expected);
    });

    it('end must be after start', () => {
      expect(check(at(60 * MIN), at(60 * MIN))).toBe('END_NOT_AFTER_START');
      expect(check(at(60 * MIN), at(30 * MIN))).toBe('END_NOT_AFTER_START');
    });
  });

  describe('start: from the current minute … 7 days ahead', () => {
    it('the current minute is allowed (booking "right now")', () => {
      // now = 08:00:20 → 08:00:00 is still "now" (D-026).
      expect(check(at(0), at(30 * MIN))).toBeNull();
    });

    it('the previous minute is in the past', () => {
      expect(check(at(-MIN), at(30 * MIN))).toBe('IN_THE_PAST');
    });

    it('exactly 7 days ahead is allowed, a minute later is not', () => {
      const week = 7 * 24 * 60 * MIN;
      expect(check(at(week), at(week + 30 * MIN))).toBeNull();
      expect(check(at(week + MIN), at(week + 31 * MIN))).toBe('TOO_FAR_AHEAD');
    });
  });

  it.each([
    ['seconds in start', at(60 * MIN + 30_000), at(120 * MIN)],
    ['milliseconds in end', at(60 * MIN), at(120 * MIN + 1)],
  ])('bounds must be whole minutes (%s)', (_c, from, to) => {
    expect(check(from, to)).toBe('NOT_MINUTE_ALIGNED');
  });
});
