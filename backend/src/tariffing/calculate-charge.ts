import { DateTime, IANAZone } from 'luxon';
import {
  Charge,
  ChargeInput,
  ChargeSegment,
  RateKind,
  TariffingError,
  TariffVersion,
} from './tariffing.types';

/**
 * Pure tariff calculation (D-003, D-014). No I/O, no clock, no framework.
 *
 * Rules:
 * - billed minutes N = ceil((exit − entry) / 1 min); minute i starts at
 *   entry + i·1 min;
 * - a minute is priced by the tariff version valid at its start and by the
 *   day/night part of that version in the parking's local time.
 *
 * Instead of pricing minute by minute, [entry, entry + N min) is cut at
 * every point where the price may change (version boundaries and local
 * day/night boundaries). Inside each piece the price is constant, so the
 * number of minutes that START in [a, b) is
 *   ceil((b − entry) / 1 min) − ceil((a − entry) / 1 min).
 * Everything is integer arithmetic on milliseconds and kopecks.
 */

const MINUTE_MS = 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface Rate {
  tariff: TariffVersion;
  kind: RateKind;
  priceKop: number;
}

export function calculateCharge(input: ChargeInput): Charge {
  const { tariffs, timeZone } = input;
  const entry = input.enteredAt.getTime();
  const exit = input.exitedAt.getTime();

  if (!Number.isFinite(entry) || !Number.isFinite(exit)) {
    throw new TariffingError(
      'INVALID_TIME',
      'Entry and exit must be valid dates',
    );
  }
  if (exit < entry) {
    throw new TariffingError('EXIT_BEFORE_ENTRY', 'Exit is earlier than entry');
  }
  if (!IANAZone.isValidZone(timeZone)) {
    throw new TariffingError(
      'INVALID_TIME_ZONE',
      `Unknown time zone: ${timeZone}`,
    );
  }
  validateTariffs(tariffs);

  const minutes = Math.ceil((exit - entry) / MINUTE_MS);
  if (minutes === 0) {
    return { minutes: 0, amountKop: 0, segments: [] };
  }
  const billedEnd = entry + minutes * MINUTE_MS;
  const firstMinuteAtOrAfter = (t: number) =>
    Math.ceil((t - entry) / MINUTE_MS);

  const cuts = priceChangePoints(entry, billedEnd, tariffs, timeZone);
  const segments: ChargeSegment[] = [];

  for (let i = 0; i < cuts.length - 1; i++) {
    const first = firstMinuteAtOrAfter(cuts[i]);
    const end = firstMinuteAtOrAfter(cuts[i + 1]);
    if (end <= first) continue; // no minute starts in this piece

    const from = entry + first * MINUTE_MS;
    const count = end - first;
    const rate = rateAt(from, tariffs, timeZone);
    const last = segments[segments.length - 1];

    if (last && last.tariffId === rate.tariff.id && last.kind === rate.kind) {
      last.minutes += count;
      last.amountKop += count * rate.priceKop;
      last.to = new Date(entry + end * MINUTE_MS);
    } else {
      segments.push({
        tariffId: rate.tariff.id,
        kind: rate.kind,
        from: new Date(from),
        to: new Date(entry + end * MINUTE_MS),
        minutes: count,
        pricePerMinuteKop: rate.priceKop,
        amountKop: count * rate.priceKop,
      });
    }
  }

  const amountKop = segments.reduce((sum, s) => sum + s.amountKop, 0);
  if (!Number.isSafeInteger(amountKop)) {
    throw new TariffingError(
      'INVALID_TARIFF',
      'Amount exceeds the safe integer range',
    );
  }
  return { minutes, amountKop, segments };
}

// ---------------------------------------------------------------------------

function validateTariffs(tariffs: readonly TariffVersion[]): void {
  const invalid = (msg: string) => new TariffingError('INVALID_TARIFF', msg);

  for (const t of tariffs) {
    const from = t.validFrom.getTime();
    const to = t.validTo === null ? Infinity : t.validTo.getTime();
    if (!Number.isFinite(from) || Number.isNaN(to) || to <= from) {
      throw invalid(`Tariff ${t.id}: invalid validity period`);
    }
    if (!HHMM.test(t.dayStartsAt) || !HHMM.test(t.nightStartsAt)) {
      throw invalid(`Tariff ${t.id}: boundaries must be HH:mm`);
    }
    if (t.dayStartsAt === t.nightStartsAt) {
      throw invalid(
        `Tariff ${t.id}: day and night cannot start at the same time`,
      );
    }
    for (const price of [t.dayPriceKop, t.nightPriceKop]) {
      if (!Number.isSafeInteger(price) || price < 0) {
        throw invalid(
          `Tariff ${t.id}: prices must be non-negative integer kopecks`,
        );
      }
    }
  }

  const sorted = [...tariffs].sort(
    (a, b) => a.validFrom.getTime() - b.validFrom.getTime(),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prevTo = sorted[i - 1].validTo;
    if (prevTo === null || prevTo.getTime() > sorted[i].validFrom.getTime()) {
      throw invalid(`Tariffs ${sorted[i - 1].id} and ${sorted[i].id} overlap`);
    }
  }
}

