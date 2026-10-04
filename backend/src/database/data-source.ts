import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source-options';

/** Entry point for the TypeORM CLI (`npm run migration:*`). */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set');
}

export default new DataSource(buildDataSourceOptions({ url }));
