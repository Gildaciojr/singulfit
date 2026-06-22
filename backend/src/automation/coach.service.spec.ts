import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTOMATION_RULE_CODES,
  AutomationRuleCode,
} from './automation.constants';
import { CoachService } from './coach.service';
import { CoachIntelligenceService } from './coach-intelligence.service';

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
    const service = new CoachService(
      prisma as unknown as PrismaService,
      coachIntelligence as unknown as CoachIntelligenceService,
    );

    return {
      service,
      prisma,
      coachIntelligence,
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
});
