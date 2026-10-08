import { Test, type TestingModule } from '@nestjs/testing';
import { AIJobStatus, Prisma } from '@prisma/client';
import { CurrentNutritionPlanReaderService } from '../../diet/current-nutrition-plan-reader.service';
import { CanonicalNutritionPlanPresenterService } from '../../diet/canonical-nutrition-plan-presenter.service';
import { ConversationCurrentNutritionContextService } from '../runtime/conversation-current-nutrition-context.service';
import { nutritionRequest } from '../understanding/nutrition-request.policy';
import { ConversationModule } from '../conversation.module';
import { ConversationContinuationService } from '../runtime/conversation-continuation.service';
import type { ContinuationReply } from '../runtime/conversation-continuation.contract';
import { continuation } from '../runtime/conversation-continuation.contract';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';
import { ConversationDailyQueryService } from '../runtime/conversation-daily-query.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import { ConversationNutritionDeterministicAnswerService } from '../runtime/conversation-nutrition-deterministic-answer.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationExecutionBridgeService } from '../runtime/conversation-execution-bridge.service';
import { ConversationResponsePayloadBuilder } from '../runtime/conversation-response-payload.builder';
import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import { CoachConversationHumanContextBuilder } from '../../context/coach-conversation-human-context.builder';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';
import { understandingInput } from './conversation-understanding.fixtures';
import {
  goalPreparationInput,
  routingSnapshot,
} from './conversation-routing.fixtures';

