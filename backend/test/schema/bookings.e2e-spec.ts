import { expectViolation, useRollbackClient } from '../support/db';
import {
  BOOKING_INSERT,
  Driver,
  insertBooking,
  insertDriver,
  insertSpot,
} from '../support/factories';

describe('schema: bookings', () => {
  const db = useRollbackClient();
  let alice: Driver;
  let bob: Driver;
  let spot: string;
  let otherSpot: string;

  beforeEach(async () => {
    alice = await insertDriver(db());
    bob = await insertDriver(db());
    spot = await insertSpot(db());
    otherSpot = await insertSpot(db());
  });

  const bobOn = (
    spotId: string,
    from: string,
    to: string,
    status = 'confirmed',
  ) => [bob.userId, bob.carId, spotId, from, to, status];

  describe('no overlapping active bookings on one spot', () => {
    it.each(['confirmed', 'checked_in'])(
      'rejects an overlap with a %s booking',
      async (status) => {
        await insertBooking(db(), {
          driver: alice,
          spotId: spot,
          from: '2026-10-05T10:00:00Z',
          to: '2026-10-05T11:00:00Z',
          status,
        });
        await expectViolation(
          db(),
          BOOKING_INSERT,
          bobOn(spot, '2026-10-05T10:59:00Z', '2026-10-05T12:00:00Z'),
          { code: '23P01', constraint: 'bookings_no_overlap_per_spot' },
        );
      },
    );

    it('rejects a booking fully inside another one', async () => {
      await insertBooking(db(), {
        driver: alice,
        spotId: spot,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T12:00:00Z',
      });
      await expectViolation(
        db(),
        BOOKING_INSERT,
        bobOn(spot, '2026-10-05T10:30:00Z', '2026-10-05T11:00:00Z'),
        { code: '23P01', constraint: 'bookings_no_overlap_per_spot' },
      );
    });

    it('allows adjacent bookings (half-open ranges)', async () => {
      await insertBooking(db(), {
        driver: alice,
        spotId: spot,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      });
      await db().query(
        BOOKING_INSERT,
        bobOn(spot, '2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z'),
      );
    });

    it('allows the same time on another spot', async () => {
      await insertBooking(db(), {
        driver: alice,
        spotId: spot,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      });
      await db().query(
        BOOKING_INSERT,
        bobOn(otherSpot, '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
      );
    });

    it.each(['cancelled', 'no_show', 'completed'])(
      'a %s booking does not block the spot',
      async (status) => {
        await insertBooking(db(), {
          driver: alice,
          spotId: spot,
          from: '2026-10-05T10:00:00Z',
          to: '2026-10-05T11:00:00Z',
          status,
        });
        await db().query(
          BOOKING_INSERT,
          bobOn(spot, '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z'),
        );
      },
    );

    it('a cancelled booking cannot be revived over a newer one', async () => {
      const cancelled = await insertBooking(db(), {
        driver: alice,
        spotId: spot,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
        status: 'cancelled',
      });
      await insertBooking(db(), {
        driver: bob,
        spotId: spot,
        from: '2026-10-05T10:30:00Z',
        to: '2026-10-05T11:30:00Z',
      });
      await expectViolation(
        db(),
        `UPDATE bookings SET status = 'confirmed' WHERE id = $1`,
        [cancelled],
        { code: '23P01', constraint: 'bookings_no_overlap_per_spot' },
      );
    });
  });

  describe('one car cannot hold two overlapping bookings', () => {
    it('rejects the same car on two spots at once', async () => {
      await insertBooking(db(), {
        driver: alice,
        spotId: spot,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      });
      await expectViolation(
        db(),
        BOOKING_INSERT,
        [
          alice.userId,
          alice.carId,
          otherSpot,
          '2026-10-05T10:30:00Z',
          '2026-10-05T11:30:00Z',
          'confirmed',
        ],
        { code: '23P01', constraint: 'bookings_no_overlap_per_car' },
      );
    });

    it('allows the same car at different times', async () => {
      await insertBooking(db(), {
        driver: alice,
        spotId: spot,
        from: '2026-10-05T10:00:00Z',
        to: '2026-10-05T11:00:00Z',
      });
      await insertBooking(db(), {
        driver: alice,
        spotId: otherSpot,
        from: '2026-10-05T11:00:00Z',
        to: '2026-10-05T12:00:00Z',
      });
    });
  });

  describe('period shape', () => {
    const withPeriod = (periodSql: string) => `
      INSERT INTO bookings (user_id, car_id, spot_id, period, status)
      VALUES ($1, $2, $3, ${periodSql}, 'confirmed')`;
    const args = () => [bob.userId, bob.carId, spot];

    it.each([
      ['empty', `tstzrange('2026-10-05T10:00Z', '2026-10-05T10:00Z')`],
      ['unbounded end', `tstzrange('2026-10-05T10:00Z', NULL)`],
      ['unbounded start', `tstzrange(NULL, '2026-10-05T10:00Z')`],
      [
        'closed end',
        `tstzrange('2026-10-05T10:00Z', '2026-10-05T11:00Z', '[]')`,
      ],
      [
        'open start',
        `tstzrange('2026-10-05T10:00Z', '2026-10-05T11:00Z', '()')`,
      ],
    ])('rejects %s ranges', async (_case, periodSql) => {
      await expectViolation(db(), withPeriod(periodSql), args(), {
        code: '23514',
        constraint: 'bookings_period_bounds_check',
      });
    });

    it.each([
      ['seconds in start', '2026-10-05T10:00:30Z', '2026-10-05T11:00:00Z'],
      [
        'milliseconds in end',
        '2026-10-05T10:00:00Z',
        '2026-10-05T11:00:00.001Z',
      ],
    ])(
      'rejects bounds not aligned to a minute (%s)',
      async (_case, from, to) => {
        await expectViolation(db(), BOOKING_INSERT, bobOn(spot, from, to), {
          code: '23514',
          constraint: 'bookings_period_minute_check',
        });
      },
    );

    it('accepts minute-aligned bounds in any offset', async () => {
      await db().query(
        BOOKING_INSERT,
        bobOn(spot, '2026-10-05T16:00:00+06:00', '2026-10-05T17:30:00+06:00'),
      );
    });
  });

  it('status must be a known value', async () => {
    await expectViolation(
      db(),
      BOOKING_INSERT,
      bobOn(spot, '2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', 'expired'),
      { code: '23514', constraint: 'bookings_status_check' },
    );
  });
});
