import { AIJobStatus } from '@prisma/client';
import { CoachProactiveRealizerService } from './coach-proactive-realizer.service';

describe('CoachProactiveRealizerService', () => {
  const input = {
    userId: 'user-id',
    operationKey:
      'proactive:user-id:HYDRATION_REMINDER:HYDRATION_MORNING:2026-08-18T13:30:00.000Z',
    preferredName: 'Gildácio',
    intent: 'HYDRATION_CHECK' as const,
    slotKey: 'HYDRATION_MORNING',
    localTime: '10:30',
    goal: 'HEALTH',
    nutritionPlanSummary: null,
    workoutPlanSummary: null,
    trainingTime: null,
    mealTimes: [],
    fallback: 'Oi, Gildácio! Como está sua hidratação hoje?',
  };

  function subject(options?: {
    status?: AIJobStatus;
    outputText?: string;
    createFailure?: boolean;
    providerFailure?: boolean;
    result?: unknown;
  }) {
    const response = {
      responseId: 'response-id',
      model: 'model',
      outputText:
        options?.outputText ??
        JSON.stringify({ text: 'Oi, Gildácio! Como está sua hidratação?' }),
      promptTokens: 10,
      completionTokens: 8,
      totalTokens: 18,
    };
    const aiService = {
      createStandaloneJob: options?.createFailure
        ? jest.fn().mockRejectedValue(new Error('prompt missing'))
        : jest.fn().mockResolvedValue({
            id: 'job-id',
            status: options?.status ?? AIJobStatus.PENDING,
            result: options?.result ?? null,
          }),
      runTextJob: options?.providerFailure
        ? jest.fn().mockRejectedValue(new Error('provider failed'))
        : jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn().mockResolvedValue({}),
      failJob: jest.fn().mockResolvedValue(undefined),
    };
    const transaction = {};
    const prisma = {
      $transaction: jest.fn(
        (callback: (client: typeof transaction) => unknown) =>
          callback(transaction),
      ),
    };
    return {
      service: new CoachProactiveRealizerService(
        prisma as never,
        aiService as never,
      ),
      aiService,
    };
  }

  it('executes exactly once, validates and persists a natural result', async () => {
    const setup = subject();

    await expect(setup.service.realize(input)).resolves.toBe(
      'Oi, Gildácio! Como está sua hidratação?',
    );
    expect(setup.aiService.runTextJob).toHaveBeenCalledTimes(1);
    expect(setup.aiService.completeJobInTransaction).toHaveBeenCalledTimes(1);
    expect(setup.aiService.failJob).not.toHaveBeenCalled();
  });

  it.each([
    ['provider failure', { providerFailure: true }],
    ['invalid output', { outputText: '{"message":"no text"}' }],
    ['missing prompt', { createFailure: true }],
    ['active conflict', { status: AIJobStatus.PROCESSING }],
  ] as const)(
    'uses one deterministic fallback on %s without retry',
    async (_name, options) => {
      const setup = subject(options);

      await expect(setup.service.realize(input)).resolves.toBe(input.fallback);
      expect(setup.aiService.runTextJob).toHaveBeenCalledTimes(
        options.createFailure || options.status === AIJobStatus.PROCESSING
          ? 0
          : 1,
      );
    },
  );

  it('reuses a completed operation with zero additional provider executions', async () => {
    const setup = subject({
      status: AIJobStatus.COMPLETED,
      result: { text: 'Mensagem já persistida' },
    });

    await expect(setup.service.realize(input)).resolves.toBe(
      'Mensagem já persistida',
    );
    expect(setup.aiService.runTextJob).not.toHaveBeenCalled();
  });
});
