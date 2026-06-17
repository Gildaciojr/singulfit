import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { CheckInService } from './check-in.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { ProgressService } from './progress.service';

@Controller('api/v1/progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(
    private readonly progressService: ProgressService,
    private readonly checkInService: CheckInService,
  ) {}

  @Post('check-ins')
  createCheckIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCheckInDto,
  ) {
    return this.checkInService.create(user.userId, body);
  }

  @Get('check-ins')
  getCheckIns(@CurrentUser() user: AuthenticatedUser) {
    return this.checkInService.list(user.userId);
  }

  @Get('insights')
  getInsights(@CurrentUser() user: AuthenticatedUser) {
    return this.progressService.getInsights(user.userId);
  }

  @Get()
  getProgress(@CurrentUser() user: AuthenticatedUser) {
    return this.progressService.getProgress(user.userId);
  }
}
