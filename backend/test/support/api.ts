import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { hashPassword } from '../../src/auth/password-hasher';
import { Clock } from '../../src/clock/clock';
import { FakeClock } from '../../src/clock/fake-clock';
import { configureApp } from '../../src/configure-app';

export interface TestApp {
  app: INestApplication<App>;
  clock: FakeClock;
  ds: DataSource;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Full API on a real PostgreSQL with a controllable clock. */
export async function createTestApp(now: string): Promise<TestApp> {
  const clock = new FakeClock(now);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return {
    app,
    clock,
    ds: app.get(DataSource),
    http: () => request(app.getHttpServer()),
    // Leave the database as found: other files (e.g. the demo seed test)
    // must not depend on which API test happened to run before them.
    close: async () => {
      await resetDomainData(app.get(DataSource));
      await app.close();
    },
  };
}

/**
 * Removes everything users created and resets the spot_state snapshot;
 * reference data (spots, tariffs) stays. API tests commit real rows, so each test starts clean.
 */
export async function resetDomainData(ds: DataSource): Promise<void> {
  await ds.query(`
    TRUNCATE users, cars, bookings, visits, invoices, gate_events,
             anomalies, email_outbox
    RESTART IDENTITY CASCADE`);
  // Snapshot back to the state after migrations (free, version 0).
  await ds.query(`UPDATE spot_state SET state = 'free', version = 0`);
}

let cachedHash: Promise<string> | undefined;
/** scrypt is slow on purpose; tests that do not test login share one hash. */
function sharedHash(): Promise<string> {
  cachedHash ??= hashPassword('password123');
  return cachedHash;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

/** Creates a user directly in the database and signs a token for it. */
export async function createUser(
  t: TestApp,
  opts: { email?: string; role?: 'driver' | 'operator' } = {},
): Promise<TestUser> {
  const email =
    opts.email ?? `user-${Math.random().toString(36).slice(2)}@test.local`;
  const role = opts.role ?? 'driver';
  const rows: { id: string }[] = await t.ds.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, await sharedHash(), role],
  );
  const token = await t.app
    .get(JwtService)
    .signAsync({ sub: rows[0].id, role });
  return {
    id: rows[0].id,
    email,
    token,
    auth: { Authorization: `Bearer ${token}` },
  };
}

export async function addCar(
  t: TestApp,
  user: TestUser,
  plate: string,
): Promise<{ id: string; plate: string }> {
  const res = await t
    .http()
    .post('/api/me/cars')
    .set(user.auth)
    .send({ plate })
    .expect(201);
  return res.body as { id: string; plate: string };
}

export async function spotByCode(t: TestApp, code: string): Promise<string> {
  const rows: { id: string }[] = await t.ds.query(
    'SELECT id FROM spots WHERE code = $1',
    [code],
  );
  return rows[0].id;
}
