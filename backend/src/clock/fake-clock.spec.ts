import { FakeClock } from './fake-clock';

describe('FakeClock', () => {
  it('returns the time it was set to and advances on demand', () => {
    const clock = new FakeClock('2026-10-04T10:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-10-04T10:00:00.000Z');

    clock.advance(15 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-10-04T10:15:00.000Z');

    clock.set('2026-10-05T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('does not leak its internal Date', () => {
    const clock = new FakeClock('2026-10-04T10:00:00Z');
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-10-04T10:00:00.000Z');
  });
});
