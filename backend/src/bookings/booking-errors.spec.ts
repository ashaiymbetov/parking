import { QueryFailedError } from 'typeorm';
import { DomainError } from '../common/domain-error';
import { mapBookingConflict } from './booking-errors';

function pgFailure(code: string, constraint?: string): QueryFailedError {
  return new QueryFailedError('INSERT INTO bookings …', [], {
    code,
    constraint,
    message: 'pg error',
  } as unknown as Error);
}

describe('mapBookingConflict (D-002, D-009, D-024)', () => {
  it.each([
    ['23P01', 'bookings_no_overlap_per_spot', 'BOOKING_CONFLICT'],
    ['23P01', 'bookings_no_overlap_per_car', 'CAR_ALREADY_BOOKED'],
    // Concurrent inserts into EXCLUDE can lose with a deadlock instead.
    ['40P01', undefined, 'BOOKING_CONFLICT'],
  ])('%s %s → 409 %s', (code, constraint, expected) => {
    const mapped = mapBookingConflict(pgFailure(code, constraint));
    expect(mapped).toBeInstanceOf(DomainError);
    expect(mapped).toMatchObject({ status: 409, code: expected });
  });

  it.each([
    ['23505', 'some_other_key'],
    ['23P01', 'tariffs_no_overlap'],
    ['57014', undefined],
  ])('leaves %s %s untouched', (code, constraint) => {
    const err = pgFailure(code, constraint);
    expect(mapBookingConflict(err)).toBe(err);
  });

  it('leaves non-database errors untouched', () => {
    const err = new Error('boom');
    expect(mapBookingConflict(err)).toBe(err);
  });
});
