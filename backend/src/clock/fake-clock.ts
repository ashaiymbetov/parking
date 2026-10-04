import { Clock } from './clock';

/** Manually driven clock for tests. */
export class FakeClock extends Clock {
  private current: Date;

  constructor(start: Date | string) {
    super();
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = new Date(at);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
