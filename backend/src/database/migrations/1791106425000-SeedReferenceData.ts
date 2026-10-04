import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data the system cannot work without (D-021): the parking layout
 * and the tariff. Demo users are NOT here — see src/seed.
 */
export class SeedReferenceData1791106425000 implements MigrationInterface {
  name = 'SeedReferenceData1791106425000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 20 spots: A01–A10 in row 1, B01–B10 in row 2.
    await queryRunner.query(`
      INSERT INTO spots (code, "row", col)
      SELECT letter || lpad(n::text, 2, '0'), r, n
      FROM (VALUES ('A', 1), ('B', 2)) AS rows (letter, r),
           generate_series(1, 10) AS n
    `);
    await queryRunner.query(`
      INSERT INTO spot_state (spot_id, state, version)
      SELECT id, 'free', 0 FROM spots WHERE code ~ '^[AB][0-9]{2}$'
    `);

    // Day 07:00–23:00 at 2.50/min, night 23:00–07:00 at 1.20/min (D-003).
    await queryRunner.query(`
      INSERT INTO tariffs (valid_during, timezone, day_starts_at, night_starts_at,
                           day_price_kop, night_price_kop)
      VALUES (tstzrange('2020-01-01T00:00:00+06:00', NULL, '[)'),
              'Asia/Bishkek', '07:00', '23:00', 250, 120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM tariffs
      WHERE valid_during = tstzrange('2020-01-01T00:00:00+06:00', NULL, '[)')
        AND day_price_kop = 250 AND night_price_kop = 120
    `);
    // spot_state rows go with their spots (ON DELETE CASCADE).
    await queryRunner.query(`DELETE FROM spots WHERE code ~ '^[AB][0-9]{2}$'`);
  }
}
