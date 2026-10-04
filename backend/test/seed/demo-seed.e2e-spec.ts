import { DataSource, QueryRunner } from 'typeorm';
import { verifyPassword } from '../../src/auth/password-hasher';
import { buildDataSourceOptions } from '../../src/database/data-source-options';
import { DEMO_PASSWORD } from '../../src/seed/demo-data';
import { seedDemoData } from '../../src/seed/demo-seed';
import { databaseUrl, migrateDatabase } from '../support/db';

describe('demo seed', () => {
  let ds: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    await migrateDatabase();
    ds = new DataSource(buildDataSourceOptions({ url: databaseUrl() }));
    await ds.initialize();
  });
  afterAll(() => ds.destroy());

  // Rolled back: demo accounts never stay in the test database.
  beforeEach(async () => {
    qr = ds.createQueryRunner();
    await qr.startTransaction();
  });
  afterEach(async () => {
    await qr.rollbackTransaction();
    await qr.release();
  });

  async function snapshot() {
    const users = await qr.manager.query<{ email: string; role: string }[]>(
      `SELECT email, role FROM users WHERE email LIKE '%@parking.local' ORDER BY email`,
    );
    const cars = await qr.manager.query<{ email: string; plate: string }[]>(
      `SELECT u.email, c.plate FROM cars c JOIN users u ON u.id = c.user_id
       WHERE u.email LIKE '%@parking.local' ORDER BY c.plate`,
    );
    return { users, cars };
  }

  it('creates the operator and two drivers with their cars', async () => {
    const result = await seedDemoData(qr.manager);

    expect(result).toEqual({ usersCreated: 3, carsCreated: 3 });
    expect(await snapshot()).toEqual({
      users: [
        { email: 'driver1@parking.local', role: 'driver' },
        { email: 'driver2@parking.local', role: 'driver' },
        { email: 'operator@parking.local', role: 'operator' },
      ],
      cars: [
        { email: 'driver1@parking.local', plate: 'A123BC' },
        { email: 'driver2@parking.local', plate: 'B777OP' },
        { email: 'driver2@parking.local', plate: 'E001KX' },
      ],
    });
  });

  it('is idempotent: a second run creates nothing', async () => {
    await seedDemoData(qr.manager);
    const before = await snapshot();

    const second = await seedDemoData(qr.manager);

    expect(second).toEqual({ usersCreated: 0, carsCreated: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it('stores a scrypt hash that verifies with the demo password', async () => {
    await seedDemoData(qr.manager);
    const rows = await qr.manager.query<{ password_hash: string }[]>(
      `SELECT password_hash FROM users WHERE email = 'driver1@parking.local'`,
    );
    await expect(
      verifyPassword(DEMO_PASSWORD, rows[0].password_hash),
    ).resolves.toBe(true);
  });
});
