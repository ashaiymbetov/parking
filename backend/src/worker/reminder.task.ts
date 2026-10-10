import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WorkerSettings } from './worker-settings';

/**
 * One reminder per booking, REMINDER_BEFORE_END_MIN before its end (D-007).
 * UNIQUE (booking_id, kind) + ON CONFLICT DO NOTHING: a repeated tick or a
 * second worker cannot enqueue a second email. If the moment passed during
 * downtime and the booking has already ended, the row is "skipped" and the
 * miss is journaled instead of sending a pointless email.
 */
@Injectable()
export class ReminderTask {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: WorkerSettings,
  ) {}

  run(now: Date): Promise<number> {
    return this.ds.transaction(async (m) => {
      const created: { booking_id: string; status: string }[] = await m.query(
        `WITH due AS (
           SELECT b.id, u.email, upper(b.period) AS ends_at
           FROM bookings b JOIN users u ON u.id = b.user_id
           WHERE b.status IN ('confirmed', 'checked_in')
             AND upper(b.period) - make_interval(mins => $2) <= $1
             AND NOT EXISTS (SELECT 1 FROM email_outbox o
                             WHERE o.booking_id = b.id AND o.kind = 'reminder')
           ORDER BY upper(b.period)
           LIMIT 50
           FOR UPDATE OF b SKIP LOCKED)
         INSERT INTO email_outbox
           (booking_id, kind, to_email, status, next_attempt_at, created_at)
         SELECT id, 'reminder', email,
                CASE WHEN ends_at > $1 THEN 'pending' ELSE 'skipped' END, $1, $1
         FROM due
         ON CONFLICT (booking_id, kind) DO NOTHING
         RETURNING booking_id, status`,
        [now, this.settings.reminderMin],
      );
      const missed = created.filter((r) => r.status === 'skipped');
      if (missed.length > 0) {
        await m.query(
          `INSERT INTO anomalies (kind, booking_id, plate, details, created_at)
           SELECT 'reminder_missed', b.id, c.plate,
                  jsonb_build_object('endedAt', upper(b.period)), $2
           FROM bookings b JOIN cars c ON c.id = b.car_id
           WHERE b.id = ANY($1)`,
          [missed.map((r) => r.booking_id), now],
        );
      }
      return created.length;
    });
  }
}
