import { Test, type TestingModule } from '@nestjs/testing';
import { AIJobStatus } from '@prisma/client';
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

  it.each(
    [
      ['Qual meu lanche da tarde?', 'PLAN_LOOKUP'],
      ['Me dê uma dica para lanche da tarde', 'NUTRITION_ADVICE'],
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
              'Uma alternativa prática é um sanduíche de ovos com tomate e uma fruta.',
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
        expect(result.observability?.answerSource).toBe('AI');
        expect(result.content).not.toContain('Macarrão');
        const payload: unknown = JSON.parse(
          ai.runTextJob.mock.calls[0][1].input as string,
        );
        expect(payload).toMatchObject({
          nutritionGuidance: {
            intent,
            policy: { readOnly: true, currentPlanRole: 'CONTEXT_NOT_ANSWER' },
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
