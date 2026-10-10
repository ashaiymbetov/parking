import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Mailer } from '../mail/mailer';
import { noShowMail, reminderMail } from '../mail/templates';
import { WorkerSettings } from './worker-settings';

const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 30_000;
const MAX_PER_TICK = 20;

interface DueEmail {
  id: string;
  kind: 'reminder' | 'no_show';
  to_email: string;
  attempts: number;
  plate: string;
  spot_code: string;
  from: Date;
  to: Date;
}

/**
 * Delivers pending outbox rows. The row stays locked while SMTP runs: a
 * crash between the SMTP answer and COMMIT can resend the email — creation
 * is exactly-once, delivery at-least-once (D-007).
 */
@Injectable()
export class OutboxTask {
  private readonly logger = new Logger(OutboxTask.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly mailer: Mailer,
    private readonly settings: WorkerSettings,
  ) {}

  async run(now: Date): Promise<number> {
    let processed = 0;
    while (processed < MAX_PER_TICK && (await this.sendOne(now))) {
      processed += 1;
    }
    return processed;
  }

  private sendOne(now: Date): Promise<boolean> {
    return this.ds.transaction(async (m) => {
      const rows: DueEmail[] = await m.query(
        `SELECT o.id, o.kind, o.to_email::text AS to_email, o.attempts,
                c.plate, s.code AS spot_code,
                lower(b.period) AS "from", upper(b.period) AS "to"
         FROM email_outbox o
         JOIN bookings b ON b.id = o.booking_id
         JOIN cars c ON c.id = b.car_id
         JOIN spots s ON s.id = b.spot_id
         WHERE o.status = 'pending' AND o.next_attempt_at <= $1
         ORDER BY o.next_attempt_at
         LIMIT 1
         FOR UPDATE OF o SKIP LOCKED`,
        [now],
      );
      const email = rows[0];
      if (!email) return false;

      const data = {
        plate: email.plate,
        spotCode: email.spot_code,
        from: email.from,
        to: email.to,
        timeZone: this.settings.timeZone,
      };
      const content =
        email.kind === 'reminder'
          ? reminderMail(data, this.settings.reminderMin)
          : noShowMail(data, this.settings.graceMin);
      const attempts = email.attempts + 1;

      try {
        await this.mailer.send({
          to: email.to_email,
          ...content,
          messageId: `outbox-${email.id}@parking.local`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failed = attempts >= MAX_ATTEMPTS;
        // Exponential backoff: 30 s, 1 min, 2 min, 4 min, then give up.
        const next = new Date(
          now.getTime() + FIRST_RETRY_MS * 2 ** (attempts - 1),
        );
        await m.query(
          `UPDATE email_outbox
           SET attempts = $2, last_error = $3, next_attempt_at = $4,
               status = CASE WHEN $5 THEN 'failed' ELSE 'pending' END
           WHERE id = $1`,
          [email.id, attempts, message, next, failed],
        );
        this.logger.warn(
          `email ${email.id} attempt ${attempts} failed: ${message}`,
        );
        return true;
      }

      await m.query(
        `UPDATE email_outbox
         SET status = 'sent', sent_at = $2, attempts = $3, last_error = NULL
         WHERE id = $1`,
        [email.id, now, attempts],
      );
      return true;
    });
  }
}
