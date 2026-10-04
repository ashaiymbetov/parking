import { expectViolation, useRollbackClient } from '../support/db';
import { insertSpot } from '../support/factories';

const TARIFF_INSERT = `
  INSERT INTO tariffs (valid_during, timezone, day_starts_at, night_starts_at,
                       day_price_kop, night_price_kop)
  VALUES (tstzrange($1, $2, '[)'), 'Asia/Bishkek', '07:00', '23:00', $3, $4)`;

describe('schema: spots and tariffs', () => {
  const db = useRollbackClient();

  it('spot code is unique', async () => {
    await insertSpot(db(), { code: 'Z01' });
    await expectViolation(
      db(),
      `INSERT INTO spots (code, "row", col) VALUES ('Z01', 9001, 1)`,
      [],
      { code: '23505', constraint: 'spots_code_key' },
    );
  });

  it('two spots cannot share a grid cell', async () => {
    await db().query(
      `INSERT INTO spots (code, "row", col) VALUES ('Z02', 9002, 1)`,
    );
    await expectViolation(
      db(),
      `INSERT INTO spots (code, "row", col) VALUES ('Z03', 9002, 1)`,
      [],
      { code: '23505', constraint: 'spots_row_col_key' },
    );
  });

  describe('tariff versions', () => {
    beforeEach(async () => {
      // Start from an empty tariff table; the transaction rolls this back.
      await db().query('DELETE FROM tariffs');
    });

    it('adjacent validity periods are allowed', async () => {
      await db().query(TARIFF_INSERT, [
        '2026-01-01T00:00:00+06:00',
        '2026-11-01T00:00:00+06:00',
        250,
        120,
      ]);
      await db().query(TARIFF_INSERT, [
        '2026-11-01T00:00:00+06:00',
        null,
        250,
        150,
      ]);
    });

    it('overlapping validity periods are rejected', async () => {
      await db().query(TARIFF_INSERT, [
        '2026-01-01T00:00:00+06:00',
        null,
        250,
        120,
      ]);
      await expectViolation(
        db(),
        TARIFF_INSERT,
        ['2026-06-01T00:00:00+06:00', '2026-07-01T00:00:00+06:00', 300, 150],
        { code: '23P01', constraint: 'tariffs_no_overlap' },
      );
    });

    it('prices cannot be negative', async () => {
      await expectViolation(
        db(),
        TARIFF_INSERT,
        ['2026-01-01T00:00:00+06:00', null, -1, 120],
        { code: '23514', constraint: 'tariffs_prices_check' },
      );
    });

    it('day and night cannot start at the same time', async () => {
      await expectViolation(
        db(),
        `INSERT INTO tariffs (valid_during, timezone, day_starts_at, night_starts_at,
                              day_price_kop, night_price_kop)
         VALUES (tstzrange(now(), NULL), 'Asia/Bishkek', '07:00', '07:00', 1, 1)`,
        [],
        { code: '23514', constraint: 'tariffs_day_night_check' },
      );
    });
  });
});
