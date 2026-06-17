import {
  AIResponseEvaluationType,
  AIResponseRiskLevel,
  AIReviewStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListAIQualityDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  promptVersionId?: string;

  @IsOptional()
  @IsEnum(AIResponseRiskLevel)
  riskLevel?: AIResponseRiskLevel;

  @IsOptional()
  @IsEnum(AIResponseEvaluationType)
  evaluationType?: AIResponseEvaluationType;

  @IsOptional()
  @IsEnum(AIReviewStatus)
  status?: AIReviewStatus;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

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
