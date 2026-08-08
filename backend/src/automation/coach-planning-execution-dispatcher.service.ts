import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CONVERSATION_GOAL,
  type ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import type { LegacyWorkoutCandidate } from '../workout/interfaces/legacy-workout-candidate.interface';
import type { CoachCommandIntent } from './coach-command.service';
import type {
  CoachPlanningDispatchResult,
  CoachPlanningExecutor,
} from './coach-planning-execution.contract';
import { CoachPlanningBothApplicationExecutorService } from './coach-planning-both-application-executor.service';
import type { GenerateNutritionPlanV2Input } from '../diet/v2/nutrition-planning-generation.contract';
import { NutritionApplicationExecutorService } from '../diet/v2/execution/nutrition-application-executor.service';
import { NutritionPublicResultFormatter } from '../diet/v2/execution/nutrition-public-result.formatter';
import type { PlanningExecutionRouteSelection } from './planning-execution-route-policy.service';

type GeneratedDietPlan = Awaited<ReturnType<DietGeneratorService['generate']>>;
type GeneratedWorkoutPlan = Awaited<
  ReturnType<WorkoutGeneratorService['generate']>
>;

export interface CoachPlanningExecutionDispatchInput {
  readonly userId: string;
  readonly legacyIntent: CoachCommandIntent;
  readonly decision: ConversationGoalDecision | null;
  readonly routeSelection?: PlanningExecutionRouteSelection;
  readonly nutritionV2?: {
    readonly generationInput: GenerateNutritionPlanV2Input;
    readonly profileId: string;
    readonly correlationId: string;
    readonly traceId?: string;
  };
}

@Injectable()
export class CoachPlanningExecutionDispatcherService {
  constructor(
    private readonly dietGenerator: DietGeneratorService,
    private readonly workoutGenerator: WorkoutGeneratorService,
    private readonly bothExecutor: CoachPlanningBothApplicationExecutorService,
    @Optional()
    private readonly nutritionV2Executor?: NutritionApplicationExecutorService,
    @Optional()
    private readonly nutritionV2Formatter?: NutritionPublicResultFormatter,
  ) {}

  async dispatch(input: CoachPlanningExecutionDispatchInput): Promise<string> {
    return (await this.dispatchStructured(input)).content;
  }

  async dispatchStructured(
    input: CoachPlanningExecutionDispatchInput,
  ): Promise<CoachPlanningDispatchResult> {
    if (!input.decision) {
      return this.executeLegacyIntent(input.userId, input.legacyIntent);
    }

    switch (input.decision.goal) {
      case CONVERSATION_GOAL.GENERATE_DIET_PLAN:
        return input.routeSelection?.nutrition === 'V2'
          ? this.generateDietV2(input)
          : this.generateDiet(input.userId);
      case CONVERSATION_GOAL.GENERATE_WORKOUT_PLAN:
        return this.generateWorkout(input.userId);
      case CONVERSATION_GOAL.GENERATE_COMBINED_PLANS:
        return this.generateCombined(input.userId);
      // Estes objetivos ainda não possuem executor oficial e preservam o intent legado.
      case CONVERSATION_GOAL.ANSWER_MESSAGE:
      case CONVERSATION_GOAL.ASK_PROFILE_INFORMATION:
      case CONVERSATION_GOAL.UPDATE_DIET_PLAN:
      case CONVERSATION_GOAL.UPDATE_WORKOUT_PLAN:
      case CONVERSATION_GOAL.REVIEW_PROGRESS:
      case CONVERSATION_GOAL.REQUEST_CONFIRMATION:
      case CONVERSATION_GOAL.SHOW_CURRENT_PLAN:
      case CONVERSATION_GOAL.SHOW_PLAN_STATUS:
      case CONVERSATION_GOAL.GENERAL_GUIDANCE:
      case CONVERSATION_GOAL.UNKNOWN:
        return this.executeLegacyIntent(input.userId, input.legacyIntent);
    }

    return this.executeUnsupportedGoal(
      input.decision.goal,
      input.userId,
      input.legacyIntent,
    );
  }

  formatDiet(plan: GeneratedDietPlan): string {
    const meals = plan.meals
      .slice(0, 5)
      .map((meal) => {
        const items = meal.items
          .slice(0, 3)
          .map((item) => `${item.foodName} (${item.quantity})`)
          .join(', ');
        const notes = meal.notes ? ` Observação: ${meal.notes}` : '';

        return `• ${meal.name}: ${items}.${notes}`;
      })
      .join('\n');

    return [
      `🥗 Montei ${plan.title} como uma base prática para ${this.goalLabel(plan.objective)}.`,
      '',
      `Calorias diárias: ${this.formatNumber(plan.dailyCaloriesTarget.toNumber())} kcal`,
      `Macros: ${this.formatNumber(plan.proteinTarget.toNumber())}g proteína, ${this.formatNumber(plan.carbsTarget.toNumber())}g carboidratos, ${this.formatNumber(plan.fatTarget.toNumber())}g gorduras.`,
      '',
      'Estas são as refeições para consultar no dia a dia:',
      meals,
      '',
      'Use este plano como guia inicial. Se quiser, depois posso ajudar a ajustar substituições conforme sua rotina.',
    ].join('\n');
  }

