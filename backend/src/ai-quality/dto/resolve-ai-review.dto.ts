import { AIReviewStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export class ResolveAIReviewDto {
  @IsIn([AIReviewStatus.REVIEWED, AIReviewStatus.DISMISSED])
  status!: AIReviewStatus;
}
