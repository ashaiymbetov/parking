import { expectViolation, useRollbackClient } from '../support/db';
import {
  Driver,
  VISIT_INSERT,
  insertBooking,
  insertDriver,
  insertSpot,
  insertVisit,
} from '../support/factories';

const INVOICE_INSERT = `
  INSERT INTO invoices (visit_id, minutes, amount_kop, breakdown)
  VALUES ($1, $2, $3, '[]'::jsonb)`;

describe('schema: visits and invoices', () => {
  const db = useRollbackClient();
  let driver: Driver;
  let spot: string;
  let otherSpot: string;

  beforeEach(async () => {
    driver = await insertDriver(db());
    spot = await insertSpot(db());
    otherSpot = await insertSpot(db());
  });

  const openVisit = (plate: string, spotId: string) => [
    plate,
    spotId,
    '2026-10-05T10:00:00Z',
    null,
    null,
    null,
  ];

  describe('a car cannot be inside twice', () => {
    it('rejects a second open visit for the same plate', async () => {
      await insertVisit(db(), {
        plate: driver.plate,
        spotId: spot,
        enteredAt: '2026-10-05T09:00:00Z',
      });
      await expectViolation(
        db(),
        VISIT_INSERT,
        openVisit(driver.plate, otherSpot),
        {
          code: '23505',
          constraint: 'visits_one_open_per_plate',
        },
      );
    });

    it('allows a new open visit after the previous one was closed', async () => {
      await insertVisit(db(), {
        plate: driver.plate,
        spotId: spot,
        enteredAt: '2026-10-05T08:00:00Z',
        exitedAt: '2026-10-05T09:00:00Z',
      });
      await db().query(VISIT_INSERT, openVisit(driver.plate, spot));
    });
  });

  describe('a spot cannot hold two cars', () => {
    it('rejects a second open visit on the same spot', async () => {
      await insertVisit(db(), {
        plate: 'AAA111',
        spotId: spot,
        enteredAt: '2026-10-05T09:00:00Z',
      });
      await expectViolation(db(), VISIT_INSERT, openVisit('BBB222', spot), {
        code: '23505',
        constraint: 'visits_one_open_per_spot',
      });
    });

    it('allows a new car once the spot was vacated', async () => {
      await insertVisit(db(), {
        plate: 'AAA111',
        spotId: spot,
        enteredAt: '2026-10-05T08:00:00Z',
        exitedAt: '2026-10-05T09:00:00Z',
      });
      await db().query(VISIT_INSERT, openVisit('BBB222', spot));
    });
  });

  it('one booking leads to at most one visit', async () => {
    const bookingId = await insertBooking(db(), {
      driver,
      spotId: spot,
      from: '2026-10-05T10:00:00Z',
      to: '2026-10-05T11:00:00Z',
      status: 'checked_in',
    });
    await insertVisit(db(), {
      plate: driver.plate,
      spotId: spot,
      enteredAt: '2026-10-05T10:00:00Z',
      exitedAt: '2026-10-05T10:20:00Z',
      bookingId,
    });
    await expectViolation(
      db(),
      VISIT_INSERT,
      [driver.plate, spot, '2026-10-05T10:30:00Z', null, null, bookingId],
      { code: '23505', constraint: 'visits_booking_id_key' },
    );
  });

  it('exit cannot be earlier than entry', async () => {
    await expectViolation(
      db(),
      VISIT_INSERT,
      [
        'CCC333',
        spot,
        '2026-10-05T10:00:00Z',
        '2026-10-05T09:59:59Z',
        'exit',
        null,
      ],
      { code: '23514', constraint: 'visits_exit_after_entry_check' },
    );
  });

  it.each([
    ['closed without a reason', '2026-10-05T11:00:00Z', null],
    ['open with a reason', null, 'exit'],
    ['unknown reason', '2026-10-05T11:00:00Z', 'teleport'],
  ])(
    'close_reason is consistent with exited_at (%s)',
    async (_c, exitedAt, reason) => {
      await expectViolation(
        db(),
        VISIT_INSERT,
        ['CCC333', spot, '2026-10-05T10:00:00Z', exitedAt, reason, null],
        { code: '23514', constraint: 'visits_close_reason_check' },
      );
    },
  );

  it('visit plate must be normalized', async () => {
    await expectViolation(db(), VISIT_INSERT, openVisit('ccc 333', spot), {
      code: '23514',
      constraint: 'visits_plate_format_check',
    });
  });

  describe('invoices', () => {
    let visitId: string;

    beforeEach(async () => {
      visitId = await insertVisit(db(), {
        plate: driver.plate,
        spotId: spot,
        enteredAt: '2026-10-05T10:00:00Z',
        exitedAt: '2026-10-05T11:00:00Z',
      });
    });

    it('a visit has at most one invoice', async () => {
      await db().query(INVOICE_INSERT, [visitId, 60, 15000]);
      await expectViolation(db(), INVOICE_INSERT, [visitId, 60, 15000], {
        code: '23505',
        constraint: 'invoices_visit_id_key',
      });
    });

    it.each([
      ['negative amount', 60, -1],
      ['negative minutes', -1, 0],
    ])('rejects %s', async (_c, minutes, amount) => {
      await expectViolation(db(), INVOICE_INSERT, [visitId, minutes, amount], {
        code: '23514',
        constraint: 'invoices_amounts_check',
      });
    });

    it('amount is stored as an integer number of kopecks', async () => {
      await db().query(INVOICE_INSERT, [visitId, 60, 15000]);
      const res = await db().query<{ amount_kop: unknown }>(
        'SELECT amount_kop FROM invoices WHERE visit_id = $1',
        [visitId],
      );
      // integer, not bigint: pg returns a JS number, not a string.
      expect(res.rows[0].amount_kop).toBe(15000);
    });
  });
});