  formatWorkout(plan: GeneratedWorkoutPlan): string {
    const days = plan.days
      .slice(0, 7)
      .map((day) => {
        const exercises = day.exercises
          .slice(0, 4)
          .map((exercise) => exercise.exerciseName)
          .join(', ');

        return `• Dia ${day.dayNumber} - ${day.title}: ${exercises}.`;
      })
      .join('\n');

    return [
      `🏋️ Organizei ${plan.title} para apoiar seu objetivo de ${this.goalLabel(plan.objective)}.`,
      '',
      'Sua divisão semanal ficou assim:',
      days,
      '',
      'Respeite sua técnica, carga atual e recuperação. Se sentir dor fora do normal, pare e procure orientação profissional.',
    ].join('\n');
  }

  private async executeLegacyIntent(
    userId: string,
    intent: CoachCommandIntent,
  ): Promise<CoachPlanningDispatchResult> {
    switch (intent) {
      case 'DIET':
        return this.generateDiet(userId);
      case 'WORKOUT':
        return this.generateWorkout(userId);
      case 'BOTH':
        return this.generateCombined(userId);
      case 'UNKNOWN':
        return this.result(
          this.unknownIntentMessage(),
          'UNKNOWN_LEGACY',
          false,
        );
    }

    return this.executeUnsupportedIntent(intent);
  }

  private async generateDiet(
    userId: string,
  ): Promise<CoachPlanningDispatchResult> {
    return this.result(
      this.formatDiet(await this.dietGenerator.generate(userId)),
      'DIET_LEGACY',
      true,
    );
  }

  private async generateDietV2(
    input: CoachPlanningExecutionDispatchInput,
  ): Promise<CoachPlanningDispatchResult> {
    if (
      !input.nutritionV2 ||
      !this.nutritionV2Executor ||
      !this.nutritionV2Formatter
    ) {
      throw new ServiceUnavailableException(
        'Rota Nutrition V2 selecionada sem infraestrutura executável',
      );
    }
    const result = await this.nutritionV2Executor.execute({
      generationInput: input.nutritionV2.generationInput,
      ownership: {
        userId: input.userId,
        profileId: input.nutritionV2.profileId,
      },
      correlationId: input.nutritionV2.correlationId,
      traceId: input.nutritionV2.traceId,
    });
    return this.result(
      this.nutritionV2Formatter.format(result),
      'DIET_V2',
      result.aiJobCompleted,
    );
  }

  private async generateWorkout(
    userId: string,
  ): Promise<CoachPlanningDispatchResult> {
    return this.result(
      this.formatWorkout(await this.workoutGenerator.generate(userId)),
      'WORKOUT_LEGACY',
      true,
    );
  }

  private async generateCombined(
    userId: string,
  ): Promise<CoachPlanningDispatchResult> {
    const dietCandidate = await this.dietGenerator.generateCandidate(userId);
    let workoutCandidate: LegacyWorkoutCandidate;
    try {
      workoutCandidate = await this.workoutGenerator.generateCandidate(userId);
    } catch (error: unknown) {
      await this.dietGenerator.failCandidate(
        dietCandidate,
        new Error(
          `Planejamento combinado abortado antes do commit: ${this.errorMessage(error)}`,
        ),
      );
      throw error;
    }
    const committed = await this.bothExecutor.execute(
      dietCandidate,
      workoutCandidate,
    );

    return this.result(
      `${this.formatDiet(committed.dietPlan)}\n\n${this.formatWorkout(committed.workoutPlan)}`,
      'COMBINED_LEGACY',
      true,
    );
  }

  private executeUnsupportedGoal(
    _goal: never,
    userId: string,
    legacyIntent: CoachCommandIntent,
  ): Promise<CoachPlanningDispatchResult> {
    return this.executeLegacyIntent(userId, legacyIntent);
  }

  private executeUnsupportedIntent(
    _intent: never,
  ): CoachPlanningDispatchResult {
    void _intent;
    return this.result(this.unknownIntentMessage(), 'UNKNOWN_LEGACY', false);
  }

  private result(
    content: string,
    executor: CoachPlanningExecutor,
    generationCompleted: boolean,
  ): CoachPlanningDispatchResult {
    return Object.freeze({
      content,
      executor,
      generationCompleted,
      fallbackApplied: false,
    });
  }

  private unknownIntentMessage(): string {
    return 'Posso te ajudar com alimentação, treino ou acompanhar sua evolução. Me conta com suas palavras o que você precisa agora.';
  }

  private goalLabel(goal: string): string {
    const labels: Record<string, string> = {
      WEIGHT_LOSS: 'emagrecimento',
      MUSCLE_GAIN: 'ganho de massa muscular',
      MAINTENANCE: 'manutenção e evolução física',
    };

    return labels[goal] ?? 'evolução física';
  }

  private formatNumber(value: number): string {
    return Number(value.toFixed(2)).toString().replace('.', ',');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
      ? error.message.trim().slice(0, 1_000)
      : 'falha não identificada';
  }
}
