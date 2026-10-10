import { DomainError } from '../common/domain-error';
import { pgError } from '../common/pg-error';

/**
 * EXCLUDE violations become user-facing conflicts. A deadlock (40P01) that
 * is still there after BookingsService's retries is answered the same way
 * as an overlap (D-024).
 */
export function mapBookingConflict(err: unknown): unknown {
  const pg = pgError(err);
  if (!pg) return err;
  if (pg.code === '23P01' && pg.constraint === 'bookings_no_overlap_per_car') {
    return new DomainError(
      409,
      'CAR_ALREADY_BOOKED',
      'У этой машины уже есть бронь на пересекающееся время',
    );
  }
  if (
    (pg.code === '23P01' && pg.constraint === 'bookings_no_overlap_per_spot') ||
    pg.code === '40P01'
  ) {
    return new DomainError(
      409,
      'BOOKING_CONFLICT',
      'Место уже забронировано на это время — выберите другое время или место',
    );
  }
  return err;
}

export function isDeadlock(err: unknown): boolean {
  return pgError(err)?.code === '40P01';
}
