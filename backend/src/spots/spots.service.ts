import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { parsePeriod } from '../bookings/period';
import { Clock } from '../clock/clock';

export interface SpotView {
  id: string;
  code: string;
  row: number;
  col: number;
}

@Injectable()
export class SpotsService {
  private readonly nearMs: number;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.nearMs = config.getOrThrow<number>('EARLY_ENTRY_MIN') * 60_000;
  }

  list(): Promise<SpotView[]> {
    return this.ds.query(
      `SELECT id, code, "row", col FROM spots WHERE is_active ORDER BY "row", col`,
    );
  }

  /**
   * Spots that a booking for [from, to) would get right now: no active
   * booking overlaps, and — for a booking starting soon — no car is on it.
   * Same rules as BookingsService.create.
   */
  available(fromIso: string, toIso: string): Promise<SpotView[]> {
    const now = this.clock.now();
    const { from, to } = parsePeriod(fromIso, toIso, now);
    const startsSoon = from.getTime() < now.getTime() + this.nearMs;
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
