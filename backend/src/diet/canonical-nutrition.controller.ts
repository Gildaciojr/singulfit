import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NutritionPlanImplementation } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { CanonicalNutritionPlanDto } from './canonical-nutrition-plan.dto';
import { CurrentNutritionPlanReaderService } from './current-nutrition-plan-reader.service';

@Controller('api/v2/nutrition-plans')
@UseGuards(JwtAuthGuard)
export class CanonicalNutritionController {
  constructor(
    private readonly reader: CurrentNutritionPlanReaderService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get('current')
  async getCurrent(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CanonicalNutritionPlanDto> {
    await this.subscriptionsService.getProfileSubscription(user.userId);
    const plan = await this.reader.getCurrent(user.userId);
    if (!plan)
      throw new NotFoundException('Plano nutricional ativo não encontrado');
    return plan;
  }

  @Get('history')
  async getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') rawLimit?: string,
  ): Promise<readonly CanonicalNutritionPlanDto[]> {
    await this.subscriptionsService.getProfileSubscription(user.userId);
    return rawLimit === undefined
      ? this.reader.listHistory(user.userId)
      : this.reader.listHistory(user.userId, Number(rawLimit));
  }

  @Get(':implementation/:planId')
  async getByReference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('implementation', new ParseEnumPipe(NutritionPlanImplementation))
    implementation: NutritionPlanImplementation,
    @Param('planId', ParseUUIDPipe) planId: string,
  ): Promise<CanonicalNutritionPlanDto> {
    await this.subscriptionsService.getProfileSubscription(user.userId);
    const plan = await this.reader.getByReference(user.userId, {
      implementation,
      id: planId,
    });
    if (!plan) throw new NotFoundException('Plano nutricional não encontrado');
    return plan;
  }
}
