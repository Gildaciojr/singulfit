import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { WorkoutGeneratorService } from './workout-generator.service';
import { WorkoutService } from './workout.service';

@Controller('api/v1/workouts')
@UseGuards(JwtAuthGuard)
export class WorkoutController {
  constructor(
    private readonly workoutService: WorkoutService,
    private readonly workoutGeneratorService: WorkoutGeneratorService,
  ) {}

  @Post('generate')
  generate(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutGeneratorService.generate(user.userId);
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
