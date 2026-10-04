import { PostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Tests always run against a real PostgreSQL 16.
 * - DATABASE_URL set (e.g. the compose database) → use it as is;
 * - otherwise → start a throwaway container via testcontainers.
 */
export default async function globalSetup(): Promise<void> {
  process.env.JWT_SECRET ??= 'test-only-jwt-secret-0123456789';
  if (process.env.DATABASE_URL) {
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
