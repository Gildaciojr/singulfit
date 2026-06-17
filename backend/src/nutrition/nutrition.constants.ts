export const NUTRITION_VISION_PROMPT_NAME = 'nutrition_vision_brazilian_meal';

export const NUTRITION_VISION_SCHEMA_NAME = 'nutrition_analysis';

export const NUTRITION_VISION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    foods: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        properties: {
          foodName: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },
          estimatedGrams: {
            type: 'number',
            minimum: 0,
          },
          calories: {
            type: 'number',
            minimum: 0,
          },
          protein: {
            type: 'number',
            minimum: 0,
          },
          carbs: {
            type: 'number',
            minimum: 0,
          },
          fat: {
            type: 'number',
            minimum: 0,
          },
          fiber: {
            type: 'number',
            minimum: 0,
          },
          sugar: {
            type: 'number',
            minimum: 0,
          },
          isUltraProcessed: {
            type: 'boolean',
          },
          isVegetable: {
            type: 'boolean',
          },
        },
        required: [
          'foodName',
          'estimatedGrams',
          'calories',
          'protein',
          'carbs',
          'fat',
          'fiber',
          'sugar',
          'isUltraProcessed',
          'isVegetable',
        ],
        additionalProperties: false,
      },
    },
    totalCalories: {
      type: 'number',
      minimum: 0,
    },
    protein: {
      type: 'number',
      minimum: 0,
    },
    carbs: {
      type: 'number',
      minimum: 0,
    },
    fat: {
      type: 'number',
      minimum: 0,
    },
    fiber: {
      type: 'number',
      minimum: 0,
    },
    sugar: {
      type: 'number',
      minimum: 0,
    },
    ultraProcessedRatio: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    vegetableGrams: {
      type: 'number',
      minimum: 0,
    },
    hydrationMl: {
      type: 'number',
      minimum: 0,
    },
    mealCategory: {
      type: 'string',
      enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'UNKNOWN'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
  required: [
    'foods',
    'totalCalories',
    'protein',
    'carbs',
    'fat',
    'fiber',
    'sugar',
    'ultraProcessedRatio',
    'vegetableGrams',
    'hydrationMl',
    'mealCategory',
    'confidence',
  ],
  additionalProperties: false,
};
