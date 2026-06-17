import { PilotManualCheckStatus, PilotManualCheckType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordPilotCheckDto {
  @IsEnum(PilotManualCheckType)
  checkType!: PilotManualCheckType;

  @IsEnum(PilotManualCheckStatus)
  status!: PilotManualCheckStatus;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  notes?: string;
}
