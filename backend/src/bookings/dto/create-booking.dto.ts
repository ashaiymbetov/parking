import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { IsIsoWithOffset } from './iso-with-offset';

export class CreateBookingDto {
  @IsUUID()
  carId!: string;

  @IsUUID()
  spotId!: string;

  @IsIsoWithOffset()
  from!: string;

  @IsIsoWithOffset()
  to!: string;
}

export class PeriodQueryDto {
  @IsIsoWithOffset()
  from!: string;

  @IsIsoWithOffset()
  to!: string;
}

export const BOOKING_STATUSES = [
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
] as const;

export class ListBookingsQueryDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: (typeof BOOKING_STATUSES)[number];
}
