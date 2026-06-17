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
import { DietGeneratorService } from './diet-generator.service';
import { DietService } from './diet.service';

@Controller('api/v1/diets')
@UseGuards(JwtAuthGuard)
export class DietController {
  constructor(
    private readonly dietService: DietService,
    private readonly dietGeneratorService: DietGeneratorService,
  ) {}

  @Post('generate')
  generate(@CurrentUser() user: AuthenticatedUser) {
    return this.dietGeneratorService.generate(user.userId);
  }

  @Get('current')
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.dietService.getCurrent(user.userId);
  }

  @Get('history')
  getExplicitHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.dietService.listHistory(user.userId);
  }

  @Get(':dietPlanId')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dietPlanId', ParseUUIDPipe) dietPlanId: string,
  ) {
    return this.dietService.getById(user.userId, dietPlanId);
  }

  @Get()
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.dietService.listHistory(user.userId);
  }
}
