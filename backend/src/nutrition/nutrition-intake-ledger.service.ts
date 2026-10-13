import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import { recordedPortion } from './nutrition-recorded-portion.policy';
import { MealSource, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoachProactiveSchedulePolicy } from '../automation/coach-proactive-schedule.policy';
import {
  hydrationTotal,
  intakeNeedsClarification,
  intakeEvidence,
} from './nutrition-intake-evidence.policy';

@Injectable()
export class NutritionIntakeLedgerService {
  private readonly clock = new CoachProactiveSchedulePolicy();
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly plans?: CurrentNutritionPlanReaderService,
  ) {}

  async recent(userId: string, conversationId: string, at: Date) {
    return this.prisma.nutritionIntakeRecord.findMany({
      where: {
        userId,
        sourceMessage: { conversationId },
        reportedAt: { lte: at },
        OR: [{ voidedAt: null }, { voidedAt: { gt: at } }],
        kind: { not: 'VOID' },
      },
      orderBy: { reportedAt: 'desc' },
      take: 12,
      select: { id: true, kind: true, occurredAt: true, evidence: true },
    });
  }

  async record(
    transaction: Prisma.TransactionClient,
    userId: string,
    messageId: string,
    evidence: unknown,
  ) {
    const source = await transaction.message.findFirst({
      where: {
        id: messageId,
        direction: 'INBOUND',
        type: 'TEXT',
        conversation: { userId },
      },
      select: {
        content: true,
        timestamp: true,
        replyToExternalMessageId: true,
        conversationId: true,
        conversation: {
          select: {
            user: { select: { preferences: { select: { timezone: true } } } },
          },
        },
      },
    });
    if (!source) throw new BadRequestException('INTAKE_SOURCE_NOT_OWNED');
    await transaction.$queryRaw`SELECT "id" FROM "messages" WHERE "id" = ${messageId} FOR UPDATE`;
    const validated = intakeEvidence(evidence, source.content);
    if (!validated) throw new BadRequestException('INTAKE_EVIDENCE_INVALID');
    if (intakeNeedsClarification(validated, source.content))
      throw new BadRequestException(
        'INTAKE_MULTIPLE_FACTS_REQUIRE_CLARIFICATION',
      );
    const previous = await transaction.nutritionIntakeRecord.findUnique({
      where: { sourceMessageId: messageId },
    });
    if (previous) {
      if (previous.userId !== userId)
        throw new BadRequestException('INTAKE_OWNERSHIP_MISMATCH');
      return previous;
    }
    const target =
      validated.action !== 'ADD' && validated.targetRecordId
        ? await transaction.nutritionIntakeRecord.findFirst({
            where: {
              id: validated.targetRecordId,
              userId,
              voidedAt: null,
              sourceMessage: { conversationId: source.conversationId },
              reportedAt: { lte: source.timestamp },
            },
          })
        : null;
    if (validated.action !== 'ADD' && !target)
      throw new BadRequestException('INTAKE_REVISION_REFERENCE_REQUIRED');
    if (target) {
      await transaction.$queryRaw`SELECT "id" FROM "nutrition_intake_records" WHERE "id" = ${target.id} FOR UPDATE`;
      const active = await transaction.nutritionIntakeRecord.findUniqueOrThrow({
        where: { id: target.id },
      });
      if (active.voidedAt)
        throw new BadRequestException('INTAKE_ALREADY_REVISED');
      if (validated.kind !== 'VOID' && validated.kind !== target.kind)
        throw new BadRequestException('INTAKE_REVISION_KIND_MISMATCH');
    }
    const timezone = this.clock.timezone(
      source.conversation.user.preferences?.timezone,
    );
    const today = this.clock.localDayRange(source.timestamp, timezone);
    // Yesterday uses the preceding local day, including DST changes, not 24h subtraction.
    const occurredAt =
      target?.occurredAt ??
      (validated.date
        ? this.clock.localDayRange(
            new Date(`${validated.date}T12:00:00Z`),
            timezone,
          ).start
        : validated.day === 'YESTERDAY'
          ? this.clock.localDayRange(
              new Date(today.start.getTime() - 1),
              timezone,
            ).start
          : source.timestamp);
    if (occurredAt > source.timestamp)
      throw new BadRequestException('INTAKE_FUTURE_DATE');
    let mealId: string | null = null;
    if (validated.kind === 'MEAL') {
      const binding =
        typeof evidence === 'object' &&
        evidence !== null &&
        !Array.isArray(evidence)
          ? (evidence as Record<string, unknown>)
          : {};
      const linkedMessageId =
        typeof binding.linkedMessageId === 'string'
          ? binding.linkedMessageId
          : null;
      const linked =
        linkedMessageId || source.replyToExternalMessageId
          ? await transaction.meal.findMany({
              where: {
                userId,
                conversationId: source.conversationId,
                OR: [
                  ...(linkedMessageId
                    ? [
                        {
                          message: {
                            is: {
                              id: linkedMessageId,
                              conversationId: source.conversationId,
                              timestamp: { lte: source.timestamp },
                            },
                          },
                        },
                      ]
                    : []),
                  ...(source.replyToExternalMessageId
                    ? [
                        {
                          message: {
                            is: {
                              externalMessageId:
                                source.replyToExternalMessageId,
                              timestamp: { lte: source.timestamp },
                            },
                          },
                        },
                        {
                          analysis: {
                            is: {
                              outboundMessage: {
                                is: {
                                  externalMessageId:
                                    source.replyToExternalMessageId,
                                  userId,
                                  conversationId: source.conversationId,
                                  status: 'SENT' as const,
                                  sentAt: { lte: source.timestamp },
                                },
                              },
                            },
                          },
                        },
                      ]
                    : []),
                ],
              },
              take: 2,
            })
          : [];
      if (linked.length > 1)
        throw new BadRequestException('INTAKE_REFERENCE_AMBIGUOUS');
      if (linked[0] && !target) mealId = linked[0].id;
      else {
        const meal = await transaction.meal.upsert({
          where: { messageId },
          update: {},
          create: {
            userId,
            conversationId: source.conversationId,
            messageId,
            source: MealSource.TEXT_REPORT,
          },
        });
        if (meal.userId !== userId)
          throw new BadRequestException('INTAKE_MEAL_NOT_OWNED');
        mealId = meal.id;
      }
    }
    const nutrition =
      validated.kind === 'MEAL' && this.plans
        ? await this.plannedNutrition(
            userId,
            occurredAt,
            validated.meal,
            validated.plannedMeal === true,
            validated.items ?? [],
            source.content,
            timezone,
          )
        : null;
    const receipt = await transaction.nutritionIntakeRecord.upsert({
      where: { sourceMessageId: messageId },
      update: {},
      create: {
        userId,
        sourceMessageId: messageId,
        operationKey: `nutrition-intake-v1:${messageId}`,
        kind: validated.kind,
        occurredAt,
        reportedAt: source.timestamp,
        volumeMl: validated.volumeMl,
        mealId,
        supersedesId: target?.id ?? null,
        evidence: {
          ...validated,
          provenance: 'USER_REPORTED',
          timeSource:
            validated.day === 'YESTERDAY' || validated.date
              ? 'DATE_ONLY'
              : 'REPORT_TIMESTAMP',
          nutrition,
        },
      },
    });
    if (receipt.userId !== userId)
      throw new BadRequestException('INTAKE_OWNERSHIP_MISMATCH');
    if (target)
      await transaction.nutritionIntakeRecord.update({
        where: { id: target.id },
        data: { voidedAt: source.timestamp },
      });
    return receipt;
  }

  private async plannedNutrition(
    userId: string,
    at: Date,
    meal: string | undefined,
    whole: boolean,
    portions: readonly { foodQuote: string; quantityQuote: string }[],
    quote: string,
    timezone: string,
  ) {
    if (!meal || meal === 'UNKNOWN') return null;
    const plan = await this.plans!.getApplicableAt(userId, at);
    if (!plan) return null;
    if (plan.userId !== userId)
      throw new BadRequestException('INTAKE_PLAN_NOT_OWNED');
    if (!whole && portions.length) {
      const references =
        plan.implementation === 'LEGACY'
          ? plan.meals.flatMap((entry) =>
              entry.items.map((food) => ({ ...food })),
            )
          : plan.document.days.flatMap((day) =>
              day.meals.flatMap((entry) =>
                entry.items.map((food) => ({
                  foodName: food.foodName,
                  quantity: food.quantity,
                  calories: food.caloriesKcal,
                  protein: food.macros.proteinGrams,
                  carbs: food.macros.carbohydrateGrams,
                  fat: food.macros.fatGrams,
                })),
              ),
            );
      const estimates = portions.map((portion) =>
        recordedPortion(references, portion),
      );
      const sum = (key: 'calories' | 'protein' | 'carbs' | 'fat') =>
        estimates.some((item) => !item || item[key] === null)
          ? null
          : estimates.reduce((total, item) => total + (item?.[key] ?? 0), 0);
      let uncovered = quote;
      for (const portion of portions)
        uncovered = uncovered
          .replace(portion.foodQuote, '')
          .replace(portion.quantityQuote, '');
      const complete =
        uncovered.replace(/\b(e|de)\b|[\s,.;:()]/gu, '').length === 0 &&
        estimates.every((item) => item !== null);
      // Item extraction is auxiliary: never assert complete intake from omitted foods.
      return {
        calories: complete ? sum('calories') : null,
        protein: complete ? sum('protein') : null,
        carbs: complete ? sum('carbs') : null,
        fat: complete ? sum('fat') : null,
        knownPortionCalories: sum('calories'),
        portions: estimates,
        sourcePlanId: plan.id,
        provenance: 'RECORDED_PORTION_ESTIMATE',
        coverage: complete ? 'QUOTED_ITEMS_COMPLETE' : 'PARTIAL',
      };
    }
    if (!whole) return null;
    const parts = this.clock.parts(at, timezone);
    const weekday = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day),
    ).getUTCDay();
    const weekdays = [
      'domingo',
      'segunda',
      'terca',
      'quarta',
      'quinta',
      'sexta',
      'sabado',
    ];
    const days =
      plan.implementation === 'V2'
        ? plan.document.days.filter(
            (day) =>
              day.label
                .normalize('NFD')
                .replace(/\p{M}/gu, '')
                .toLowerCase()
                .replace(/[- ]feira$/u, '')
                .trim() === weekdays[weekday],
          )
        : [];
    const selectedDay =
      plan.implementation === 'V2'
        ? days.length === 1
          ? days[0]
          : plan.document.artifactType === 'DAILY_STRUCTURE' &&
              plan.document.days.length === 1
            ? plan.document.days[0]
            : null
        : null;
    const meals =
      plan.implementation === 'LEGACY'
        ? plan.meals
            .filter(
              (candidate) =>
                (
                  ({
                    BREAKFAST: 'cafe da manha',
                    LUNCH: 'almoco',
                    DINNER: 'jantar',
                    SNACK: 'lanche',
                  }) as Readonly<Record<string, string>>
                )[meal] ===
                candidate.name
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/\p{M}/gu, ''),
            )
            .map((candidate) =>
              candidate.items.map((item) => ({
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                quantity: item.quantity,
              })),
            )
        : selectedDay
          ? selectedDay.meals
              .filter((candidate) => candidate.period === meal)
              .map((candidate) =>
                candidate.items.map((item) => ({
                  calories: item.caloriesKcal,
                  protein: item.macros.proteinGrams,
                  carbs: item.macros.carbohydrateGrams,
                  fat: item.macros.fatGrams,
                  quantity: item.quantity,
                })),
              )
          : [];
    if (
      meals.length !== 1 ||
      !meals[0].length ||
      meals[0].some((item) => !item.quantity.trim())
    )
      return null;
    const items = meals[0];
    const sum = (key: 'calories' | 'protein' | 'carbs' | 'fat') =>
      items.some((item) => item[key] === null)
        ? null
        : items.reduce((total, item) => total + (item[key] ?? 0), 0);
    return {
      calories: sum('calories'),
      protein: sum('protein'),
      carbs: sum('carbs'),
      fat: sum('fat'),
      sourcePlanId: plan.id,
      provenance: 'PLAN_PORTION_ESTIMATE',
      quantities: items.map((item) => item.quantity),
    };
  }

  async water(userId: string, at: Date, timezone?: string | null) {
    const range = this.clock.localDayRange(at, timezone);
    const records = await this.prisma.nutritionIntakeRecord.findMany({
      where: {
        userId,
        OR: [{ voidedAt: null }, { voidedAt: { gt: at } }],
        reportedAt: { lte: at },
        kind: { in: ['WATER_ADD', 'WATER_TOTAL'] },
        occurredAt: { gte: range.start, lt: range.end, lte: at },
      },
      orderBy: [{ reportedAt: 'asc' }, { sourceMessageId: 'asc' }],
    });
    return {
      volumeMl: hydrationTotal(records),
      recordCount: records.length,
      ...range,
    };
  }

  async goal(userId: string, at: Date) {
    return this.prisma.nutritionIntakeRecord.findFirst({
      where: {
        userId,
        kind: 'WATER_GOAL',
        OR: [{ voidedAt: null }, { voidedAt: { gt: at } }],
        reportedAt: { lte: at },
      },
      orderBy: { reportedAt: 'desc' },
      select: { volumeMl: true },
    });
  }

  async waterWeek(userId: string, at: Date, timezone?: string | null) {
    const range = this.clock.localWeekRange(at, timezone);
    const days: {
      date: Date;
      start: Date;
      end: Date;
      volumeMl: number | null;
      recordCount: number;
    }[] = [];
    let day = range.start;
    while (day <= at) {
      const end = this.clock.localDayRange(day, timezone).end;
      days.push({
        date: day,
        ...(await this.water(
          userId,
          new Date(Math.min(at.getTime(), end.getTime() - 1)),
          timezone,
        )),
      });
      day = end;
    }
    return days;
  }

  async hasMeal(
    userId: string,
    meal: 'LUNCH' | 'DINNER',
    at: Date,
    timezone?: string | null,
  ) {
    const range = this.clock.localDayRange(at, timezone);
    return Boolean(
      await this.prisma.nutritionIntakeRecord.findFirst({
        where: {
          userId,
          OR: [{ voidedAt: null }, { voidedAt: { gt: at } }],
          reportedAt: { lte: at },
          kind: 'MEAL',
          occurredAt: { gte: range.start, lt: range.end, lte: at },
          evidence: { path: ['meal'], equals: meal },
        },
      }),
    );
  }
}
