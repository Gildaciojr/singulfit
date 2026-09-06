import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-auth-payload.interface';
import {
  CONVERSATION_GOAL,
  CONVERSATION_RECOGNIZED_INTENT,
} from '../context/conversation-goal-planner.contract';
import {
  COACH_PROFILE_COMPLETION_SECTION,
  type CoachProfileSectionCompletion,
} from '../context/coach-profile-snapshot.contract';
import { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { DietService } from './diet.service';
import { CurrentNutritionPlanReaderService } from './current-nutrition-plan-reader.service';
import { NutritionApplicationExecutorService } from './v2/execution/nutrition-application-executor.service';
import { GenerateNutritionPlanV2InputBuilder } from './v2/generate-nutrition-plan-v2-input.builder';

@Controller('api/v1/diets')
@UseGuards(JwtAuthGuard)
export class DietController {
  constructor(
    private readonly dietService: DietService,
    private readonly currentReader: CurrentNutritionPlanReaderService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly prisma: PrismaService,
    private readonly snapshotBuilder: CoachProfileSnapshotBuilder,
    private readonly inputBuilder: GenerateNutritionPlanV2InputBuilder,
    private readonly nutritionExecutor: NutritionApplicationExecutorService,
  ) {}

  @Post('generate')
  async generate(@CurrentUser() user: AuthenticatedUser) {
    await this.subscriptionsService.getProfileSubscription(user.userId);
    const referenceDate = new Date();
    const [snapshot, profile] = await Promise.all([
      this.snapshotBuilder.build(user.userId, referenceDate),
      this.prisma.fitnessProfile.findUnique({
        where: { userId: user.userId },
        select: { id: true },
      }),
    ]);
    const nutritionSection = snapshot.completion.sections.find(
      (section) =>
        section.section === COACH_PROFILE_COMPLETION_SECTION.NUTRITION,
    );
    if (!profile || !nutritionSection?.ready) {
      throw this.contextRequired(nutritionSection);
    }
    const decision = Object.freeze({
      recognizedIntent: CONVERSATION_RECOGNIZED_INTENT.DIET_PLAN_REQUEST,
      goal: CONVERSATION_GOAL.GENERATE_DIET_PLAN,
      reason: 'DIET_PROFILE_READY' as const,
      targetPlan: 'DIET' as const,
      profileCompletionState: nutritionSection.state,
      canExecute: true,
      confidence: 'HIGH' as const,
      selectedProfileField: null,
      metPreconditions: Object.freeze([
        { kind: 'PLAN_PROFILE_READY' as const, plan: 'DIET' as const },
      ]),
      missingPreconditions: Object.freeze([]),
      pendingDependencies: Object.freeze([]),
    });
    const generationInput = this.inputBuilder.build({
      userId: user.userId,
      decision,
      snapshot,
      referenceDate,
    });
    const result = await this.nutritionExecutor.execute({
      generationInput,
      ownership: { userId: user.userId, profileId: profile.id },
      correlationId: `rest-nutrition-generation:${user.userId}:${referenceDate.toISOString()}`,
    });
    if (result.kind !== 'PLAN') {
      throw new UnprocessableEntityException({
        code: 'NUTRITION_GENERATION_BLOCKED',
        kind: result.kind,
      });
    }
    return this.currentReader.getCurrent(user.userId);
  }

  @Get('current')
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.currentReader.getCurrent(user.userId);
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

  private contextRequired(
    section: CoachProfileSectionCompletion | undefined,
  ): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'NUTRITION_CONTEXT_REQUIRED',
      missingFields: section?.missingFields ?? [],
      confirmationRequiredFields: section?.confirmationRequiredFields ?? [],
    });
  }
}
