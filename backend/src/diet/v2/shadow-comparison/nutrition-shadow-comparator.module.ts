import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NutritionShadowComparatorService } from './nutrition-shadow-comparator.service';
import { NUTRITION_SHADOW_COMPARISON_REPOSITORY } from './nutrition-shadow-comparison.repository';
import { PrismaNutritionShadowComparisonGateway } from './prisma-nutrition-shadow-comparison.gateway';

@Module({
  imports: [PrismaModule],
  providers: [
    NutritionShadowComparatorService,
    PrismaNutritionShadowComparisonGateway,
    {
      provide: NUTRITION_SHADOW_COMPARISON_REPOSITORY,
      useExisting: PrismaNutritionShadowComparisonGateway,
    },
  ],
  exports: [NutritionShadowComparatorService],
})
export class NutritionShadowComparatorModule {}
