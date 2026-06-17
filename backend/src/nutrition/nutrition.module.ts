import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { ContextModule } from '../context/context.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { StorageModule } from '../storage/storage.module';
import { LongitudinalModule } from '../longitudinal/longitudinal.module';
import { AdaptiveIntelligenceModule } from '../adaptive-intelligence/adaptive-intelligence.module';
import { NutritionAdminController } from './nutrition-admin.controller';
import { NutritionIntelligenceService } from './nutrition-intelligence.service';
import { NutritionQualityService } from './nutrition-quality.service';
import { NutritionVisionService } from './nutrition-vision.service';
import { NutritionService } from './nutrition.service';

@Module({
  imports: [
    AIModule,
    AuthModule,
    ContextModule,
    StorageModule,
    EntitlementsModule,
    LongitudinalModule,
    AdaptiveIntelligenceModule,
  ],
  controllers: [NutritionAdminController],
  providers: [
    NutritionService,
    NutritionVisionService,
    NutritionQualityService,
    NutritionIntelligenceService,
  ],
  exports: [
    NutritionService,
    NutritionVisionService,
    NutritionQualityService,
    NutritionIntelligenceService,
  ],
})
export class NutritionModule {}
