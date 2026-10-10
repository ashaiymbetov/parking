import { IsString, MaxLength } from 'class-validator';

export class GateRequestDto {
  /** Raw camera reading; normalized by the service, garbage is journaled. */
  @IsString()
  @MaxLength(64)
  plate!: string;
}
