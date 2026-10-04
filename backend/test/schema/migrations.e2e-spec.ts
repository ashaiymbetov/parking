import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/data-source-options';
import { migrations } from '../../src/database/migrations';
import { databaseUrl, migrateDatabase } from '../support/db';

const DOMAIN_TABLES = [
  'users',
  'cars',
  'spots',
  'tariffs',
  'bookings',
  'visits',
  'invoices',
  'gate_events',
  'anomalies',
  'email_outbox',
  'spot_state',
];

describe('schema: migrations', () => {
  let ds: DataSource;

  beforeAll(async () => {
    await migrateDatabase();
    ds = new DataSource(buildDataSourceOptions({ url: databaseUrl() }));
    await ds.initialize();
  });

  afterAll(async () => {
    // Leave the database migrated for any test that runs after this one.
    await ds.runMigrations({ transaction: 'each' });
    await ds.destroy();
  });

  async function existingTables(): Promise<string[]> {
    const rows: { name: string | null }[] = await ds.query(
      `SELECT to_regclass(t) AS name FROM unnest($1::text[]) AS t`,
      [DOMAIN_TABLES],
    );
    return rows.flatMap((r) => (r.name ? [r.name] : []));
  }

  it('creates every table from the data model', async () => {
    expect((await existingTables()).sort()).toEqual([...DOMAIN_TABLES].sort());
  });

  it('every migration can be reverted down to an empty schema and re-applied', async () => {
    for (let i = 0; i < migrations.length; i++) {
      await ds.undoLastMigration({ transaction: 'each' });
    }
    const applied: unknown[] = await ds.query('SELECT 1 FROM migrations');
    expect(applied).toHaveLength(0);
    expect(await existingTables()).toEqual([]);

    const ran = await ds.runMigrations({ transaction: 'each' });
    expect(ran).toHaveLength(migrations.length);
    expect((await existingTables()).sort()).toEqual([...DOMAIN_TABLES].sort());
  });
});
