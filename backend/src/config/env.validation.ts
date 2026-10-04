import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsInt()
  @Min(100)
  WORKER_POLL_MS: number = 5000;

  /** Create demo users on API start (idempotent). Off unless set. */
  @Transform(({ obj, key }) => parseFlag((obj as Record<string, unknown>)[key]))
  @IsBoolean()
  SEED_DEMO: boolean = false;
}

/** Boolean env flag: true/1, false/0 or unset; anything else stays invalid. */
function parseFlag(raw: unknown): unknown {
  if (raw === undefined || raw === '') return false;
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return raw;
}

/** Fails fast on startup if the environment is incomplete or malformed. */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return env;
}
