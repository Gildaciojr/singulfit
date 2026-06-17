import { FitnessGoal } from '@prisma/client';

export const WORKOUT_PROMPT_BY_GOAL: Record<FitnessGoal, string> = {
  [FitnessGoal.WEIGHT_LOSS]: 'workout_generation_weight_loss',
  [FitnessGoal.MUSCLE_GAIN]: 'workout_generation_muscle_gain',
  [FitnessGoal.MAINTENANCE]: 'workout_generation_maintenance',
};

export const WORKOUT_JSON_SCHEMA_NAME = 'personalized_workout_plan';

export const WORKOUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    },
    days: {
      type: 'array',
      minItems: 1,
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          dayNumber: {
            type: 'integer',
            minimum: 1,
            maximum: 7,
          },
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
          },
          exercises: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                exerciseName: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 200,
                },
                sets: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 20,
                },
                reps: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 100,
                },
                restSeconds: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 600,
                },
                notes: {
                  type: ['string', 'null'],
                  maxLength: 1000,
                },
              },
              required: [
                'exerciseName',
                'sets',
                'reps',
                'restSeconds',
                'notes',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['dayNumber', 'title', 'exercises'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'days'],
  additionalProperties: false,
};
