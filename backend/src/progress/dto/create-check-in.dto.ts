import { EnergyLevel } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCheckInDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  mood!: string;

  @IsEnum(EnergyLevel)
  energyLevel!: EnergyLevel;

  @IsInt()
  @Min(0)
  @Max(100)
  adherenceScore!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  notes?: string;
}
