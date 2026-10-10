import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Clock } from '../clock/clock';
import { DomainError } from '../common/domain-error';
import { pgError } from '../common/pg-error';
import { normalizePlate } from '../plates/normalize-plate';
import { publish } from '../realtime/events';
import { refreshSpotState } from '../spots/spot-state';
import { calculateCharge } from '../tariffing/calculate-charge';
import { loadTariffs } from '../visits/tariffs';
import {
  InvoiceView,
  SELECT_VISIT,
  toVisitView,
  VisitRow,
  VisitView,
} from '../visits/views';
import {
  alreadyInside,
  AnomalyNote,
  GateRejection,
  invalidPlate,
  noFreeSpot,
  notInside,
} from './gate-rejection';

export type GateKind = 'entry' | 'exit';

/** What the controller sends back; also stored for Idempotency-Key replay. */
export interface GateResponse {
  status: number;
  body: unknown;
}

export interface EntryResult {
  visitId: string;
  plate: string;
  spot: { id: string; code: string };
  bookingId: string | null;
  enteredAt: string;
}

export interface ExitResult {
  visit: VisitView;
  invoice: InvoiceView;
}

interface Accepted {
  response: GateResponse;
  visitId: string;
  /** Accepted, but worth the operator's attention (Q6). */
  anomaly?: AnomalyNote;
}

/**
 * Gate simulator (ARCHITECTURE §1.3, §1.5, §1.7). Every request is written
 * to gate_events in the same transaction as its effect; a refused request
 * changes nothing but the journals.
 */
