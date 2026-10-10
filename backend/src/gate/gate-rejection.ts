import { DomainError } from '../common/domain-error';

export type AnomalyKind =
  | 'exit_without_entry'
  | 'double_entry'
  | 'no_free_spot'
  | 'invalid_plate'
  | 'booked_spot_occupied';

export interface AnomalyNote {
  kind: AnomalyKind;
  bookingId?: string;
  details?: Record<string, unknown>;
}

/**
 * A gate request that is refused but still journaled (gate_events) and,
 * when it is an anomaly, written to the anomaly journal (D-012).
 */
export class GateRejection extends DomainError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly anomaly?: AnomalyNote,
  ) {
    super(status, code, message);
  }
}

export const alreadyInside = () =>
  new GateRejection(409, 'ALREADY_INSIDE', 'Машина уже на парковке', {
    kind: 'double_entry',
  });

export const notInside = () =>
  new GateRejection(
    409,
    'NOT_INSIDE',
    'Машины нет на парковке — выезд без заезда',
    { kind: 'exit_without_entry' },
  );

export const noFreeSpot = (bookingId?: string) =>
  new GateRejection(409, 'NO_FREE_SPOT', 'Свободных мест нет', {
    kind: 'no_free_spot',
    bookingId,
  });

export const invalidPlate = (raw: string) =>
  new GateRejection(422, 'INVALID_PLATE', 'Номер не распознан', {
    kind: 'invalid_plate',
    details: { rawPlate: raw },
  });
