import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSpotsAndTariffs1791106421000 implements MigrationInterface {
  name = 'CreateSpotsAndTariffs1791106421000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE spots (
        id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code      text NOT NULL,
        "row"     integer NOT NULL,
        col       integer NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        CONSTRAINT spots_code_key UNIQUE (code),
        CONSTRAINT spots_row_col_key UNIQUE ("row", col)
      )
    `);

    // Tariff versions by validity period (D-014): a minute is priced by the
    // version valid at its start, so versions must never overlap.
    await queryRunner.query(`
      CREATE TABLE tariffs (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        valid_during    tstzrange NOT NULL,
        timezone        text NOT NULL,
        day_starts_at   time NOT NULL,
        night_starts_at time NOT NULL,
        day_price_kop   integer NOT NULL,
        night_price_kop integer NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT tariffs_no_overlap
          EXCLUDE USING gist (valid_during WITH &&),
        CONSTRAINT tariffs_valid_during_check CHECK (NOT isempty(valid_during)),
        CONSTRAINT tariffs_prices_check
          CHECK (day_price_kop >= 0 AND night_price_kop >= 0),
        CONSTRAINT tariffs_day_night_check
          CHECK (day_starts_at <> night_starts_at)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tariffs`);
    await queryRunner.query(`DROP TABLE spots`);
  }
}
