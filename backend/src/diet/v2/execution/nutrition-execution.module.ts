import { Module } from '@nestjs/common';
import { DietModule } from '../../diet.module';
import { NutritionConversationalArtifactInfrastructureModule } from '../conversational-persistence/nutrition-conversational-artifact-infrastructure.module';
import { NutritionPlanV2InfrastructureModule } from '../persistence/nutrition-plan-v2-infrastructure.module';
import { NutritionApplicationExecutorService } from './nutrition-application-executor.service';
import { NutritionPublicResultFormatter } from './nutrition-public-result.formatter';

@Module({
  imports: [
    DietModule,
    NutritionPlanV2InfrastructureModule,
    NutritionConversationalArtifactInfrastructureModule,
  ],
  providers: [
    NutritionApplicationExecutorService,
    NutritionPublicResultFormatter,
  ],
  exports: [
    NutritionApplicationExecutorService,
    NutritionPublicResultFormatter,
  ],
})
export class NutritionExecutionModule {}
