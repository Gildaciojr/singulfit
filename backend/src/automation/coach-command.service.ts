import { Injectable } from '@nestjs/common';
import { CoachMessageType, ScheduledMessageStatus } from '@prisma/client';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';

type CoachCommandIntent = 'DIET' | 'WORKOUT' | 'BOTH' | 'UNKNOWN';

interface ProcessCoachCommandInput {
  userId: string;
  messageId: string;
}

interface ProcessCoachCommandResult {
  handled: boolean;
  duplicated: boolean;
  intent: CoachCommandIntent;
  reason?: string;
}

type GeneratedDietPlan = Awaited<ReturnType<DietGeneratorService['generate']>>;
type GeneratedWorkoutPlan = Awaited<
  ReturnType<WorkoutGeneratorService['generate']>
>;

@Injectable()
export class CoachCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dietGenerator: DietGeneratorService,
    private readonly workoutGenerator: WorkoutGeneratorService,
    private readonly eventBus: EventBusService,
  ) {}

  async processTextMessage(
    input: ProcessCoachCommandInput,
  ): Promise<ProcessCoachCommandResult> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversation: {
          userId: input.userId,
        },
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        conversation: {
          select: {
            user: {
              select: {
                onboardingCompleted: true,
              },
            },
          },
        },
      },
    });

    if (!message) {
      return {
        handled: false,
        duplicated: false,
        intent: 'UNKNOWN',
        reason: 'TEXT_MESSAGE_NOT_FOUND',
      };
    }

    if (!message.conversation.user.onboardingCompleted) {
      return {
        handled: false,
        duplicated: false,
        intent: 'UNKNOWN',
        reason: 'ONBOARDING_NOT_COMPLETED',
      };
    }

    const intent = this.classify(message.content);
    const idempotencyKey = this.idempotencyKey(input.userId, message.id);
    const existing = await this.prisma.coachMessage.findUnique({
      where: {
        idempotencyKey,
      },
    });

    if (existing) {
      await this.scheduleResponse({
        userId: input.userId,
        messageId: message.id,
        content: existing.content,
        scheduledFor: this.scheduledFor(message.timestamp, message.id),
      });

      return {
        handled: true,
        duplicated: true,
        intent,
      };
    }

    const content = await this.contentForIntent(input.userId, intent);
    await this.prisma.coachMessage.create({
      data: {
        userId: input.userId,
        type: CoachMessageType.FOLLOW_UP,
        idempotencyKey,
        content,
        context: {
          source: 'WHATSAPP_COMMAND',
          messageId: message.id,
          intent,
        },
        generatedAt: new Date(),
        scheduledFor: message.timestamp,
      },
    });
    await this.scheduleResponse({
      userId: input.userId,
      messageId: message.id,
      content,
      scheduledFor: this.scheduledFor(message.timestamp, message.id),
    });

    return {
      handled: true,
      duplicated: false,
      intent,
    };
  }

  classify(text: string): CoachCommandIntent {
    const normalized = this.normalize(text);
    const wantsDiet = this.includesAny(normalized, [
      'quero uma dieta',
      'preciso de uma dieta',
      'monta uma dieta',
      'monte uma dieta',
      'plano alimentar',
      'alimentacao',
      'me ajuda com alimentacao',
    ]);
    const wantsWorkout = this.includesAny(normalized, [
      'quero treino',
      'monte meu treino',
      'monta meu treino',
      'plano de treino',
      'treino para mim',
      'treino pra mim',
      'academia',
      'quero treinar',
    ]);
    const wantsBoth = this.includesAny(normalized, [
      'quero os dois',
      'dieta e treino',
      'treino e dieta',
      'quero tudo',
      'alimentacao e treino',
      'treino e alimentacao',
    ]);

    if (wantsBoth || (wantsDiet && wantsWorkout)) {
      return 'BOTH';
    }

    if (wantsDiet) {
      return 'DIET';
    }

    if (wantsWorkout) {
      return 'WORKOUT';
    }

    return 'UNKNOWN';
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

  private async contentForIntent(
    userId: string,
    intent: CoachCommandIntent,
  ): Promise<string> {
    try {
      if (intent === 'DIET') {
        return this.formatDiet(await this.dietGenerator.generate(userId));
      }

      if (intent === 'WORKOUT') {
        return this.formatWorkout(await this.workoutGenerator.generate(userId));
      }

      if (intent === 'BOTH') {
        const diet = await this.dietGenerator.generate(userId);
        const workout = await this.workoutGenerator.generate(userId);

        return `${this.formatDiet(diet)}\n\n${this.formatWorkout(workout)}`;
      }

      return this.unknownIntentMessage();
    } catch (error: unknown) {
      return this.failureMessage(error);
    }
  }

  private async scheduleResponse(input: {
    userId: string;
    messageId: string;
    content: string;
    scheduledFor: Date;
  }): Promise<void> {
    const rule = await this.prisma.automationRule.findUnique({
      where: {
        code: AUTOMATION_RULE_CODES.DAILY_COACH,
      },
    });

    if (!rule || !rule.enabled) {
      throw new Error('Regra de automação indisponível');
    }

    await this.prisma.userAutomationPreference.upsert({
      where: {
        userId: input.userId,
      },
      update: {},
      create: {
        userId: input.userId,
      },
    });

    await this.prisma.$transaction(async (transaction) => {
      const scheduledMessage = await transaction.scheduledMessage.upsert({
        where: {
          userId_automationRuleId_scheduledFor: {
            userId: input.userId,
            automationRuleId: rule.id,
            scheduledFor: input.scheduledFor,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          automationRuleId: rule.id,
          scheduledFor: input.scheduledFor,
          status: ScheduledMessageStatus.PENDING,
          content: input.content,
        },
        include: {
          automationRule: true,
        },
      });

      await this.eventBus.publish(
        {
          eventType: INTERNAL_EVENT.AUTOMATION_TRIGGERED,
          aggregateType: 'SCHEDULED_MESSAGE',
          aggregateId: scheduledMessage.id,
          payload: {
            scheduledMessageId: scheduledMessage.id,
            userId: input.userId,
            automationRuleId: rule.id,
            ruleCode: AUTOMATION_RULE_CODES.DAILY_COACH,
            source: 'WHATSAPP_COACH_COMMAND',
            sourceMessageId: input.messageId,
          },
          availableAt: input.scheduledFor,
        },
        transaction,
      );
    });
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

  private failureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : '';

    if (/assinatura|acesso|subscription|forbidden/i.test(message)) {
      return 'Para gerar seu plano personalizado, sua assinatura precisa estar ativa. Assim que o acesso estiver liberado, eu continuo daqui.';
    }

    if (/perfil fitness|perfil/i.test(message)) {
      return 'Ainda preciso do seu perfil completo para gerar um plano seguro e personalizado. Conclua o onboarding e me peça novamente.';
    }

    return 'Tive uma falha ao gerar seu plano agora. Tente novamente em alguns instantes que eu continuo te ajudando.';
  }

  private idempotencyKey(userId: string, messageId: string): string {
    return `${userId}:WHATSAPP_COACH_COMMAND:${messageId}`;
  }

  private scheduledFor(timestamp: Date, messageId: string): Date {
    return new Date(timestamp.getTime() + this.stableOffsetMs(messageId));
  }

  private stableOffsetMs(value: string): number {
    let hash = 0;

    for (const char of value) {
      hash = (hash * 31 + char.charCodeAt(0)) % 997;
    }

    return hash;
  }

  private includesAny(text: string, expressions: readonly string[]): boolean {
    return expressions.some((expression) => text.includes(expression));
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
