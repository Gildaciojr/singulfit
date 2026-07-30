import { Injectable } from '@nestjs/common';
import { NutritionPlanStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  NutritionShadowActivePlanPort,
  NutritionShadowActivePlanReference,
} from './nutrition-shadow-active-plan.port';

@Injectable()
export class PrismaNutritionShadowActivePlanAdapter implements NutritionShadowActivePlanPort {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    userId: string,
  ): Promise<NutritionShadowActivePlanReference | null> {
    const plan = await this.prisma.nutritionPlanV2.findFirst({
      where: { userId, status: NutritionPlanStatus.ACTIVE },
      select: { id: true, artifactType: true, generatedAt: true },
      orderBy: { generatedAt: 'desc' },
    });
    if (!plan) return null;
    if (
      plan.artifactType !== 'DAILY_STRUCTURE' &&
      plan.artifactType !== 'WEEKLY_PLAN' &&
      plan.artifactType !== 'PLAN_ADAPTATION' &&
      plan.artifactType !== 'FOOD_SUBSTITUTION'
    )
      return null;
    return Object.freeze({
      id: plan.id,
      artifactType: plan.artifactType,
      generatedAt: plan.generatedAt,
    }) as NutritionShadowActivePlanReference;
  }
}
