import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import { CoachService } from './coach.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import type { CoachProactiveRealizerService } from './coach-proactive-realizer.service';
import type { CurrentWorkoutPlanReaderService } from '../workout/v2/current-workout-plan-reader.service';

describe('CoachService', () => {
  function createSubject() {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'SingulFit',
          fitnessProfile: {
            currentWeightKg: new Prisma.Decimal('70.00'),
            targetWeightKg: new Prisma.Decimal('62.00'),
            goal: 'WEIGHT_LOSS',
          },
          goalClassification: {
            goal: 'WEIGHT_LOSS',
          },
        }),
      },
      workoutPlan: {
        findFirst: jest.fn().mockResolvedValue({
          title: 'Treino personalizado',
          days: [
            {
              dayNumber: 1,
              title: 'Força geral',
              exercises: [
                {
                  exerciseName: 'Agachamento',
                },
                {
                  exerciseName: 'Remada',
                },
              ],
            },
          ],
        }),
      },
      dietPlan: {
        findFirst: jest.fn().mockResolvedValue({
          title: 'Dieta brasileira',
          meals: [
            {
              name: 'Café da manhã',
              caloriesTarget: new Prisma.Decimal('430.00'),
            },
            {
              name: 'Almoço',
              caloriesTarget: new Prisma.Decimal('620.00'),
            },
          ],
        }),
      },
      progressSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            weightKg: new Prisma.Decimal('70.00'),
            insights: [
              {
                insight: 'Você perdeu 2 kg no período.',
              },
            ],
          },
          {
            weightKg: new Prisma.Decimal('72.00'),
            insights: [],
          },
        ]),
      },
      fitnessCheckIn: {
        findFirst: jest.fn().mockResolvedValue({
          adherenceScore: 88,
        }),
      },
      userPreferences: {
        findUnique: jest.fn().mockResolvedValue({
          preferredTrainingTime: '18:00',
          preferredMealTimes: [],
        }),
      },
    };
    const coachIntelligence = {
      generateCoachMessage: jest.fn().mockResolvedValue({
        content: 'Mensagem diária contextualizada',
      }),
      generateReview: jest.fn().mockResolvedValue({
        content: 'Revisão contextualizada',
      }),
    };
    const currentNutritionPlanReader = {
      getCurrent: jest.fn().mockResolvedValue({
        implementation: 'LEGACY',
        title: 'Dieta brasileira',
        meals: [
          { name: 'Café da manhã', caloriesTarget: 430 },
          { name: 'Almoço', caloriesTarget: 620 },
        ],
      }),
    };
    const proactiveRealizer = {
      realize: jest
        .fn()
        .mockImplementation((input: { fallback: string }) =>
          Promise.resolve(input.fallback),
        ),
    };
    const workoutSession = {
      sessionKey: 'session-2',
      sequence: 2,
      label: 'Costas e bíceps',
      estimatedDurationMinutes: 60,
      blocks: [],
    };
    const currentWorkoutPlanReader = {
      read: jest.fn().mockResolvedValue({
        status: 'AVAILABLE',
        plan: {
          document: { title: 'Plano V2' },
        },
      }),
      select: jest.fn().mockReturnValue({
        kind: 'SESSION',
        session: workoutSession,
      }),
    };
    const service = new CoachService(
      prisma as unknown as PrismaService,
      coachIntelligence as unknown as CoachIntelligenceService,
      currentNutritionPlanReader as unknown as CurrentNutritionPlanReaderService,
      proactiveRealizer as unknown as CoachProactiveRealizerService,
      currentWorkoutPlanReader as unknown as CurrentWorkoutPlanReaderService,
    );

    return {
      service,
      prisma,
      coachIntelligence,
      currentNutritionPlanReader,
      proactiveRealizer,
      currentWorkoutPlanReader,
    };
  }

  it.each(Object.values(AUTOMATION_RULE_CODES))(
    'generates non-empty personalized content for %s',
    async (ruleCode: AutomationRuleCode) => {
      const subject = createSubject();

      await expect(
        subject.service.generateContent(
          'user-id',
          ruleCode,
          new Date('2026-06-08T12:00:00.000Z'),
        ),
      ).resolves.toEqual(expect.any(String));
    },
  );

  it('uses current workout exercises in the daily reminder', async () => {
    const subject = createSubject();

    const content = await subject.service.generateContent(
      'user-id',
      AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      new Date('2026-06-08T12:00:00.000Z'),
    );

    expect(content).toContain('Força geral');
    expect(content).toContain('Agachamento, Remada');
  });

  it('summarizes progress, workout and diet in the weekly message', async () => {
    const subject = createSubject();

    const content = await subject.service.generateContent(
      'user-id',
      AUTOMATION_RULE_CODES.WEEKLY_SUMMARY,
      new Date('2026-06-08T12:00:00.000Z'),
    );

    expect(content).toContain('reduziu 2 kg');
    expect(content).toContain('Você perdeu 2 kg no período.');
    expect(content).toContain('Treino personalizado');
    expect(content).toContain('Dieta brasileira');
  });

  it('uses V2 day, period and suggestedTime without fabricating nullable nutrition', async () => {
    const subject = createSubject();
    subject.currentNutritionPlanReader.getCurrent.mockResolvedValueOnce({
      implementation: 'V2',
      title: 'Plano canônico V2',
      document: {
        days: [
          {
            dayNumber: 1,
            meals: [
              {
                name: 'Café prático',
                period: 'BREAKFAST',
                suggestedTime: '07:30',
                items: [
                  {
                    caloriesKcal: null,
                    macros: {
                      proteinGrams: null,
                      carbohydrateGrams: null,
                      fatGrams: null,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    } as never);

    const content = await subject.service.generateContent(
      'user-id',
      AUTOMATION_RULE_CODES.MEAL_REMINDER,
      new Date('2026-06-08T12:00:00.000Z'),
    );
    expect(content).toContain('Café prático (café da manhã, 07:30)');
    expect(content).not.toContain('0 kcal');
    expect(content).not.toContain('0g');
  });

  it('explicitly defers a V2 meal reminder when no time exists', async () => {
    const subject = createSubject();
    subject.currentNutritionPlanReader.getCurrent.mockResolvedValueOnce({
      implementation: 'V2',
      title: 'Plano sem horários',
      document: {
        days: [
          {
            dayNumber: 1,
            meals: [
              {
                name: 'Refeição flexível',
                period: 'FLEXIBLE',
                suggestedTime: null,
              },
            ],
          },
        ],
      },
    } as never);
    await expect(
      subject.service.generateContent(
        'user-id',
        AUTOMATION_RULE_CODES.MEAL_REMINDER,
        new Date('2026-06-08T12:00:00.000Z'),
      ),
    ).resolves.toContain('fica adiado');
  });

  it('uses the V2 canonical title in the weekly summary', async () => {
    const subject = createSubject();
    subject.currentNutritionPlanReader.getCurrent.mockResolvedValueOnce({
      implementation: 'V2',
      title: 'Plano semanal V2',
      document: { days: [] },
    } as never);
    await expect(
      subject.service.generateContent(
        'user-id',
        AUTOMATION_RULE_CODES.WEEKLY_SUMMARY,
        new Date('2026-06-08T12:00:00.000Z'),
      ),
    ).resolves.toContain('Plano semanal V2');
  });

  it('builds the premium onboarding kickoff with the real user goal', async () => {
    const subject = createSubject();

    const content = await subject.service.generateOnboardingKickoff('user-id');

    expect(content).toContain('Olá SingulFit');
    expect(content).toContain('emagrecimento');
    expect(content).toContain('Pode me contar com suas palavras');
    expect(content).not.toMatch(/\b[123]\./u);
  });

  it('uses the first real name and a fact-safe fallback for proactive hydration', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValueOnce({
      name: 'Gildácio Júnior',
      fitnessProfile: { goal: 'HEALTH' },
      goalClassification: { goal: 'HEALTH' },
    });

    const result = await subject.service.generateProactiveContent('user-id', {
      intent: 'HYDRATION_CHECK',
      slotKey: 'HYDRATION_MORNING',
      ruleCode: AUTOMATION_RULE_CODES.HYDRATION_REMINDER,
      scheduledFor: new Date('2026-08-18T13:30:00.000Z'),
      localTime: '10:30',
    });

    expect(result.content).toBe(
      'Oi, Gildácio! Como está sua hidratação hoje? Quanto você já conseguiu beber?',
    );
    expect(result.content).not.toContain('atleta');
    expect(result.operationKey).toBe(
      'proactive:user-id:HYDRATION_REMINDER:HYDRATION_MORNING:2026-08-18T13:30:00.000Z',
    );
    expect(subject.proactiveRealizer.realize).toHaveBeenCalledWith(
      expect.objectContaining({ preferredName: 'Gildácio' }),
    );
  });

  it('does not claim an active nutrition plan when the canonical reader returns absence', async () => {
    const subject = createSubject();
    subject.currentNutritionPlanReader.getCurrent.mockResolvedValueOnce(null);

    const result = await subject.service.generateProactiveContent('user-id', {
      intent: 'MEAL_PLAN_CHECK',
      slotKey: 'MEAL_PLAN',
      ruleCode: AUTOMATION_RULE_CODES.MEAL_REMINDER,
      scheduledFor: new Date('2026-08-19T17:00:00.000Z'),
      localTime: '14:00',
    });

    expect(result.content).toBe(
      'Oi, SingulFit! Como está sua alimentação hoje?',
    );
    expect(result.content).not.toContain('seu plano');
  });

  it('uses the confirmed Workout V2 session for the proactive workout check', async () => {
    const subject = createSubject();
    const scheduledFor = new Date('2026-08-18T22:00:00.000Z');

    const result = await subject.service.generateProactiveContent('user-id', {
      intent: 'WORKOUT_CHECK',
      slotKey: 'WORKOUT',
      ruleCode: AUTOMATION_RULE_CODES.DAILY_WORKOUT,
      scheduledFor,
      localTime: '19:00',
    });

    expect(result?.content).toBe(
      'Oi, SingulFit! Conseguiu fazer a sessão 2 — Costas e bíceps hoje? Como foi?',
    );
    expect(subject.currentWorkoutPlanReader.select).toHaveBeenCalledWith(
      expect.anything(),
      'hoje',
      scheduledFor,
    );
    expect(subject.proactiveRealizer.realize).toHaveBeenCalledWith(
      expect.objectContaining({
        workoutPlanSummary: 'Sessão 2: Costas e bíceps (60 min)',
      }),
    );
  });

  it.each(['REST_DAY', 'CALENDAR_UNAVAILABLE'] as const)(
    'does not create a proactive workout check for %s',
    async (kind) => {
      const subject = createSubject();
      subject.currentWorkoutPlanReader.select.mockReturnValueOnce({ kind });

      await expect(
        subject.service.generateProactiveContent('user-id', {
          intent: 'WORKOUT_CHECK',
          slotKey: 'WORKOUT',
          ruleCode: AUTOMATION_RULE_CODES.DAILY_WORKOUT,
          scheduledFor: new Date('2026-08-18T22:00:00.000Z'),
          localTime: '19:00',
        }),
      ).resolves.toBeNull();
      expect(subject.proactiveRealizer.realize).not.toHaveBeenCalled();
    },
  );
});
