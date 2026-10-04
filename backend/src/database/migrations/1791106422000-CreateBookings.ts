import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookings1791106422000 implements MigrationInterface {
  name = 'CreateBookings1791106422000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Only confirmed / checked_in bookings hold their interval; final
    // statuses (completed, cancelled, no_show) release it.
    await queryRunner.query(`
      CREATE TABLE bookings (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid NOT NULL REFERENCES users (id),
        car_id        uuid NOT NULL REFERENCES cars (id),
        spot_id       uuid NOT NULL REFERENCES spots (id),
        period        tstzrange NOT NULL,
        status        text NOT NULL DEFAULT 'confirmed',
        checked_in_at timestamptz,
        released_at   timestamptz,
        cancelled_at  timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT bookings_status_check
          CHECK (status IN ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')),

        -- Two bookings of one spot never overlap, whatever the concurrency (D-002).
        CONSTRAINT bookings_no_overlap_per_spot
          EXCLUDE USING gist (spot_id WITH =, period WITH &&)
          WHERE (status IN ('confirmed', 'checked_in')),

        -- One car never holds two overlapping bookings (D-009).
        CONSTRAINT bookings_no_overlap_per_car
          EXCLUDE USING gist (car_id WITH =, period WITH &&)
          WHERE (status IN ('confirmed', 'checked_in')),

        -- Finite, non-empty, half-open [start, end).
        CONSTRAINT bookings_period_bounds_check
          CHECK (NOT isempty(period)
                 AND NOT lower_inf(period) AND NOT upper_inf(period)
                 AND lower_inc(period) AND NOT upper_inc(period)),

        -- Bounds are whole minutes (D-008). Epoch arithmetic is immutable
        -- and independent of the session TimeZone, unlike date_trunc.
        CONSTRAINT bookings_period_minute_check
          CHECK (mod(extract(epoch FROM lower(period)), 60) = 0
                 AND mod(extract(epoch FROM upper(period)), 60) = 0)
      )
    `);

    // Worker scans: no-show by start, reminders by end.
    await queryRunner.query(
      `CREATE INDEX bookings_status_start_idx ON bookings (status, lower(period))`,
    );
    await queryRunner.query(
      `CREATE INDEX bookings_status_end_idx ON bookings (status, upper(period))`,
    );
    await queryRunner.query(
      `CREATE INDEX bookings_user_id_idx ON bookings (user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE bookings`);
  }
}
