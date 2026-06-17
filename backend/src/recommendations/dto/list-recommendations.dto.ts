import {
  RecommendationCategory,
  RecommendationPriority,
  RecommendationStatus,
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

export class ListRecommendationsDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(RecommendationCategory)
  category?: RecommendationCategory;

  @IsOptional()
  @IsEnum(RecommendationPriority)
  priority?: RecommendationPriority;

  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;

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
