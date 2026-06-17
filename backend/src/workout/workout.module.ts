import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WorkoutController } from './workout.controller';
import { WorkoutGeneratorService } from './workout-generator.service';
import { WorkoutService } from './workout.service';

@Module({
  imports: [AuthModule, AIModule, SubscriptionsModule],
  controllers: [WorkoutController],
  providers: [WorkoutService, WorkoutGeneratorService],
  exports: [WorkoutService, WorkoutGeneratorService],
})
export class WorkoutModule {}
