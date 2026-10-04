/**
 * Source of "now" for all domain code. Inject `Clock` instead of calling
 * `new Date()` / `Date.now()` so tests can control time.
 */
export abstract class Clock {
  abstract now(): Date;
}
