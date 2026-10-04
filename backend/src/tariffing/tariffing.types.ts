/**
 * Contract of the tariff calculation. Pure data: no NestJS, no database.
 * Instants are absolute (UTC) `Date`s; local time exists only inside the
 * calculation, via Luxon and the parking time zone.
 */

/** One version of the tariff, valid on [validFrom, validTo). */
export interface TariffVersion {
  id: string;
  validFrom: Date;
  /** Exclusive; `null` = open-ended. */
  validTo: Date | null;
  /** Local wall-clock time 'HH:mm' when the day rate starts. */
  dayStartsAt: string;
  /** Local wall-clock time 'HH:mm' when the night rate starts. */
  nightStartsAt: string;
  /** Integer kopecks per minute. */
  dayPriceKop: number;
  nightPriceKop: number;
}

export type RateKind = 'day' | 'night';

export interface ChargeInput {
  enteredAt: Date;
  exitedAt: Date;
  tariffs: readonly TariffVersion[];
  /** IANA zone of the parking, e.g. 'Asia/Bishkek'. */
  timeZone: string;
}

/**
 * A run of consecutive billed minutes with the same price. `from`/`to` are
 * the start of the first and the end of the last minute of the run, so the
 * segments tile [enteredAt, enteredAt + minutes) exactly.
 */
export interface ChargeSegment {
  tariffId: string;
  kind: RateKind;
  from: Date;
  to: Date;
  minutes: number;
  pricePerMinuteKop: number;
  amountKop: number;
}

export interface Charge {
  minutes: number;
  amountKop: number;
  segments: ChargeSegment[];
}

export type TariffingErrorCode =
  | 'INVALID_TIME'
  | 'EXIT_BEFORE_ENTRY'
  | 'NO_TARIFF'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_TARIFF';

export class TariffingError extends Error {
  constructor(
    readonly code: TariffingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TariffingError';
  }
}
