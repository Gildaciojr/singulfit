import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CreateMeasurementDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(500)
  weightKg!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  bodyFatPercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(500)
  muscleMassKg?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  measuredAt?: string;
}
