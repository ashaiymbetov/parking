import { useRollbackClient } from '../support/db';
import {
  Driver,
  insertBooking,
  insertDriver,
  insertSpot,
  insertVisit,
} from '../support/factories';

/**
 * One SQL function decides a spot's state for the map, for walk-in choice
 * and for the spot_state snapshot (D-011): occupied > booked > free, where
 * "booked" is a confirmed booking overlapping [at, at + soon).
 */
describe('schema: spot state functions (D-011)', () => {
  const db = useRollbackClient();
  const AT = '2026-10-05T08:00:00Z';
  let driver: Driver;
  let spot: string;

  beforeEach(async () => {
    driver = await insertDriver(db());
    spot = await insertSpot(db());
  });

  async function stateAt(at = AT, soonMin = 15): Promise<string> {
    const res = await db().query<{ state: string }>(
      `SELECT spot_state_at($1, $2, make_interval(mins => $3)) AS state`,
      [spot, at, soonMin],
    );
    return res.rows[0].state;
  }

  const book = (from: string, to: string, status = 'confirmed') =>
    insertBooking(db(), { driver, spotId: spot, from, to, status });

  it('free without visits and bookings', async () => {
    expect(await stateAt()).toBe('free');
  });

  it.each([
    ['starts in 14 minutes', '2026-10-05T08:14:00Z', 'booked'],
    ['starts right now', '2026-10-05T08:00:00Z', 'booked'],
    [
      'started 10 minutes ago (not yet no-show)',
      '2026-10-05T07:50:00Z',
      'booked',
    ],
    ['starts in exactly 15 minutes', '2026-10-05T08:15:00Z', 'free'],
    ['starts in an hour', '2026-10-05T09:00:00Z', 'free'],
  ])('a confirmed booking that %s → %s', async (_case, from, expected) => {
    await book(from, '2026-10-05T10:00:00Z');
    expect(await stateAt()).toBe(expected);
  });

  it('a booking that ended exactly now does not count', async () => {
    await book('2026-10-05T07:00:00Z', '2026-10-05T08:00:00Z');
    expect(await stateAt()).toBe('free');
  });

  it.each(['checked_in', 'cancelled', 'no_show', 'completed'])(
    'a %s booking does not make the spot booked',
    async (status) => {
      await book('2026-10-05T08:05:00Z', '2026-10-05T09:00:00Z', status);
      expect(await stateAt()).toBe('free');
    },
  );

  it('the window length is a parameter (EARLY_ENTRY_MIN)', async () => {
    await book('2026-10-05T08:20:00Z', '2026-10-05T09:00:00Z');
    expect(await stateAt(AT, 15)).toBe('free');
    expect(await stateAt(AT, 30)).toBe('booked');
  });

  it('an open visit wins over a booking; a closed one does not count', async () => {
    await book('2026-10-05T08:05:00Z', '2026-10-05T09:00:00Z');
    const plate = 'V123AB';
    await insertVisit(db(), {
      plate,
      spotId: spot,
      enteredAt: '2026-10-05T06:00:00Z',
      exitedAt: '2026-10-05T07:00:00Z',
    });
    expect(await stateAt()).toBe('booked');

    await insertVisit(db(), {
      plate,
      spotId: spot,
      enteredAt: '2026-10-05T07:30:00Z',
    });
    expect(await stateAt()).toBe('occupied');
  });

  describe('refresh_spot_state', () => {
    async function refresh(at = AT) {
      const res = await db().query<{
        new_state: string;
        new_version: string;
        changed: boolean;
      }>(
        `SELECT * FROM refresh_spot_state($1, $2, make_interval(mins => 15))`,
        [spot, at],
      );
      const r = res.rows[0];
      return {
        state: r.new_state,
        version: Number(r.new_version),
        changed: r.changed,
      };
    }

    it('creates the snapshot row for a spot that has none', async () => {
      expect(await refresh()).toEqual({
        state: 'free',
        version: 1,
        changed: true,
      });
    });

    it('bumps the version only when the state really changes', async () => {
      const first = await refresh();
      expect(await refresh()).toEqual({ ...first, changed: false });

      await book('2026-10-05T08:10:00Z', '2026-10-05T09:00:00Z');
      expect(await refresh()).toEqual({
        state: 'booked',
        version: first.version + 1,
        changed: true,
      });

      // Time alone changes the state: the booking has ended.
      expect(await refresh('2026-10-05T09:00:00Z')).toEqual({
        state: 'free',
        version: first.version + 2,
        changed: true,
      });
    });
  });
});
