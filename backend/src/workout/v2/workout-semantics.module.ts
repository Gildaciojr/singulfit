import { Module } from '@nestjs/common';
import { WorkoutModalityResolutionService } from './workout-modality-resolution.service';

@Module({
  providers: [WorkoutModalityResolutionService],
  exports: [WorkoutModalityResolutionService],
})
export class WorkoutSemanticsModule {}
