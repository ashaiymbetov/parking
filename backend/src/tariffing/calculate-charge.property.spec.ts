import fc from 'fast-check';
import { DateTime } from 'luxon';
import { calculateCharge } from './calculate-charge';
import { ChargeInput, RateKind, TariffVersion } from './tariffing.types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Zones with and without DST, including a 30-minute DST shift
 * (Australia/Lord_Howe) and a negative offset.
 */
const ZONES = [
  'Asia/Bishkek',
  'UTC',
  'Europe/Berlin',
  'America/New_York',
  'Australia/Lord_Howe',
] as const;

const BOUNDARIES: ReadonlyArray<[string, string]> = [
  ['07:00', '23:00'],
  ['08:30', '20:15'],
  ['06:00', '22:00'],
  // Day "starts" late in the evening and wraps past midnight.
  ['22:00', '06:00'],
];

const YEAR_2026 = Date.UTC(2026, 0, 1);
const YEAR_2027 = Date.UTC(2027, 0, 1);

const price = fc.integer({ min: 0, max: 1_000 });

/** Entry time with arbitrary seconds and milliseconds through all of 2026. */
const entryMs = fc.integer({ min: YEAR_2026, max: YEAR_2027 });

/** Mostly short visits, sometimes several days. */
const durationMs = fc.oneof(
  fc.integer({ min: 0, max: 5 * MINUTE }),
  fc.integer({ min: 0, max: 2 * DAY }),
  fc.integer({ min: 2 * DAY, max: 4 * DAY }),
);

/**
 * 1–3 consecutive tariff versions covering the whole visit; change points
 * fall anywhere around it, including mid-minute.
 */
function tariffsAround(entry: number) {
  return fc
    .tuple(
      fc.uniqueArray(fc.integer({ min: entry - DAY, max: entry + 4 * DAY }), {
        maxLength: 2,
      }),
      fc.array(fc.tuple(fc.constantFrom(...BOUNDARIES), price, price), {
        minLength: 3,
        maxLength: 3,
      }),
    )
    .map(([cuts, specs]): TariffVersion[] => {
      const edges = [
        YEAR_2026 - 400 * DAY,
        ...cuts.sort((a, b) => a - b),
        null,
      ];
      return edges.slice(0, -1).map((from, i) => {
        const [[dayStartsAt, nightStartsAt], dayPriceKop, nightPriceKop] =
          specs[i];
        const to = edges[i + 1];
        return {
          id: `v${i}`,
          validFrom: new Date(from!),
          validTo: to === null ? null : new Date(to),
          dayStartsAt,
          nightStartsAt,
          dayPriceKop,
          nightPriceKop,
        };
      });
    });
}

const visit: fc.Arbitrary<ChargeInput> = fc
  .tuple(entryMs, durationMs, fc.constantFrom(...ZONES))
  .chain(([entry, duration, timeZone]) =>
    tariffsAround(entry).map((tariffs) => ({
      enteredAt: new Date(entry),
      exitedAt: new Date(entry + duration),
      tariffs,
      timeZone,
    })),
  );

// ---------------------------------------------------------------------------
// Reference model: price every billed minute separately, by its start.
// Deliberately naive and independent from the segment arithmetic.
// ---------------------------------------------------------------------------

function secondsOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
}

function rateAt(t: number, tariffs: readonly TariffVersion[], zone: string) {
  const version = tariffs.find(
    (v) =>
      v.validFrom.getTime() <= t &&
      (v.validTo === null || t < v.validTo.getTime()),
  )!;
  const local = DateTime.fromMillis(t, { zone });
  const s =
    local.hour * 3600 +
    local.minute * 60 +
    local.second +
    local.millisecond / 1000;
  const dayStart = secondsOfDay(version.dayStartsAt);
  const nightStart = secondsOfDay(version.nightStartsAt);
  const isDay =
    dayStart < nightStart
      ? s >= dayStart && s < nightStart
      : s >= dayStart || s < nightStart;
  const kind: RateKind = isDay ? 'day' : 'night';
  return {
    tariffId: version.id,
    kind,
    price: isDay ? version.dayPriceKop : version.nightPriceKop,
  };
}

