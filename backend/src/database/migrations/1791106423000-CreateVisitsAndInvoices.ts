import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVisitsAndInvoices1791106423000 implements MigrationInterface {
  name = 'CreateVisitsAndInvoices1791106423000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A visit is open while exited_at IS NULL. car_id / user_id are NULL for
    // guests (Q9 → D-005).
    await queryRunner.query(`
      CREATE TABLE visits (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        plate        text NOT NULL,
        car_id       uuid REFERENCES cars (id),
        user_id      uuid REFERENCES users (id),
        spot_id      uuid NOT NULL REFERENCES spots (id),
        booking_id   uuid REFERENCES bookings (id),
        entered_at   timestamptz NOT NULL,
        exited_at    timestamptz,
        close_reason text,
        created_at   timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT visits_booking_id_key UNIQUE (booking_id),
        CONSTRAINT visits_plate_format_check
          CHECK (plate ~ '^[A-Z0-9]{1,15}$'),
        CONSTRAINT visits_exit_after_entry_check
          CHECK (exited_at IS NULL OR exited_at >= entered_at),
        -- IS NOT NULL is required: NULL IN (...) is NULL, and CHECK passes on NULL.
        CONSTRAINT visits_close_reason_check
          CHECK ((exited_at IS NULL AND close_reason IS NULL)
                 OR (exited_at IS NOT NULL AND close_reason IS NOT NULL
                     AND close_reason IN ('exit', 'forced')))
      )
    `);

    // A car cannot be inside twice.
    await queryRunner.query(`
      CREATE UNIQUE INDEX visits_one_open_per_plate
        ON visits (plate) WHERE exited_at IS NULL
    `);
    // A spot cannot hold two cars.
    await queryRunner.query(`
      CREATE UNIQUE INDEX visits_one_open_per_spot
        ON visits (spot_id) WHERE exited_at IS NULL
    `);
    await queryRunner.query(
      `CREATE INDEX visits_user_id_idx ON visits (user_id, entered_at DESC)`,
    );

    // Money in integer kopecks (never float, never bigint-as-string).
    await queryRunner.query(`
      CREATE TABLE invoices (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        visit_id   uuid NOT NULL REFERENCES visits (id),
        minutes    integer NOT NULL,
        amount_kop integer NOT NULL,
        breakdown  jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT invoices_visit_id_key UNIQUE (visit_id),
        CONSTRAINT invoices_amounts_check CHECK (minutes >= 0 AND amount_kop >= 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE invoices`);
    await queryRunner.query(`DROP TABLE visits`);
  }
}
