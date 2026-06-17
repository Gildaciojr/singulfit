import { PilotCohortStatus } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePilotCohortDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2_000)
  description!: string;

  @IsOptional()
  @IsEnum(PilotCohortStatus)
  status: PilotCohortStatus = PilotCohortStatus.PLANNED;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;
}
