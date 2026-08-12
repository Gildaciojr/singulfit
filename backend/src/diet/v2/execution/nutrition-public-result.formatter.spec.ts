import { BadRequestException } from '@nestjs/common';
import { FitnessGoal } from '@prisma/client';
import type { NutritionConversationalArtifactV1 } from '../nutrition-conversational-artifact.contract';
import { NutritionPlanV2Formatter } from '../nutrition-plan-v2.formatter';
import type { NutritionPlanV2 } from '../nutrition-plan-v2.contract';
import type { OperationalNutritionPlanArtifactType } from '../nutrition-planning-artifact.contract';
import type { NutritionExecutionResultV2 } from './nutrition-application-execution.contract';
import { NutritionPublicResultFormatter } from './nutrition-public-result.formatter';

describe('NutritionPublicResultFormatter', () => {
  const formatter = new NutritionPublicResultFormatter(
    new NutritionPlanV2Formatter(),
  );

  function plan(
    artifactType: OperationalNutritionPlanArtifactType,
  ): NutritionPlanV2 {
    const dayCount = artifactType === 'WEEKLY_PLAN' ? 7 : 1;

    return Object.freeze({
      schemaVersion: 2,
      artifactType,
      lifecycleReason: 'CREATION',
      replacesPlanReference: null,
      title: `Plano ${artifactType}`,
      objectiveSummary: 'Alimentação individualizada para manutenção.',
      strategy: Object.freeze({
        schemaVersion: 2,
        artifactType,
        objective: Object.freeze({
          status: 'CONFIRMED',
          value: FitnessGoal.MAINTENANCE,
        }),
        dayCount,
        mealCountPerDay: Object.freeze({ status: 'NOT_SET' }),
        mealSchedule: Object.freeze({ status: 'NOT_SET' }),
        energyTargetKcal: Object.freeze({ status: 'NOT_SET' }),
        energySource: 'NOT_AVAILABLE',
        macroTargets: Object.freeze({ status: 'NOT_SET' }),
        trainingAware: false,
        appliedConstraintCodes: Object.freeze([]),
        excludedFoods: Object.freeze([]),
        preferredFoods: Object.freeze([]),
        variationPolicy: artifactType === 'WEEKLY_PLAN' ? 'WEEKLY' : 'DAILY',
        detailLevel: artifactType === 'WEEKLY_PLAN' ? 'DETAILED' : 'STANDARD',
        factors: Object.freeze(['OBJECTIVE']),
      }),
      guidance: Object.freeze(['Mantenha horários consistentes.']),
      days: Object.freeze(
        Array.from({ length: dayCount }, (_, index) =>
          Object.freeze({
            dayNumber: index + 1,
            label: `Dia ${index + 1}`,
            trainingDay: false,
            meals: Object.freeze([
              Object.freeze({
                mealKey: `meal-${index + 1}`,
                name: 'Café da manhã',
                period: 'BREAKFAST' as const,
                suggestedTime: '08:00',
                items: Object.freeze([
                  Object.freeze({
                    itemKey: `item-${index + 1}`,
                    foodName: 'Aveia',
                    role: 'CARBOHYDRATE' as const,
                    quantity: '40 g',
                    caloriesKcal: 150,
                    macros: Object.freeze({
                      proteinGrams: 5,
                      carbohydrateGrams: 25,
                      fatGrams: 3,
                    }),
                    allergenTags: Object.freeze([]),
                    dietaryTags: Object.freeze([]),
                  }),
                ]),
                alternatives: Object.freeze([]),
              }),
            ]),
          }),
        ),
      ),
      substitutions: Object.freeze([]),
      adaptationRules: Object.freeze([]),
      hydrationGuidance: Object.freeze(['Beba água ao longo do dia.']),
      safetyNotes: Object.freeze([]),
      generation: Object.freeze({
        engineVersion: 2,
        promptVersionId: 'prompt-id',
        aiJobId: 'job-id',
        operationKey: `operation-${artifactType}`,
        model: 'model-id',
        generatedAt: '2026-07-30T12:00:00.000Z',
        reused: false,
      }),
      validation: Object.freeze({
        status: 'VALID',
        issues: Object.freeze([]),
      }),
    });
  }

  function planResult(document: NutritionPlanV2): NutritionExecutionResultV2 {
    return Object.freeze({
      kind: 'PLAN',
      aggregateId: 'aggregate-id',
      artifactType: document.artifactType,
      document,
      aiJobCompleted: true,
      requiresFormatting: true,
      requiresPersistence: true,
    });
  }

  it.each(['DAILY_STRUCTURE', 'WEEKLY_PLAN'] as const)(
    'formats the official %s plan document without reconstructing it',
    (artifactType) => {
      const content = formatter.format(planResult(plan(artifactType)));

      expect(content).toContain('🥗 *Seu plano alimentar*');
      expect(content).toContain('• 40 g — Aveia');
      if (artifactType === 'WEEKLY_PLAN') {
        expect(content).toContain('*Dia 7*');
      } else {
        expect(content).not.toContain('*Dia 1*');
      }
    },
  );

  it.each([
    {
      artifact: Object.freeze({
        schemaVersion: '1.0',
        artifactType: 'POINT_GUIDANCE',
        title: 'Orientação nutricional',
        summary: 'Resumo da orientação.',
        generatedAt: '2026-07-30T12:00:00.000Z',
        guidance: Object.freeze({
          answer: 'Priorize alimentos minimamente processados.',
          rationale: Object.freeze(['Maior densidade nutricional.']),
          actionableSteps: Object.freeze(['Planeje a próxima refeição.']),
          cautions: Object.freeze(['Respeite suas restrições.']),
        }),
      }) satisfies NutritionConversationalArtifactV1,
      expected: 'Priorize alimentos minimamente processados.',
    },
    {
      artifact: Object.freeze({
        schemaVersion: '1.0',
        artifactType: 'MEAL_SUGGESTION',
        title: 'Sugestão de refeição',
        summary: 'Uma opção prática.',
        generatedAt: '2026-07-30T12:00:00.000Z',
        meal: Object.freeze({
          name: 'Iogurte com fruta',
          mealType: 'LANCHE',
          description: 'Combinação simples.',
          items: Object.freeze([
            Object.freeze({
              name: 'Iogurte',
              quantity: 1,
              unit: 'pote',
              preparationNotes: null,
            }),
          ]),
          estimatedNutrition: Object.freeze({
            caloriesKcal: 200,
            proteinGrams: 10,
            carbohydrateGrams: 25,
            fatGrams: 5,
          }),
          alternatives: Object.freeze(['Leite vegetal com fruta']),
        }),
      }) satisfies NutritionConversationalArtifactV1,
      expected: 'Iogurte — 1 pote',
    },
    {
      artifact: Object.freeze({
        schemaVersion: '1.0',
        artifactType: 'PLAN_REVIEW',
        title: 'Revisão do plano',
        summary: 'Revisão concluída.',
        generatedAt: '2026-07-30T12:00:00.000Z',
        reviewedPlanId: 'plan-id',
        review: Object.freeze({
          overallAssessment: 'O plano permanece coerente.',
          strengths: Object.freeze(['Boa distribuição de refeições.']),
          concerns: Object.freeze([]),
          recommendations: Object.freeze(['Manter o acompanhamento.']),
        }),
      }) satisfies NutritionConversationalArtifactV1,
      expected: 'O plano permanece coerente.',
    },
  ])(
    'formats $artifact.artifactType as a public conversation',
    ({ artifact, expected }) => {
      const result: NutritionExecutionResultV2 = Object.freeze({
        kind: 'CONVERSATIONAL_ARTIFACT',
        aggregateId: 'artifact-id',
        artifactType: artifact.artifactType,
        document: artifact,
        aiJobCompleted: true,
        requiresFormatting: true,
        requiresPersistence: true,
      });

      expect(formatter.format(result)).toContain(expected);
    },
  );

  it('rejects CURRENT_PLAN_PRESENTATION because it has no public document', () => {
    const result: NutritionExecutionResultV2 = Object.freeze({
      kind: 'CURRENT_PLAN_PRESENTATION',
      aggregateId: null,
      artifactType: 'CURRENT_PLAN_PRESENTATION',
      document: null,
      aiJobCompleted: false,
      requiresFormatting: false,
      requiresPersistence: false,
    });

    expect(() => formatter.format(result)).toThrow(BadRequestException);
  });
});