@Injectable()
export class GateService {
  private readonly earlyMin: number;
  private readonly graceMin: number;
  private readonly timeZone: string;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.earlyMin = config.getOrThrow<number>('EARLY_ENTRY_MIN');
    this.graceMin = config.getOrThrow<number>('NO_SHOW_GRACE_MIN');
    this.timeZone = config.getOrThrow<string>('PARKING_TZ');
  }

  async handle(
    kind: GateKind,
    rawPlate: string,
    key?: string,
  ): Promise<GateResponse> {
    if (key) {
      const stored = await this.replay(kind, rawPlate, key);
      if (stored) return stored;
    }
    try {
      return await this.ds.transaction((m) =>
        this.process(m, kind, rawPlate, key ?? null),
      );
    } catch (err) {
      // The same key is being processed concurrently: its journal row won,
      // this whole transaction is rolled back — answer with the stored one.
      if (
        key &&
        pgError(err)?.constraint === 'gate_events_idempotency_key_key'
      ) {
        const stored = await this.replay(kind, rawPlate, key);
        if (stored) return stored;
      }
      throw err;
    }
  }

  private async process(
    m: EntityManager,
    kind: GateKind,
    rawPlate: string,
    key: string | null,
  ): Promise<GateResponse> {
    const now = this.clock.now();
    const plate = normalizePlate(rawPlate);

    let accepted: Accepted | null = null;
    let rejection: GateRejection | null = null;
    if (!plate) {
      rejection = invalidPlate(rawPlate);
    } else {
      // The work is undone on refusal, the journal entry below is not.
      await m.query('SAVEPOINT gate_work');
      try {
        accepted =
          kind === 'entry'
            ? await this.enter(m, plate, now)
            : await this.leave(m, plate, now);
        await m.query('RELEASE SAVEPOINT gate_work');
      } catch (err) {
        await m.query('ROLLBACK TO SAVEPOINT gate_work');
        rejection = asRejection(err);
        if (!rejection) throw err;
      }
    }

    const response: GateResponse = rejection
      ? {
          status: rejection.status,
          body: { code: rejection.code, message: rejection.message },
        }
      : accepted!.response;

    // The answer is read back from the journal, so the first response and
    // every replay are byte-for-byte the same (jsonb reorders keys).
    const event: { id: string; response: GateResponse }[] = await m.query(
      `INSERT INTO gate_events (kind, raw_plate, plate, occurred_at,
         idempotency_key, outcome, error_code, response, visit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       RETURNING id, response`,
      [
        kind,
        rawPlate,
        plate,
        now,
        key,
        rejection ? 'rejected' : 'ok',
        rejection?.code ?? null,
        JSON.stringify(response),
        accepted?.visitId ?? null,
      ],
    );

    const anomaly = rejection?.anomaly ?? accepted?.anomaly;
    if (anomaly) {
      const created: { id: string }[] = await m.query(
        `INSERT INTO anomalies (kind, plate, gate_event_id, booking_id, details, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id`,
        [
          anomaly.kind,
          plate,
          event[0].id,
          anomaly.bookingId ?? null,
          JSON.stringify(anomaly.details ?? {}),
          now,
        ],
      );
      await publish(m, {
        type: 'anomaly.created',
        id: created[0].id,
        kind: anomaly.kind,
        plate,
      });
    }
    return event[0].response;
  }

  /** Entry by booking (D-004) or as a walk-in (D-010). */
  private async enter(
    m: EntityManager,
    plate: string,
    now: Date,
  ): Promise<Accepted> {
    const inside: unknown[] = await m.query(
      `SELECT 1 FROM visits WHERE plate = $1 AND exited_at IS NULL`,
      [plate],
    );
    if (inside.length > 0) throw alreadyInside();

    const cars: { id: string; user_id: string }[] = await m.query(
      `SELECT id, user_id FROM cars WHERE plate = $1`,
      [plate],
    );
    const car = cars[0] ?? null;

    // A confirmed booking whose entry window [start − early, start + grace)
    // contains now. Locked: the worker's no-show takes the same row lock.
    const bookings: { id: string; spot_id: string; user_id: string }[] = car
      ? await m.query(
          `SELECT id, spot_id, user_id FROM bookings
           WHERE car_id = $1 AND status = 'confirmed'
             AND lower(period) - make_interval(mins => $3) <= $2
             AND $2 < lower(period) + make_interval(mins => $4)
           ORDER BY lower(period)
           LIMIT 1
           FOR UPDATE`,
          [car.id, now, this.earlyMin, this.graceMin],
        )
      : [];
    const booking = bookings[0] ?? null;

    let spot: { id: string; code: string } | null = null;
    let anomaly: AnomalyNote | undefined;
    if (booking) {
      const own: { id: string; code: string; occupied: boolean }[] =
        await m.query(
          `SELECT s.id, s.code,
                  EXISTS (SELECT 1 FROM visits v
                          WHERE v.spot_id = s.id AND v.exited_at IS NULL) AS occupied
           FROM spots s WHERE s.id = $1
           FOR UPDATE OF s`,
          [booking.spot_id],
        );
      if (!own[0].occupied) {
        spot = { id: own[0].id, code: own[0].code };
      } else {
        // Someone overstayed on the booked spot (Q6).
        spot = await this.pickFreeSpot(m, now);
        if (!spot) throw noFreeSpot(booking.id);
        anomaly = {
          kind: 'booked_spot_occupied',
          bookingId: booking.id,
          details: { bookedSpot: own[0].code, assignedSpot: spot.code },
        };
      }
    } else {
      spot = await this.pickFreeSpot(m, now);
      if (!spot) throw noFreeSpot();
    }

    const visit: { id: string }[] = await m.query(
      `INSERT INTO visits (plate, car_id, user_id, spot_id, booking_id, entered_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING id`,
      [
        plate,
        car?.id ?? null,
        car?.user_id ?? null,
        spot.id,
        booking?.id ?? null,
        now,
      ],
    );
    if (booking) {
      await m.query(
        `UPDATE bookings SET status = 'checked_in', checked_in_at = $2 WHERE id = $1`,
        [booking.id, now],
      );
      await publish(m, {
        type: 'booking.updated',
        bookingId: booking.id,
        status: 'checked_in',
        userId: booking.user_id,
      });
    }
    await publish(m, {
      type: 'visit.updated',
      visitId: visit[0].id,
      status: 'open',
      plate,
      spotId: spot.id,
      userId: car?.user_id ?? null,
    });
    await refreshSpotState(m, spot.id, now, this.earlyMin);

    const body: EntryResult = {
      visitId: visit[0].id,
      plate,
      spot,
      bookingId: booking?.id ?? null,
      enteredAt: now.toISOString(),
    };
    return { response: { status: 201, body }, visitId: visit[0].id, anomaly };
  }

  /**
   * A free spot by the one state rule (D-011): no car, no confirmed booking
   * starting within the window. Prefer spots with no upcoming booking, then
   * the latest next booking, then the code (D-010). SKIP LOCKED: concurrent
   * entries take different spots instead of queueing for the same one.
   */
  private async pickFreeSpot(
    m: EntityManager,
    now: Date,
  ): Promise<{ id: string; code: string } | null> {
    const rows: { id: string; code: string }[] = await m.query(
      `SELECT s.id, s.code FROM spots s
       WHERE s.is_active
         AND spot_state_at(s.id, $1, make_interval(mins => $2)) = 'free'
       ORDER BY (SELECT min(lower(b.period)) FROM bookings b
                 WHERE b.spot_id = s.id AND b.status = 'confirmed'
                   AND upper(b.period) > $1) DESC NULLS FIRST,
                s.code
       LIMIT 1
       FOR UPDATE OF s SKIP LOCKED`,
      [now, this.earlyMin],
    );
    return rows[0] ?? null;
  }

  /** Exit closes the visit and bills it in one transaction (D-013). */
  private async leave(
    m: EntityManager,
    plate: string,
    now: Date,
  ): Promise<Accepted> {
    // A parallel exit waits here, then finds the visit closed → NOT_INSIDE.
    const open: {
      id: string;
      spot_id: string;
      user_id: string | null;
      booking_id: string | null;
      entered_at: Date;
    }[] = await m.query(
      `SELECT id, spot_id, user_id, booking_id, entered_at FROM visits
       WHERE plate = $1 AND exited_at IS NULL
       FOR UPDATE`,
      [plate],
    );
    const visit = open[0];
    if (!visit) throw notInside();

    await m.query(`SELECT 1 FROM spots WHERE id = $1 FOR UPDATE`, [
      visit.spot_id,
    ]);
    const charge = calculateCharge({
      enteredAt: visit.entered_at,
      exitedAt: now,
      tariffs: await loadTariffs(m, this.timeZone),
      timeZone: this.timeZone,
    });

    await m.query(
      `UPDATE visits SET exited_at = $2, close_reason = 'exit' WHERE id = $1`,
      [visit.id, now],
    );
    await m.query(
      `INSERT INTO invoices (visit_id, minutes, amount_kop, breakdown, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        visit.id,
        charge.minutes,
        charge.amountKop,
        JSON.stringify(charge.segments),
        now,
      ],
    );
    if (visit.booking_id) {
      const done: { user_id: string }[] = await m.query(
        `UPDATE bookings SET status = 'completed'
         WHERE id = $1 AND status = 'checked_in'
         RETURNING user_id`,
        [visit.booking_id],
      );
      if (done.length > 0) {
        await publish(m, {
          type: 'booking.updated',
          bookingId: visit.booking_id,
          status: 'completed',
          userId: done[0].user_id,
        });
      }
    }
    await publish(m, {
      type: 'visit.updated',
      visitId: visit.id,
      status: 'closed',
      plate,
      spotId: visit.spot_id,
      userId: visit.user_id,
      amountKop: charge.amountKop,
    });
    await refreshSpotState(m, visit.spot_id, now, this.earlyMin);

    const rows: VisitRow[] = await m.query(`${SELECT_VISIT} WHERE v.id = $1`, [
      visit.id,
    ]);
    const view = toVisitView(rows[0]);
    const body: ExitResult = { visit: view, invoice: view.invoice! };
    return { response: { status: 200, body }, visitId: visit.id };
  }

  /** Stored answer for a repeated key; a different request with it → 422. */
  private async replay(
    kind: GateKind,
    rawPlate: string,
    key: string,
  ): Promise<GateResponse | null> {
    const rows: {
      kind: GateKind;
      raw_plate: string;
      response: GateResponse;
    }[] = await this.ds.query(
      `SELECT kind, raw_plate, response FROM gate_events WHERE idempotency_key = $1`,
      [key],
    );
    const stored = rows[0];
    if (!stored) return null;
    if (stored.kind !== kind || stored.raw_plate !== rawPlate) {
      throw new DomainError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'Этот Idempotency-Key уже использован для другого запроса',
      );
    }
    return stored.response;
  }
}

/** Refusals we journal; anything else is a bug and rolls everything back. */
function asRejection(err: unknown): GateRejection | null {
  if (err instanceof GateRejection) return err;
  // Two entries of one plate raced past the "already inside" check.
  if (pgError(err)?.constraint === 'visits_one_open_per_plate') {
    return alreadyInside();
  }
  return null;
}
