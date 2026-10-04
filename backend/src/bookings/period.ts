import { DateTime } from 'luxon';
import { DomainError } from '../common/domain-error';
import { validateBookingPeriod, VIOLATION_MESSAGES } from './booking-period';

/** Parses a validated ISO pair and applies the booking rules or throws 422. */
export function parsePeriod(
  fromIso: string,
  toIso: string,
  now: Date,
): { from: Date; to: Date } {
  const from = DateTime.fromISO(fromIso, { setZone: true }).toJSDate();
  const to = DateTime.fromISO(toIso, { setZone: true }).toJSDate();
  const violation = validateBookingPeriod({ from, to, now });
  if (violation) {
    throw new DomainError(
      422,
      'BOOKING_INVALID_PERIOD',
      VIOLATION_MESSAGES[violation],
      {
        reason: violation,
      },
    );
  }
  return { from, to };
}
