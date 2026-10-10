import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Clock } from '../clock/clock';
import { DomainError } from '../common/domain-error';
import { carNotFound } from '../profile/cars.service';
import { refreshSpotState } from '../spots/spot-state';
import { isDeadlock, mapBookingConflict } from './booking-errors';
import { CreateBookingDto } from './dto/create-booking.dto';
import { parsePeriod } from './period';

export interface BookingView {
  id: string;
  status: string;
  spot: { id: string; code: string };
  car: { id: string; plate: string };
  from: string;
  to: string;
  createdAt: string;
}

interface BookingRow {
  id: string;
  status: string;
  spot_id: string;
  spot_code: string;
  car_id: string;
  plate: string;
  from: Date;
  to: Date;
  created_at: Date;
}

const SELECT_BOOKING = `
  SELECT b.id, b.status, s.id AS spot_id, s.code AS spot_code,
         c.id AS car_id, c.plate,
         lower(b.period) AS "from", upper(b.period) AS "to", b.created_at
  FROM bookings b
  JOIN spots s ON s.id = b.spot_id
  JOIN cars c ON c.id = b.car_id`;

function toView(r: BookingRow): BookingView {
  return {
    id: r.id,
    status: r.status,
    spot: { id: r.spot_id, code: r.spot_code },
    car: { id: r.car_id, plate: r.plate },
    from: r.from.toISOString(),
    to: r.to.toISOString(),
    createdAt: r.created_at.toISOString(),
  };
}

/** Bounded retries after 40P01 (D-024). */
const MAX_DEADLOCK_ATTEMPTS = 3;

const notFound = () =>
  new DomainError(404, 'BOOKING_NOT_FOUND', 'Бронь не найдена');

@Injectable()
export class BookingsService {
  /**
   * A booking starting this soon needs the spot to be physically free
   * (D-008) and makes the spot "booked" on the map (D-011).
   */
  private readonly soonMin: number;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.soonMin = config.getOrThrow<number>('EARLY_ENTRY_MIN');
  }

  private startsSoon(from: Date, now: Date): boolean {
    return from.getTime() < now.getTime() + this.soonMin * 60_000;
  }

  /**
   * Overlaps are NOT checked here: the INSERT goes straight to the database
   * and the EXCLUDE constraints reject it (D-002). Checking first in code
   * would only add a race window.
   */
  async create(user: AuthUser, dto: CreateBookingDto): Promise<BookingView> {
    const now = this.clock.now();
    const { from, to } = parsePeriod(dto.from, dto.to, now);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.ds.transaction((m) =>
          this.insert(m, user, dto, from, to, now),
        );
      } catch (err) {
        // A deadlock victim may well have been free: the transaction it
        // waited for can itself fail. Retry, so the answer is exact (D-024).
        if (isDeadlock(err) && attempt < MAX_DEADLOCK_ATTEMPTS) continue;
        throw mapBookingConflict(err);
      }
    }
  }

  private async insert(
    m: EntityManager,
    user: AuthUser,
    dto: CreateBookingDto,
    from: Date,
    to: Date,
    now: Date,
  ): Promise<BookingView> {
    const car: unknown[] = await m.query(
      `SELECT 1 FROM cars WHERE id = $1 AND user_id = $2`,
      [dto.carId, user.id],
    );
    if (car.length === 0) throw carNotFound();

    // Bookings of one spot are created one at a time: with concurrent
    // inserts into EXCLUDE, PostgreSQL may abort a non-conflicting one as a
    // deadlock victim (D-024). Gate entry takes the same lock, so "check the
    // visit, then insert" cannot race either.
    const spot: unknown[] = await m.query(
      `SELECT 1 FROM spots WHERE id = $1 AND is_active FOR UPDATE`,
      [dto.spotId],
    );
    if (spot.length === 0) {
      throw new DomainError(404, 'SPOT_NOT_FOUND', 'Место не найдено');
    }

    const soon = this.startsSoon(from, now);
    if (soon) {
      const occupied: unknown[] = await m.query(
        `SELECT 1 FROM visits WHERE spot_id = $1 AND exited_at IS NULL`,
        [dto.spotId],
      );
      if (occupied.length > 0) {
        throw new DomainError(
          409,
          'SPOT_OCCUPIED',
          'На месте сейчас стоит машина — выберите другое место или более позднее время',
        );
      }
    }

    const inserted: { id: string }[] = await m.query(
      `INSERT INTO bookings (user_id, car_id, spot_id, period, created_at)
       VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6)
       RETURNING id`,
      [user.id, dto.carId, dto.spotId, from, to, now],
    );
    // Only a booking starting soon can change what the map shows.
    if (soon) await refreshSpotState(m, dto.spotId, now, this.soonMin);
    return this.findOwn(m, user.id, inserted[0].id);
  }

  async list(user: AuthUser, status?: string): Promise<BookingView[]> {
    const rows: BookingRow[] = await this.ds.query(
      `${SELECT_BOOKING}
       WHERE b.user_id = $1 AND ($2::text IS NULL OR b.status = $2)
       ORDER BY lower(b.period) DESC`,
      [user.id, status ?? null],
    );
    return rows.map(toView);
  }

  get(user: AuthUser, id: string): Promise<BookingView> {
    return this.findOwn(this.ds.manager, user.id, id);
  }

  /** Only a confirmed booking that has not started yet (D-026). */
  async cancel(user: AuthUser, id: string): Promise<BookingView> {
    const now = this.clock.now();
    return this.ds.transaction(async (m) => {
      const own: { spot_id: string }[] = await m.query(
        `SELECT spot_id FROM bookings WHERE id = $1 AND user_id = $2`,
        [id, user.id],
      );
      if (own.length === 0) throw notFound();
      // Same lock order as create (spot, then bookings) — no deadlock with
      // an INSERT waiting on this booking's row in the EXCLUDE index.
      await m.query(`SELECT 1 FROM spots WHERE id = $1 FOR UPDATE`, [
        own[0].spot_id,
      ]);

      const rows: { status: string; from: Date }[] = await m.query(
        `SELECT status, lower(period) AS "from" FROM bookings
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const b = rows[0];
      if (b.status !== 'confirmed' || now.getTime() >= b.from.getTime()) {
        throw new DomainError(
          409,
          'BOOKING_NOT_CANCELLABLE',
          b.status !== 'confirmed'
            ? 'Бронь уже не активна'
            : 'Бронь уже началась — отменить её нельзя',
        );
      }
      await m.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`,
        [id, now],
      );
      if (this.startsSoon(b.from, now)) {
        await refreshSpotState(m, own[0].spot_id, now, this.soonMin);
      }
      return this.findOwn(m, user.id, id);
    });
  }

  private async findOwn(
    m: EntityManager,
    userId: string,
    id: string,
  ): Promise<BookingView> {
    const rows: BookingRow[] = await m.query(
      `${SELECT_BOOKING} WHERE b.id = $1 AND b.user_id = $2`,
      [id, userId],
    );
    if (rows.length === 0) throw notFound();
    return toView(rows[0]);
  }
}
