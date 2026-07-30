import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NutritionPlanV2PersistenceValidator } from '../persistence/nutrition-plan-v2-persistence.validator';
import type {
  NutritionReviewPlanPort,
  NutritionReviewPlanReference,
} from './nutrition-review-plan.port';

@Injectable()
export class PrismaNutritionReviewPlanAdapter implements NutritionReviewPlanPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: NutritionPlanV2PersistenceValidator,
  ) {}
  async resolveActive(
    userId: string,
  ): Promise<NutritionReviewPlanReference | null> {
    const plan = await this.prisma.nutritionPlanV2.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
    });
    if (!plan) return null;
    const aggregate = this.validator.reconstruct(plan);
    return Object.freeze({
      id: aggregate.id,
      userId: aggregate.userId,
      document: aggregate.document,
    });
  }
}
