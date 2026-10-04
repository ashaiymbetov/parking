import { DataSourceOptions } from 'typeorm';
import { migrations } from './migrations';

export interface DataSourceSettings {
  url: string;
  /** Only the API process applies migrations; worker and CLI do not. */
  runMigrations?: boolean;
}

export function buildDataSourceOptions({
  url,
  runMigrations = false,
}: DataSourceSettings): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    // Schema is owned by hand-written SQL migrations, never by entities.
    synchronize: false,
    migrationsRun: runMigrations,
    migrationsTableName: 'migrations',
    migrations,
    entities: [],
    extra: {
      // Fail fast instead of hanging when the database is unreachable.
      connectionTimeoutMillis: 3000,
    },
  };
}
