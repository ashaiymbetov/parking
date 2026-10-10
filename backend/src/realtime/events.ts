import { EntityManager } from 'typeorm';

/** The one NOTIFY channel; spot.updated is sent by refresh_spot_state(). */
export const CHANNEL = 'parking_events';

export type ParkingEvent =
  | { type: 'spot.updated'; spotId: string; state: string; version: number }
  | {
      type: 'booking.updated';
      bookingId: string;
      status: string;
      userId: string;
    }
  | {
      type: 'visit.updated';
      visitId: string;
      status: 'open' | 'closed';
      plate: string;
      spotId: string;
      /** null for a guest: operators only. */
      userId: string | null;
      amountKop?: number;
    }
  | { type: 'anomaly.created'; id: string; kind: string; plate: string | null }
  /** Sent by the API itself after its LISTEN connection came back. */
  | { type: 'sync.required' };

/**
 * Queues an event inside the caller's transaction: PostgreSQL delivers it
 * on COMMIT and drops it on ROLLBACK (also of a savepoint). Payloads carry
 * ids and short state only — NOTIFY is limited to 8000 bytes.
 */
export async function publish(
  m: EntityManager,
  event: Exclude<ParkingEvent, { type: 'sync.required' | 'spot.updated' }>,
): Promise<void> {
  await m.query(`SELECT pg_notify($1, $2)`, [CHANNEL, JSON.stringify(event)]);
}

export interface Delivery {
  rooms: string[];
  event: string;
  payload: Record<string, unknown>;
}

export const LOT = 'lot';
export const OPERATORS = 'operators';
export const userRoom = (id: string) => `user:${id}`;

/** Who gets what (ARCHITECTURE §4). Routing data never leaves the server. */
export function route(e: ParkingEvent): Delivery | null {
  switch (e.type) {
    case 'spot.updated':
      return {
        rooms: [LOT],
        event: e.type,
        payload: { spotId: e.spotId, state: e.state, version: e.version },
      };
    case 'booking.updated':
      return {
        rooms: [userRoom(e.userId)],
        event: e.type,
        payload: { bookingId: e.bookingId, status: e.status },
      };
    case 'visit.updated': {
      const { type, userId, ...payload } = e;
      return {
        rooms: userId ? [userRoom(userId), OPERATORS] : [OPERATORS],
        event: type,
        payload,
      };
    }
    case 'anomaly.created':
      return {
        rooms: [OPERATORS],
        event: e.type,
        payload: { id: e.id, kind: e.kind, plate: e.plate },
      };
    case 'sync.required':
      return { rooms: [LOT], event: e.type, payload: {} };
    default:
      return null;
  }
}
