import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

/** ISO 8601 date-time with an explicit offset (Z or ±hh:mm). */
export const IsIsoWithOffset = () =>
  applyDecorators(
    IsISO8601({ strict: true, strictSeparator: true }),
    Matches(/T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, {
      message: '$property must include a time zone offset (Z or ±hh:mm)',
    }),
  );
