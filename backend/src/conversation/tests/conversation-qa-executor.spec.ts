import { AIJobStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import { COACH_CONVERSATIONAL_QA_V1_PROMPT_SEED } from '../runtime/coach-conversational-qa.prompt.definition';

describe('ConversationQAExecutorService', () => {
  it('stores the full OpenAI JSON Schema wrapper in the prompt seed', () => {
    expect(COACH_CONVERSATIONAL_QA_V1_PROMPT_SEED.schema).toMatchObject({
      name: 'coach_conversational_qa_v1',
      schema: expect.objectContaining({ type: 'object' }),
    });
  });

  const publicPlan: PublicNutritionResponse = Object.freeze({
    title: 'Seu plano alimentar',
    summary: 'Plano atual',
    goal: 'emagrecimento',
    energyTargetKcal: 2440,
    macroTargets: Object.freeze({ proteinGrams: 118 }),
    days: Object.freeze([
      Object.freeze({
        meals: Object.freeze([
          Object.freeze({
            name: 'Jantar',
            time: '20:00',
            items: Object.freeze([
              Object.freeze({ name: 'Arroz', quantity: '5 colheres' }),
            ]),
          }),
        ]),
      }),
    ]),
    substitutions: Object.freeze([
      Object.freeze({ source: 'Arroz', alternative: 'Macarrão' }),
    ]),
    hydrationGuidance: Object.freeze(['Beba água ao longo do dia.']),
    generalGuidance: Object.freeze([]),
    adaptationGuidance: Object.freeze([]),
    safetyGuidance: Object.freeze([]),
  });

  function human(
    message: string,
    recentConversation: CoachConversationHumanContext['recentConversation'] = Object.freeze(
      [],
    ),
  ): CoachConversationHumanContext {
    return {
      currentMessage: message,
      turnCue: 'COMMON',
      preferredName: null,
      goal: null,
      desiredOutcome: null,
      routine: {
        trainingTime: null,
        mealTimes: null,
        cookingAvailability: null,
        mealsAwayFromHome: null,
      },
      training: { modality: null, experience: null },
      nutrition: {
        dietaryPattern: null,
        preferredFoods: null,
        rejectedFoods: null,
      },
      restrictions: null,
      communication: {
        style: null,
        coachingStyle: null,
        tone: null,
        motivation: null,
        messagePreference: 'BALANCED',
        journeyStage: null,
      },
      memory: Object.freeze([]),
      recentConversation,
      continuity: null,
      progress: null,
      currentPlans: { diet: null, workout: null },
    };
  }

  function route(kind: 'ANSWER_MESSAGE' | 'NUTRITION_GUIDANCE') {
    return {
      kind,
      operation: 'PROVIDE_GUIDANCE',
    } as ConversationExecutionRoute;
  }

  function createSubject(output: object, status = AIJobStatus.PENDING) {
    const response = {
      responseId: 'provider-response',
      model: 'model',
      outputText: JSON.stringify(output),
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    };
    const ai = {
      createJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status,
        result: status === AIJobStatus.COMPLETED ? output : null,
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
      failPendingJob: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: AIJobStatus.COMPLETED,
        result: output,
      }),
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (transaction: object) => unknown) =>
          callback({}),
        ),
    };
    const currentNutrition = {
      read: jest.fn().mockResolvedValue({
        status: 'AVAILABLE',
        plan: publicPlan,
      }),
    };
    return {
      service: new ConversationQAExecutorService(
        ai as never,
        prisma as never,
        currentNutrition as never,
        new ConversationPublicAnswerBoundaryService(),
      ),
      ai,
      prisma,
      currentNutrition,
    };
  }

  const cases = [
    {
      message: 'Quanto é a medida de uma colher de sopa?',
      answer:
        'Uma colher de sopa padrão tem aproximadamente 15 mL. Em gramas, o valor varia conforme o alimento e o preparo.',
      grounding: 'GENERAL_KNOWLEDGE',
    },
    {
      message: 'Qual o volume aproximado de uma colher grande de cozinha?',
      answer:
        'Como referência geral, uma colher de sopa tem cerca de 15 mL; o peso depende da densidade do ingrediente.',
      grounding: 'GENERAL_KNOWLEDGE',
    },
    {
      message: 'Quantos litros de água preciso tomar por dia?',
      answer:
        'A necessidade de água varia com corpo, clima e atividade. Use sede e cor da urina como referências gerais e procure orientação profissional se houver condição de saúde.',
      grounding: 'MIXED',
    },
    {
      message:
        'Na dieta que você montou, quanto seriam 5 colheres de arroz em gramas?',
      answer:
        'Seu plano registra 5 colheres de arroz. A conversão para gramas é aproximada porque depende do tamanho da colher e do preparo.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Qual é minha meta de proteína?',
      answer: 'Sua meta atual no plano é 118 g de proteína por dia.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Qual era mesmo meu jantar?',
      answer: 'Seu jantar atual está previsto para 20:00 e inclui arroz.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Posso trocar arroz por macarrão?',
      answer:
        'Sim. Seu plano atual registra macarrão como troca possível para o arroz.',
      grounding: 'CURRENT_PLAN',
    },
    {
      message: 'Não gostei do atum. Posso trocar por quê?',
      answer:
        'Não encontrei atum no seu plano atual. Posso dar opções gerais, mas preciso saber em qual refeição você pretende usá-lo.',
      grounding: 'MIXED',
    },
    {
      message: 'Por que você colocou 4 refeições?',
      answer:
        'A distribuição das refeições segue o contexto usado no plano atual e pode ajudar a organizar sua rotina.',
      grounding: 'MIXED',
    },
    {
      message: 'Posso inverter almoço e jantar?',
      answer:
        'Como orientação pontual, a inversão pode ser considerada se quantidades e restrições forem respeitadas; isso não altera seu plano salvo.',
      grounding: 'CURRENT_PLAN',
    },
  ] as const;

  it.each(cases)(
    'answers read-only category with one provider execution: $message',
    async ({ message, answer, grounding }) => {
      const subject = createSubject({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer,
        followUpQuestion: null,
        grounding,
        confidence: 'HIGH',
      });

      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('NUTRITION_GUIDANCE'),
          humanContext: human(message),
        }),
      ).resolves.toMatchObject({ status: 'COMPLETED', content: answer });

      expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
      expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
      const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
      const providerTimeout = subject.ai.runTextJob.mock.calls[0][1].timeoutMs;
      expect(providerInput).toContain('118');
      expect(providerInput).toContain('Macarrão');
      expect(providerInput).not.toMatch(
        /job-id|provider-response|operationKey|correlationId|NUTRITION_V2/iu,
      );
      expect(providerTimeout).toBeGreaterThanOrEqual(1_000);
      expect(providerTimeout).toBeLessThan(25_000);
    },
  );

  it.each([
    [
      'Na minha dieta, quanto dão 5 colheres desse arroz em gramas?',
      'E se fossem 3?',
    ],
    ['Posso trocar arroz por macarrão?', 'Essa troca muda muito as calorias?'],
    [
      'A quantidade foi definida pelo seu plano atual.',
      'Por que você colocou isso?',
    ],
  ])(
    'sends bounded public recent context for reference resolution',
    async (previous, current) => {
      const subject = createSubject({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer: 'Resposta contextual.',
        followUpQuestion: null,
        grounding: 'RECENT_CONTEXT',
        confidence: 'HIGH',
      });

      await subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(
          current,
          Object.freeze([{ direction: 'USER', text: previous }]),
        ),
      });

      const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
      expect(providerInput).toContain(previous);
      expect(providerInput).toContain(current);
      expect(providerInput).toContain('recentConversation');
      expect(providerInput).not.toMatch(/user-id|conversation-id|message-id/u);
    },
  );

  it('reuses a completed answer without another provider execution', async () => {
    const candidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta persistida.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };
    const subject = createSubject(candidate, AIJobStatus.COMPLETED);

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta repetida?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Resposta persistida.',
      observability: { answerSource: 'AI_REUSED' },
    });
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });

  it('joins and reuses the answer from the concurrent executor that won the claim', async () => {
    const candidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta oficial do vencedor.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };
    const subject = createSubject(candidate);
    subject.ai.runTextJob.mockRejectedValueOnce(
      new ConflictException('Job de IA já processado ou em andamento'),
    );

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta duplicada?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Resposta oficial do vencedor.',
      observability: { answerSource: 'AI_REUSED' },
    });
    expect(subject.ai.failJob).not.toHaveBeenCalled();
    expect(subject.ai.getJob).toHaveBeenCalledWith('job-id');
  });

  it('executes one provider call and gives concurrent duplicates the winner content', async () => {
    const candidate = {
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta oficial bem-sucedida.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    };
    const response = {
      responseId: 'provider-response',
      model: 'model',
      outputText: JSON.stringify(candidate),
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    };
    let jobStatus: AIJobStatus = AIJobStatus.PENDING;
    let storedResult: object | null = null;
    let providerCalls = 0;
    let releaseProvider: (() => void) | undefined;
    let announceProviderStart: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      announceProviderStart = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const ai = {
      createJob: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: 'job-id',
          status: AIJobStatus.PENDING,
          result: null,
        }),
      ),
      runTextJob: jest.fn().mockImplementation(async () => {
        if (jobStatus === AIJobStatus.PROCESSING) {
          throw new ConflictException('Job em andamento');
        }
        jobStatus = AIJobStatus.PROCESSING;
        providerCalls += 1;
        announceProviderStart?.();
        await providerRelease;
        return response;
      }),
      completeJobInTransaction: jest.fn().mockImplementation(() => {
        storedResult = candidate;
        jobStatus = AIJobStatus.COMPLETED;
        return Promise.resolve();
      }),
      failJob: jest.fn().mockResolvedValue(undefined),
      failPendingJob: jest.fn().mockResolvedValue(undefined),
      getJob: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ status: jobStatus, result: storedResult }),
        ),
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (transaction: object) => unknown) =>
          callback({}),
        ),
    };
    const currentNutrition = {
      read: jest.fn().mockResolvedValue({ status: 'ABSENT', plan: null }),
    };
    const service = new ConversationQAExecutorService(
      ai as never,
      prisma as never,
      currentNutrition as never,
      new ConversationPublicAnswerBoundaryService(),
    );
    const input = {
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('ANSWER_MESSAGE'),
      humanContext: human('Quanto é uma colher de sopa?'),
      deadlineAtMs: Date.now() + 10_000,
    };

    const winner = service.execute(input);
    await providerStarted;
    const duplicate = service.execute(input);
    releaseProvider?.();
    const results = await Promise.all([winner, duplicate]);
    const officialResponses = new Map<string, string>();
    for (const result of results) {
      if (result.status === 'COMPLETED') {
        officialResponses.set(input.messageId, result.content);
      }
    }

    expect(providerCalls).toBe(1);
    expect(results).toEqual([
      expect.objectContaining({
        status: 'COMPLETED',
        content: 'Resposta oficial bem-sucedida.',
      }),
      expect.objectContaining({
        status: 'COMPLETED',
        content: 'Resposta oficial bem-sucedida.',
      }),
    ]);
    expect(officialResponses).toEqual(
      new Map([['message-id', 'Resposta oficial bem-sucedida.']]),
    );
    expect(ai.failJob).not.toHaveBeenCalled();
  });

  it('contains completion failures and records the provider usage on failure', async () => {
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'Resposta segura.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    });
    subject.ai.completeJobInTransaction.mockRejectedValueOnce(
      new Error('transaction failed'),
    );

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'AI_JOB_COMPLETION_FAILED',
    });
    const failure = subject.ai.failJob.mock.calls[0];
    expect(failure[0]).toBe('job-id');
    expect(failure[1]).toBeInstanceOf(Error);
    expect(failure[2]).toEqual(expect.objectContaining({ totalTokens: 30 }));
  });

  it('fails closed before creating a job when the runtime budget is too small', async () => {
    const subject = createSubject({});

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
        deadlineAtMs: Date.now() + 3_000,
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'INSUFFICIENT_RUNTIME_BUDGET',
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });

  it('finishes provider timeout through the normal failed-job path before runtime deadline', async () => {
    const subject = createSubject({});
    subject.ai.runTextJob.mockRejectedValueOnce(new Error('provider timeout'));
    const runtimeBudgetMs = 6_000;

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
        deadlineAtMs: Date.now() + runtimeBudgetMs,
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'PROVIDER_EXECUTION_FAILED',
    });
    const request = subject.ai.runTextJob.mock.calls[0][1];
    expect(request.timeoutMs).toBeLessThanOrEqual(runtimeBudgetMs - 2_500);
    expect(subject.ai.failJob).toHaveBeenCalledTimes(1);
    expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
  });

  it('defers a persistent modification without producing public content', async () => {
    const subject = createSubject({
      disposition: 'DEFER_TO_SIDE_EFFECT_PIPELINE',
      domain: 'NUTRITION',
      answer: null,
      followUpQuestion: null,
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(
          'Troque meu almoço com meu jantar no meu plano daqui para frente.',
        ),
      }),
    ).resolves.toMatchObject({ status: 'DEFERRED' });
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
  });

  it('rejects internal output instead of exposing a corrupted line', async () => {
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'GENERAL',
      answer: 'operationKey 123 não deve aparecer.',
      followUpQuestion: null,
      grounding: 'GENERAL_KNOWLEDGE',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Pergunta'),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'PUBLIC_BOUNDARY_REJECTED',
    });
  });
});
