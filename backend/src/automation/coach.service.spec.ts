import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import { CoachService } from './coach.service';
import { CoachIntelligenceService } from './coach-intelligence.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';

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
    const service = new CoachService(
      prisma as unknown as PrismaService,
      coachIntelligence as unknown as CoachIntelligenceService,
      currentNutritionPlanReader as unknown as CurrentNutritionPlanReaderService,
    );

    return {
      service,
      prisma,
      coachIntelligence,
      currentNutritionPlanReader,
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
});
