import { IsString, MaxLength } from 'class-validator';

export class AddCarDto {
  /** Free-form input; normalized by the service (normalizePlate). */
  @IsString()
  @MaxLength(64)
  plate!: string;
}
