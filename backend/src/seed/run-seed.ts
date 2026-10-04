import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../database/data-source-options';
import { seedDemoData } from './demo-seed';

/** CLI: `npm run seed` (needs DATABASE_URL and applied migrations). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const ds = new DataSource(buildDataSourceOptions({ url }));
  await ds.initialize();
  try {
    if (await ds.showMigrations()) {
      throw new Error(
        'Pending migrations: start the backend or run `npm run migration:run` first',
      );
    }
    const result = await ds.transaction((m) => seedDemoData(m));
    console.log(
      `Demo data: ${result.usersCreated} users, ${result.carsCreated} cars created`,
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
