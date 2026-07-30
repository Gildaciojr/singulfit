import { Injectable } from '@nestjs/common';
import {
  CONVERSATION_GOAL,
  type ConversationGoalDecision,
} from '../context/conversation-goal-planner.contract';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import type { CoachCommandIntent } from './coach-command.service';

type GeneratedDietPlan = Awaited<ReturnType<DietGeneratorService['generate']>>;
type GeneratedWorkoutPlan = Awaited<
  ReturnType<WorkoutGeneratorService['generate']>
>;

export interface CoachPlanningExecutionDispatchInput {
  readonly userId: string;
  readonly legacyIntent: CoachCommandIntent;
  readonly decision: ConversationGoalDecision | null;
}

@Injectable()
export class CoachPlanningExecutionDispatcherService {
  constructor(
    private readonly dietGenerator: DietGeneratorService,
    private readonly workoutGenerator: WorkoutGeneratorService,
  ) {}

  async dispatch(input: CoachPlanningExecutionDispatchInput): Promise<string> {
    if (!input.decision) {
      return this.executeLegacyIntent(input.userId, input.legacyIntent);
    }

    switch (input.decision.goal) {
      case CONVERSATION_GOAL.GENERATE_DIET_PLAN:
        return this.generateDiet(input.userId);
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
      `🥗 Plano alimentar: ${plan.title}`,
      '',
      `Objetivo: ${this.goalLabel(plan.objective)}`,
      `Calorias diárias: ${this.formatNumber(plan.dailyCaloriesTarget.toNumber())} kcal`,
      `Macros: ${this.formatNumber(plan.proteinTarget.toNumber())}g proteína, ${this.formatNumber(plan.carbsTarget.toNumber())}g carboidratos, ${this.formatNumber(plan.fatTarget.toNumber())}g gorduras.`,
      '',
      'Refeições principais:',
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
      `🏋️ Plano de treino: ${plan.title}`,
      '',
      `Objetivo: ${this.goalLabel(plan.objective)}`,
      '',
      'Divisão semanal:',
      days,
      '',
      'Respeite sua técnica, carga atual e recuperação. Se sentir dor fora do normal, pare e procure orientação profissional.',
    ].join('\n');
  }

  private async executeLegacyIntent(
    userId: string,
    intent: CoachCommandIntent,
  ): Promise<string> {
    switch (intent) {
      case 'DIET':
        return this.generateDiet(userId);
      case 'WORKOUT':
        return this.generateWorkout(userId);
      case 'BOTH':
        return this.generateCombined(userId);
      case 'UNKNOWN':
        return this.unknownIntentMessage();
    }

    return this.executeUnsupportedIntent(intent);
  }

  private async generateDiet(userId: string): Promise<string> {
    return this.formatDiet(await this.dietGenerator.generate(userId));
  }

  private async generateWorkout(userId: string): Promise<string> {
    return this.formatWorkout(await this.workoutGenerator.generate(userId));
  }

  private async generateCombined(userId: string): Promise<string> {
    const diet = await this.dietGenerator.generate(userId);
    const workout = await this.workoutGenerator.generate(userId);

    return `${this.formatDiet(diet)}\n\n${this.formatWorkout(workout)}`;
  }

  private executeUnsupportedGoal(
    _goal: never,
    userId: string,
    legacyIntent: CoachCommandIntent,
  ): Promise<string> {
    return this.executeLegacyIntent(userId, legacyIntent);
  }

  private executeUnsupportedIntent(_intent: never): string {
    return this.unknownIntentMessage();
  }

  private unknownIntentMessage(): string {
    return [
      'Posso te ajudar com isso 😊',
      '',
      'Escolha uma opção:',
      '',
      '1. Plano alimentar',
      '2. Plano de treino',
      '3. Os dois',
      '',
      'Você também pode responder com “quero uma dieta”, “monte meu treino” ou “quero os dois”.',
    ].join('\n');
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
}
