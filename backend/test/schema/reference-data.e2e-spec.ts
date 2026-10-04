import { useRollbackClient } from '../support/db';

describe('reference data (migration)', () => {
  const db = useRollbackClient();

  it('creates 20 active spots A01–A10 / B01–B10 on a 2×10 grid', async () => {
    const res = await db().query<{ code: string; row: number; col: number }>(
      `SELECT code, "row", col FROM spots
       WHERE code ~ '^[AB][0-9]{2}$' AND is_active ORDER BY code`,
    );
    const expected = ['A', 'B'].flatMap((letter, r) =>
      Array.from({ length: 10 }, (_, i) => ({
        code: `${letter}${String(i + 1).padStart(2, '0')}`,
        row: r + 1,
        col: i + 1,
      })),
    );
    expect(res.rows).toEqual(expected);
  });

  it('every seeded spot starts free in spot_state', async () => {
    const res = await db().query<{ state: string; version: string; n: number }>(
      `SELECT ss.state, ss.version, count(*)::int AS n
       FROM spots s JOIN spot_state ss ON ss.spot_id = s.id
       WHERE s.code ~ '^[AB][0-9]{2}$'
       GROUP BY ss.state, ss.version`,
    );
    expect(res.rows).toEqual([{ state: 'free', version: '0', n: 20 }]);
  });

  it('has one tariff: day 07:00 250 kop/min, night 23:00 120 kop/min, Asia/Bishkek', async () => {
    const res = await db().query(
      `SELECT timezone, day_starts_at, night_starts_at, day_price_kop, night_price_kop,
              lower(valid_during) = '2020-01-01T00:00:00+06:00'::timestamptz AS from_2020,
              upper_inf(valid_during) AS open_ended
       FROM tariffs`,
    );
    expect(res.rows).toEqual([
      {
        timezone: 'Asia/Bishkek',
        day_starts_at: '07:00:00',
        night_starts_at: '23:00:00',
        day_price_kop: 250,
        night_price_kop: 120,
        from_2020: true,
        open_ended: true,
      },
    ]);
  });
});
