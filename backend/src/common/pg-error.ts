import { QueryFailedError } from 'typeorm';

export interface PgErrorInfo {
  code?: string;
  constraint?: string;
}

/** SQLSTATE and constraint name of a failed query, if it is one. */
export function pgError(err: unknown): PgErrorInfo | null {
  if (!(err instanceof QueryFailedError)) return null;
  const driverError = err.driverError as PgErrorInfo | undefined;
  return { code: driverError?.code, constraint: driverError?.constraint };
}
