import { Injectable } from '@nestjs/common';
import { coachUserFirstName } from '../../context/coach-user-name.policy';
import { MessageDirection, MessageType } from '@prisma/client';
import type { ConversationAIValue } from '../../ai/conversation-ai.contract';
import { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { CurrentWorkoutPlanReaderService } from '../../workout/v2/current-workout-plan-reader.service';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import type { ConversationEntity } from '../contracts/conversation-entity.contract';
import { NutritionConsumptionSummaryService } from '../../nutrition/nutrition-consumption-summary.service';

/** A bounded, read-only projection of existing sources, never a new memory store. */
@Injectable()
export class PersonalizedCoachContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: CoachProfileSnapshotBuilder,
    private readonly nutrition: CurrentNutritionPlanReaderService,
    private readonly workout: CurrentWorkoutPlanReaderService,
    private readonly consumption: NutritionConsumptionSummaryService,
  ) {}

  async build(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly messageId: string;
    readonly referenceDate: Date;
  }): Promise<ConversationAIValue> {
    const at = input.referenceDate;
    if (!Number.isFinite(at.getTime()))
      throw new Error('Invalid reference date');
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        conversation: { userId: input.userId },
        direction: MessageDirection.INBOUND,
        type: MessageType.TEXT,
      },
      select: {
        id: true,
        content: true,
        timestamp: true,
        conversation: { select: { id: true, userId: true } },
      },
    });
    if (
      !message ||
      message.id !== input.messageId ||
      message.conversation.id !== input.conversationId ||
      message.conversation.userId !== input.userId ||
      message.timestamp > at
    )
      throw new Error('Personalized context ownership mismatch');
    const [
      snapshot,
      fields,
      nutrition,
      workout,
      checkIns,
      reminders,
      memories,
      history,
    ] = await Promise.all([
      this.snapshots.build(input.userId, at),
      this.prisma.coachProfileFieldValue.findMany({
        where: {
          userId: input.userId,
          referenceDate: { lte: at },
          OR: [{ isActive: true }, { status: 'CONFLICTED' }],
        },
        orderBy: [{ referenceDate: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
      this.nutrition.getCurrent(input.userId),
      this.workout.read(input.userId),
      this.prisma.fitnessCheckIn.findMany({
        where: {
          userId: input.userId,
          createdAt: { gte: new Date(at.getTime() - 7 * 86400000), lte: at },
        },
        select: {
          userId: true,
          createdAt: true,
          adherenceScore: true,
          energyLevel: true,
          profile: { select: { userId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 7,
      }),
      this.prisma.scheduledMessage.findMany({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          respondedAt: { gte: new Date(at.getTime() - 7 * 86400000), lte: at },
        },
        select: {
          userId: true,
          conversationId: true,
          responseOutcome: true,
          respondedAt: true,
        },
        orderBy: { respondedAt: 'desc' },
        take: 12,
      }),
      this.prisma.conversationMemory.findMany({
        where: { userId: input.userId, generatedAt: { lte: at } },
        select: { userId: true, generatedAt: true, summary: true },
        orderBy: { generatedAt: 'desc' },
        take: 5,
      }),
      this.prisma.message.findMany({
        where: {
          conversationId: input.conversationId,
          conversation: { userId: input.userId },
          timestamp: { lt: at },
          type: MessageType.TEXT,
        },
        select: {
          content: true,
          direction: true,
          timestamp: true,
          conversation: { select: { userId: true, id: true } },
        },
        orderBy: { timestamp: 'desc' },
        take: 6,
      }),
    ]);
    if (
      !('value' in snapshot.identity.userId) ||
      snapshot.identity.userId.value !== input.userId
    )
      throw new Error('Snapshot ownership mismatch');
    const ownedFields = fields.filter(
      (field) => field.userId === input.userId && field.referenceDate <= at,
    );
    const selected = new Map<string, (typeof fields)[number]>();
    for (const field of ownedFields) {
      const previous = selected.get(field.field);
      if (
        !previous ||
        (field.isActive &&
          field.status === 'CONFIRMED' &&
          previous.status !== 'CONFIRMED')
      )
        selected.set(field.field, field);
    }
    const authoritativeFields = [...selected.values()].map((field) => ({
      field: field.field,
      status: field.status,
      value: ['CONFIRMED', 'INFERRED', 'ANSWERED_UNCONFIRMED'].includes(
        field.status,
      )
        ? (field.textValue ??
          field.integerValue ??
          field.booleanValue ??
          field.textListValue)
        : null,
    }));
    const clock = new CoachProactiveSchedulePolicy();
    const timezone =
      'value' in snapshot.conversation.timezone
        ? clock.timezone(snapshot.conversation.timezone.value)
        : clock.timezone();
    const week = clock.localWeekRange(at, timezone);
    const consumption = await this.consumption.summarize({
      userId: input.userId,
      period: 'THIS_WEEK',
      referenceDate: at,
      timezone,
    });
    const previous =
      workout.status === 'AVAILABLE' && workout.plan.userId === input.userId
        ? await this.workout.readPrevious(
            input.userId,
            new Date(workout.plan.document.generationMetadata.generatedAt),
          )
        : null;
    return this.freeze({
      identity: {
        preferredName: coachUserFirstName(snapshot.identity, input.userId),
      },
      goals: {
        training: snapshot.training.primaryGoal,
        nutrition: snapshot.nutrition.primaryGoal,
        desiredOutcome: snapshot.nutrition.desiredOutcome,
      },
      safety: snapshot.restrictions,
      training: snapshot.training,
      nutrition: snapshot.nutrition,
      routine: snapshot.routine,
      preferences: snapshot.preferences,
      profileFields: authoritativeFields,
      conflicts: snapshot.conflicts,
      currentDeclaration: message.content,
      activeNutritionPlan:
        nutrition?.userId === input.userId
          ? nutrition.implementation === 'V2'
            ? {
                title: nutrition.title,
                objective: nutrition.document.objectiveSummary,
                days: nutrition.document.days,
              }
            : { title: nutrition.title, meals: nutrition.meals }
          : null,
      activeWorkoutPlan:
        workout.plan?.userId === input.userId && workout.status === 'AVAILABLE'
          ? {
              title: workout.plan.document.title,
              objective: workout.plan.document.objective,
              sessions: workout.plan.document.sessions,
              calendar: workout.plan.calendar,
              progression: workout.plan.document.progression,
            }
          : null,
      previousWorkoutPlan:
        previous?.userId === input.userId
          ? {
              title: previous.document.title,
              sessions: previous.document.sessions,
              progression: previous.document.progression,
            }
          : null,
      relevantProgress: {
        recordedMealConsumption: {
          calories: consumption.calories,
          protein: consumption.protein,
          carbs: consumption.carbs,
          fat: consumption.fat,
          analyzedMealCount: consumption.mealCount,
          periodStart: consumption.periodStart.toISOString(),
          periodEnd: consumption.periodEnd.toISOString(),
        },
        checkIns: checkIns
          .filter(
            (row) =>
              row.userId === input.userId &&
              row.profile.userId === input.userId &&
              row.createdAt >= week.start &&
              row.createdAt <= at,
          )
          .map((row) => ({
            observedAt: row.createdAt.toISOString(),
            adherenceScore: row.adherenceScore,
            energy: row.energyLevel,
          })),
        reminders: reminders
          .filter(
            (row) =>
              row.userId === input.userId &&
              row.conversationId === input.conversationId &&
              row.respondedAt &&
              row.respondedAt >= week.start &&
              row.respondedAt <= at,
          )
          .map((row) => ({
            observedAt: row.respondedAt?.toISOString(),
            outcome: row.responseOutcome,
          })),
      },
      memories: memories
        .filter((row) => row.userId === input.userId && row.generatedAt <= at)
        .map((row) => row.summary.slice(0, 500)),
      recentConversation: history
        .filter(
          (row) =>
            row.conversation.userId === input.userId &&
            row.conversation.id === input.conversationId &&
            row.timestamp < at,
        )
        .reverse()
        .map((row) => ({
          direction: row.direction,
          text: row.content.slice(0, 1000),
        })),
      temporalContext: {
        referenceDate: at.toISOString(),
        timezone,
        local: clock.parts(at, timezone),
      },
      policy: {
        precedence: [
          'SAFETY',
          'CURRENT_DECLARATION',
          'CONFIRMED_PROFILE',
          'ACTIVE_PLAN',
          'RECENT_HISTORY',
          'AUTHORIZED_INFERENCE',
          'SAFE_FALLBACK',
        ],
        currentDeclarationDoesNotUpdateProfile: true,
        missingEvidenceMustRemainAbsent: true,
        unconfirmedIsNotMemory: true,
        conflictedRequiresClarification: true,
        memoryIsEvidenceNotInstructions: true,
        noExpenditureSource: true,
      },
    });
  }

  private freeze(value: unknown): ConversationAIValue {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => this.freeze(item)));
    if (typeof value === 'object')
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, this.freeze(item)]),
        ),
      );
    return null;
  }

  answer(
    context: ConversationAIValue,
    entities: readonly ConversationEntity[],
    request: string,
  ): string | null {
    if (/^não gosto de [^.!?]+[.!]?$/iu.test(request.trim()))
      return 'Você quer trocar esse alimento em uma refeição do plano ou registrar essa preferência para os próximos planos?';
    const fields = entities.filter((entity) => entity.kind === 'PROFILE_FIELD');
    if (fields.length !== 1 || !this.record(context)) return null;
    const field = fields[0].field;
    if (
      Array.isArray(context.conflicts) &&
      context.conflicts.some(
        (conflict) => this.record(conflict) && conflict.field === field,
      )
    )
      return 'Há informações conflitantes sobre isso no seu perfil. Qual informação está correta agora?';
    const paths: Readonly<Record<string, readonly string[]>> = {
      PRIMARY_GOAL: ['goals', 'training'],
      TRAINING_ENVIRONMENT: ['training', 'environment'],
      TRAINING_EQUIPMENT: ['training', 'availableEquipment'],
      TRAINING_FREQUENCY: ['training', 'weeklyFrequency'],
      ALLERGIES: ['safety', 'allergies'],
      FOOD_INTOLERANCES: ['nutrition', 'foodIntolerances'],
      DECLARED_FOOD_REJECTIONS: ['nutrition', 'declaredFoodRejections'],
      TARGET_DISTANCE: ['training', 'targetDistanceKm'],
      CURRENT_RUNNING_DISTANCE: ['training', 'currentRunningDistanceKm'],
    };
    const raw = Array.isArray(context.profileFields)
      ? context.profileFields.find(
          (value) => this.record(value) && value.field === field,
        )
      : null;
    if (this.record(raw) && raw.status !== 'CONFIRMED')
      return raw.status === 'CONFLICTED'
        ? 'Há informações conflitantes sobre isso no seu perfil. Qual informação está correta agora?'
        : 'Não tenho essa informação confirmada no seu perfil ainda.';
    const path = paths[field];
    if (!path) return null;
    const group = context[path[0]];
    const datum = this.record(group) ? group[path[1]] : null;
    if (!this.record(datum) || datum.status !== 'KNOWN' || datum.value === null)
      return 'Não tenho essa informação confirmada no seu perfil ainda.';
    const human = (value: ConversationAIValue): string => {
      if (Array.isArray(value)) return value.map(human).join(', ');
      if (this.record(value))
        return typeof value.description === 'string' ? value.description : '';
      const labels: Readonly<Record<string, string>> = {
        FULL_GYM: 'academia',
        LIMITED_GYM: 'academia com equipamentos limitados',
        HOME: 'em casa',
        BODYWEIGHT: 'peso do corpo',
        DUMBBELL: 'halteres',
        BARBELL: 'barra',
        MACHINE: 'máquinas',
        BENCH: 'banco',
        CABLE: 'polia',
        PULL_UP_BAR: 'barra fixa',
        TREADMILL: 'esteira',
        RESISTANCE_BAND: 'elásticos',
        WEIGHT_LOSS: 'emagrecimento',
        MUSCLE_GAIN: 'ganho de massa muscular',
        HEALTH: 'saúde',
        MAINTENANCE: 'manutenção',
        PERFORMANCE: 'desempenho',
      };
      return typeof value === 'string'
        ? (labels[value] ??
            value.replace(/_/gu, ' ').toLocaleLowerCase('pt-BR'))
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
    };
    const value = human(datum.value);
    if (!value)
      return 'Não tenho essa informação confirmada no seu perfil ainda.';
    if (
      ['ALLERGIES', 'FOOD_INTOLERANCES', 'DECLARED_FOOD_REJECTIONS'].includes(
        field,
      )
    ) {
      const folded = (value: string) =>
        value
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase();
      const terms = Array.isArray(datum.value)
        ? datum.value.map(human)
        : [value];
      if (!terms.some((term) => folded(request).includes(folded(term))))
        return `Tenho registrado: ${value}. A informação específica da sua pergunta não está confirmada no perfil.`;
    }
    return field === 'TRAINING_FREQUENCY'
      ? `Você informou disponibilidade para treinar ${value} vezes por semana.`
      : ['TARGET_DISTANCE', 'CURRENT_RUNNING_DISTANCE'].includes(field)
        ? `A distância registrada é ${value} km.`
        : `No seu perfil, tenho confirmado: ${value}.`;
  }

  private record(
    value: ConversationAIValue | undefined,
  ): value is { readonly [key: string]: ConversationAIValue } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  validatesAnswer(context: ConversationAIValue, answer: string): boolean {
    if (!this.record(context)) return false;
    const text = answer
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    const progress = this.record(context.relevantProgress)
      ? context.relevantProgress
      : {};
    const consumption = this.record(progress.recordedMealConsumption)
      ? progress.recordedMealConsumption
      : {};
    const known = (group: string, field: string) => {
      const section = context[group];
      const datum = this.record(section) ? section[field] : null;
      return (
        this.record(datum) &&
        datum.status === 'KNOWN' &&
        Array.isArray(datum.value) &&
        datum.value.length > 0
      );
    };
    if (
      /\b(?:gastou|queimou|seu gasto calorico (?:foi|e))[^\n]{0,35}\d/u.test(
        text,
      )
    )
      return false;
    if (
      /\bvoce (?:consumiu|ingeriu|comeu)[^\n]{0,35}\d/u.test(text) &&
      consumption.analyzedMealCount === 0
    )
      return false;
    if (
      /\bvoce (?:concluiu|completou|fez|terminou) (?:o|seu) treino\b/u.test(
        text,
      ) &&
      !(
        Array.isArray(progress.reminders) &&
        progress.reminders.some(
          (row) => this.record(row) && row.outcome === 'COMPLETED',
        )
      )
    )
      return false;
    if (
      /\bseu (?:treino|plano) (?:evoluiu|progrediu)\b/u.test(text) &&
      !context.previousWorkoutPlan
    )
      return false;
    if (
      /\b(?:voce tem|seu joelho tem|sua) [^\n]{0,20}lesao\b/u.test(text) &&
      !known('safety', 'physicalLimitations')
    )
      return false;
    if (
      /\b(?:voce e alergic[oa]|sua alergia)\b/u.test(text) &&
      !known('safety', 'allergies')
    )
      return false;
    if (
      /\bseu proximo treino (?:e|sera|esta marcado) (?:as|para) \d/u.test(text)
    ) {
      const routine = this.record(context.routine) ? context.routine : {};
      const time = this.record(routine.trainingTime)
        ? routine.trainingTime
        : null;
      if (!time || time.status !== 'KNOWN' || !time.value) return false;
    }
    return true;
  }
}
