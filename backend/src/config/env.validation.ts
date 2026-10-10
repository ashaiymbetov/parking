import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  MinLength,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { IANAZone } from 'luxon';

@ValidatorConstraint({ name: 'ianaZone' })
class IsIanaZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && IANAZone.isValidZone(value);
  }
  defaultMessage(): string {
    return 'PARKING_TZ must be an IANA time zone, e.g. Asia/Bishkek';
  }
}

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

  /** Required by the API (AuthModule), not by the worker. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  JWT_SECRET?: string;

  @IsInt()
  @Min(60)
  JWT_TTL_SECONDS: number = 12 * 60 * 60;

  /** Parking time zone: tariff day/night boundaries and display (D-003). */
  @Validate(IsIanaZone)
  PARKING_TZ: string = 'Asia/Bishkek';

  /** Entry by booking is accepted until start + this; then no-show (D-004). */
  @IsInt()
  @Min(1)
  NO_SHOW_GRACE_MIN: number = 15;

  /** "Starts soon" window: early entry by booking, SPOT_OCCUPIED check. */
  @IsInt()
  @Min(0)
  EARLY_ENTRY_MIN: number = 15;

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
