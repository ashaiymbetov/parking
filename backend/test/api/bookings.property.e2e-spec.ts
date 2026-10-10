import fc from 'fast-check';
import {
  addCar,
  createTestApp,
  createUser,
  resetDomainData,
  spotByCode,
  TestApp,
} from '../support/api';

const NOW = '2026-10-05T08:00:00Z';
const SLOT_MS = 15 * 60_000;
const BASE = Date.parse('2026-10-05T10:00:00Z');

interface Interval {
  from: number;
  to: number;
}

const overlaps = (a: Interval, b: Interval) => a.from < b.to && b.from < a.to;

/**
 * ARCHITECTURE §7, «то же, свойство»: a random set of intervals for one spot
 * is sent all at once. Whatever the interleaving, the accepted bookings are
 * pairwise disjoint, and every rejected one really overlapped an accepted one.
 */
describe('API: concurrent bookings (property, real PostgreSQL)', () => {
  let t: TestApp;
  let spot: string;

  beforeAll(async () => {
    t = await createTestApp(NOW);
    spot = await spotByCode(t, 'B05');
  });
  afterAll(async () => {
    await resetDomainData(t.ds);
    await t.close();
  });

  it('accepted bookings never overlap; rejected ones always conflicted', async () => {
    const intervals = fc
      .array(
        fc
          .record({
            startSlot: fc.integer({ min: 0, max: 16 }), // within 4 hours
            lengthSlots: fc.integer({ min: 1, max: 8 }), // 15 min … 2 h
          })
          .map((r): Interval => ({
            from: BASE + r.startSlot * SLOT_MS,
            to: BASE + (r.startSlot + r.lengthSlots) * SLOT_MS,
          })),
        { minLength: 2, maxLength: 8 },
      )
      .filter((ivs) =>
        ivs.some((a, i) => ivs.some((b, j) => i < j && overlaps(a, b))),
      );

    await fc.assert(
      fc.asyncProperty(intervals, async (ivs) => {
        await resetDomainData(t.ds);
        // One driver per request, so only the spot can conflict.
        const drivers = [];
        for (let i = 0; i < ivs.length; i++) {
          const user = await createUser(t);
          const car = await addCar(t, user, `PROP${i}`);
          drivers.push({ user, car });
        }

        const responses = await Promise.all(
          ivs.map((iv, i) =>
            t
              .http()
              .post('/api/bookings')
              .set(drivers[i].user.auth)
              .send({
                carId: drivers[i].car.id,
                spotId: spot,
                from: new Date(iv.from).toISOString(),
                to: new Date(iv.to).toISOString(),
              }),
          ),
        );

        const accepted = ivs.filter((_, i) => responses[i].status === 201);
        const rejected = ivs.filter((_, i) => responses[i].status !== 201);

        for (const [i, r] of responses.entries()) {
          if (r.status !== 201) {
            expect([i, r.status, r.body.code]).toEqual([
              i,
              409,
              'BOOKING_CONFLICT',
            ]);
          }
        }
        for (const [i, a] of accepted.entries()) {
          for (const b of accepted.slice(i + 1))
            expect(overlaps(a, b)).toBe(false);
        }
        for (const r of rejected) {
          expect(accepted.some((a) => overlaps(a, r))).toBe(true);
        }

        const rows: { n: number }[] = await t.ds.query(
          `SELECT count(*)::int AS n FROM bookings
           WHERE spot_id = $1 AND status = 'confirmed'`,
          [spot],
        );
        expect(rows[0].n).toBe(accepted.length);
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});
