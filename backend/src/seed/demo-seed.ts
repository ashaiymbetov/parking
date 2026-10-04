import { EntityManager } from 'typeorm';
import { hashPassword } from '../auth/password-hasher';
import { DEMO_PASSWORD, DEMO_USERS } from './demo-data';

export interface SeedResult {
  usersCreated: number;
  carsCreated: number;
}

/**
 * Idempotent: existing users and plates are left untouched, so the seed can
 * run on every start. Requires all migrations to be applied.
 */
export async function seedDemoData(
  manager: EntityManager,
): Promise<SeedResult> {
  const result: SeedResult = { usersCreated: 0, carsCreated: 0 };

  for (const user of DEMO_USERS) {
    const existing: { id: string }[] = await manager.query(
      'SELECT id FROM users WHERE email = $1',
      [user.email],
    );
    let userId = existing[0]?.id;

    if (!userId) {
      // Hash only when needed: scrypt is deliberately slow.
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [user.email, await hashPassword(DEMO_PASSWORD), user.role],
      );
      if (inserted.length > 0) {
        result.usersCreated += 1;
        userId = inserted[0].id;
      } else {
        // Created concurrently by another process.
        const again: { id: string }[] = await manager.query(
          'SELECT id FROM users WHERE email = $1',
          [user.email],
        );
        userId = again[0].id;
      }
    }

    for (const plate of user.plates) {
      const car: unknown[] = await manager.query(
        `INSERT INTO cars (user_id, plate) VALUES ($1, $2)
         ON CONFLICT (plate) DO NOTHING
         RETURNING id`,
        [userId, plate],
      );
      result.carsCreated += car.length;
    }
  }

  return result;
}
