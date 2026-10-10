import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { refreshSpotState } from '../spots/spot-state';
import { WorkerSettings } from './worker-settings';

const BATCH = 50;

/**
 * Releases confirmed bookings nobody arrived for by start + grace (D-004,
 * D-006). Derived from data: after downtime the first tick catches up.
 */
@Injectable()
export class NoShowTask {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: WorkerSettings,
  ) {}

  async run(now: Date): Promise<number> {
    const due: { id: string; spot_id: string }[] = await this.ds.query(
      `SELECT id, spot_id FROM bookings
       WHERE status = 'confirmed'
         AND lower(period) + make_interval(mins => $2) <= $1
       ORDER BY lower(period)
       LIMIT ${BATCH}`,
      [now, this.settings.graceMin],
    );
    let released = 0;
    for (const b of due) {
      if (await this.release(b.id, b.spot_id, now)) released += 1;
    }
    return released;
  }

  /**
   * Lock order spot → booking, as in booking creation and cancel (D-028).
   * SKIP LOCKED: a row busy elsewhere (another worker, a gate entry right
   * now) is left for the next tick, the worker never waits. Public for the
   * test of the race "car checks in between selection and lock".
   */
  release(id: string, spotId: string, now: Date): Promise<boolean> {
    return this.ds.transaction(async (m) => {
      const spot: unknown[] = await m.query(
        `SELECT 1 FROM spots WHERE id = $1 FOR UPDATE SKIP LOCKED`,
        [spotId],
      );
      if (spot.length === 0) return false;

      // Re-check under the lock: a car may have checked in meanwhile.
      const rows: { email: string }[] = await m.query(
        `SELECT u.email::text AS email
         FROM bookings b JOIN users u ON u.id = b.user_id
         WHERE b.id = $1 AND b.status = 'confirmed'
           AND lower(b.period) + make_interval(mins => $3) <= $2
         FOR UPDATE OF b SKIP LOCKED`,
        [id, now, this.settings.graceMin],
      );
      if (rows.length === 0) return false;

      await m.query(
        `UPDATE bookings SET status = 'no_show', released_at = $2 WHERE id = $1`,
        [id, now],
      );
      await m.query(
        `INSERT INTO email_outbox (booking_id, kind, to_email, next_attempt_at, created_at)
         VALUES ($1, 'no_show', $2, $3, $3)
         ON CONFLICT (booking_id, kind) DO NOTHING`,
        [id, rows[0].email, now],
      );
      await refreshSpotState(m, spotId, now, this.settings.soonMin);
      return true;
    });
  }
}
