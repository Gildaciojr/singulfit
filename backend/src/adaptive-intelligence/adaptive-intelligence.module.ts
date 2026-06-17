import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdaptiveCoachAdminController,
  AdaptiveNutritionAdminController,
  EarlyChurnAdminController,
} from './adaptive-intelligence-admin.controller';
import { AdaptiveIntelligenceCalculatorService } from './adaptive-intelligence-calculator.service';
import { AdaptiveIntelligenceService } from './adaptive-intelligence.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AdaptiveNutritionAdminController,
    AdaptiveCoachAdminController,
    EarlyChurnAdminController,
  ],
  providers: [
    AdaptiveIntelligenceCalculatorService,
    AdaptiveIntelligenceService,
  ],
  exports: [AdaptiveIntelligenceCalculatorService, AdaptiveIntelligenceService],
})
export class AdaptiveIntelligenceModule {}
