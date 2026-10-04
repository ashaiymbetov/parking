import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';

/** Minimal SQL factories for schema tests. Each returns the new row id. */

let gridRow = 1000;

function randomPlate(): string {
  return 'T' + randomBytes(4).toString('hex').toUpperCase();
}

export async function insertUser(
  c: Client,
  opts: { email?: string; role?: string } = {},
): Promise<string> {
  const res = await c.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', $2) RETURNING id`,
    [opts.email ?? `user-${randomUUID()}@test.local`, opts.role ?? 'driver'],
  );
  return res.rows[0].id;
}

export async function insertCar(
  c: Client,
  opts: { userId: string; plate?: string },
): Promise<string> {
  const res = await c.query<{ id: string }>(
    `INSERT INTO cars (user_id, plate) VALUES ($1, $2) RETURNING id`,
    [opts.userId, opts.plate ?? randomPlate()],
  );
  return res.rows[0].id;
}

export async function insertSpot(
  c: Client,
  opts: { code?: string } = {},
): Promise<string> {
  gridRow += 1;
  const res = await c.query<{ id: string }>(
    `INSERT INTO spots (code, "row", col) VALUES ($1, $2, 1) RETURNING id`,
    [opts.code ?? `T${gridRow}`, gridRow],
  );
  return res.rows[0].id;
}

export interface Driver {
  userId: string;
  carId: string;
  plate: string;
}

export async function insertDriver(c: Client): Promise<Driver> {
  const userId = await insertUser(c);
  const plate = randomPlate();
  const carId = await insertCar(c, { userId, plate });
  return { userId, carId, plate };
}

export const BOOKING_INSERT = `
  INSERT INTO bookings (user_id, car_id, spot_id, period, status)
  VALUES ($1, $2, $3, tstzrange($4, $5, '[)'), $6)
  RETURNING id`;

export async function insertBooking(
  c: Client,
  opts: {
    driver: Driver;
    spotId: string;
    from: string;
    to: string;
    status?: string;
  },
): Promise<string> {
  const res = await c.query<{ id: string }>(BOOKING_INSERT, [
    opts.driver.userId,
    opts.driver.carId,
    opts.spotId,
    opts.from,
    opts.to,
    opts.status ?? 'confirmed',
  ]);
  return res.rows[0].id;
}

export const VISIT_INSERT = `
  INSERT INTO visits (plate, spot_id, entered_at, exited_at, close_reason, booking_id)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id`;

export async function insertVisit(
  c: Client,
  opts: {
    plate: string;
    spotId: string;
    enteredAt: string;
    exitedAt?: string;
    bookingId?: string;
  },
): Promise<string> {
  const res = await c.query<{ id: string }>(VISIT_INSERT, [
    opts.plate,
    opts.spotId,
    opts.enteredAt,
    opts.exitedAt ?? null,
    opts.exitedAt ? 'exit' : null,
    opts.bookingId ?? null,
  ]);
  return res.rows[0].id;
}
