import { expectViolation, useRollbackClient } from '../support/db';
import { insertCar, insertUser } from '../support/factories';

describe('schema: users and cars', () => {
  const db = useRollbackClient();

  it('email is unique case-insensitively', async () => {
    await insertUser(db(), { email: 'Driver@Example.com' });
    await expectViolation(
      db(),
      `INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'driver')`,
      ['driver@example.COM'],
      { code: '23505', constraint: 'users_email_key' },
    );
  });

  it('role must be driver or operator', async () => {
    await insertUser(db(), { role: 'operator' });
    await expectViolation(
      db(),
      `INSERT INTO users (email, password_hash, role) VALUES ('a@b.c', 'x', 'admin')`,
      [],
      { code: '23514', constraint: 'users_role_check' },
    );
  });

  it('a plate belongs to at most one profile', async () => {
    const u1 = await insertUser(db());
    const u2 = await insertUser(db());
    await insertCar(db(), { userId: u1, plate: 'A123BC' });
    await expectViolation(
      db(),
      `INSERT INTO cars (user_id, plate) VALUES ($1, 'A123BC')`,
      [u2],
      { code: '23505', constraint: 'cars_plate_key' },
    );
  });

  it.each([
    ['lower case', 'a123bc'],
    ['space', 'A 123BC'],
    ['cyrillic look-alike', 'А123ВС'],
    ['hyphen', 'A-123'],
    ['empty', ''],
  ])('stores only normalized plates (%s rejected)', async (_case, plate) => {
    const userId = await insertUser(db());
    await expectViolation(
      db(),
      `INSERT INTO cars (user_id, plate) VALUES ($1, $2)`,
      [userId, plate],
      { code: '23514', constraint: 'cars_plate_format_check' },
    );
  });
});
