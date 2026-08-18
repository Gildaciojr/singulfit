import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { GenerateWorkoutPlanV2InputBuilder } from './v2/generate-workout-plan-v2-input.builder';
import { WorkoutApplicationExecutorService } from './v2/execution/workout-application-executor.service';
import { WorkoutService } from './workout.service';

@Controller('api/v1/workouts')
@UseGuards(JwtAuthGuard)
export class WorkoutController {
  constructor(
    private readonly workoutService: WorkoutService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly inputBuilder: GenerateWorkoutPlanV2InputBuilder,
    private readonly workoutExecutor: WorkoutApplicationExecutorService,
  ) {}

  @Post('generate')
  async generate(@CurrentUser() user: AuthenticatedUser) {
    await this.subscriptionsService.getProfileSubscription(user.userId);
    const referenceDate = new Date();
    const built = await this.inputBuilder.build({
      userId: user.userId,
      referenceDate,
    });
    const result = await this.workoutExecutor.execute({
      generationInput: built.generationInput,
      ownership: { userId: user.userId, profileId: built.profileId },
      executionContext: {
        correlationId: `rest-workout-generation:${user.userId}:${referenceDate.toISOString()}`,
      },
    });
    if (result.kind !== 'PLAN') {
      throw new UnprocessableEntityException({
        code:
          result.kind === 'CLARIFICATION'
            ? 'WORKOUT_CONTEXT_REQUIRED'
            : 'WORKOUT_GENERATION_BLOCKED',
        ...result,
      });
    }
    return this.workoutService.getById(user.userId, result.aggregateId);
  }

  @Get('current')
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutService.getCurrent(user.userId);
  }

  @Get('history')
  getExplicitHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutService.listHistory(user.userId);
  }

  @Get(':workoutPlanId')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workoutPlanId', ParseUUIDPipe) workoutPlanId: string,
  ) {
    return this.workoutService.getById(user.userId, workoutPlanId);
  }

  @Get()
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutService.listHistory(user.userId);
  }
}
