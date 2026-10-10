import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { parsePeriod } from '../bookings/period';
import { Clock } from '../clock/clock';
import { SpotState } from './spot-state';

export interface SpotView {
  id: string;
  code: string;
  row: number;
  col: number;
}

export interface SpotWithState extends SpotView {
  state: SpotState;
  /** Last broadcast version; a client drops events with version ≤ this. */
  version: number;
}

@Injectable()
export class SpotsService {
  private readonly soonMin: number;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.soonMin = config.getOrThrow<number>('EARLY_ENTRY_MIN');
  }

  /**
   * The state is computed now by the same SQL rule as the snapshot (D-011),
   * so it is right even before the worker notices a time-based change; the
   * version is the snapshot's.
   */
  async list(): Promise<SpotWithState[]> {
    const rows: (SpotView & { state: SpotState; version: string })[] =
      await this.ds.query(
        `SELECT s.id, s.code, s."row", s.col,
                spot_state_at(s.id, $1, make_interval(mins => $2)) AS state,
                COALESCE(ss.version, 0) AS version
         FROM spots s
         LEFT JOIN spot_state ss ON ss.spot_id = s.id
         WHERE s.is_active
         ORDER BY s."row", s.col`,
        [this.clock.now(), this.soonMin],
      );
    // bigint comes back as a string; versions stay far below 2^53.
    return rows.map((r) => ({ ...r, version: Number(r.version) }));
  }

  /**
   * Spots that a booking for [from, to) would get right now: no active
   * booking overlaps, and — for a booking starting soon — no car is on it.
   * Same rules as BookingsService.create.
   */
  available(fromIso: string, toIso: string): Promise<SpotView[]> {
    const now = this.clock.now();
    const { from, to } = parsePeriod(fromIso, toIso, now);
    const startsSoon = from.getTime() < now.getTime() + this.soonMin * 60_000;
    return this.ds.query(
      `SELECT s.id, s.code, s."row", s.col
       FROM spots s
       WHERE s.is_active
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.spot_id = s.id
             AND b.status IN ('confirmed', 'checked_in')
             AND b.period && tstzrange($1, $2, '[)'))
         AND NOT ($3 AND EXISTS (
           SELECT 1 FROM visits v WHERE v.spot_id = s.id AND v.exited_at IS NULL))
       ORDER BY s."row", s.col`,
      [from, to, startsSoon],
    );
  }
}
