import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
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

@Module({
  imports: [AuthModule, AIModule, SubscriptionsModule],
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
    WorkoutPlanningEngineV2Service,
  ],
  exports: [
    WorkoutService,
    WorkoutGeneratorService,
    WorkoutPlanningEngineV2Service,
    WorkoutPlanV2Formatter,
  ],
})
export class WorkoutModule {}