function referenceRuns(input: ChargeInput) {
  const entry = input.enteredAt.getTime();
  const minutes = Math.ceil((input.exitedAt.getTime() - entry) / MINUTE);
  const result: {
    tariffId: string;
    kind: RateKind;
    minutes: number;
    amountKop: number;
  }[] = [];
  for (let i = 0; i < minutes; i++) {
    const r = rateAt(entry + i * MINUTE, input.tariffs, input.timeZone);
    const last = result[result.length - 1];
    if (last && last.tariffId === r.tariffId && last.kind === r.kind) {
      last.minutes += 1;
      last.amountKop += r.price;
    } else {
      result.push({
        tariffId: r.tariffId,
        kind: r.kind,
        minutes: 1,
        amountKop: r.price,
      });
    }
  }
  return result;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('calculateCharge — properties (fast-check)', () => {
  it('the segments always add up to the total, in minutes and in kopecks', () => {
    fc.assert(
      fc.property(visit, (input) => {
        const r = calculateCharge(input);
        expect(sum(r.segments.map((s) => s.amountKop))).toBe(r.amountKop);
        expect(sum(r.segments.map((s) => s.minutes))).toBe(r.minutes);
      }),
      { numRuns: 500 },
    );
  });

  it('billed minutes = duration rounded up to whole minutes', () => {
    fc.assert(
      fc.property(visit, (input) => {
        const duration = input.exitedAt.getTime() - input.enteredAt.getTime();
        expect(calculateCharge(input).minutes).toBe(
          Math.ceil(duration / MINUTE),
        );
      }),
    );
  });

  it('matches minute-by-minute pricing exactly (amount and runs)', () => {
    fc.assert(
      fc.property(visit, (input) => {
        const r = calculateCharge(input);
        const expected = referenceRuns(input);
        expect(
          r.segments.map(({ tariffId, kind, minutes, amountKop }) => ({
            tariffId,
            kind,
            minutes,
            amountKop,
          })),
        ).toEqual(expected);
        expect(r.amountKop).toBe(sum(expected.map((e) => e.amountKop)));
      }),
      { numRuns: 300 },
    );
  });

  it('segments tile the billed interval: contiguous, whole minutes, non-empty', () => {
    fc.assert(
      fc.property(visit, (input) => {
        const r = calculateCharge(input);
        const entry = input.enteredAt.getTime();
        let cursor = entry;
        for (const s of r.segments) {
          expect(s.from.getTime()).toBe(cursor);
          expect(s.to.getTime() - s.from.getTime()).toBe(s.minutes * MINUTE);
          expect(s.minutes).toBeGreaterThan(0);
          expect(s.amountKop).toBe(s.minutes * s.pricePerMinuteKop);
          cursor = s.to.getTime();
        }
        expect(cursor).toBe(entry + r.minutes * MINUTE);
      }),
    );
  });

  it('money is always a safe non-negative integer number of kopecks', () => {
    fc.assert(
      fc.property(visit, (input) => {
        const r = calculateCharge(input);
        for (const value of [
          r.amountKop,
          ...r.segments.map((s) => s.amountKop),
        ]) {
          expect(Number.isSafeInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('staying longer never costs less', () => {
    fc.assert(
      fc.property(visit, fc.integer({ min: 0, max: DAY }), (input, extraMs) => {
        const longer = {
          ...input,
          exitedAt: new Date(input.exitedAt.getTime() + extraMs),
        };
        expect(calculateCharge(longer).amountKop).toBeGreaterThanOrEqual(
          calculateCharge(input).amountKop,
        );
      }),
    );
  });
});
