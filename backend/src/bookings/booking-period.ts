/**
 * Booking period rules (D-008, D-026). Pure: `now` comes from the caller's
 * Clock. Returns the first violated rule or null.
 */
const MINUTE = 60_000;

export const BOOKING_LIMITS = {
  minDurationMs: 15 * MINUTE,
  maxDurationMs: 24 * 60 * MINUTE,
  maxAheadMs: 7 * 24 * 60 * MINUTE,
} as const;

export type BookingPeriodViolation =
  | 'NOT_MINUTE_ALIGNED'
  | 'END_NOT_AFTER_START'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'IN_THE_PAST'
  | 'TOO_FAR_AHEAD';

export const VIOLATION_MESSAGES: Record<BookingPeriodViolation, string> = {
  NOT_MINUTE_ALIGNED: 'Начало и конец брони должны быть кратны минуте',
  END_NOT_AFTER_START: 'Конец брони должен быть позже начала',
  TOO_SHORT: 'Бронь не может быть короче 15 минут',
  TOO_LONG: 'Бронь не может быть длиннее 24 часов',
  IN_THE_PAST: 'Бронь не может начинаться в прошлом',
  TOO_FAR_AHEAD: 'Бронировать можно не дальше чем на 7 дней вперёд',
};

export function validateBookingPeriod(p: {
  from: Date;
  to: Date;
  now: Date;
}): BookingPeriodViolation | null {
  const from = p.from.getTime();
  const to = p.to.getTime();
  const now = p.now.getTime();

  if (from % MINUTE !== 0 || to % MINUTE !== 0) return 'NOT_MINUTE_ALIGNED';
  if (to <= from) return 'END_NOT_AFTER_START';
  if (to - from < BOOKING_LIMITS.minDurationMs) return 'TOO_SHORT';
  if (to - from > BOOKING_LIMITS.maxDurationMs) return 'TOO_LONG';
  // "Now" is the current minute, so a booking "right now" is possible.
  if (from < Math.floor(now / MINUTE) * MINUTE) return 'IN_THE_PAST';
  if (from > now + BOOKING_LIMITS.maxAheadMs) return 'TOO_FAR_AHEAD';
  return null;
}
