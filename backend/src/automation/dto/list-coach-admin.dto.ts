import { ChurnRiskLevel, CoachReviewType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListCoachAdminDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(ChurnRiskLevel)
  risk?: ChurnRiskLevel;

  @IsOptional()
  @IsEnum(CoachReviewType)
  reviewType?: CoachReviewType;

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
