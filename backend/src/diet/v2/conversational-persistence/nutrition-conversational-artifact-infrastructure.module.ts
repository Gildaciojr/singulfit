import { Module } from '@nestjs/common';
import { AIModule } from '../../../ai/ai.module';
import { NutritionConversationalArtifactValidator } from '../nutrition-conversational-artifact.validator';
import { NutritionPlanV2PersistenceValidator } from '../persistence/nutrition-plan-v2-persistence.validator';
import { NutritionConversationalArtifactPersistenceService } from './nutrition-conversational-artifact-persistence.service';
import { NutritionConversationalArtifactPersistenceValidator } from './nutrition-conversational-artifact-persistence.validator';
import { NUTRITION_CONVERSATIONAL_ARTIFACT_REPOSITORY } from './nutrition-conversational-artifact.repository';
import { PrismaNutritionConversationalArtifactGateway } from './prisma-nutrition-conversational-artifact.gateway';
import { NUTRITION_REVIEW_PLAN_PORT } from './nutrition-review-plan.port';
import { PrismaNutritionReviewPlanAdapter } from './prisma-nutrition-review-plan.adapter';

@Module({
  imports: [AIModule],
  providers: [
    NutritionConversationalArtifactValidator,
    NutritionPlanV2PersistenceValidator,
    NutritionConversationalArtifactPersistenceValidator,
    PrismaNutritionConversationalArtifactGateway,
    PrismaNutritionReviewPlanAdapter,
    {
      provide: NUTRITION_CONVERSATIONAL_ARTIFACT_REPOSITORY,
      useExisting: PrismaNutritionConversationalArtifactGateway,
    },
    {
      provide: NUTRITION_REVIEW_PLAN_PORT,
      useExisting: PrismaNutritionReviewPlanAdapter,
    },
    NutritionConversationalArtifactPersistenceService,
  ],
  exports: [
    NutritionConversationalArtifactPersistenceService,
    NUTRITION_REVIEW_PLAN_PORT,
  ],
})
export class NutritionConversationalArtifactInfrastructureModule {}
