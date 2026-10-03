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
    'Seu pipeline está pronto.',
    'Seu rollout foi concluído.',
    'A persistence está ativa.',
    'Registrei seu treino como concluído.',
    'Troquei seu treino.',
    'Troquei seu exercício.',
    'Alterei seu treino.',
    'Atualizei sua dieta.',
    'Atualizei seu plano.',
    'Mudei sua dieta.',
    'Salvei sua preferência.',
    'Salvei no seu perfil.',
    'Registrei seu treino.',
    'Registrei sua refeição.',
    'Criei seu novo treino.',
    'Montei seu novo plano.',
    'Seu treino foi atualizado.',
    'Sua dieta foi alterada.',
    'Seu plano já foi modificado.',
    'Seu treino está concluído e registrado.',
    'Meta diária concluída.',
    'Treino concluído.',
    'Como você está? Já treinou? Vai comer agora?',
  ])(
    'rejects unsafe outreach %s before acknowledging persistence',
    async (text) => {
      const s = subject({ outputText: JSON.stringify({ text }) });
      expect(await s.service.realize(input)).toBe(input.fallback);
      expect(s.aiService.completeJobInTransaction).not.toHaveBeenCalled();
      expect(s.aiService.failJob).toHaveBeenCalledTimes(1);
      expect(s.aiService.runTextJob).toHaveBeenCalledTimes(1);
      const reused = subject({
        status: AIJobStatus.COMPLETED,
        result: { text },
      });
      expect(await reused.service.realize(input)).toBe(input.fallback);
      expect(reused.aiService.runTextJob).not.toHaveBeenCalled();
      expect(reused.aiService.failJob).not.toHaveBeenCalled();
      expect(reused.aiService.completeJobInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    'Seu treino de hoje está previsto para as 18h.',
    'Hoje você tem treino de pernas.',
    'Seu almoço planejado é arroz, feijão e frango.',
    'Seu plano prevê descanso hoje.',
    'Quer revisar seu treino?',
    'Se quiser, posso te ajudar a ajustar seu treino.',
  ])('accepts legitimate outreach fresh and cached: %s', async (text) => {
    const fresh = subject({ outputText: JSON.stringify({ text }) });
    expect(await fresh.service.realize(input)).toBe(text);
    expect(fresh.aiService.completeJobInTransaction).toHaveBeenCalledTimes(1);
    expect(fresh.aiService.failJob).not.toHaveBeenCalled();
    const cached = subject({ status: AIJobStatus.COMPLETED, result: { text } });
    expect(await cached.service.realize(input)).toBe(text);
    expect(cached.aiService.runTextJob).not.toHaveBeenCalled();
    expect(cached.aiService.completeJobInTransaction).not.toHaveBeenCalled();
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
