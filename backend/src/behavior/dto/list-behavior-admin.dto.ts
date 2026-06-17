import { BehavioralInsightType, StageOfChange } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListBehaviorAdminDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(BehavioralInsightType)
  insightType?: BehavioralInsightType;

  @IsOptional()
  @IsEnum(StageOfChange)
  stage?: StageOfChange;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
