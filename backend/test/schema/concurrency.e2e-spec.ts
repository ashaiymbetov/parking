import { Client, DatabaseError } from 'pg';
import { connect, migrateDatabase } from '../support/db';
import {
  BOOKING_INSERT,
  Driver,
  VISIT_INSERT,
  insertDriver,
  insertSpot,
} from '../support/factories';

const PARALLEL = 10;

/** Each attempt runs in its own connection and transaction, all at once. */
async function raceTransactions(
  clients: Client[],
  attempt: (c: Client, i: number) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(
    clients.map(async (c, i) => {
      await c.query('BEGIN');
      try {
        await attempt(c, i);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }),
  );
}

function rejectionCodes(results: PromiseSettledResult<unknown>[]) {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => {
      const e = r.reason as DatabaseError;
      return `${e.code} ${e.constraint}`;
    });
}

describe('schema: invariants under concurrent transactions', () => {
  let setup: Client;
  let clients: Client[];
  const drivers: Driver[] = [];
  let spot: string;

  beforeAll(async () => {
    await migrateDatabase();
    setup = await connect();
    clients = await Promise.all(
      Array.from({ length: PARALLEL }, () => connect()),
    );
    spot = await insertSpot(setup);
    for (let i = 0; i < PARALLEL; i++) {
      drivers.push(await insertDriver(setup));
    }
  });

  afterAll(async () => {
    // These tests commit real rows: clean them up explicitly.
    const userIds = drivers.map((d) => d.userId);
    await setup.query('DELETE FROM visits WHERE spot_id = $1', [spot]);
    await setup.query('DELETE FROM bookings WHERE spot_id = $1', [spot]);
    await setup.query('DELETE FROM cars WHERE user_id = ANY($1)', [userIds]);
    await setup.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    await setup.query('DELETE FROM spots WHERE id = $1', [spot]);
    await Promise.all([setup, ...clients].map((c) => c.end()));
  });

  it(`${PARALLEL} drivers book overlapping slots on one spot at once → exactly one wins`, async () => {
    const results = await raceTransactions(clients, (c, i) =>
      c.query(BOOKING_INSERT, [
        drivers[i].userId,
        drivers[i].carId,
        spot,
        // Every interval overlaps all others around 12:00.
        `2026-10-06T${String(11 - (i % 3)).padStart(2, '0')}:00:00Z`,
        `2026-10-06T${String(13 + (i % 2)).padStart(2, '0')}:00:00Z`,
        'confirmed',
      ]),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // Concurrent inserts into an exclusion constraint wait on each other's
    // uncommitted rows; PostgreSQL resolves some of those waits as a
    // deadlock (40P01) instead of an exclusion violation (23P01). Both mean
    // "rejected", and the booking service must map both to a conflict (D-024).
    const codes = rejectionCodes(results);
    expect(codes).toHaveLength(PARALLEL - 1);
    for (const code of codes) {
      expect([
        '23P01 bookings_no_overlap_per_spot',
        '40P01 undefined',
      ]).toContain(code);
    }
    const stored = await setup.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bookings WHERE spot_id = $1 AND status = 'confirmed'`,
      [spot],
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it(`the same plate enters ${PARALLEL} times at once → one open visit`, async () => {
    const spots: string[] = [];
    for (let i = 0; i < PARALLEL; i++) spots.push(await insertSpot(setup));
    try {
      const results = await raceTransactions(clients, (c, i) =>
        c.query(VISIT_INSERT, [
          'RACE001',
          spots[i],
          '2026-10-06T10:00:00Z',
          null,
          null,
          null,
        ]),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejectionCodes(results)).toEqual(
        Array(PARALLEL - 1).fill('23505 visits_one_open_per_plate'),
      );
    } finally {
      await setup.query(`DELETE FROM visits WHERE plate = 'RACE001'`);
      await setup.query('DELETE FROM spots WHERE id = ANY($1)', [spots]);
    }
  });

  it(`${PARALLEL} cars take the same spot at once → one open visit`, async () => {
    const results = await raceTransactions(clients, (c, i) =>
      c.query(VISIT_INSERT, [
        `RACE1${i}`,
        spot,
        '2026-10-06T10:00:00Z',
        null,
        null,
        null,
      ]),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejectionCodes(results)).toEqual(
      Array(PARALLEL - 1).fill('23505 visits_one_open_per_spot'),
    );
  });
});
