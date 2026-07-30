import type { Prisma } from '@prisma/client';
import type { OpenAIJsonSchema } from '../../ai/interfaces/openai.interface';
import type { NutritionConversationalArtifactType } from './nutrition-conversational-artifact.contract';

const textArray = Object.freeze({ type: 'array', items: { type: 'string' } });
const base = (
  artifactType: NutritionConversationalArtifactType,
  properties: Prisma.InputJsonObject,
  required: readonly string[],
): OpenAIJsonSchema => ({
  name: `nutrition_${artifactType.toLowerCase()}_v1`,
  description: `Artifact nutricional conversacional ${artifactType}.`,
  schema: {
    type: 'object',
    properties: {
      artifactType: { type: 'string', enum: [artifactType] },
      title: { type: 'string' },
      summary: { type: 'string' },
      ...properties,
    },
    required: ['artifactType', 'title', 'summary', ...required],
    additionalProperties: false,
  },
});

export const NUTRITION_POINT_GUIDANCE_V1_PROMPT = Object.freeze({
  name: 'nutrition_point_guidance_v1',
  version: 1,
  capability: 'NUTRITION_PLANNING_V2',
  model: 'TEXT' as const,
  instructions:
    'Produza orientação nutricional pontual baseada somente no contexto fornecido. Não crie plano, dias, refeições estruturadas ou lineage. Retorne somente JSON válido.',
  schema: Object.freeze(
    base(
      'POINT_GUIDANCE',
      {
        guidance: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            rationale: textArray,
            actionableSteps: textArray,
            cautions: textArray,
          },
          required: ['answer', 'rationale', 'actionableSteps', 'cautions'],
          additionalProperties: false,
        },
      },
      ['guidance'],
    ),
  ),
});

export const NUTRITION_MEAL_SUGGESTION_V1_PROMPT = Object.freeze({
  name: 'nutrition_meal_suggestion_v1',
  version: 1,
  capability: 'NUTRITION_PLANNING_V2',
  model: 'TEXT' as const,
  instructions:
    'Produza uma sugestão isolada de refeição baseada somente no contexto fornecido. Valores nutricionais são estimativas. Não altere plano ativo. Retorne somente JSON válido.',
  schema: Object.freeze(
    base(
      'MEAL_SUGGESTION',
      {
        meal: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            mealType: { type: ['string', 'null'] },
            description: { type: 'string' },
            items: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: ['number', 'null'], minimum: 0 },
                  unit: { type: ['string', 'null'] },
                  preparationNotes: { type: ['string', 'null'] },
                },
                required: ['name', 'quantity', 'unit', 'preparationNotes'],
                additionalProperties: false,
              },
            },
            estimatedNutrition: {
              type: 'object',
              properties: {
                caloriesKcal: { type: ['number', 'null'], minimum: 0 },
                proteinGrams: { type: ['number', 'null'], minimum: 0 },
                carbohydrateGrams: { type: ['number', 'null'], minimum: 0 },
                fatGrams: { type: ['number', 'null'], minimum: 0 },
              },
              required: [
                'caloriesKcal',
                'proteinGrams',
                'carbohydrateGrams',
                'fatGrams',
              ],
              additionalProperties: false,
            },
            alternatives: textArray,
          },
          required: [
            'name',
            'mealType',
            'description',
            'items',
            'estimatedNutrition',
            'alternatives',
          ],
          additionalProperties: false,
        },
      },
      ['meal'],
    ),
  ),
});

export const NUTRITION_PLAN_REVIEW_V1_PROMPT = Object.freeze({
  name: 'nutrition_plan_review_v1',
  version: 1,
  capability: 'NUTRITION_PLANNING_V2',
  model: 'TEXT' as const,
  instructions:
    'Revise exclusivamente o plano canônico fornecido. Não altere o plano e não invente sua identidade. O ID é inserido deterministicamente pelo sistema. Retorne somente JSON válido.',
  schema: Object.freeze(
    base(
      'PLAN_REVIEW',
      {
        review: {
          type: 'object',
          properties: {
            overallAssessment: { type: 'string' },
            strengths: textArray,
            concerns: textArray,
            recommendations: textArray,
          },
          required: [
            'overallAssessment',
            'strengths',
            'concerns',
            'recommendations',
          ],
          additionalProperties: false,
        },
      },
      ['review'],
    ),
  ),
});

export const NUTRITION_CONVERSATIONAL_PROMPTS = Object.freeze([
  NUTRITION_POINT_GUIDANCE_V1_PROMPT,
  NUTRITION_MEAL_SUGGESTION_V1_PROMPT,
  NUTRITION_PLAN_REVIEW_V1_PROMPT,
]);

export function conversationalPrompt(
  type: NutritionConversationalArtifactType,
) {
  if (type === 'POINT_GUIDANCE') return NUTRITION_POINT_GUIDANCE_V1_PROMPT;
  if (type === 'MEAL_SUGGESTION') return NUTRITION_MEAL_SUGGESTION_V1_PROMPT;
  return NUTRITION_PLAN_REVIEW_V1_PROMPT;
}
