import { Type } from 'class-transformer';
import { ActivityLevel, FitnessGoal, Gender } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { FoodRestrictionDto } from './food-restriction.dto';
import { InjuryRestrictionDto } from './injury-restriction.dto';

export class UpdateProfileDto {
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsDateString({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(300)
  heightCm?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(500)
  currentWeightKg?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(500)
  targetWeightKg?: number;

  @IsOptional()
  @IsEnum(ActivityLevel)
  activityLevel?: ActivityLevel;

  @IsOptional()
  @IsEnum(FitnessGoal)
  goal?: FitnessGoal;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FoodRestrictionDto)
  foodRestrictions?: FoodRestrictionDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InjuryRestrictionDto)
  injuryRestrictions?: InjuryRestrictionDto[];
}
