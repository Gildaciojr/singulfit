import { AIJobType } from '@prisma/client';
import type { PendingAIJobCompletion } from './pending-ai-job-completion.contract';

describe('PendingAIJobCompletion', () => {
  const response = Object.freeze({
    responseId: 'response-id',
    model: 'model',
    outputText: '{}',
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
  });

  it('gives Nutrition and Workout the same explicit completion boundary', () => {
    const nutrition = Object.freeze({
      userId: 'user-id',
      aiJobId: 'nutrition-job-id',
      jobType: AIJobType.DIET,
      response,
      result: { candidateOutput: '{}', model: 'model' },
    }) satisfies PendingAIJobCompletion<
      typeof AIJobType.DIET,
      { candidateOutput: string; model: string }
    >;
    const workout = Object.freeze({
      userId: 'user-id',
      aiJobId: 'workout-job-id',
      jobType: AIJobType.WORKOUT,
      response,
      result: { candidateOutput: '{}', model: 'model' },
    }) satisfies PendingAIJobCompletion<
      typeof AIJobType.WORKOUT,
      { candidateOutput: string; model: string }
    >;

    expect(Object.keys(nutrition).sort()).toEqual(Object.keys(workout).sort());
    expect(nutrition.jobType).toBe(AIJobType.DIET);
    expect(workout.jobType).toBe(AIJobType.WORKOUT);
  });
});
