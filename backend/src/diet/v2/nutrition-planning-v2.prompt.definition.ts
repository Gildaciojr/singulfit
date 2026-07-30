import type { OpenAIJsonSchema } from '../../ai/interfaces/openai.interface';
import type { Prisma } from '@prisma/client';

const nullableNumber = Object.freeze({ type: ['number', 'null'] });
const macroSchema = Object.freeze({
  type: 'object',
  properties: {
    proteinGrams: nullableNumber,
    carbohydrateGrams: nullableNumber,
    fatGrams: nullableNumber,
  },
  required: ['proteinGrams', 'carbohydrateGrams', 'fatGrams'],
  additionalProperties: false,
});
const foodItemSchema = Object.freeze({
  type: 'object',
  properties: {
    itemKey: { type: 'string' },
    foodName: { type: 'string' },
    role: {
      type: 'string',
      enum: [
        'PROTEIN',
        'CARBOHYDRATE',
        'FAT',
        'VEGETABLE',
        'FRUIT',
        'BEVERAGE',
        'OTHER',
      ],
    },
    quantity: { type: 'string' },
    caloriesKcal: nullableNumber,
    macros: macroSchema,
    allergenTags: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'LACTOSE',
          'MILK',
          'GLUTEN',
          'PEANUT',
          'TREE_NUT',
          'EGG',
          'SOY',
          'FISH',
          'SHELLFISH',
          'VEGETARIAN',
          'VEGAN',
          'CUSTOM',
        ],
      },
    },
    dietaryTags: {
      type: 'array',
      items: { type: 'string', enum: ['VEGETARIAN', 'VEGAN'] },
    },
  },
  required: [
    'itemKey',
    'foodName',
    'role',
    'quantity',
    'caloriesKcal',
    'macros',
    'allergenTags',
    'dietaryTags',
  ],
  additionalProperties: false,
});

export const NUTRITION_PLANNING_V2_PROMPT = Object.freeze({
  name: 'nutrition_planning_v2',
  version: 1,
  capability: 'NUTRITION_PLANNING_V2',
  model: 'TEXT' as const,
  instructions: `Você preenche um artefato nutricional estruturado a partir de um contexto e de uma estratégia já decididos pelo motor SingulFit.
Não altere o tipo de artefato, objetivo, quantidade de dias, quantidade de refeições, horários, restrições, alimentos rejeitados, alvo energético ou macronutrientes definidos na estratégia.
Use somente os fatos presentes no payload. Nunca invente alergias, preferências, histórico, condição clínica ou dado corporal.
Nunca inclua alimento incompatível com appliedConstraintCodes ou excludedFoods. Declare allergenTags e dietaryTags de cada item de forma conservadora.
Quando um número estiver NOT_SET, não crie precisão falsa: use null para calorias e macronutrientes que não possam ser sustentados.
Planos com contexto médico não são autorizados por este prompt. Não diagnostique, trate, prescreva suplemento, medicamento ou promessa de resultado.
Use alimentos comuns e quantidades compreensíveis no Brasil, mantendo praticidade, variedade e equivalência funcional das substituições.
Retorne somente JSON válido no schema solicitado.`,
  schema: Object.freeze({
    name: 'nutrition_plan_v2_candidate',
    description:
      'Candidato estruturado e validável do Nutrition Planning Engine V2.',
    schema: {
      type: 'object',
      properties: {
        artifactType: {
          type: 'string',
          enum: [
            'DAILY_STRUCTURE',
            'WEEKLY_PLAN',
            'PLAN_ADAPTATION',
            'FOOD_SUBSTITUTION',
          ],
        },
        title: { type: 'string' },
        objectiveSummary: { type: 'string' },
        guidance: { type: 'array', items: { type: 'string' } },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dayNumber: { type: 'integer', minimum: 1, maximum: 7 },
              label: { type: 'string' },
              trainingDay: { type: 'boolean' },
              meals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    mealKey: { type: 'string' },
                    name: { type: 'string' },
                    period: {
                      type: 'string',
                      enum: [
                        'BREAKFAST',
                        'MORNING_SNACK',
                        'LUNCH',
                        'AFTERNOON_SNACK',
                        'DINNER',
                        'EVENING_SNACK',
                        'FLEXIBLE',
                      ],
                    },
                    suggestedTime: { type: ['string', 'null'] },
                    items: { type: 'array', items: foodItemSchema },
                    alternatives: { type: 'array', items: foodItemSchema },
                  },
                  required: [
                    'mealKey',
                    'name',
                    'period',
                    'suggestedTime',
                    'items',
                    'alternatives',
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ['dayNumber', 'label', 'trainingDay', 'meals'],
            additionalProperties: false,
          },
        },
        substitutions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              substitutionKey: { type: 'string' },
              sourceItemKey: { type: 'string' },
              alternativeItemKey: { type: 'string' },
              rationaleCode: {
                type: 'string',
                enum: [
                  'EQUIVALENT_ROLE',
                  'PREFERENCE',
                  'AVAILABILITY',
                  'VARIETY',
                ],
              },
            },
            required: [
              'substitutionKey',
              'sourceItemKey',
              'alternativeItemKey',
              'rationaleCode',
            ],
            additionalProperties: false,
          },
        },
        adaptationRules: { type: 'array', items: { type: 'string' } },
        hydrationGuidance: { type: 'array', items: { type: 'string' } },
        safetyNotes: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'artifactType',
        'title',
        'objectiveSummary',
        'guidance',
        'days',
        'substitutions',
        'adaptationRules',
        'hydrationGuidance',
        'safetyNotes',
      ],
      additionalProperties: false,
    },
  } satisfies OpenAIJsonSchema & Prisma.InputJsonObject),
});