function versionAt(
  t: number,
  tariffs: readonly TariffVersion[],
): TariffVersion {
  const version = tariffs.find(
    (v) =>
      v.validFrom.getTime() <= t &&
      (v.validTo === null || t < v.validTo.getTime()),
  );
  if (!version) {
    throw new TariffingError(
      'NO_TARIFF',
      `No tariff version is valid at ${new Date(t).toISOString()}`,
    );
  }
  return version;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function rateAt(
  t: number,
  tariffs: readonly TariffVersion[],
  zone: string,
): Rate {
  const tariff = versionAt(t, tariffs);
  const local = DateTime.fromMillis(t, { zone });
  // Local time of day in fractional minutes: 22:59:30 is still before 23:00.
  const now =
    local.hour * 60 +
    local.minute +
    (local.second * 1000 + local.millisecond) / MINUTE_MS;
  const dayStart = minutesOf(tariff.dayStartsAt);
  const nightStart = minutesOf(tariff.nightStartsAt);
  const isDay =
    dayStart < nightStart
      ? now >= dayStart && now < nightStart
      : now >= dayStart || now < nightStart; // day part wraps past midnight
  return isDay
    ? { tariff, kind: 'day', priceKop: tariff.dayPriceKop }
    : { tariff, kind: 'night', priceKop: tariff.nightPriceKop };
}

/**
 * Sorted, de-duplicated instants that start pieces of constant price,
 * framed by `entry` and `billedEnd`.
 */
function priceChangePoints(
  entry: number,
  billedEnd: number,
  tariffs: readonly TariffVersion[],
  zone: string,
): number[] {
  const points = new Set<number>([entry, billedEnd]);
  const inside = (t: number) => t > entry && t < billedEnd;

  for (const t of tariffs) {
    for (const edge of [t.validFrom, t.validTo]) {
      if (edge && inside(edge.getTime())) points.add(edge.getTime());
    }
  }

  const boundaryTimes = new Set(
    tariffs.flatMap((t) => [t.dayStartsAt, t.nightStartsAt]),
  );
  // One local day of margin on both sides covers any UTC offset.
  let day = DateTime.fromMillis(entry, { zone })
    .startOf('day')
    .minus({ days: 1 });
  const lastDay = DateTime.fromMillis(billedEnd, { zone })
    .startOf('day')
    .plus({ days: 1 });
  while (day <= lastDay) {
    for (const hhmm of boundaryTimes) {
      for (const t of localTimeInstants(day, hhmm, zone)) {
        if (inside(t)) points.add(t);
      }
    }
    const next = day.plus({ days: 1 });
    // A DST jump moves the local clock without it "reading" any boundary
    // (a skipped time, or the clock going back over one): cut there too.
    if (next.offset !== day.offset) {
      const jump = offsetChangeInstant(day.toMillis(), next.toMillis(), zone);
      if (inside(jump)) points.add(jump);
    }
    day = next;
  }

  return [...points].sort((a, b) => a - b);
}

/** First instant in (lo, hi] whose UTC offset differs from the one at lo. */
function offsetChangeInstant(lo: number, hi: number, zone: string): number {
  const offsetAt = (t: number) => DateTime.fromMillis(t, { zone }).offset;
  const before = offsetAt(lo);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * All instants at which the local clock on `day` reads `hhmm`: usually one,
 * two when the time is repeated after a DST fall-back, none when it is
 * skipped by a spring-forward (the jump itself is a cut point, see above).
 * Luxon's `fromObject` alone would return a single instant and silently
 * shift a skipped time forward by the gap.
 */
function localTimeInstants(
  day: DateTime,
  hhmm: string,
  zone: string,
): number[] {
  const [hour, minute] = hhmm.split(':').map(Number);
  const wallAsUtc = Date.UTC(day.year, day.month - 1, day.day, hour, minute);

  // Offsets in effect around this date (before and after any transition).
  const noon = day.set({ hour: 12 });
  const offsets = new Set([
    noon.minus({ days: 1 }).offset,
    noon.offset,
    noon.plus({ days: 1 }).offset,
  ]);

  const instants = new Set<number>();
  for (const offset of offsets) {
    const t = wallAsUtc - offset * MINUTE_MS;
    const local = DateTime.fromMillis(t, { zone });
    if (
      local.offset === offset &&
      local.day === day.day &&
      local.hour === hour &&
      local.minute === minute
    ) {
      instants.add(t);
    }
  }
  return [...instants];
}
