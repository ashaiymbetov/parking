import { buildDataSourceOptions } from './data-source-options';
import { migrations } from './migrations';

describe('buildDataSourceOptions', () => {
  const url = 'postgres://u:p@localhost:5432/db';

  it('never lets TypeORM synchronize the schema', () => {
    expect(buildDataSourceOptions({ url }).synchronize).toBe(false);
    expect(
      buildDataSourceOptions({ url, runMigrations: true }).synchronize,
    ).toBe(false);
  });

  it('runs migrations only when asked', () => {
    expect(buildDataSourceOptions({ url }).migrationsRun).toBe(false);
    expect(
      buildDataSourceOptions({ url, runMigrations: true }).migrationsRun,
    ).toBe(true);
  });

  it('registers all migrations', () => {
    expect(buildDataSourceOptions({ url }).migrations).toBe(migrations);
    expect(migrations.length).toBeGreaterThan(0);
  });
});
