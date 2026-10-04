import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJournalsAndOutbox1791106424000 implements MigrationInterface {
  name = 'CreateJournalsAndOutbox1791106424000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Every gate request, accepted or not. A repeated Idempotency-Key returns
    // the stored response instead of being processed again (D-012).
    await queryRunner.query(`
      CREATE TABLE gate_events (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind            text NOT NULL,
        raw_plate       text NOT NULL,
        plate           text,
        occurred_at     timestamptz NOT NULL,
        idempotency_key text,
        outcome         text NOT NULL,
        error_code      text,
        response        jsonb,
        visit_id        uuid REFERENCES visits (id),
        CONSTRAINT gate_events_idempotency_key_key UNIQUE (idempotency_key),
        CONSTRAINT gate_events_kind_check CHECK (kind IN ('entry', 'exit')),
        CONSTRAINT gate_events_outcome_check CHECK (outcome IN ('ok', 'rejected')),
        CONSTRAINT gate_events_plate_format_check
          CHECK (plate IS NULL OR plate ~ '^[A-Z0-9]{1,15}$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE anomalies (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind          text NOT NULL,
        plate         text,
        gate_event_id uuid REFERENCES gate_events (id),
        booking_id    uuid REFERENCES bookings (id),
        details       jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT anomalies_kind_check CHECK (kind IN (
          'exit_without_entry', 'double_entry', 'no_free_spot',
          'invalid_plate', 'booked_spot_occupied', 'reminder_missed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX anomalies_created_at_idx ON anomalies (created_at DESC)`,
    );

    // One email per (booking, kind): a repeated worker run cannot enqueue a
    // second one (D-007).
    await queryRunner.query(`
      CREATE TABLE email_outbox (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id      uuid NOT NULL REFERENCES bookings (id),
        kind            text NOT NULL,
        to_email        citext NOT NULL,
        status          text NOT NULL DEFAULT 'pending',
        attempts        integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL,
        sent_at         timestamptz,
        last_error      text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT email_outbox_booking_kind_key UNIQUE (booking_id, kind),
        CONSTRAINT email_outbox_kind_check CHECK (kind IN ('reminder', 'no_show')),
        CONSTRAINT email_outbox_status_check
          CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
        CONSTRAINT email_outbox_attempts_check CHECK (attempts >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX email_outbox_due_idx
        ON email_outbox (next_attempt_at) WHERE status = 'pending'
    `);

    // Last broadcast state per spot; version lets clients drop stale events (D-011).
    await queryRunner.query(`
      CREATE TABLE spot_state (
        spot_id    uuid PRIMARY KEY REFERENCES spots (id) ON DELETE CASCADE,
        state      text NOT NULL,
        version    bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT spot_state_state_check
          CHECK (state IN ('free', 'booked', 'occupied')),
        CONSTRAINT spot_state_version_check CHECK (version >= 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE spot_state`);
    await queryRunner.query(`DROP TABLE email_outbox`);
    await queryRunner.query(`DROP TABLE anomalies`);
    await queryRunner.query(`DROP TABLE gate_events`);
  }
}
