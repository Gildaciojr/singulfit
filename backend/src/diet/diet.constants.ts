import { FitnessGoal } from '@prisma/client';

export const DIET_PROMPT_BY_GOAL: Record<FitnessGoal, string> = {
  [FitnessGoal.WEIGHT_LOSS]: 'diet_generation_weight_loss',
  [FitnessGoal.MUSCLE_GAIN]: 'diet_generation_muscle_gain',
  [FitnessGoal.MAINTENANCE]: 'diet_generation_maintenance',
};

export const DIET_JSON_SCHEMA_NAME = 'personalized_diet_plan';

export const DIET_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },
    dailyCaloriesTarget: {
      type: 'number',
      minimum: 800,
      maximum: 6000,
    },
    proteinTarget: {
      type: 'number',
      minimum: 0,
      maximum: 1000,
    },
    carbsTarget: {
      type: 'number',
      minimum: 0,
      maximum: 1500,
    },
    fatTarget: {
      type: 'number',
      minimum: 0,
      maximum: 500,
    },
    meals: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
          },
          order: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
          },
          caloriesTarget: {
            type: 'number',
            minimum: 0,
            maximum: 3000,
          },
          notes: {
            type: ['string', 'null'],
            maxLength: 1000,
          },
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                foodName: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 200,
                },
                quantity: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 100,
                },
                calories: {
                  type: 'number',
                  minimum: 0,
                  maximum: 2000,
                },
                protein: {
                  type: 'number',
                  minimum: 0,
                  maximum: 500,
                },
                carbs: {
                  type: 'number',
                  minimum: 0,
                  maximum: 500,
                },
                fat: {
                  type: 'number',
                  minimum: 0,
                  maximum: 300,
                },
                substitutionGroup: {
                  type: ['string', 'null'],
                  maxLength: 300,
                },
              },
              required: [
                'foodName',
                'quantity',
                'calories',
                'protein',
                'carbs',
                'fat',
                'substitutionGroup',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'order', 'caloriesTarget', 'notes', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'title',
    'dailyCaloriesTarget',
    'proteinTarget',
    'carbsTarget',
    'fatTarget',
    'meals',
  ],
  additionalProperties: false,
};
