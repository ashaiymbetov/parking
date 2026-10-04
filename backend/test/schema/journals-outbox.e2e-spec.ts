import { expectViolation, useRollbackClient } from '../support/db';
import { insertBooking, insertDriver, insertSpot } from '../support/factories';

const OUTBOX_INSERT = `
  INSERT INTO email_outbox (booking_id, kind, to_email, next_attempt_at)
  VALUES ($1, $2, 'driver@test.local', '2026-10-05T10:50:00Z')`;

const GATE_EVENT_INSERT = `
  INSERT INTO gate_events (kind, raw_plate, plate, occurred_at, idempotency_key, outcome)
  VALUES ($1, 'A123BC', 'A123BC', '2026-10-05T10:00:00Z', $2, $3)`;

describe('schema: outbox, gate events, anomalies, spot state', () => {
  const db = useRollbackClient();
  let bookingId: string;

  beforeEach(async () => {
    const driver = await insertDriver(db());
    const spotId = await insertSpot(db());
    bookingId = await insertBooking(db(), {
      driver,
      spotId,
      from: '2026-10-05T10:00:00Z',
      to: '2026-10-05T11:00:00Z',
    });
  });

  describe('email_outbox', () => {
    it('one email per (booking, kind)', async () => {
      await db().query(OUTBOX_INSERT, [bookingId, 'reminder']);
      await expectViolation(db(), OUTBOX_INSERT, [bookingId, 'reminder'], {
        code: '23505',
        constraint: 'email_outbox_booking_kind_key',
      });
    });

    it('ON CONFLICT DO NOTHING makes a repeated enqueue a no-op', async () => {
      const enqueue = `${OUTBOX_INSERT} ON CONFLICT (booking_id, kind) DO NOTHING`;
      const first = await db().query(enqueue, [bookingId, 'reminder']);
      const second = await db().query(enqueue, [bookingId, 'reminder']);
      expect([first.rowCount, second.rowCount]).toEqual([1, 0]);
    });

    it('different kinds for the same booking are separate emails', async () => {
      await db().query(OUTBOX_INSERT, [bookingId, 'reminder']);
      await db().query(OUTBOX_INSERT, [bookingId, 'no_show']);
    });

    it('new rows start as pending with zero attempts', async () => {
      await db().query(OUTBOX_INSERT, [bookingId, 'reminder']);
      const res = await db().query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM email_outbox WHERE booking_id = $1',
        [bookingId],
      );
      expect(res.rows[0]).toEqual({ status: 'pending', attempts: 0 });
    });

    it.each([
      [
        'kind',
        `UPDATE email_outbox SET kind = 'spam'`,
        'email_outbox_kind_check',
      ],
      [
        'status',
        `UPDATE email_outbox SET status = 'lost'`,
        'email_outbox_status_check',
      ],
      [
        'attempts',
        `UPDATE email_outbox SET attempts = -1`,
        'email_outbox_attempts_check',
      ],
    ])('rejects an invalid %s', async (_c, sql, constraint) => {
      await db().query(OUTBOX_INSERT, [bookingId, 'reminder']);
      await expectViolation(db(), sql, [], { code: '23514', constraint });
    });
  });

  describe('gate_events', () => {
    it('an idempotency key is processed once', async () => {
      await db().query(GATE_EVENT_INSERT, ['entry', 'sensor-42', 'ok']);
      await expectViolation(
        db(),
        GATE_EVENT_INSERT,
        ['entry', 'sensor-42', 'ok'],
        {
          code: '23505',
          constraint: 'gate_events_idempotency_key_key',
        },
      );
    });

    it('events without a key are not deduplicated', async () => {
      await db().query(GATE_EVENT_INSERT, ['entry', null, 'ok']);
      await db().query(GATE_EVENT_INSERT, ['entry', null, 'rejected']);
    });

    it.each([
      ['kind', ['teleport', null, 'ok'], 'gate_events_kind_check'],
      ['outcome', ['exit', null, 'maybe'], 'gate_events_outcome_check'],
    ])('rejects an invalid %s', async (_c, params, constraint) => {
      await expectViolation(db(), GATE_EVENT_INSERT, params, {
        code: '23514',
        constraint,
      });
    });

    it('a normalized plate, when present, has the canonical format', async () => {
      await expectViolation(
        db(),
        `INSERT INTO gate_events (kind, raw_plate, plate, occurred_at, outcome)
         VALUES ('entry', 'a1', 'a1', now(), 'rejected')`,
        [],
        { code: '23514', constraint: 'gate_events_plate_format_check' },
      );
    });
  });

  it('anomaly kind must be known', async () => {
    await db().query(
      `INSERT INTO anomalies (kind, plate, details) VALUES ('double_entry', 'A123BC', '{}')`,
    );
    await expectViolation(
      db(),
      `INSERT INTO anomalies (kind, details) VALUES ('alien_landing', '{}')`,
      [],
      { code: '23514', constraint: 'anomalies_kind_check' },
    );
  });

  describe('spot_state', () => {
    it.each([
      [
        'state',
        `UPDATE spot_state SET state = 'flooded'`,
        'spot_state_state_check',
      ],
      [
        'version',
        `UPDATE spot_state SET version = -1`,
        'spot_state_version_check',
      ],
    ])('rejects an invalid %s', async (_c, sql, constraint) => {
      const spotId = await insertSpot(db());
      await db().query(
        `INSERT INTO spot_state (spot_id, state) VALUES ($1, 'free')`,
        [spotId],
      );
      await expectViolation(db(), `${sql} WHERE spot_id = $1`, [spotId], {
        code: '23514',
        constraint,
      });
    });
  });
});
