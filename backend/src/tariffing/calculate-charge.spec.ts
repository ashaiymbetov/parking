import { DateTime } from 'luxon';
import { calculateCharge } from './calculate-charge';
import { TariffingError, TariffVersion } from './tariffing.types';

const BISHKEK = 'Asia/Bishkek';
const BERLIN = 'Europe/Berlin';

/** Local wall-clock time in the given zone → absolute instant. */
function at(local: string, zone = BISHKEK): Date {
  const dt = DateTime.fromISO(local, { zone });
  if (!dt.isValid) throw new Error(`bad test time ${local}`);
  return dt.toJSDate();
}

function tariff(overrides: Partial<TariffVersion> = {}): TariffVersion {
  return {
    id: 'base',
    validFrom: at('2020-01-01T00:00'),
    validTo: null,
    dayStartsAt: '07:00',
    nightStartsAt: '23:00',
    dayPriceKop: 250,
    nightPriceKop: 120,
    ...overrides,
  };
}

function charge(
  from: string,
  to: string,
  tariffs = [tariff()],
  zone = BISHKEK,
) {
  return calculateCharge({
    enteredAt: at(from, zone),
    exitedAt: at(to, zone),
    tariffs,
    timeZone: zone,
  });
}

/** Compact view of segments: kind, minutes, amount (+ tariff when asked). */
function runs(result: ReturnType<typeof charge>, withTariff = false) {
  return result.segments.map((s) => ({
    ...(withTariff ? { tariffId: s.tariffId } : {}),
    kind: s.kind,
    minutes: s.minutes,
    amountKop: s.amountKop,
  }));
}

