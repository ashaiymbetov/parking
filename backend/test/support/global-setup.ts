import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

/**
 * Tests always run against a real PostgreSQL 16.
 * - DATABASE_URL set (e.g. the compose database) → a fresh database
 *   `<name>_e2e` on that server; API tests TRUNCATE tables, so they must
 *   never run in the database with demo data;
 * - otherwise → start a throwaway container via testcontainers.
 */
export default async function globalSetup(): Promise<void> {
  process.env.JWT_SECRET ??= 'test-only-jwt-secret-0123456789';
  if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL = await freshDatabaseNextTo(
      process.env.DATABASE_URL,
    );
    return;
  }
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('parking_test')
    .withUsername('parking')
    .withPassword('parking')
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  (globalThis as { __PG_CONTAINER__?: unknown }).__PG_CONTAINER__ = container;
}

async function freshDatabaseNextTo(url: string): Promise<string> {
  const target = new URL(url);
  const name = `${target.pathname.slice(1) || 'postgres'}_e2e`;
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected database name for e2e: ${name}`);
  }
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  target.pathname = `/${name}`;
  return target.toString();
}
