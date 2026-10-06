import { AIJobStatus, AIJobType } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import type { OpenAIGateway } from '../../ai/openai.gateway';
import { AIService } from '../../ai/ai.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import { ConversationNutritionDeterministicAnswerService } from '../runtime/conversation-nutrition-deterministic-answer.service';
import type { PersonalizedCoachContextService } from '../runtime/personalized-coach-context.service';
import type { CoachConversationHumanContext } from '../../context/coach-conversation-human-context.contract';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import type { ConversationExecutionRoute } from '../contracts/conversation-execution-route.contract';
import {
  COACH_CONVERSATIONAL_QA_V1_PROMPT,
  COACH_CONVERSATIONAL_QA_V2_PROMPT_SEED,
} from '../runtime/coach-conversational-qa.prompt.definition';

describe('ConversationQAExecutorService', () => {
  it('prepares prompt version 2 with the compatible name and full schema wrapper', () => {
    expect(COACH_CONVERSATIONAL_QA_V1_PROMPT.version).toBe(1);
    expect(COACH_CONVERSATIONAL_QA_V2_PROMPT_SEED).toMatchObject({
      name: 'coach_conversational_qa_v1',
      version: 2,
      schema: {
        name: 'coach_conversational_qa_v1',
        schema: expect.objectContaining({ type: 'object' }),
      },
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

  function createSubject(
    output: object,
    status: AIJobStatus = AIJobStatus.PENDING,
    deterministicNutrition = false,
    personalized?: PersonalizedCoachContextService,
    correctionGateway?: OpenAIGateway,
  ) {
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
        userId: 'user-id',
        status,
        result: status === AIJobStatus.COMPLETED ? output : null,
        promptVersion: { prompt: 'Existing QA instructions' },
      }),
      runTextJob: jest.fn().mockResolvedValue(response),
      completeJobInTransaction: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
      failPendingJob: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue({
        id: 'job-id',
        userId: 'user-id',
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
        deterministicNutrition
          ? new ConversationNutritionDeterministicAnswerService()
          : undefined,
        personalized,
        correctionGateway,
      ),
      ai,
      prisma,
      currentNutrition,
    };
  }

  it.each([AIJobStatus.PENDING, AIJobStatus.COMPLETED, AIJobStatus.PROCESSING])(
    'validates personalized assertions before exposing fresh, stored or joined answers: %s',
    async (status) => {
      const personalized = {
        build: jest
          .fn()
          .mockResolvedValue({ policy: { noExpenditureSource: true } }),
        answer: jest.fn().mockReturnValue(null),
        validatesAnswer: jest.fn().mockReturnValue(false),
      };
      const subject = createSubject(
        {
          disposition: 'ANSWER',
          domain: 'PROGRESS',
          answer: 'Você queimou 600 kcal.',
          followUpQuestion: null,
          grounding: 'PROFILE',
          confidence: 'HIGH',
        },
        status,
        false,
        personalized as unknown as PersonalizedCoachContextService,
      );
      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('ANSWER_MESSAGE'),
          humanContext: human('Como estou indo?'),
        }),
      ).resolves.toMatchObject({
        status: 'FAILED',
        reason: 'UNSUPPORTED_PERSONAL_ASSERTION',
      });
      expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      expect(personalized.validatesAnswer).toHaveBeenCalled();
    },
  );
  it('fails closed on personalized ownership failure before creating an AI job', async () => {
    const personalized = {
      build: jest.fn().mockRejectedValue(new Error('ownership')),
    };
    const subject = createSubject(
      {},
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Qual meu objetivo?'),
      }),
    ).resolves.toMatchObject({
      status: 'FAILED',
      reason: 'PERSONALIZED_CONTEXT_UNAVAILABLE',
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
  });
  it('answers a confirmed profile read without the provider or any job write', async () => {
    const personalized = {
      build: jest.fn().mockResolvedValue({}),
      answer: jest.fn().mockReturnValue('Seu objetivo é emagrecimento.'),
    };
    const subject = createSubject(
      {},
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Qual meu objetivo?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Seu objetivo é emagrecimento.',
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });
  it('sends the authorized personal context to reasoning QA instead of unverified human history', async () => {
    const context = {
      identity: { preferredName: 'Gildacio' },
      goals: { training: 'emagrecimento' },
      training: { perceivedConditioning: 'iniciante' },
      safety: { physicalLimitations: 'joelho' },
      recentConversation: [],
    };
    const personalized = {
      build: jest.fn().mockResolvedValue(context),
      answer: jest.fn().mockReturnValue(null),
      validatesAnswer: jest.fn().mockReturnValue(true),
    };
    const subject = createSubject(
      {
        disposition: 'ANSWER',
        domain: 'WORKOUT',
        answer: 'Vamos considerar seu objetivo e suas limitações.',
        followUpQuestion: null,
        grounding: 'PROFILE',
        confidence: 'HIGH',
      },
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human('Para mim é melhor caminhar ou correr?', [
          { direction: 'USER', text: 'unverified foreign history' },
        ]),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    const payload = JSON.parse(
      subject.ai.runTextJob.mock.calls[0][1].input,
    ) as { trustedContext: unknown };
    expect(payload.trustedContext).toEqual(context);
    expect(JSON.stringify(payload)).not.toContain('unverified foreign history');
  });

  it('answers canonical nutrition facts without creating or running an AI job', async () => {
    const subject = createSubject({}, AIJobStatus.PENDING, true);

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Qual é minha meta de proteína?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: 'Sua meta diária no plano é 118 g de proteína.',
      observability: {
        answerSource: 'DETERMINISTIC_FALLBACK',
        totalTokens: 0,
      },
    });
    expect(subject.ai.createJob).not.toHaveBeenCalled();
    expect(subject.ai.runTextJob).not.toHaveBeenCalled();
  });
  it('uses one bounded authorized personalized history when the unified window is absent', async () => {
    const personalized = {
      build: jest.fn().mockResolvedValue({
        recentConversation: [
          { direction: 'INBOUND', text: 'Me dá uma ideia de jantar' },
          { direction: 'OUTBOUND', text: 'Uma opção de jantar é sopa.' },
        ],
      }),
      answer: jest.fn().mockReturnValue(null),
      validatesAnswer: jest.fn().mockReturnValue(true),
    };
    const s = createSubject(
      {
        disposition: 'ANSWER',
        domain: 'GENERAL',
        answer: 'Posso ajudar com isso.',
        followUpQuestion: null,
        grounding: 'RECENT_CONTEXT',
        confidence: 'HIGH',
      },
      AIJobStatus.PENDING,
      false,
      personalized as unknown as PersonalizedCoachContextService,
    );
    await s.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('ANSWER_MESSAGE'),
      humanContext: human('Pode explicar?'),
    });
    const payload: unknown = JSON.parse(
      s.ai.runTextJob.mock.calls[0][1].input as string,
    );
    expect(payload).toMatchObject({
      trustedContext: { recentConversation: [] },
      recentConversation: [
        { direction: 'USER', text: 'Me dá uma ideia de jantar', origin: null },
        {
          direction: 'COACH',
          text: 'Uma opção de jantar é sopa.',
          origin: null,
        },
      ],
    });
    expect(
      (s.ai.runTextJob.mock.calls[0][1].input as string).split(
        'Uma opção de jantar é sopa.',
      ),
    ).toHaveLength(2);
  });

  describe('contextual meal advice', () => {
    describe('bounded corrective recovery', () => {
      const repeated = 'Iogurte natural com banana e aveia.';
      const candidate = (answer: string) => ({
        disposition: 'ANSWER',
        domain: 'NUTRITION',
        answer,
        followUpQuestion: null,
        grounding: 'MIXED',
        confidence: 'HIGH',
      });
      function recovery(
        first = repeated,
        second = 'Uma opção diferente é pão integral com frango desfiado.',
      ) {
        const gateway = {
          createTextResponse: jest.fn().mockResolvedValue({
            responseId: 'correction',
            model: 'model',
            outputText: JSON.stringify(candidate(second)),
            promptTokens: 25,
            completionTokens: 15,
            totalTokens: 40,
          }),
        };
        const subject = createSubject(
          candidate(first),
          AIJobStatus.PENDING,
          true,
          undefined,
          gateway as unknown as OpenAIGateway,
        );
        subject.currentNutrition.read.mockResolvedValue({
          status: 'AVAILABLE',
          plan: {
            ...publicPlan,
            days: [
              {
                meals: [
                  {
                    name: 'Lanche da tarde',
                    time: '16:00',
                    items: [
                      { name: 'Iogurte natural', quantity: '1 pote' },
                      { name: 'Banana', quantity: '1 unidade' },
                      { name: 'Aveia', quantity: '1 colher' },
                    ],
                  },
                ],
              },
            ],
          },
        });
        const request = {
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('NUTRITION_GUIDANCE'),
          humanContext: human('Me dê uma dica de lanche da tarde'),
          referenceDate: new Date('2026-10-05T18:00:00Z'),
          deadlineAtMs: Date.now() + 25_000,
        };
        const stored: {
          id: string;
          userId: string;
          type: AIJobType;
          status: AIJobStatus;
          result: unknown;
          error?: string;
        } = {
          id: 'job-id',
          userId: 'user-id',
          type: AIJobType.TEXT,
          status: AIJobStatus.PROCESSING,
          result: null,
        };
        const usage = {
          recordInTransaction: jest.fn().mockResolvedValue(undefined),
        };
        const usageReservations = {
          reverseInTransaction: jest.fn().mockResolvedValue(undefined),
        };
        const transaction = {
          aIJob: {
            findUnique: jest
              .fn()
              .mockImplementation(() => Promise.resolve(stored)),
            update: jest
              .fn()
              .mockImplementation(
                (input: { data: { status: AIJobStatus; error: string } }) => {
                  Object.assign(stored, input.data);
                  return Promise.resolve(stored);
                },
              ),
          },
        };
        const failureAI = new AIService(
          {
            $transaction: (execute: (tx: object) => Promise<void>) =>
              execute(transaction),
          } as never,
          {} as never,
          gateway as unknown as OpenAIGateway,
          usage as never,
          {} as never,
          usageReservations as never,
          {} as never,
          {} as never,
        );
        subject.ai.failJob.mockImplementation(
          failureAI.failJob.bind(failureAI),
        );
        subject.ai.completeJobInTransaction.mockImplementation(
          (
            _tx: object,
            input: {
              result: unknown;
              response: {
                totalTokens: number;
                promptTokens: number;
                completionTokens: number;
              };
            },
          ) => {
            stored.status = AIJobStatus.COMPLETED;
            stored.result = input.result;
            usage.recordInTransaction(_tx, {
              aiJobId: stored.id,
              ...input.response,
            });
          },
        );
        return { ...subject, gateway, request, stored, usage, failureAI };
      }
      it('corrects the production snack copy once within the original deadline and job', async () => {
        const s = recovery();
        const result = await s.service.execute(s.request);
        expect(result).toMatchObject({
          status: 'COMPLETED',
          content: 'Uma opção diferente é pão integral com frango desfiado.',
          observability: {
            nutritionAdviceInitialViolation:
              'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
            nutritionAdviceRetryAttempted: true,
            nutritionAdviceRetryOutcome: 'RECOVERED',
            totalTokens: 70,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.gateway.createTextResponse.mock.calls[0][0]).toMatchObject({
          instructions: 'Existing QA instructions',
          requestId: 'job-id:nutrition-advice-correction:1',
        });
        const call = s.gateway.createTextResponse.mock.calls[0][0] as {
          input: string;
          timeoutMs: number;
        };
        expect(JSON.parse(call.input) as unknown).toMatchObject({
          nutritionAdviceCorrection: {
            originalViolation: 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
            correctiveAttempt: 1,
          },
        });
        expect(call.timeoutMs).toBeLessThanOrEqual(22_500);
        expect(s.ai.createJob).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
        expect(s.ai.failJob).not.toHaveBeenCalled();
        expect(s.stored.status).toBe(AIJobStatus.COMPLETED);
        expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it('clarifies safely when the only corrective candidate still repeats', async () => {
        const s = recovery(repeated, repeated);
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
          content: 'Que alimentos você tem disponíveis para uma alternativa?',
          observability: {
            disposition: 'CLARIFY',
            answerSource: 'DETERMINISTIC_FALLBACK',
            nutritionAdviceRetryOutcome: 'FAILED',
            totalTokens: 70,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.ai.failJob).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).not.toHaveBeenCalled();
        expect(s.stored).toMatchObject({
          status: AIJobStatus.FAILED,
          result: null,
          error: 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
        });
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
        expect(s.usage.recordInTransaction).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            promptTokens: 45,
            completionTokens: 25,
            totalTokens: 70,
          }),
        );
        await s.failureAI.failJob('job-id', new Error('duplicate failure'), {
          responseId: 'duplicate',
          model: 'model',
          outputText: '',
          promptTokens: 45,
          completionTokens: 25,
          totalTokens: 70,
        });
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it('does not call the corrective provider for an initially valid answer', async () => {
        const s = recovery('Pão integral com frango desfiado.');
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
        });
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
        expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(s.stored.status).toBe(AIJobStatus.COMPLETED);
      });
      it('does not retry safety violations', async () => {
        const s = recovery('Uma opção é pasta de amendoim.');
        s.request.humanContext = {
          ...s.request.humanContext,
          restrictions: { value: ['amendoim'], sources: [] },
        };
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'FAILED',
        });
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
      });
      it('does not retry without the remaining provider budget', async () => {
        const s = recovery();
        const baseTime = Date.now();
        let clockTime = baseTime;
        s.ai.runTextJob.mockImplementation(() => {
          clockTime = baseTime + 24_000;
          return Promise.resolve({
            responseId: 'first',
            model: 'model',
            outputText: JSON.stringify(candidate(repeated)),
            promptTokens: 20,
            completionTokens: 10,
            totalTokens: 30,
          });
        });
        const now = jest.spyOn(Date, 'now').mockImplementation(() => clockTime);
        try {
          expect(await s.service.execute(s.request)).toMatchObject({
            status: 'COMPLETED',
            observability: {
              nutritionAdviceInitialViolation:
                'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
              nutritionAdviceRetryAttempted: false,
              disposition: 'CLARIFY',
              fallbackReason: 'INSUFFICIENT_RUNTIME_BUDGET',
              totalTokens: 30,
            },
          });
          expect(s.ai.runTextJob).toHaveBeenCalledTimes(1);
          expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
          expect(s.stored.status).toBe(AIJobStatus.FAILED);
          expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
        } finally {
          now.mockRestore();
        }
      });
      it('does not retry provider failures', async () => {
        const s = recovery();
        s.ai.runTextJob.mockRejectedValue(new Error('Provider unavailable'));
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'FAILED',
          reason: 'PROVIDER_EXECUTION_FAILED',
        });
        expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
      });
      it('revalidates food safety on the corrective candidate', async () => {
        const s = recovery(repeated, 'Uma opção é pasta de amendoim.');
        s.request.humanContext = {
          ...s.request.humanContext,
          restrictions: { value: ['amendoim'], sources: [] },
        };
        expect(await s.service.execute(s.request)).toMatchObject({
          status: 'COMPLETED',
          content: 'Que alimentos você tem disponíveis para uma alternativa?',
          observability: {
            nutritionAdviceRetryAttempted: true,
            nutritionAdviceRetryOutcome: 'FAILED',
            disposition: 'CLARIFY',
            fallbackReason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
            totalTokens: 70,
          },
        });
        expect(s.gateway.createTextResponse).toHaveBeenCalledTimes(1);
        expect(s.ai.completeJobInTransaction).not.toHaveBeenCalled();
        expect(s.stored).toMatchObject({
          status: AIJobStatus.FAILED,
          result: null,
          error: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        expect(s.usage.recordInTransaction).toHaveBeenCalledTimes(1);
      });
      it.each(['ownership', 'database', 'stored', 'joining'])(
        'does not start corrective recovery for %s',
        async (mode) => {
          const s = recovery();
          if (mode === 'ownership')
            s.ai.createJob.mockResolvedValue({
              id: 'job-id',
              userId: 'foreign',
              status: AIJobStatus.PENDING,
            });
          if (mode === 'database')
            s.ai.createJob.mockRejectedValue(new Error('Database unavailable'));
          if (mode === 'stored')
            s.ai.createJob.mockResolvedValue({
              id: 'job-id',
              userId: 'user-id',
              status: AIJobStatus.COMPLETED,
              result: candidate(repeated),
            });
          if (mode === 'joining') {
            s.ai.createJob.mockResolvedValue({
              id: 'job-id',
              userId: 'user-id',
              status: AIJobStatus.PROCESSING,
            });
            s.ai.getJob.mockResolvedValue({
              id: 'job-id',
              userId: 'user-id',
              status: AIJobStatus.COMPLETED,
              result: candidate(repeated),
            });
          }
          expect(await s.service.execute(s.request)).toMatchObject({
            status: 'FAILED',
          });
          expect(s.ai.runTextJob).not.toHaveBeenCalled();
          expect(s.gateway.createTextResponse).not.toHaveBeenCalled();
        },
      );
    });
    const snackPlan: PublicNutritionResponse = Object.freeze({
      ...publicPlan,
      days: Object.freeze([
        {
          meals: Object.freeze([
            {
              name: 'Lanche da tarde',
              time: '16:00',
              items: Object.freeze([
                { name: 'Macarrão cozido', quantity: '2 pratos pequenos' },
                { name: 'Peito de frango grelhado', quantity: '100 g' },
                { name: 'Feijão cozido', quantity: '1 concha pequena' },
              ]),
            },
          ]),
        },
      ]),
    });
    const option = (answer: string) => ({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });
    const input = (message: string) => ({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human(message),
      referenceDate: new Date('2026-10-05T18:00:00Z'),
    });

    it('keeps an explicit snack lookup faithful to the canonical meal', async () => {
      const subject = createSubject({}, AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: snackPlan,
      });
      const result = await subject.service.execute(
        input('Qual meu lanche da tarde?'),
      );
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: { answerSource: 'DETERMINISTIC_FALLBACK' },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected plan lookup');
      for (const item of snackPlan.days[0].meals[0].items)
        expect(result.content).toContain(item.name);
      expect(subject.ai.runTextJob).not.toHaveBeenCalled();
    });

    it.each([
      ['Me dê uma dica para lanche da tarde', 'NUTRITION_ADVICE', []],
      [
        'O que posso comer no lugar do meu lanche da tarde?',
        'MEAL_SUBSTITUTION',
        [],
      ],
      [
        'Quero um lanche rápido e proteico',
        'CONSTRAINED_RECOMMENDATION',
        ['QUICK', 'HIGH_PROTEIN'],
      ],
      ['Me sugira algo sem lactose', 'CONSTRAINED_RECOMMENDATION', ['LACTOSE']],
    ] as const)(
      'sends %s to the existing QA with meal context and no plan mutation',
      async (message, intent, constraints) => {
        const before = JSON.stringify(snackPlan);
        const subject = createSubject(
          option('Uma opção prática é pão integral com ovos e uma fruta.'),
          AIJobStatus.PENDING,
          true,
        );
        subject.currentNutrition.read.mockResolvedValue({
          status: 'AVAILABLE',
          plan: snackPlan,
        });
        const result = await subject.service.execute(input(message));
        expect(result).toMatchObject({
          status: 'COMPLETED',
          observability: { answerSource: 'AI' },
        });
        const payload: unknown = JSON.parse(
          subject.ai.runTextJob.mock.calls[0][1].input as string,
        );
        expect(payload).toMatchObject({
          nutritionGuidance: {
            intent,
            immediateConstraints: constraints,
            safetyConstraints: constraints.filter((code) => code === 'LACTOSE'),
            originalMeals: [
              {
                name: 'Lanche da tarde',
                items: snackPlan.days[0].meals[0].items,
              },
            ],
            policy: {
              readOnly: true,
              currentPlanRole: 'CONTEXT_NOT_ANSWER',
              preserveApproximateNutritionalFunction:
                intent === 'MEAL_SUBSTITUTION',
            },
          },
        });
        expect(subject.ai.completeJobInTransaction).toHaveBeenCalledTimes(1);
        // The executor receives no plan repository or generator; its only write is AI completion.
        expect(Object.keys(subject.prisma)).toEqual(['$transaction']);
        expect(JSON.stringify(snackPlan)).toBe(before);
      },
    );

    it.each([
      AIJobStatus.PENDING,
      AIJobStatus.COMPLETED,
      AIJobStatus.PROCESSING,
    ])(
      'rejects mechanical canonical meal copies on fresh, stored and joined answers: %s',
      async (status) => {
        const subject = createSubject(
          option('Macarrão cozido com frango grelhado e feijão cozido.'),
          status,
          true,
        );
        subject.currentNutrition.read.mockResolvedValue({
          status: 'AVAILABLE',
          plan: snackPlan,
        });
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it('allows a canonical ingredient in a different combination', async () => {
      const subject = createSubject(
        option('Você pode preparar um sanduíche de frango com tomate.'),
        AIJobStatus.PENDING,
        true,
      );
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: snackPlan,
      });
      await expect(
        subject.service.execute(input('Me dê uma dica para lanche da tarde')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it.each([
      AIJobStatus.PENDING,
      AIJobStatus.COMPLETED,
      AIJobStatus.PROCESSING,
    ])(
      'blocks explicit lactose-incompatible advice before exposing any answer: %s',
      async (status) => {
        const subject = createSubject(
          option('Experimente iogurte natural com fruta.'),
          status,
          true,
        );
        await expect(
          subject.service.execute(input('Me sugira algo sem lactose')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['amendoim', 'Experimente uma fruta com pasta de amendoim.'],
      ['leite', 'Experimente iogurte sem lactose.'],
      ['kiwi', 'Experimente kiwi com aveia.'],
    ])(
      'honors the existing personalized allergy projection: %s',
      async (allergy, answer) => {
        const context = {
          safety: {
            allergies: { status: 'KNOWN', value: [{ description: allergy }] },
          },
          nutrition: {},
        };
        const personalized = {
          build: jest.fn().mockResolvedValue(context),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        const payload: unknown = JSON.parse(
          subject.ai.runTextJob.mock.calls[0][1].input as string,
        );
        expect(payload).toMatchObject({
          nutritionGuidance: { safetyConstraints: [allergy] },
          trustedContext: context,
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['vegano', 'Uma opção é frango com tomate.'],
      ['VEGAN', 'Uma opção é ovos com tomate.'],
      ['vegetariano', 'Uma opção é peixe com tomate.'],
      ['sem glúten', 'Uma opção é pão integral com ovos.'],
    ])(
      'blocks advice incompatible with an existing dietary restriction: %s',
      async (restriction, answer) => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            safety: {
              foodRestrictions: {
                status: 'KNOWN',
                value: [{ description: restriction }],
              },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({
          status: 'FAILED',
          reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
        });
        expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['ovo', 'Uma nova opção é fruta com aveia.', 'COMPLETED'],
      ['ovo', 'Uma opção é ovos mexidos.', 'FAILED'],
      [
        'pasta de amendoim',
        'Uma opção é PASTA DE AMENDOIM com fruta.',
        'FAILED',
      ],
      ['maçã', 'Uma opção é MACAS com aveia.', 'FAILED'],
      ['ovo', 'Uma opção é um novelo de conversa sobre frutas.', 'COMPLETED'],
    ] as const)(
      'matches rejected food %s using normalized whole terms: %s',
      async (food, answer, status) => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            nutrition: {
              declaredFoodRejections: { status: 'KNOWN', value: [food] },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({ status });
      },
    );

    it.each([
      [
        'uva',
        'Uma nova opção para um dia de chuva é fruta com aveia.',
        'COMPLETED',
      ],
      ['uva', 'Uma opção é uvas com aveia.', 'FAILED'],
      ['fruta do conde', 'Uma opção é FRUTA DO CONDE.', 'FAILED'],
      ['fruta do conde', 'Uma opção é fruta com aveia.', 'COMPLETED'],
    ] as const)(
      'matches custom restriction %s using normalized whole terms: %s',
      async (food, answer, status) => {
        const personalized = {
          build: jest.fn().mockResolvedValue({
            safety: {
              allergies: { status: 'KNOWN', value: [{ description: food }] },
            },
          }),
          answer: jest.fn().mockReturnValue(null),
          validatesAnswer: jest.fn().mockReturnValue(true),
        };
        const subject = createSubject(
          option(answer),
          AIJobStatus.PENDING,
          true,
          personalized as unknown as PersonalizedCoachContextService,
        );
        await expect(
          subject.service.execute(input('Me dê uma dica para lanche da tarde')),
        ).resolves.toMatchObject({ status });
      },
    );

    it('accepts compatible advice with goal, preferences and allergy context intact', async () => {
      const context = {
        goals: { nutrition: { status: 'KNOWN', value: 'WEIGHT_LOSS' } },
        safety: {
          allergies: { status: 'KNOWN', value: [{ description: 'amendoim' }] },
        },
        nutrition: {
          declaredFoodRejections: { status: 'KNOWN', value: ['frango'] },
          cookingAvailability: { status: 'KNOWN', value: 'LIMITED' },
        },
        preferences: {
          foodPreferences: {
            status: 'KNOWN',
            value: [{ kind: 'ACCEPTED', foodName: 'aveia' }],
          },
        },
      };
      const personalized = {
        build: jest.fn().mockResolvedValue(context),
        answer: jest.fn().mockReturnValue(null),
        validatesAnswer: jest.fn().mockReturnValue(true),
      };
      const subject = createSubject(
        option('Uma opção rápida é fruta com aveia e bebida vegetal.'),
        AIJobStatus.PENDING,
        true,
        personalized as unknown as PersonalizedCoachContextService,
      );
      await expect(
        subject.service.execute(input('Me dê uma dica para lanche da tarde')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      const payload: unknown = JSON.parse(
        subject.ai.runTextJob.mock.calls[0][1].input as string,
      );
      expect(payload).toMatchObject({
        trustedContext: context,
        nutritionGuidance: {
          excludedFoods: ['frango'],
          safetyConstraints: ['amendoim'],
        },
      });
    });

    it('asks one useful question for conflicting allergies before model execution', async () => {
      const personalized = {
        build: jest.fn().mockResolvedValue({
          safety: {
            allergies: {
              status: 'REQUIRES_CONFIRMATION',
              value: [{ description: 'amendoim' }],
            },
          },
          profileFields: [
            { field: 'ALLERGIES', status: 'CONFLICTED', value: null },
          ],
        }),
        answer: jest.fn().mockReturnValue(null),
        validatesAnswer: jest.fn().mockReturnValue(true),
      };
      const subject = createSubject(
        {},
        AIJobStatus.PENDING,
        true,
        personalized as unknown as PersonalizedCoachContextService,
      );
      const result = await subject.service.execute(
        input('Me dê uma dica para lanche da tarde'),
      );
      expect(result).toMatchObject({
        status: 'COMPLETED',
        observability: { disposition: 'CLARIFY' },
      });
      if (result.status !== 'COMPLETED')
        throw new Error('Expected clarification');
      expect(result.content.match(/\?/gu)).toHaveLength(1);
      expect(subject.ai.createJob).not.toHaveBeenCalled();
    });

    it('asks about an unknown original meal before proposing an equivalent substitution', async () => {
      const subject = createSubject({}, AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'ABSENT',
        plan: null,
      });
      await expect(
        subject.service.execute(
          input('O que posso comer no lugar do meu lanche da tarde?'),
        ),
      ).resolves.toMatchObject({
        status: 'COMPLETED',
        observability: { disposition: 'CLARIFY' },
      });
      expect(subject.ai.createJob).not.toHaveBeenCalled();
    });

    it('does not let a clarification conceal an incompatible suggestion', async () => {
      const subject = createSubject(
        {
          ...option('Experimente iogurte natural.'),
          disposition: 'CLARIFY',
          followUpQuestion: 'Você tem fruta em casa?',
        },
        AIJobStatus.PENDING,
        true,
      );
      await expect(
        subject.service.execute(input('Me sugira algo sem lactose')),
      ).resolves.toMatchObject({
        status: 'FAILED',
        reason: 'NUTRITION_ADVICE_UNSAFE_FOOD',
      });
    });

    it('allows explicitly lactose-free dairy when no milk allergy is present', async () => {
      const subject = createSubject(
        option('Uma opção é iogurte sem lactose com fruta.'),
        AIJobStatus.PENDING,
        true,
      );
      await expect(
        subject.service.execute(input('Me sugira algo sem lactose')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('uses recent suggestions to support variety on consecutive requests', async () => {
      const first = 'Uma opção é um sanduíche de ovos com tomate.';
      const second = 'Outra ideia é uma fruta com aveia e bebida vegetal.';
      const subject = createSubject(option(first), AIJobStatus.PENDING, true);
      subject.currentNutrition.read.mockResolvedValue({
        status: 'AVAILABLE',
        plan: snackPlan,
      });
      await expect(
        subject.service.execute(input('Me dê uma dica para lanche da tarde')),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      subject.ai.runTextJob.mockResolvedValue({
        responseId: 'second',
        model: 'model',
        outputText: JSON.stringify(option(second)),
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
      });
      await expect(
        subject.service.execute({
          ...input('Me sugira algo diferente para comer agora'),
          messageId: 'second-message',
          humanContext: human('Me sugira algo diferente para comer agora', [
            { direction: 'COACH', text: first },
          ]),
        }),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      const payload: unknown = JSON.parse(
        subject.ai.runTextJob.mock.calls[1][1].input as string,
      );
      expect(payload).toMatchObject({
        nutritionGuidance: { recentSuggestions: [first] },
      });
      expect(subject.ai.runTextJob).toHaveBeenCalledTimes(2);
    });
  });

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

  it('keeps a short hydration answer public while retaining internal grounding', async () => {
    const answer =
      'A necessidade varia com seu corpo, clima e atividade. Sede e cor da urina ajudam como referências gerais.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('Quantos litros de água por dia?'),
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content: answer,
      observability: { grounding: 'MIXED' },
    });
    expect(answer.length).toBeLessThanOrEqual(350);
    expect(answer).not.toMatch(/can[oô]nic|\*\*|runtime|pipeline/iu);
  });

  it('preserves the requested rice quantity without repeating unrelated foods', async () => {
    const answer =
      '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: 'Quer que eu converta isso para gramas?',
      grounding: 'CURRENT_PLAN',
      confidence: 'HIGH',
    });
    subject.currentNutrition.read.mockResolvedValueOnce({
      status: 'AVAILABLE',
      plan: {
        ...publicPlan,
        days: Object.freeze([
          Object.freeze({
            meals: Object.freeze([
              Object.freeze({
                name: 'Almoço',
                items: Object.freeze([
                  Object.freeze({
                    name: 'Arroz branco cozido',
                    quantity: '3 xícaras cozidas',
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      },
    });

    const result = await subject.service.execute({
      userId: 'user-id',
      conversationId: 'conversation-id',
      messageId: 'message-id',
      route: route('NUTRITION_GUIDANCE'),
      humanContext: human('Quanto de arroz eu tenho no almoço?'),
    });

    expect(result).toMatchObject({
      status: 'COMPLETED',
      content: `${answer}\n\nQuer que eu converta isso para gramas?`,
    });
    expect(result.status === 'COMPLETED' && result.content).toContain(
      '3 xícaras cozidas',
    );
    const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
    expect(providerInput).toContain('3 xícaras cozidas');
    expect(result.status === 'COMPLETED' && result.content).not.toContain(
      'Feijão',
    );
  });

  it('persists the production candidate with its trailing offer structured and unchanged publicly', async () => {
    const publicContent =
      'No almoço, você tem *3 xícaras de arroz branco cozido* 🍚\n\nSe quiser, eu também posso te passar isso em gramas aproximadas.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer: publicContent,
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
        humanContext: human('Quanto arroz eu tenho no almoço?'),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', content: publicContent });

    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
    expect(subject.ai.completeJobInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        result: expect.objectContaining({
          answer: 'No almoço, você tem *3 xícaras de arroz branco cozido* 🍚',
          followUpQuestion:
            'Se quiser, eu também posso te passar isso em gramas aproximadas.',
        }),
      }),
    );
  });

  it('uses a previous coach follow-up for one read-only provider continuation', async () => {
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer: 'As 3 xícaras equivalem aproximadamente a 480 g de arroz cozido.',
      followUpQuestion: null,
      grounding: 'RECENT_CONTEXT',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('ANSWER_MESSAGE'),
        humanContext: human(
          'Sim',
          Object.freeze([
            {
              direction: 'COACH',
              text: 'Quer que eu converta isso para gramas?',
            },
          ]),
        ),
        previousAnswer:
          '🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*.',
        previousFollowUpQuestion: 'Quer que eu converta isso para gramas?',
      }),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      content:
        'As 3 xícaras equivalem aproximadamente a 480 g de arroz cozido.',
    });
    expect(subject.ai.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: AIJobType.TEXT }),
    );
    expect(subject.ai.createJob).toHaveBeenCalledTimes(1);
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
    const providerInput = subject.ai.runTextJob.mock.calls[0][1].input;
    expect(providerInput).toContain(
      '"previousFollowUpQuestion":"Quer que eu converta isso para gramas?"',
    );
    expect(providerInput).toContain(
      '"previousAnswer":"🍚 No almoço, seu plano tem *arroz branco cozido: 3 xícaras cozidas*."',
    );
    expect(providerInput).toContain('"request":"Sim"');
  });

  it('answers only the requested approximate referent', async () => {
    const answer =
      'As 3 xícaras de arroz cozido equivalem aproximadamente a 480 g.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'RECENT_CONTEXT',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human('E em gramas, aproximadamente quanto seria isso?'),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', content: answer });
    expect(answer).not.toMatch(/feij[aã]o|frango/iu);
  });

  it('keeps a lighter-lunch suggestion concise, read-only and bounded to three bullets', async () => {
    const answer =
      'Para deixar o almoço mais leve hoje:\n- reduza um pouco o arroz;\n- mantenha a proteína;\n- aumente salada ou legumes.';
    const subject = createSubject({
      disposition: 'ANSWER',
      domain: 'NUTRITION',
      answer,
      followUpQuestion: null,
      grounding: 'MIXED',
      confidence: 'HIGH',
    });

    await expect(
      subject.service.execute({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        route: route('NUTRITION_GUIDANCE'),
        humanContext: human(
          'O que posso ajustar no almoço hoje para ficar mais leve?',
        ),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED', content: answer });
    expect(answer.length).toBeLessThanOrEqual(650);
    expect(answer.match(/^[-•]\s+/gmu)).toHaveLength(3);
    expect(subject.ai.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: AIJobType.TEXT }),
    );
    expect(subject.ai.runTextJob).toHaveBeenCalledTimes(1);
  });

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

  it('normalizes a legacy completed candidate without another provider execution', async () => {
    const publicContent =
      'Resposta persistida.\n\nQuer que eu converta isso para gramas?';
    const subject = createSubject(
      {
        disposition: 'ANSWER',
        domain: 'GENERAL',
        answer: publicContent,
        followUpQuestion: null,
        grounding: 'GENERAL_KNOWLEDGE',
        confidence: 'HIGH',
      },
      AIJobStatus.COMPLETED,
    );

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
      content: publicContent,
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
  it.each([AIJobStatus.COMPLETED, AIJobStatus.PROCESSING])(
    'rejects a foreign job returned by a mock: %s',
    async (status) => {
      const subject = createSubject(
        {
          disposition: 'ANSWER',
          domain: 'GENERAL',
          answer: 'Foreign answer',
          followUpQuestion: null,
          grounding: 'PROFILE',
          confidence: 'HIGH',
        },
        status,
      );
      if (status === AIJobStatus.COMPLETED)
        subject.ai.createJob.mockResolvedValue({
          id: 'job-id',
          status,
          userId: 'other',
          result: {},
        });
      else
        subject.ai.getJob.mockResolvedValue({
          id: 'job-id',
          status: AIJobStatus.COMPLETED,
          userId: 'other',
          result: {},
        });
      await expect(
        subject.service.execute({
          userId: 'user-id',
          conversationId: 'conversation-id',
          messageId: 'message-id',
          route: route('ANSWER_MESSAGE'),
          humanContext: human('Qual meu objetivo?'),
        }),
      ).resolves.toMatchObject({
        status: 'FAILED',
        reason: 'AI_JOB_OWNERSHIP_MISMATCH',
      });
      expect(subject.ai.runTextJob).not.toHaveBeenCalled();
      expect(subject.ai.completeJobInTransaction).not.toHaveBeenCalled();
    },
  );
});
