import { Client, DatabaseError } from 'pg';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/data-source-options';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set (globalSetup should provide it)');
  }
  return url;
}

/** Brings the test database to the latest schema. Idempotent. */
export async function migrateDatabase(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions({ url: databaseUrl() }));
  await ds.initialize();
  try {
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  return client;
}

/**
 * One raw pg connection per test file; every test runs inside
 * BEGIN … ROLLBACK, so tests never see each other's rows.
 */
export function useRollbackClient(): () => Client {
  let client: Client | undefined;

  beforeAll(async () => {
    await migrateDatabase();
    client = await connect();
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client!.query('BEGIN');
  });
  afterEach(async () => {
    await client!.query('ROLLBACK');
  });

  return () => client!;
}

export interface ExpectedViolation {
  /** SQLSTATE: 23505 unique, 23P01 exclusion, 23514 check, 23503 FK. */
  code: string;
  /** Name of the constraint or unique index that must fire. */
  constraint: string;
}

/**
 * Runs a statement that must be rejected by the database. Uses a savepoint
 * so the surrounding test transaction stays usable afterwards.
 */
export async function expectViolation(
  client: Client,
  sql: string,
  params: unknown[],
  expected: ExpectedViolation,
): Promise<void> {
  await client.query('SAVEPOINT expect_violation');
  let error: unknown;
  try {
    await client.query(sql, params);
  } catch (e) {
    error = e;
  }
  await client.query('ROLLBACK TO SAVEPOINT expect_violation');

  if (!(error instanceof DatabaseError)) {
    throw new Error(
      `Expected ${expected.code} on ${expected.constraint}, but the statement ` +
        (error instanceof Error ? `failed with ${error.message}` : 'succeeded'),
    );
  }
  expect({ code: error.code, constraint: error.constraint }).toEqual(expected);
}
