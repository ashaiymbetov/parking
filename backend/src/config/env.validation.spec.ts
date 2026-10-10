import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const url = 'postgres://u:p@localhost:5432/db';

  it('converts numeric strings from process.env to numbers', () => {
    // Real env values are always strings (e.g. from docker-compose).
    const env = validateEnv({
      DATABASE_URL: url,
      PORT: '3001',
      WORKER_POLL_MS: '1000',
    });
    expect(env.PORT).toBe(3001);
    expect(env.WORKER_POLL_MS).toBe(1000);
  });

  it('applies defaults', () => {
    const env = validateEnv({ DATABASE_URL: url });
    expect(env.PORT).toBe(3000);
    expect(env.WORKER_POLL_MS).toBe(5000);
  });

  it('fails fast on missing or malformed values', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: url, PORT: 'abc' })).toThrow(
      /PORT/,
    );
  });
});

describe('validateEnv: SEED_DEMO', () => {
  const url = 'postgres://u:p@localhost:5432/db';

  it.each([
    [undefined, false],
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('SEED_DEMO=%s → %s', (raw, expected) => {
    expect(validateEnv({ DATABASE_URL: url, SEED_DEMO: raw }).SEED_DEMO).toBe(
      expected,
    );
  });

  it('rejects anything else', () => {
    expect(() => validateEnv({ DATABASE_URL: url, SEED_DEMO: 'yes' })).toThrow(
      /SEED_DEMO/,
    );
  });
});

describe('validateEnv: parking time and thresholds', () => {
  const url = 'postgres://u:p@localhost:5432/db';

  it('defaults to Asia/Bishkek and 15 minutes', () => {
    const env = validateEnv({ DATABASE_URL: url });
    expect(env.PARKING_TZ).toBe('Asia/Bishkek');
    expect(env.NO_SHOW_GRACE_MIN).toBe(15);
  });

  it('rejects an unknown time zone', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: url, PARKING_TZ: 'Mars/Olympus' }),
    ).toThrow(/PARKING_TZ/);
  });
});
