import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NUTRITION_SHADOW_ANALYTICS_REPOSITORY } from './nutrition-shadow-analytics.repository';
import { NutritionShadowAnalyticsService } from './nutrition-shadow-analytics.service';
import { PrismaNutritionShadowAnalyticsGateway } from './prisma-nutrition-shadow-analytics.gateway';

@Module({
  imports: [PrismaModule],
  providers: [
    NutritionShadowAnalyticsService,
    PrismaNutritionShadowAnalyticsGateway,
    {
      provide: NUTRITION_SHADOW_ANALYTICS_REPOSITORY,
      useExisting: PrismaNutritionShadowAnalyticsGateway,
    },
  ],
  exports: [NutritionShadowAnalyticsService],
})
export class NutritionShadowAnalyticsModule {}