describe('calculateCharge — examples (ARCHITECTURE §6, D-003)', () => {
  it('a visit entirely in the day', () => {
    const r = charge('2026-10-04T10:00:00', '2026-10-04T11:30:00');
    expect(r).toMatchObject({ minutes: 90, amountKop: 22_500 });
    expect(runs(r)).toEqual([{ kind: 'day', minutes: 90, amountKop: 22_500 }]);
  });

  it('a visit entirely in the night', () => {
    const r = charge('2026-10-04T23:30:00', '2026-10-05T05:30:00');
    expect(r).toMatchObject({ minutes: 360, amountKop: 43_200 });
    expect(runs(r)).toEqual([
      { kind: 'night', minutes: 360, amountKop: 43_200 },
    ]);
  });

  it('across 23:00 (day → night)', () => {
    const r = charge('2026-10-04T22:40:00', '2026-10-04T23:20:00');
    expect(r).toMatchObject({ minutes: 40, amountKop: 7_400 });
    expect(runs(r)).toEqual([
      { kind: 'day', minutes: 20, amountKop: 5_000 },
      { kind: 'night', minutes: 20, amountKop: 2_400 },
    ]);
    expect(r.segments.map((s) => s.from.toISOString())).toEqual([
      '2026-10-04T16:40:00.000Z',
      '2026-10-04T17:00:00.000Z', // 23:00 in Bishkek (UTC+6)
    ]);
  });

  it('a minute that starts before 23:00 is billed at the day rate', () => {
    // 160 s → 3 minutes starting 22:58:30, 22:59:30 (day), 23:00:30 (night).
    const r = charge('2026-10-04T22:58:30', '2026-10-04T23:01:10');
    expect(r).toMatchObject({ minutes: 3, amountKop: 620 });
    expect(runs(r)).toEqual([
      { kind: 'day', minutes: 2, amountKop: 500 },
      { kind: 'night', minutes: 1, amountKop: 120 },
    ]);
    // The day run ends at the end of its last minute, past 23:00.
    expect(r.segments[0].to.toISOString()).toBe('2026-10-04T17:00:30.000Z');
  });

  it('across 07:00 (night → day)', () => {
    const r = charge('2026-10-05T06:30:00', '2026-10-05T07:30:00');
    expect(r).toMatchObject({ minutes: 60, amountKop: 11_100 });
    expect(runs(r)).toEqual([
      { kind: 'night', minutes: 30, amountKop: 3_600 },
      { kind: 'day', minutes: 30, amountKop: 7_500 },
    ]);
  });

  it('across midnight: the night is one run, midnight does not split it', () => {
    const r = charge('2026-10-04T22:00:00', '2026-10-05T01:00:00');
    expect(r).toMatchObject({ minutes: 180, amountKop: 29_400 });
    expect(runs(r)).toEqual([
      { kind: 'day', minutes: 60, amountKop: 15_000 },
      { kind: 'night', minutes: 120, amountKop: 14_400 },
    ]);
  });

  it('across midnight and the morning boundary', () => {
    const r = charge('2026-10-04T21:15:00', '2026-10-05T07:05:00');
    expect(r).toMatchObject({ minutes: 590, amountKop: 85_100 });
    expect(runs(r)).toEqual([
      { kind: 'day', minutes: 105, amountKop: 26_250 },
      { kind: 'night', minutes: 480, amountKop: 57_600 },
      { kind: 'day', minutes: 5, amountKop: 1_250 },
    ]);
  });

  it('longer than a day: several day/night transitions', () => {
    const r = charge('2026-10-04T10:00:00', '2026-10-06T12:00:00');
    expect(r).toMatchObject({ minutes: 3_000, amountKop: 625_200 });
    expect(runs(r)).toEqual([
      { kind: 'day', minutes: 780, amountKop: 195_000 },
      { kind: 'night', minutes: 480, amountKop: 57_600 },
      { kind: 'day', minutes: 960, amountKop: 240_000 },
      { kind: 'night', minutes: 480, amountKop: 57_600 },
      { kind: 'day', minutes: 300, amountKop: 75_000 },
    ]);
  });

  describe('short visits', () => {
    it('0 seconds → 0 minutes, nothing to pay, no segments', () => {
      const r = charge('2026-10-04T10:00:00', '2026-10-04T10:00:00');
      expect(r).toEqual({ minutes: 0, amountKop: 0, segments: [] });
    });

    it('30 seconds → one whole minute (rounded up)', () => {
      const r = charge('2026-10-04T10:00:00', '2026-10-04T10:00:30');
      expect(r).toMatchObject({ minutes: 1, amountKop: 250 });
    });

    it('30 seconds at night → one night minute', () => {
      const r = charge('2026-10-05T02:00:00', '2026-10-05T02:00:30');
      expect(r).toMatchObject({ minutes: 1, amountKop: 120 });
    });

    it('1 millisecond over a minute → two minutes', () => {
      const r = charge('2026-10-04T10:00:00.000', '2026-10-04T10:01:00.001');
      expect(r).toMatchObject({ minutes: 2, amountKop: 500 });
    });
  });

  describe('tariff change in the middle of a visit (D-014)', () => {
    const NOV = at('2026-11-01T00:00');
    const versions = [
      tariff({ id: 'v1', validTo: NOV }),
      tariff({ id: 'v2', validFrom: NOV, nightPriceKop: 150 }),
    ];

    it('night minutes before and after the change use their own version', () => {
      const r = charge('2026-10-31T23:30:00', '2026-11-01T00:30:00', versions);
      expect(r).toMatchObject({ minutes: 60, amountKop: 8_100 });
      expect(runs(r, true)).toEqual([
        { tariffId: 'v1', kind: 'night', minutes: 30, amountKop: 3_600 },
        { tariffId: 'v2', kind: 'night', minutes: 30, amountKop: 4_500 },
      ]);
    });

    it('a change during the day splits the day run', () => {
      const NOON = at('2026-10-04T12:00');
      const r = charge('2026-10-04T11:00:00', '2026-10-04T13:00:00', [
        tariff({ id: 'old', validTo: NOON }),
        tariff({ id: 'new', validFrom: NOON, dayPriceKop: 300 }),
      ]);
      expect(r).toMatchObject({ minutes: 120, amountKop: 33_000 });
      expect(runs(r, true)).toEqual([
        { tariffId: 'old', kind: 'day', minutes: 60, amountKop: 15_000 },
        { tariffId: 'new', kind: 'day', minutes: 60, amountKop: 18_000 },
      ]);
    });

    it('the version order in the input does not matter', () => {
      const r = charge(
        '2026-10-31T23:30:00',
        '2026-11-01T00:30:00',
        [...versions].reverse(),
      );
      expect(r.amountKop).toBe(8_100);
    });
  });

  describe('daylight saving time (Luxon, never fixed offsets)', () => {
    const berlin = tariff({ validFrom: at('2020-01-01T00:00', BERLIN) });

    it('spring forward: the night of 2026-03-29 is one hour shorter', () => {
      // 02:00 CET → 03:00 CEST: 23:00–07:00 lasts 7 real hours.
      const r = charge(
        '2026-03-28T22:00:00',
        '2026-03-29T08:00:00',
        [berlin],
        BERLIN,
      );
      expect(r).toMatchObject({ minutes: 540, amountKop: 80_400 });
      expect(runs(r)).toEqual([
        { kind: 'day', minutes: 60, amountKop: 15_000 },
        { kind: 'night', minutes: 420, amountKop: 50_400 },
        { kind: 'day', minutes: 60, amountKop: 15_000 },
      ]);
    });

    it('fall back: the night of 2026-10-25 is one hour longer', () => {
      // 03:00 CEST → 02:00 CET: 23:00–07:00 lasts 9 real hours.
      const r = charge(
        '2026-10-24T22:00:00',
        '2026-10-25T08:00:00',
        [berlin],
        BERLIN,
      );
      expect(r).toMatchObject({ minutes: 660, amountKop: 94_800 });
      expect(runs(r)).toEqual([
        { kind: 'day', minutes: 60, amountKop: 15_000 },
        { kind: 'night', minutes: 540, amountKop: 64_800 },
        { kind: 'day', minutes: 60, amountKop: 15_000 },
      ]);
    });

    it('the morning boundary is 07:00 local on both sides of the change', () => {
      const r = charge(
        '2026-10-25T06:00:00',
        '2026-10-25T08:00:00',
        [berlin],
        BERLIN,
      );
      expect(r.segments.map((s) => s.from.toISOString())).toEqual([
        '2026-10-25T05:00:00.000Z', // 06:00 CET
        '2026-10-25T06:00:00.000Z', // 07:00 CET
      ]);
    });
  });

  describe('a boundary inside a DST transition (generic tariffs)', () => {
    // Not the case for 07:00/23:00, but the function must stay correct for
    // any boundary: here the day starts at 02:30 and the night at 14:00.
    const early = tariff({
      validFrom: at('2020-01-01T00:00', BERLIN),
      dayStartsAt: '02:30',
      nightStartsAt: '14:00',
    });

    it('a skipped boundary (02:30 on 2026-03-29) switches at the jump itself', () => {
      // Clocks go 02:00 CET → 03:00 CEST at 01:00Z; 03:00 is already "after 02:30".
      const r = charge(
        '2026-03-29T01:00:00',
        '2026-03-29T04:00:00',
        [early],
        BERLIN,
      );
      expect(runs(r)).toEqual([
        { kind: 'night', minutes: 60, amountKop: 7_200 },
        { kind: 'day', minutes: 60, amountKop: 15_000 },
      ]);
      expect(r.segments[1].from.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    });

    it('a repeated boundary (02:30 twice on 2026-10-25) is crossed twice', () => {
      // 01:30 CEST → 03:30 CET = 3 real hours; local 02:00–03:00 happens twice.
      const r = calculateCharge({
        enteredAt: new Date('2026-10-24T23:30:00Z'), // 01:30 CEST
        exitedAt: new Date('2026-10-25T02:30:00Z'), // 03:30 CET
        tariffs: [early],
        timeZone: BERLIN,
      });
      expect(runs(r)).toEqual([
        { kind: 'night', minutes: 60, amountKop: 7_200 }, // 01:30–02:30 CEST
        { kind: 'day', minutes: 30, amountKop: 7_500 }, // 02:30–03:00 CEST
        { kind: 'night', minutes: 30, amountKop: 3_600 }, // 02:00–02:30 CET
        { kind: 'day', minutes: 60, amountKop: 15_000 }, // 02:30–03:30 CET
      ]);
    });
  });

  describe('invalid input fails loudly', () => {
    function errorCode(fn: () => unknown): string | undefined {
      try {
        fn();
      } catch (e) {
        return e instanceof TariffingError
          ? e.code
          : `unexpected: ${String(e)}`;
      }
      return undefined;
    }

    it('exit before entry', () => {
      expect(
        errorCode(() => charge('2026-10-04T10:00:00', '2026-10-04T09:59:59')),
      ).toBe('EXIT_BEFORE_ENTRY');
    });

    it('an invalid date', () => {
      expect(
        errorCode(() =>
          calculateCharge({
            enteredAt: new Date('not a date'),
            exitedAt: at('2026-10-04T11:00'),
            tariffs: [tariff()],
            timeZone: BISHKEK,
          }),
        ),
      ).toBe('INVALID_TIME');
    });

    it('a minute with no valid tariff version', () => {
      const r = () =>
        charge('2026-10-31T23:30:00', '2026-11-01T00:30:00', [
          tariff({ validTo: at('2026-11-01T00:00') }),
        ]);
      expect(errorCode(r)).toBe('NO_TARIFF');
    });

    it('unknown time zone', () => {
      expect(
        errorCode(() =>
          calculateCharge({
            enteredAt: at('2026-10-04T10:00'),
            exitedAt: at('2026-10-04T11:00'),
            tariffs: [tariff()],
            timeZone: 'Mars/Olympus_Mons',
          }),
        ),
      ).toBe('INVALID_TIME_ZONE');
    });

    it.each([
      ['fractional price', { dayPriceKop: 2.5 }],
      ['negative price', { nightPriceKop: -1 }],
      ['bad time', { dayStartsAt: '7am' }],
      ['equal boundaries', { nightStartsAt: '07:00' }],
    ])('malformed tariff: %s', (_c, overrides) => {
      expect(
        errorCode(() =>
          charge('2026-10-04T10:00', '2026-10-04T11:00', [tariff(overrides)]),
        ),
      ).toBe('INVALID_TARIFF');
    });
  });
});