describe('Nutrition advice integration (real semantic pipeline, external I/O doubled)', () => {
  let module: TestingModule;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConversationModule],
    }).compile();
  });
  afterAll(() => module.close());

  it.each([
    'Nesse almoço das 12h que você acabou de me mostrar, posso substituir o peito de frango por ovos? Essa substituição está prevista na minha dieta atual? Não quero alterar meu plano, apenas saber.',
    'uai no almoço kkk, posso trocar o frango por ovo ou não?',
  ])(
    'routes the incident substitution inquiry as read-only, not a diet update: %s',
    async (text) => {
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(
          understandingInput(text, { dietAvailable: true, targetPlan: 'DIET' }),
        );
      expect(understanding).toMatchObject({
        domain: 'NUTRITION',
        operation: 'PROVIDE_GUIDANCE',
        intent: 'NUTRITION_QUESTION',
      });
      const decision = module.get(ConversationRoutingDecisionService).decide(
        goalPreparationInput(understanding, {
          snapshot: routingSnapshot({ dietAvailable: true }),
        }),
      );
      expect(decision.executionRoute.kind).toBe('NUTRITION_GUIDANCE');
    },
  );

  const plan: PublicNutritionResponse = {
    title: 'Plano ativo',
    summary: 'Estrutura diária',
    goal: 'emagrecimento',
    days: [
      {
        label: 'Segunda-feira',
        meals: [
          {
            name: 'Lanche da tarde',
            time: '16:00',
            items: [
              { name: 'Macarrão cozido', quantity: '2 pratos pequenos' },
              { name: 'Peito de frango grelhado', quantity: '100 g' },
              { name: 'Feijão cozido', quantity: '1 concha pequena' },
            ],
          },
        ],
      },
    ],
    substitutions: [],
    hydrationGuidance: [],
    generalGuidance: [],
    adaptationGuidance: [],
    safetyGuidance: [],
  };

  it('keeps domain/executor/public answer coherent across workout, calories, dinner, swap, suggestion and workout', async () => {
    const at = new Date('2026-10-08T15:00:00Z');
    const decimal = (value: number) => new Prisma.Decimal(value);
    const row = {
      id: 'diet',
      userId: 'user-id',
      profileId: 'profile',
      aiJobId: 'old-diet-job',
      title: 'Plano ativo',
      status: 'ACTIVE',
      objective: 'WEIGHT_LOSS',
      generatedAt: at,
      createdAt: at,
      updatedAt: at,
      dailyCaloriesTarget: decimal(2200),
      proteinTarget: decimal(130),
      carbsTarget: decimal(270),
      fatTarget: decimal(65),
      meals: [
        {
          id: 'dinner',
          name: 'Jantar',
          order: 1,
          caloriesTarget: decimal(600),
          notes: null,
          items: [
            {
              id: 'chicken',
              foodName: 'Filé de frango',
              quantity: '120 g',
              calories: decimal(200),
              protein: decimal(30),
              carbs: decimal(0),
              fat: decimal(5),
              substitutionGroup: null,
            },
          ],
        },
      ],
    };
    const jobs = new Map<
      string,
      { id: string; userId: string; status: AIJobStatus; result: unknown }
    >();
    const io = {
      nutritionPlanOwnership: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-id',
          implementation: 'LEGACY',
          planId: 'diet',
          profileId: 'profile',
        }),
      },
      dietPlan: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn(),
        create: jest.fn(),
      },
      userPreferences: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-id',
          timezone: 'America/Sao_Paulo',
        }),
      },
      $transaction: jest.fn((run: (tx: object) => Promise<unknown>) => run({})),
    };
    const reader = new CurrentNutritionPlanReaderService(
      io as never,
      {} as never,
    );
    const current = new ConversationCurrentNutritionContextService(
      reader,
      new CanonicalNutritionPlanPresenterService(),
    );
    const ai = {
      createJob: jest.fn((request: { messageId: string; userId: string }) => {
        if (jobs.has(request.messageId))
          return Promise.resolve(jobs.get(request.messageId));
        const job = {
          id: request.messageId,
          userId: request.userId,
          status: AIJobStatus.PENDING,
          result: null,
        };
        jobs.set(request.messageId, job);
        return Promise.resolve(job);
      }),
      runTextJob: jest.fn((_id: string, request: { input: string }) => {
        const payload = JSON.parse(request.input) as {
          request: string;
          nutritionGuidance?: { intent: string };
        };
        const answer =
          payload.nutritionGuidance?.intent === 'MEAL_SUBSTITUTION'
            ? 'Não está cadastrada no seu plano, mas dá sim pra trocar o frango por ovos.'
            : 'Como sugestão aproximada, um sanduíche de ovos e tomate pode variar o jantar; ajuste a porção ao apetite e ao seu objetivo, sem alterar a dieta.';
        return Promise.resolve({
          outputText: JSON.stringify({
            disposition: 'ANSWER',
            domain: 'NUTRITION',
            answer,
            followUpQuestion: null,
            grounding: 'MIXED',
            confidence: 'HIGH',
          }),
          responseId: 'controlled-response',
          model: 'controlled',
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
        });
      }),
      completeJobInTransaction: jest.fn(
        (_tx: object, request: { aiJobId: string; result: unknown }) => {
          const job = jobs.get(request.aiJobId);
          if (!job) throw new Error('Missing job');
          job.status = AIJobStatus.COMPLETED;
          job.result = request.result;
          return Promise.resolve();
        },
      ),
      failJob: jest.fn(),
    };
    const qa = new ConversationQAExecutorService(
      ai as never,
      io as never,
      current,
      new ConversationPublicAnswerBoundaryService(),
      new ConversationNutritionDeterministicAnswerService(),
    );
    const workout = {
      present: jest
        .fn()
        .mockResolvedValue(
          'Seu treino de amanhã: sessão de superiores, conforme o plano atual.',
        ),
    };
    const daily = new ConversationDailyQueryService(
      io as never,
      {} as never,
      reader,
    );
    const bridge = new ConversationExecutionBridgeService(
      new ConversationResponsePayloadBuilder(),
      new ConversationLanguageRealizerService(),
      new ConversationResponseFormatterService(),
      new ConversationResponseValidatorService(),
      qa,
      undefined,
      workout as never,
      daily,
    );
    const history: { direction: 'INBOUND' | 'OUTBOUND'; text: string }[] = [];
    const inputs = [
      ['Qual meu treino de amanhã?', 'WORKOUT', 'superiores'],
      ['Qual minha meta de calorias para a semana?', 'NUTRITION', '2.200 kcal'],
      [
        'Me dê uma dica alternativa de jantar para hoje?',
        'NUTRITION',
        'sugestão aproximada',
      ],
      [
        'Posso substituir o frango por ovos no jantar? Está cadastrada na minha dieta?',
        'NUTRITION',
        'Não há essa troca cadastrada',
      ],
      [
        'Me sugira uma nova opção para o jantar',
        'NUTRITION',
        'sugestão aproximada',
      ],
      ['Qual meu treino de amanhã?', 'WORKOUT', 'superiores'],
    ];
    for (const [index, [text, domain, expected]] of inputs.entries()) {
      const turnInput = understandingInput(text, {
        dietAvailable: true,
        workoutAvailable: true,
        targetPlan: 'WORKOUT',
        recentHistory: history.map((turn, logicalTurn) => ({
          ...turn,
          logicalTurn,
          occurredAt: at.toISOString(),
        })),
      });
      const understood = await module
        .get(ConversationUnderstandingService)
        .understand({
          ...turnInput,
          receivedAt: at.toISOString(),
          continuity: {
            ...turnInput.continuity,
            currentLogicalTurn: history.length + 1,
          },
        });
      expect(understood.domain).toBe(domain);
      const snapshot = routingSnapshot({
        dietAvailable: true,
        workoutAvailable: true,
      });
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide(goalPreparationInput(understood, { snapshot }));
      const human = new CoachConversationHumanContextBuilder().build(snapshot, {
        currentMessage: text,
        recentHistory: history,
      });
      const execution = {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: `macro-${index}`,
        referenceDate: at,
      };
      const response = await bridge.execute(decision, human, execution);
      expect(response.status).toBe('COMPLETED');
      expect(response.content).toContain(expected);
      if (domain === 'NUTRITION')
        expect(response.content).not.toContain('superiores');
      expect(await bridge.execute(decision, human, execution)).toMatchObject({
        status: 'COMPLETED',
        content: response.content,
      });
      history.push(
        { direction: 'INBOUND', text },
        { direction: 'OUTBOUND', text: response.content ?? '' },
      );
    }
    expect(ai.runTextJob).toHaveBeenCalledTimes(3);
    expect(io.dietPlan.create).not.toHaveBeenCalled();
    expect(io.dietPlan.update).not.toHaveBeenCalled();
    for (const request of ai.createJob.mock.calls)
      expect(request[0]).toMatchObject({ userId: 'user-id', type: 'TEXT' });
  });

  it.each(
    [
      ['Qual meu lanche da tarde?', 'PLAN_LOOKUP'],
      ['Me dê uma dica para lanche da tarde', 'NUTRITION_ADVICE'],
      ['Me dê uma dica alternativa de jantar para hoje?', 'NUTRITION_ADVICE'],
      ['Sugira uma alternativa para o almoço', 'NUTRITION_ADVICE'],
      ['Me dá uma dica de lanche da tarde', 'NUTRITION_ADVICE'],
      ['Quero uma dica para o lanche da tarde', 'NUTRITION_ADVICE'],
      [
        'Quero que você me dê uma dica para um lanche da tarde',
        'NUTRITION_ADVICE',
      ],
      ['Me sugira um lanche da tarde', 'NUTRITION_ADVICE'],
      ['O que você sugere para o lanche da tarde?', 'NUTRITION_ADVICE'],
      ['Alguma ideia pro lanche da tarde?', 'NUTRITION_ADVICE'],
      ['Tem alguma opção para meu lanche da tarde?', 'NUTRITION_ADVICE'],
      ['Queria algo diferente para o lanche da tarde', 'NUTRITION_ADVICE'],
      ['O que posso comer à tarde?', 'NUTRITION_ADVICE'],
      [
        'Me dá uma opção rápida e proteica para a tarde',
        'CONSTRAINED_RECOMMENDATION',
      ],
      [
        'Me da uma opcao rapida e proteica para a tarde',
        'CONSTRAINED_RECOMMENDATION',
      ],
      [
        'O que posso comer no lugar do meu lanche da tarde?',
        'MEAL_SUBSTITUTION',
      ],
      [
        'Quero um lanche da tarde rápido e proteico',
        'CONSTRAINED_RECOMMENDATION',
      ],
      ['Me sugira algo diferente para comer agora', 'NUTRITION_ADVICE'],
      ['Me sugira algo sem lactose', 'CONSTRAINED_RECOMMENDATION'],
    ].flatMap(([text, intent]) =>
      [null, 'MEAL_CONTENT_REQUEST', 'WORKOUT_DAY_QUERY'].map(
        (pendingKind) => [text, intent, pendingKind] as const,
      ),
    ),
  )(
    'routes %s (%s) through the continuation gate with pending=%s',
    async (text, intent, pendingKind) => {
      const referenceDate = new Date('2026-10-05T18:00:00Z');
      const semantics = { interpret: jest.fn().mockResolvedValue(null) };
      const gate = new ConversationContinuationService(
        {} as never,
        semantics as never,
        {} as never,
        {} as never,
        new ConversationPublicAnswerBoundaryService(),
        new ConversationSafetyDetectorService(),
        new ConversationMessageNormalizerService(),
        {} as never,
        {
          enabled: () => true,
          source: () =>
            Promise.resolve({
              content: text,
              timestamp: referenceDate,
              conversationId: 'conversation-id',
              replyToExternalMessageId: null,
            }),
          pending: () =>
            Promise.resolve(
              pendingKind
                ? {
                    continuation: continuation(
                      pendingKind === 'WORKOUT_DAY_QUERY'
                        ? 'WORKOUT_DAY_QUERY'
                        : 'MEAL_CONTENT_REQUEST',
                      referenceDate,
                    ),
                  }
                : null,
            ),
          resolveOnce: (
            _user: string,
            _message: string,
            _type: string,
            execute: () => Promise<ContinuationReply | null>,
          ) => execute(),
        } as never,
      );
      expect(await gate.resolve('user-id', 'message-id')).toBeNull();
      expect(semantics.interpret).not.toHaveBeenCalled();
      const current = {
        userId: 'user-id',
        implementation: 'V2',
        document: {
          artifactType: 'DAILY_STRUCTURE',
          days: [
            {
              label: 'Segunda-feira',
              dayNumber: 1,
              meals: plan.days[0].meals.map((meal) => ({
                name: meal.name,
                period: 'AFTERNOON_SNACK',
                suggestedTime: meal.time,
                items: meal.items.map((item) => ({
                  foodName: item.name,
                  quantity: item.quantity,
                })),
              })),
            },
          ],
        },
      };
      const before = JSON.stringify(current);
      const writers = {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      };
      const prisma = {
        nutritionPlanV2: writers,
        nutritionPlanOwnership: { upsert: jest.fn() },
        userPreferences: {
          findUnique: jest.fn().mockResolvedValue({
            userId: 'user-id',
            timezone: 'America/Sao_Paulo',
          }),
        },
        $transaction: jest.fn(
          (execute: (transaction: object) => Promise<unknown>) => execute({}),
        ),
      };
      const ai = {
        createJob: jest.fn().mockResolvedValue({
          id: 'job',
          userId: 'user-id',
          status: AIJobStatus.PENDING,
        }),
        runTextJob: jest.fn().mockResolvedValue({
          responseId: 'response',
          model: 'test-provider',
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
          outputText: JSON.stringify({
            disposition: 'ANSWER',
            domain: 'NUTRITION',
            answer:
              intent === 'MEAL_SUBSTITUTION'
                ? 'Como orientação aproximada fora do plano, uma alternativa prática é um sanduíche de ovos com tomate e uma fruta.'
                : 'Uma alternativa prática é um sanduíche de ovos com tomate e uma fruta.',
            followUpQuestion: null,
            grounding: 'MIXED',
            confidence: 'HIGH',
          }),
        }),
        completeJobInTransaction: jest.fn().mockResolvedValue(undefined),
        failJob: jest.fn(),
      };
      const reader = { getCurrent: jest.fn().mockResolvedValue(current) };
      const daily = new ConversationDailyQueryService(
        prisma as never,
        {} as never,
        reader as never,
      );
      const qa = new ConversationQAExecutorService(
        ai as never,
        prisma as never,
        {
          read: jest.fn().mockResolvedValue({ status: 'AVAILABLE', plan }),
        } as never,
        new ConversationPublicAnswerBoundaryService(),
        new ConversationNutritionDeterministicAnswerService(),
      );
      const bridge = new ConversationExecutionBridgeService(
        new ConversationResponsePayloadBuilder(),
        new ConversationLanguageRealizerService(),
        new ConversationResponseFormatterService(),
        new ConversationResponseValidatorService(),
        qa,
        undefined,
        undefined,
        daily,
      );
      const understanding = await module
        .get(ConversationUnderstandingService)
        .understand(
          understandingInput(text, {
            dietAvailable: true,
            workoutAvailable: true,
            targetPlan: 'WORKOUT',
          }),
        );
      expect(understanding).toMatchObject({
        status: 'UNDERSTOOD',
        domain: 'NUTRITION',
        operation: 'PROVIDE_GUIDANCE',
        intent: 'NUTRITION_QUESTION',
      });
      if (text.includes('um lanche'))
        expect(
          understanding.references.some(
            (reference) =>
              reference.kind === 'PLAN' && reference.target === 'ORDINAL',
          ),
        ).toBe(false);
      const snapshot = routingSnapshot({
        dietAvailable: true,
        workoutAvailable: true,
      });
      const decision = module
        .get(ConversationRoutingDecisionService)
        .decide(goalPreparationInput(understanding, { snapshot }));
      expect(decision.executionRoute.kind).toBe('NUTRITION_GUIDANCE');
      const human = new CoachConversationHumanContextBuilder().build(snapshot, {
        currentMessage: text,
        recentHistory: [
          {
            direction: 'OUTBOUND',
            text: 'Qual sessão de treino você quer ver?',
          },
        ],
      });
      const result = await bridge.execute(decision, human, {
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'message-id',
        referenceDate,
      });
      expect(result.status).toBe('COMPLETED');
      if (intent === 'PLAN_LOOKUP') {
        for (const item of plan.days[0].meals[0].items)
          expect(result.content).toContain(item.name);
        expect(ai.runTextJob).not.toHaveBeenCalled();
      } else {
        expect(result.observability?.answerSource).toBe(
          intent === 'MEAL_SUBSTITUTION' &&
            nutritionRequest(text)?.substitutionPurpose !== 'OFF_PLAN_ADVICE'
            ? 'DETERMINISTIC_FALLBACK'
            : 'AI',
        );
        expect(result.content).not.toContain('Macarrão');
        const payload: unknown = JSON.parse(
          ai.runTextJob.mock.calls[0][1].input as string,
        );
        expect(payload).toMatchObject({
          nutritionGuidance: {
            intent,
            policy: {
              readOnly: true,
              currentPlanRole:
                intent === 'MEAL_SUBSTITUTION' &&
                nutritionRequest(text)?.substitutionPurpose !==
                  'OFF_PLAN_ADVICE'
                  ? 'SUBSTITUTION_EVIDENCE'
                  : 'CONTEXT_NOT_ANSWER',
            },
          },
        });
        if (/op[cç][aã]o r[aá]pida e proteica/u.test(text))
          expect(payload).toMatchObject({
            nutritionGuidance: {
              immediateConstraints: ['QUICK', 'HIGH_PROTEIN'],
              safetyConstraints: [],
            },
          });
        expect(reader.getCurrent).not.toHaveBeenCalled();
      }
      for (const writer of Object.values(writers))
        expect(writer).not.toHaveBeenCalled();
      expect(prisma.nutritionPlanOwnership.upsert).not.toHaveBeenCalled();
      expect(JSON.stringify(current)).toBe(before);
    },
  );
});
