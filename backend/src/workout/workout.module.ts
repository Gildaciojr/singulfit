import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ContextModule } from '../context/context.module';
import { WorkoutController } from './workout.controller';
import { WorkoutGeneratorService } from './workout-generator.service';
import { WorkoutService } from './workout.service';
import { WorkoutArtifactResolverService } from './v2/workout-artifact-resolver.service';
import { WorkoutPlanV2Formatter } from './v2/workout-plan-v2.formatter';
import { WorkoutPlanV2Validator } from './v2/workout-plan-v2.validator';
import { WorkoutPlanningContextBuilder } from './v2/workout-planning-context.builder';
import { WorkoutPlanningEngineV2Service } from './v2/workout-planning-engine-v2.service';
import { WorkoutPlanningReadinessService } from './v2/workout-planning-readiness.service';
import { WorkoutPlanningSafetyService } from './v2/workout-planning-safety.service';
import { WorkoutPlanningStrategyService } from './v2/workout-planning-strategy.service';
import { WorkoutApplicationExecutorService } from './v2/execution/workout-application-executor.service';
import { WorkoutPlanV2PersistenceService } from './v2/persistence/workout-plan-v2-persistence.service';
import { WorkoutPlanV2PersistenceValidator } from './v2/persistence/workout-plan-v2-persistence.validator';
import { PrismaWorkoutPlanV2Gateway } from './v2/persistence/prisma-workout-plan-v2.gateway';
import { WORKOUT_PLAN_V2_REPOSITORY } from './v2/persistence/workout-plan-v2.repository';
import { GenerateWorkoutPlanV2InputBuilder } from './v2/generate-workout-plan-v2-input.builder';
import { CurrentWorkoutPlanReaderService } from './v2/current-workout-plan-reader.service';
import { WorkoutPlanV2StoredDocumentParser } from './v2/workout-plan-v2-stored-document.parser';

@Module({
  imports: [AuthModule, AIModule, SubscriptionsModule, ContextModule],
  controllers: [WorkoutController],
  providers: [
    WorkoutService,
    WorkoutGeneratorService,
    WorkoutArtifactResolverService,
    WorkoutPlanningReadinessService,
    WorkoutPlanningContextBuilder,
    WorkoutPlanningStrategyService,
    WorkoutPlanningSafetyService,
    WorkoutPlanV2Validator,
    WorkoutPlanV2Formatter,
    WorkoutPlanV2StoredDocumentParser,
    CurrentWorkoutPlanReaderService,
    GenerateWorkoutPlanV2InputBuilder,
    WorkoutPlanningEngineV2Service,
    WorkoutPlanV2PersistenceValidator,
    PrismaWorkoutPlanV2Gateway,
    {
      provide: WORKOUT_PLAN_V2_REPOSITORY,
      useExisting: PrismaWorkoutPlanV2Gateway,
    },
    WorkoutPlanV2PersistenceService,
    WorkoutApplicationExecutorService,
  ],
  exports: [
    WorkoutService,
    WorkoutGeneratorService,
    WorkoutPlanningEngineV2Service,
    WorkoutPlanV2Formatter,
    GenerateWorkoutPlanV2InputBuilder,
    WorkoutApplicationExecutorService,
    CurrentWorkoutPlanReaderService,
  ],
})
export class WorkoutModule {}
