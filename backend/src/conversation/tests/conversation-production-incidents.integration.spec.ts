import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConversationModule } from '../conversation.module';
import { ConversationContinuationService } from '../runtime/conversation-continuation.service';
import { ConversationContinuationSemanticsService } from '../runtime/conversation-continuation-semantics.service';
import { ConversationContinuationStore } from '../runtime/conversation-continuation.store';
import { ConversationQAFollowUpContextService } from '../runtime/conversation-qa-follow-up-context.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationRuntimeOperationalConfigService } from '../runtime/conversation-runtime-operational-config.service';
import { ConversationRuntimeService } from '../runtime/conversation-runtime.service';
import { ConversationRuntimeIntegrationService } from '../runtime/conversation-runtime-integration.service';
import { ConversationRuntimeAuditService } from '../runtime/conversation-runtime-audit.service';
import { ConversationOfficialSelectionService } from '../runtime/conversation-official-selection.service';
import { ConversationShadowComparatorService } from '../runtime/conversation-shadow-comparator.service';
import { ConversationTurnContextBuilderService } from '../runtime/conversation-turn-context-builder.service';
import { ConversationQAExecutorService } from '../runtime/conversation-qa-executor.service';
import { ConversationNutritionDeterministicAnswerService } from '../runtime/conversation-nutrition-deterministic-answer.service';
import { ConversationExecutionBridgeService } from '../runtime/conversation-execution-bridge.service';
import { ConversationResponsePayloadBuilder } from '../runtime/conversation-response-payload.builder';
import { ConversationLanguageRealizerService } from '../runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../runtime/conversation-response-validator.service';
import { ConversationUnderstandingService } from '../understanding/conversation-understanding.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import { ConversationEntityRecognizerService } from '../understanding/conversation-entity-recognizer.service';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationRoutingDecisionService } from '../routing/conversation-routing-decision.service';
import { CoachProfileSnapshotConversationAdapter } from '../adapters/coach-profile-snapshot.adapter';
import { ProfileAcquisitionDecisionConversationAdapter } from '../adapters/profile-acquisition-decision.adapter';
import { CoachConversationHumanContextBuilder } from '../../context/coach-conversation-human-context.builder';
import type { CoachProfileSnapshotBuilder } from '../../context/coach-profile-snapshot.builder';
import type { CoachAdaptiveProfileCollectorService } from '../../context/coach-adaptive-profile-collector.service';
import type { ProfileQuestionSpecificationService } from '../../context/profile-acquisition/profile-question.service';
import type { ConversationCurrentNutritionContextService } from '../runtime/conversation-current-nutrition-context.service';
import { PersonalizedCoachContextService } from '../runtime/personalized-coach-context.service';
import type { CurrentWorkoutPlanReaderService } from '../../workout/v2/current-workout-plan-reader.service';
import type { ConversationAIService } from '../../ai/conversation-ai.service';
import { AIService } from '../../ai/ai.service';
import type {
  AIUsageService,
  RecordAIUsageInput,
} from '../../ai/ai-usage.service';
import type { OpenAIGateway } from '../../ai/openai.gateway';
import type { OpenAITextRequest } from '../../ai/interfaces/openai.interface';
import type { PromptService } from '../../ai/prompt.service';
import type { ReservationService } from '../../entitlements/reservation.service';
import type { UsageService } from '../../usage/usage.service';
import { IntegrationEventHandlersService } from '../../event-bus/integration-event-handlers.service';
import { EventHandlerRegistry } from '../../event-bus/event-handler.registry';
import { INTERNAL_EVENT } from '../../event-bus/event-bus.constants';
import type { OutboxEventHandler } from '../../event-bus/event-bus.interfaces';
import { EventBusService } from '../../event-bus/event-bus.service';
import { AuditService } from '../../observability/audit.service';
import { CoachCommandService } from '../../automation/coach-command.service';
import type { CoachPlanningExecutionService } from '../../automation/coach-planning-execution.service';
import type { ConversationGoalShadowPipelineService } from '../../automation/conversation-goal-shadow-pipeline.service';
import { AutomationService } from '../../automation/automation.service';
import { CoachProactiveSchedulePolicy } from '../../automation/coach-proactive-schedule.policy';
import type { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_CONVERSATION_QA_PROMPT } from '../runtime/conversation-qa-capability';
import { continuation } from '../runtime/conversation-continuation.contract';
import {
  knownDatum,
  routingSnapshot,
  readyAdaptiveDecision,
} from './conversation-routing.fixtures';
import type { PublicNutritionResponse } from '../../diet/v2/presentation/public-nutrition-response.contract';

const url = process.env.CONVERSATION_CONTINUATION_INTEGRATION_DATABASE_URL;
const integration = url ? describe : describe.skip;
const realCalories =
  'O treino de academia que você montou para mim, com 4 sessões semanais de aproximadamente 60 minutos, pode me fazer gastar quantas calorias em média por sessão? Considere meu peso de 95 kg.';
const firstDinner =
  'Uma boa alternativa para o jantar é arroz branco com peito de frango grelhado e abobrinha refogada. Outra alternativa é macarrão com bife bovino grelhado.';
const secondDinner =
  'Uma outra opção é arroz branco com peito de frango grelhado e alface e pepino. Também arroz branco com carne bovina e abobrinha.';
const newDinner =
  'Uma ideia aproximada é batata assada com peixe e salada de pepino.';
const answer = (text: string, domain = 'NUTRITION') => ({
  disposition: 'ANSWER',
  domain,
  answer: text,
  followUpQuestion: null,
  grounding: 'MIXED',
  confidence: 'HIGH',
});
const composition = (
  quote: string,
  mainIngredients: string[],
  mainProtein: string | null,
  accompaniments: string[] = [],
) => ({
  quote,
  mainIngredients,
  mainProtein,
  accompaniments,
  preparation: null,
});

integration(
  'Consolidated P0 production incidents (isolated PostgreSQL, controlled provider)',
  () => {
    const db = new PrismaClient({
      datasources: {
        db: {
          url: url ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled',
        },
      },
    });
    const prisma = db as unknown as PrismaService;
    let module: TestingModule;
    let userId: string;
    let foreignId: string;
    let conversationId: string;
    let command: CoachCommandService;
    let automation: AutomationService;
    let handleInbound: OutboxEventHandler;
    let promptId: string;
    let ruleId: string;
    let hydrationRuleId: string;
    let at: Date;
    let turnBuilder: ConversationTurnContextBuilderService;
    const createdRules: string[] = [];
    const provider = { createTextResponse: jest.fn() };
    const outputs: unknown[] = [];
    const send = jest.fn();
    const planning = { execute: jest.fn() };
    let initialPlans: string;
    let snapshot: ReturnType<typeof routingSnapshot>;
    const plan: PublicNutritionResponse = {
      title: 'Plano alimentar de teste',
      summary: 'Estrutura diária',
      energyTargetKcal: 2440,
      days: Array.from({ length: 7 }, () => ({
        meals: [
          {
            name: 'Jantar',
            items: [
              { name: 'Arroz branco', quantity: '4 colheres' },
              { name: 'Peito de frango grelhado', quantity: '120 g' },
              { name: 'Abobrinha', quantity: '1 porção' },
              { name: 'Feijão', quantity: '1 concha' },
            ],
          },
        ],
      })),
      substitutions: [],
      hydrationGuidance: [],
      generalGuidance: [],
      adaptationGuidance: [],
      safetyGuidance: [],
    };
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !target.port ||
        !target.pathname.includes('consolidated')
      )
        throw new Error(
          'Explicit isolated local consolidated test DB required',
        );
      await db.message.findFirst({ where: { id: 'schema-check-only' } });
      module = await Test.createTestingModule({
        imports: [ConversationModule],
      }).compile();
      for (const code of ['DAILY_COACH', 'HYDRATION_REMINDER']) {
        let row = await db.automationRule.findUnique({ where: { code } });
        if (!row) {
          row = await db.automationRule.create({
            data: { code, name: 'Isolated regression rule' },
          });
          createdRules.push(row.id);
        }
        if (code === 'DAILY_COACH') ruleId = row.id;
        else hydrationRuleId = row.id;
      }
      promptId = (
        await db.promptVersion.create({
          data: {
            name: ACTIVE_CONVERSATION_QA_PROMPT.name,
            version: 9001,
            prompt: ACTIVE_CONVERSATION_QA_PROMPT.instructions,
            model: 'TEXT',
            isActive: true,
          },
        })
      ).id;
    });
    beforeEach(async () => {
      provider.createTextResponse.mockReset();
      send.mockReset();
      planning.execute.mockReset();
      outputs.length = 0;
      at = new Date(Date.now() - 60_000);
      userId = (
        await db.user.create({
          data: { phone: `p0-test-${randomUUID()}`, onboardingCompleted: true },
        })
      ).id;
      foreignId = (
        await db.user.create({
          data: {
            phone: `p0-foreign-${randomUUID()}`,
            onboardingCompleted: true,
          },
        })
      ).id;
      conversationId = (
        await db.conversation.create({
          data: {
            userId,
            phoneNumber:
              '+999' +
              BigInt('0x' + randomUUID().replace(/-/gu, '').slice(0, 12))
                .toString()
                .slice(0, 10),
          },
        })
      ).id;
      const profile = await db.fitnessProfile.create({
        data: {
          userId,
          gender: 'MALE',
          birthDate: new Date('1990-01-01'),
          heightCm: 180,
          currentWeightKg: 95,
          targetWeightKg: 85,
          activityLevel: 'MODERATE',
          goal: 'WEIGHT_LOSS',
        },
      });
      await db.workoutPlan.create({
        data: {
          userId,
          profileId: profile.id,
          title: 'Quatro sessões de academia',
          objective: 'WEIGHT_LOSS',
        },
      });
      await db.workoutPlan.create({
        data: {
          userId,
          profileId: profile.id,
          title: 'Treino anterior',
          objective: 'WEIGHT_LOSS',
          status: 'ARCHIVED',
        },
      });
      const dietJob = await db.aIJob.create({
        data: {
          userId,
          type: 'DIET',
          promptVersionId: promptId,
          status: 'COMPLETED',
          startedAt: at,
          completedAt: at,
        },
      });
      await db.dietPlan.create({
        data: {
          userId,
          profileId: profile.id,
          aiJobId: dietJob.id,
          title: plan.title,
          objective: 'WEIGHT_LOSS',
          dailyCaloriesTarget: 2440,
          proteinTarget: 150,
          carbsTarget: 250,
          fatTarget: 70,
        },
      });
      initialPlans = JSON.stringify(
        await Promise.all([
          db.workoutPlan.findMany({
            where: { userId },
            orderBy: { id: 'asc' },
          }),
          db.dietPlan.findMany({ where: { userId } }),
        ]),
      );
      const base = routingSnapshot({
        dietAvailable: true,
        workoutAvailable: true,
      });
      snapshot = {
        ...base,
        identity: { ...base.identity, userId: knownDatum(userId) },
        physical: { ...base.physical, currentWeightKg: knownDatum(95) },
        referenceDate: at.toISOString(),
      };
      const snapshots = {
        build: () => Promise.resolve(snapshot),
      } as unknown as CoachProfileSnapshotBuilder;
      const config = new ConversationRuntimeOperationalConfigService({
        get: (key: string) =>
          (
            ({
              CONVERSATION_RUNTIME_MODE: 'PRIMARY',
              CONVERSATION_RUNTIME_KILL_SWITCH: 'false',
              CONVERSATION_RUNTIME_TIMEOUT_MS: '25000',
            }) as Record<string, string>
          )[key],
      } as unknown as ConfigService);
      const boundary = new ConversationPublicAnswerBoundaryService();
      const followUp = new ConversationQAFollowUpContextService(
        prisma,
        boundary,
      );
      const nutrition = {
        read: (owner: string) => {
          if (owner !== userId) throw new Error('Unexpected nutrition owner');
          return Promise.resolve({ status: 'AVAILABLE', plan });
        },
      } as unknown as ConversationCurrentNutritionContextService;
      const eventBus = new EventBusService(prisma);
      const aiUsage = {
        recordInTransaction: async (
          tx: Prisma.TransactionClient,
          input: RecordAIUsageInput,
        ) =>
          tx.aIUsage.upsert({
            where: { aiJobId: input.aiJobId },
            create: {
              userId: input.userId,
              aiJobId: input.aiJobId,
              model: input.model,
              promptTokens: input.promptTokens,
              completionTokens: input.completionTokens,
              totalTokens: input.totalTokens,
              estimatedCost: 0,
              usageDate: new Date(),
            },
            update: {},
          }),
      } as unknown as AIUsageService;
      const ai = new AIService(
        prisma,
        {
          getActive: () =>
            db.promptVersion.findUniqueOrThrow({ where: { id: promptId } }),
        } as unknown as PromptService,
        provider as unknown as OpenAIGateway,
        aiUsage,
        {} as ReservationService,
        {
          confirmInTransaction: jest.fn(),
          reverseInTransaction: jest.fn(),
        } as unknown as UsageService,
        {
          get: (_key: string, fallback: string) => fallback,
        } as unknown as ConfigService,
        eventBus,
      );
      provider.createTextResponse.mockImplementation(
        (request: OpenAITextRequest) => {
          expect(request.jsonSchema).toBeDefined();
          const result = outputs.shift();
          if (!result) throw new Error('Unexpected extra provider call');
          return Promise.resolve({
            responseId: randomUUID(),
            model: 'controlled-model',
            outputText: JSON.stringify(result),
            promptTokens: 100,
            completionTokens: 20,
            totalTokens: 120,
          });
        },
      );
      const personalized = {
        build: async (input: {
          userId: string;
          conversationId: string;
          messageId: string;
        }) => {
          const source = await db.message.findFirst({
            where: {
              id: input.messageId,
              conversationId: input.conversationId,
              conversation: { userId: input.userId },
            },
          });
          if (!source) throw new Error('Context ownership mismatch');
          return {
            activeNutritionPlan: plan,
            activeWorkoutPlan: {
              title: 'Quatro sessões de academia',
              durationMinutes: 60,
              modality: 'GYM',
            },
            safety: { allergies: { status: 'KNOWN', value: ['PEANUT'] } },
            nutrition: {
              declaredFoodRejections: {
                status: 'KNOWN',
                value: ['tomate', 'beterraba'],
              },
            },
            physical: { currentWeightKg: { status: 'KNOWN', value: 95 } },
            currentDeclaration: source.content,
            relevantProgress: {
              recordedMealConsumption: { analyzedMealCount: 0 },
            },
          };
        },
        answer: () => null,
        validatesAnswer: (
          context: Parameters<
            PersonalizedCoachContextService['validatesAnswer']
          >[0],
          text: string,
        ) =>
          PersonalizedCoachContextService.prototype.validatesAnswer.call(
            personalized as unknown as PersonalizedCoachContextService,
            context,
            text,
          ) === true,
        record: (value: unknown) =>
          !!value && typeof value === 'object' && !Array.isArray(value),
      } as unknown as PersonalizedCoachContextService;
      const qa = new ConversationQAExecutorService(
        ai,
        prisma,
        nutrition,
        boundary,
        new ConversationNutritionDeterministicAnswerService(),
        personalized,
        provider as unknown as OpenAIGateway,
      );
      const builder = new ConversationTurnContextBuilderService(
        prisma,
        snapshots,
        {
          decide: () => readyAdaptiveDecision(),
        } as unknown as CoachAdaptiveProfileCollectorService,
        module.get(CoachProfileSnapshotConversationAdapter),
        module.get(ProfileAcquisitionDecisionConversationAdapter),
        {} as ProfileQuestionSpecificationService,
        new CoachConversationHumanContextBuilder(),
        module.get(ConversationMessageNormalizerService),
        module.get(ConversationEntityRecognizerService),
        followUp,
      );
      turnBuilder = builder;
      const runtime = new ConversationRuntimeService(
        config,
        builder,
        module.get(ConversationUnderstandingService),
        module.get(ConversationRoutingDecisionService),
      );
      const bridge = new ConversationExecutionBridgeService(
        new ConversationResponsePayloadBuilder(),
        new ConversationLanguageRealizerService(),
        new ConversationResponseFormatterService(),
        new ConversationResponseValidatorService(),
        qa,
      );
      const integration = new ConversationRuntimeIntegrationService(
        config,
        runtime,
        bridge,
        new ConversationOfficialSelectionService(),
        new ConversationShadowComparatorService(),
        new ConversationRuntimeAuditService(new AuditService(prisma)),
      );
      const interpreter = new ConversationContinuationSemanticsService(
        {
          execute: (input: { payload: { text: string } }) =>
            Promise.resolve({
              status: 'COMPLETED',
              structuredOutput: {
                action: input.payload.text.includes('água')
                  ? 'HYDRATION_REPLY'
                  : 'INDEPENDENT',
                day: 'UNRESOLVED',
                consumption: 'UNKNOWN',
                meal: 'UNKNOWN',
                description: null,
                hydrationGoal: false,
                reference: input.payload.text.includes('água')
                  ? 'PENDING'
                  : 'EXPLICIT',
                workoutEffect: 'NONE',
                response: input.payload.text.includes('água')
                  ? 'Você já bebeu 1 litro de água hoje.'
                  : null,
              },
            }),
        } as unknown as ConversationAIService,
        boundary,
      );
      const continuations = new ConversationContinuationService(
        prisma,
        interpreter,
        {} as CurrentWorkoutPlanReaderService,
        nutrition,
        boundary,
        module.get(ConversationSafetyDetectorService),
        module.get(ConversationMessageNormalizerService),
        followUp,
        new ConversationContinuationStore(prisma, config),
      );
      command = new CoachCommandService(
        prisma,
        planning as unknown as CoachPlanningExecutionService,
        eventBus,
        {
          execute: () => Promise.resolve(undefined),
        } as unknown as ConversationGoalShadowPipelineService,
        integration,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        continuations,
      );
      send.mockImplementation(() =>
        Promise.resolve({
          externalMessageId: randomUUID(),
        }),
      );
      automation = new AutomationService(
        prisma,
        {} as never,
        {} as never,
        { sendText: send } as never,
        { requireAccessInTransaction: jest.fn() } as never,
        eventBus,
        {} as never,
        {} as never,
        new CoachProactiveSchedulePolicy(),
      );
      const registry = new EventHandlerRegistry();
      const handlers = new IntegrationEventHandlersService(
        registry,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        command,
        automation,
        {} as never,
        {
          processTextMessage: () => Promise.resolve({ handled: false }),
        } as never,
        {
          captureActiveResponse: () => Promise.resolve({ handled: false }),
        } as never,
        { authorizeOrNotify: () => Promise.resolve(true) } as never,
        undefined,
        continuations,
      );
      handlers.onModuleInit();
      const handler = registry.get(
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      );
      if (!handler) throw new Error('Real inbound handler missing');
      handleInbound = handler;
    });
    afterEach(async () => {
      if (userId) {
        await db.outboxEvent.deleteMany({
          where: { payload: { path: ['userId'], equals: userId } },
        });
        await db.auditLog.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
      if (foreignId) await db.user.delete({ where: { id: foreignId } });
    });
    afterAll(async () => {
      if (promptId) await db.promptVersion.delete({ where: { id: promptId } });
      if (createdRules.length)
        await db.automationRule.deleteMany({
          where: { id: { in: createdRules } },
        });
      if (module) await module.close();
      await db.$disconnect();
    });
    async function inbound(text: string, quote?: string) {
      at = new Date();
      const row = await db.message.create({
        data: {
          conversationId,
          direction: 'INBOUND',
          type: 'TEXT',
          content: text,
          timestamp: at,
          replyToExternalMessageId: quote,
        },
      });
      const event = await db.outboxEvent.create({
        data: {
          eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
          aggregateType: 'MESSAGE',
          aggregateId: row.id,
          payload: { userId, messageId: row.id },
        },
      });
      await handleInbound(event);
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      const response = await db.scheduledMessage.findFirstOrThrow({
        where: {
          userId,
          automationRuleId: ruleId,
          context: { path: ['sourceMessageId'], equals: row.id },
        },
      });
      // A delivery cannot predate the actual AIJob completion under load.
      const deliveredAt = new Date(Math.max(Date.now(), at.getTime() + 2000));
      await automation.sendScheduledMessage(response.id, deliveredAt);
      at = deliveredAt;
      const calls = provider.createTextResponse.mock.calls.length;
      const sends = send.mock.calls.length;
      await handleInbound(event);
      await automation.sendScheduledMessage(
        response.id,
        new Date(at.getTime() + 3000),
      );
      expect(provider.createTextResponse).toHaveBeenCalledTimes(calls);
      expect(send).toHaveBeenCalledTimes(sends);
      expect(
        await db.scheduledMessage.count({
          where: {
            userId,
            automationRuleId: ruleId,
            context: { path: ['sourceMessageId'], equals: row.id },
          },
        }),
      ).toBe(1);
      expect(
        await db.workoutPlan
          .findMany({ where: { userId }, orderBy: { id: 'asc' } })
          .then(async (workout) =>
            JSON.stringify([
              workout,
              await db.dietPlan.findMany({ where: { userId } }),
            ]),
          ),
      ).toBe(initialPlans);
      expect(planning.execute).not.toHaveBeenCalled();
      expect(
        await db.aIJob.count({
          where: {
            userId,
            messageId: row.id,
            type: { in: ['DIET', 'WORKOUT'] },
          },
        }),
      ).toBe(0);
      expect(
        await db.outboxEvent.count({
          where: {
            eventType: 'AUTOMATION_TRIGGERED',
            payload: { path: ['sourceMessageId'], equals: row.id },
          },
        }),
      ).toBe(1);
      expect(
        (
          await db.scheduledMessage.findUniqueOrThrow({
            where: { id: response.id },
          })
        ).status,
      ).toBe('SENT');
      return { inbound: row, response };
    }
    it('consolidated P0 calorie question reaches contextual AI and the final sent response', async () => {
      const estimate =
        'Como aproximação para 95 kg e 60 minutos, atividades entre 3,5 e 6 MET correspondem a cerca de 350–600 kcal. Intensidade e pausas mudam essa faixa; não é uma medição do seu treino.';
      outputs.push(answer(estimate, 'WORKOUT'));
      const turn = await inbound(realCalories);
      expect(turn.response.content).toBe(estimate);
      expect(turn.response.content).not.toContain('Sua meta diária');
      const audit = await db.auditLog.findFirstOrThrow({
        where: { userId, action: 'CONVERSATION_RUNTIME_EVALUATED' },
      });
      expect(audit.metadata).toMatchObject({
        routeKind: 'ANSWER_MESSAGE',
        answerDomain: 'WORKOUT',
        answerSource: 'AI',
        understandingDomain: 'WORKOUT',
      });
      expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
      expect(provider.createTextResponse.mock.calls[0][0].input).toContain(
        '95',
      );
    });
    it('consolidated P0 real dinner sequence repairs the repeated central pair once and publishes a different meal', async () => {
      outputs.push(answer(firstDinner));
      const first = await inbound(
        'Me dê uma dica alternativa de jantar para hoje?',
      );
      outputs.push(
        {
          ...answer(secondDinner),
          nutritionComposition: {
            previous: [
              composition(
                firstDinner,
                ['arroz branco', 'peito de frango'],
                'peito de frango',
              ),
              composition(
                firstDinner,
                ['macarrão', 'bife bovino'],
                'bife bovino',
              ),
            ],
            current: [
              composition(
                secondDinner,
                ['arroz branco', 'peito de frango'],
                'peito de frango',
                ['alface', 'pepino'],
              ),
              composition(
                secondDinner,
                ['arroz branco', 'carne bovina'],
                'carne bovina',
                ['abobrinha'],
              ),
            ],
          },
        },
        {
          ...answer(newDinner),
          nutritionComposition: {
            previous: [
              composition(
                firstDinner,
                ['arroz branco', 'peito de frango'],
                'peito de frango',
              ),
              composition(
                firstDinner,
                ['macarrão', 'bife bovino'],
                'bife bovino',
              ),
            ],
            current: [
              composition(newDinner, ['batata', 'peixe'], 'peixe', ['pepino']),
            ],
          },
        },
      );
      const next = await inbound('Outra opção');
      expect(next.response.content).toBe(newDinner);
      expect(next.response.content).not.toContain('peito de frango');
      expect(provider.createTextResponse).toHaveBeenCalledTimes(3);
      const audit = await db.auditLog.findFirstOrThrow({
        where: {
          userId,
          action: 'CONVERSATION_RUNTIME_EVALUATED',
          metadata: { path: ['messageId'], equals: next.inbound.id },
        },
      });
      expect(audit.metadata).toMatchObject({
        effectiveReferentSource: 'DELIVERED_QA',
        effectiveReferentMessageId: first.inbound.id,
        effectiveReferentMeal: 'jantar',
        nutritionAdviceRetryAttempted: true,
        nutritionAdviceRetryOutcome: 'RECOVERED',
      });
      expect(provider.createTextResponse.mock.calls[1][0].input).toContain(
        firstDinner,
      );
      expect(
        await db.aIUsage
          .findMany({ where: { userId } })
          .then((rows) => rows.map((row) => row.totalTokens).sort()),
      ).toEqual([120, 240]);
    });
    it('consolidated P0 hydration reminder delegates the echo, preserves its receipt and never invents water tracking', async () => {
      const reminder = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: hydrationRuleId,
          content:
            'Como está sua hidratação hoje? Quanto você já conseguiu beber?',
          status: 'SENT',
          scheduledFor: at,
          sentAt: at,
          externalMessageId: randomUUID(),
          responseExpiresAt: new Date(Date.now() + 3600000),
          context: { continuation: { ...continuation('HYDRATION_CHECK', at) } },
        },
      });
      const guidance =
        'Você começou a se hidratar. Continue distribuindo a água ao longo do dia, sem tentar compensar tudo de uma vez.';
      outputs.push({
        ...answer(guidance, 'GENERAL'),
        hydrationGuidance: guidance.includes('Continue')
          ? guidance.slice(guidance.indexOf('Continue'))
          : guidance,
      });
      const turn = await inbound(
        'Já bebi 1 litro de água hoje.',
        reminder.externalMessageId ?? undefined,
      );
      expect(turn.response.content).toBe(guidance);
      expect(turn.response.content).not.toBe(
        'Você já bebeu 1 litro de água hoje.',
      );
      const receipt = await db.scheduledMessage.findUniqueOrThrow({
        where: { id: reminder.id },
      });
      expect(receipt.responseMessageId).toBe(turn.inbound.id);
      expect(receipt.responseOutcome).toBe('UNKNOWN');
      expect(
        await db.meal.count({ where: { messageId: turn.inbound.id } }),
      ).toBe(0);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(provider.createTextResponse.mock.calls[0][0].input),
      ).toMatchObject({
        hydrationReply: { tracking: 'READ_ONLY_REPORT', goalConfirmed: false },
      });
    });
    it.each(['tomate', 'beterraba', 'amendoim'])(
      'preserves food safety after the single correction: %s',
      async (food) => {
        outputs.push(
          answer(`Uma opção é ${food} com arroz.`),
          answer(`Prepare ${food} com legumes.`),
        );
        const turn = await inbound(
          'Me dê uma dica alternativa de jantar para hoje?',
        );
        expect(turn.response.content).not.toContain(food);
        expect(
          provider.createTextResponse.mock.calls.length,
        ).toBeLessThanOrEqual(2);
      },
    );
    it('rejects unsupported hydration registration and preserves a safe public failure', async () => {
      const reminder = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: hydrationRuleId,
          content: 'Quanto você já bebeu?',
          status: 'SENT',
          scheduledFor: at,
          sentAt: at,
          externalMessageId: randomUUID(),
          context: { continuation: { ...continuation('HYDRATION_CHECK', at) } },
        },
      });
      outputs.push(
        answer('Registrei sua água e você atingiu sua meta diária.', 'GENERAL'),
      );
      const turn = await inbound(
        'Já bebi 1 litro de água hoje.',
        reminder.externalMessageId ?? undefined,
      );
      expect(turn.response.content).not.toContain('Registrei');
      expect(turn.response.content).not.toContain('atingiu sua meta');
      expect(
        await db.aIJob.findFirstOrThrow({
          where: { messageId: turn.inbound.id },
        }),
      ).toMatchObject({
        status: 'FAILED',
        error: 'UNSUPPORTED_HYDRATION_ASSERTION',
      });
    });
    it('rejects an estimated activity expenditure presented as a personal measurement', async () => {
      outputs.push(answer('Você gastou 500 calorias nesse treino.', 'WORKOUT'));
      const turn = await inbound(realCalories);
      expect(turn.response.content).not.toContain('Você gastou 500');
      expect(
        await db.aIJob.findFirstOrThrow({
          where: { messageId: turn.inbound.id },
        }),
      ).toMatchObject({
        status: 'FAILED',
        error: 'UNSUPPORTED_PERSONAL_ASSERTION',
      });
    });
    it('consolidated P0 preserves legacy six-field results without allowing an unverified alternative to bypass variety', async () => {
      outputs.push(answer(firstDinner));
      await inbound('Me dê uma dica alternativa de jantar para hoje?');
      outputs.push(answer(secondDinner), {
        ...answer(newDinner),
        nutritionComposition: {
          previous: [
            composition(
              firstDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
            ),
            composition(
              firstDinner,
              ['macarrão', 'bife bovino'],
              'bife bovino',
            ),
          ],
          current: [
            composition(newDinner, ['batata', 'peixe'], 'peixe', ['pepino']),
          ],
        },
      });
      const turn = await inbound('Outra opção');
      expect(turn.response.content).toBe(newDinner);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(3);
    });
    it('does not publish the rejected alternative when both bounded candidates repeat the central meal', async () => {
      outputs.push(answer(firstDinner));
      await inbound('Me dê uma dica alternativa de jantar para hoje?');
      const repeated = {
        ...answer(secondDinner),
        nutritionComposition: {
          previous: [
            composition(
              firstDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
            ),
          ],
          current: [
            composition(
              secondDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
            ),
          ],
        },
      };
      outputs.push(repeated, repeated);
      const turn = await inbound('Outra opção');
      expect(turn.response.content).not.toBe(secondDinner);
      expect(turn.response.content).not.toContain('peito de frango');
      expect(provider.createTextResponse).toHaveBeenCalledTimes(3);
      expect(
        await db.aIJob.findFirstOrThrow({
          where: { messageId: turn.inbound.id },
        }),
      ).toMatchObject({
        status: 'FAILED',
        error: 'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION',
      });
    });
    it('keeps the three real incident domains separate in a single conversation', async () => {
      const reminder = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: hydrationRuleId,
          content: 'Como está sua hidratação hoje?',
          status: 'SENT',
          scheduledFor: at,
          sentAt: at,
          externalMessageId: randomUUID(),
          context: {
            continuation: continuation(
              'HYDRATION_CHECK',
              at,
            ) as unknown as Prisma.InputJsonObject,
          },
        },
      });
      const hydration =
        'Você começou a se hidratar. Distribua a água durante o dia, respeitando suas orientações individuais.';
      outputs.push({
        ...answer(hydration, 'GENERAL'),
        hydrationGuidance:
          'Distribua a água durante o dia, respeitando suas orientações individuais.',
      });
      expect(
        (
          await inbound(
            'Já bebi 1 litro de água hoje.',
            reminder.externalMessageId ?? undefined,
          )
        ).response.content,
      ).toBe(hydration);
      const calories =
        'É possível estimar o gasto por modalidade, duração e intensidade, mas sem sensor não há medição individual desse treino.';
      outputs.push(answer(calories, 'WORKOUT'));
      expect((await inbound(realCalories)).response.content).toBe(calories);
      outputs.push(answer(firstDinner));
      const dinner = await inbound(
        'Me dê uma dica alternativa de jantar para hoje?',
      );
      outputs.push({
        ...answer(newDinner),
        nutritionComposition: {
          previous: [
            composition(
              firstDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
            ),
            composition(
              firstDinner,
              ['macarrão', 'bife bovino'],
              'bife bovino',
            ),
          ],
          current: [
            composition(newDinner, ['batata', 'peixe'], 'peixe', ['pepino']),
          ],
        },
      });
      const alternative = await inbound('Outra opção');
      expect(alternative.response.content).toBe(newDinner);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(4);
      const audit = await db.auditLog.findFirstOrThrow({
        where: {
          userId,
          action: 'CONVERSATION_RUNTIME_EVALUATED',
          metadata: { path: ['messageId'], equals: alternative.inbound.id },
        },
      });
      expect(audit.metadata).toMatchObject({
        effectiveReferentMessageId: dinner.inbound.id,
        effectiveReferentDomain: 'NUTRITION',
        nutritionAdviceRetryAttempted: false,
      });
    });
    it('blocker 1 rejects an omitted previous central option even when the model declares only the other alternative', async () => {
      outputs.push({
        ...answer(firstDinner),
        nutritionComposition: {
          previous: [],
          current: [
            composition(
              firstDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
            ),
            composition(
              firstDinner,
              ['macarrão', 'bife bovino'],
              'bife bovino',
            ),
          ],
        },
      });
      await inbound('Me dê uma dica alternativa de jantar para hoje?');
      const omitted = {
        ...answer(secondDinner),
        nutritionComposition: {
          previous: [
            composition(
              firstDinner,
              ['macarrão', 'bife bovino'],
              'bife bovino',
            ),
          ],
          current: [
            composition(
              secondDinner,
              ['arroz branco', 'peito de frango'],
              'peito de frango',
              ['alface', 'pepino'],
            ),
            composition(
              secondDinner,
              ['arroz branco', 'carne bovina'],
              'carne bovina',
              ['abobrinha'],
            ),
          ],
        },
      };
      outputs.push(omitted, omitted);
      const turn = await inbound('Outra opção');
      expect(turn.response.content).not.toBe(secondDinner);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(3);
      expect(
        await db.aIJob.findFirstOrThrow({
          where: { messageId: turn.inbound.id },
        }),
      ).toMatchObject({
        status: 'FAILED',
        error: 'NUTRITION_ADVICE_REPEATS_PREVIOUS_SUGGESTION',
      });
    });
    it.each([
      'Você já bebeu 1 litro de água hoje.',
      'Pelo seu relato, você tomou um litro de água ao longo de hoje.',
      'Registrei esse volume. Continue distribuindo a água durante o dia.',
      'Você atingiu sua meta. Continue distribuindo a água durante o dia.',
    ])(
      'blocker 2 rejects a hydration echo without useful guidance: %s',
      async (echo) => {
        const reminder = await db.scheduledMessage.create({
          data: {
            userId,
            conversationId,
            automationRuleId: hydrationRuleId,
            content: 'Quanto você já bebeu?',
            status: 'SENT',
            scheduledFor: at,
            sentAt: at,
            externalMessageId: randomUUID(),
            context: {
              continuation: { ...continuation('HYDRATION_CHECK', at) },
            },
          },
        });
        outputs.push({
          ...answer(echo, 'GENERAL'),
          hydrationGuidance: echo.includes('Continue')
            ? echo.slice(echo.indexOf('Continue'))
            : echo,
        });
        const turn = await inbound(
          'Já bebi 1 litro de água hoje.',
          reminder.externalMessageId ?? undefined,
        );
        expect(turn.response.content).not.toBe(echo);
        expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
        expect(
          await db.aIJob.findFirstOrThrow({
            where: { messageId: turn.inbound.id },
          }),
        ).toMatchObject({ status: 'FAILED' });
      },
    );
    it('blocker 2 allows a safe denial of registration with brief useful guidance', async () => {
      const reminder = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: hydrationRuleId,
          content: 'Quanto você já bebeu?',
          status: 'SENT',
          scheduledFor: at,
          sentAt: at,
          externalMessageId: randomUUID(),
          context: { continuation: { ...continuation('HYDRATION_CHECK', at) } },
        },
      });
      const guidance =
        'Não registrei esse volume. Continue distribuindo a água ao longo do dia.';
      outputs.push({
        ...answer(guidance, 'GENERAL'),
        hydrationGuidance: guidance.includes('Continue')
          ? guidance.slice(guidance.indexOf('Continue'))
          : guidance,
      });
      expect(
        (
          await inbound(
            'Já bebi 1 litro de água hoje.',
            reminder.externalMessageId ?? undefined,
          )
        ).response.content,
      ).toBe(guidance);
    });
    it('blocker 3 validates a quoted authorized reminder after more than eight later SENT messages', async () => {
      const reminderAt = new Date(at.getTime() - 20000);
      const reminder = await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: hydrationRuleId,
          content: 'Quanto você já bebeu?',
          status: 'SENT',
          scheduledFor: reminderAt,
          sentAt: reminderAt,
          externalMessageId: randomUUID(),
          responseExpiresAt: new Date(Date.now() + 3600000),
          context: {
            continuation: { ...continuation('HYDRATION_CHECK', reminderAt) },
          },
        },
      });
      for (let i = 1; i <= 10; i++)
        await db.scheduledMessage.create({
          data: {
            userId,
            conversationId,
            automationRuleId: ruleId,
            content: 'Mensagem de contexto',
            status: 'SENT',
            scheduledFor: new Date(reminderAt.getTime() + i * 1000),
            sentAt: new Date(reminderAt.getTime() + i * 1000),
            externalMessageId: randomUUID(),
          },
        });
      const input = {
        userId,
        conversationId,
        messageId: randomUUID(),
        text: 'Já bebi 1 litro de água hoje.',
        receivedAt: at.toISOString(),
        legacyIntent: 'UNKNOWN' as const,
        hydrationReminderId: reminder.id,
        proactiveReply: true,
      };
      const context = await turnBuilder.build(input);
      expect(context.humanContext.hydrationReply).toMatchObject({
        reminderQuestion: reminder.content,
        tracking: 'READ_ONLY_REPORT',
        goalConfirmed: false,
      });
      await expect(
        turnBuilder.build({ ...input, userId: foreignId }),
      ).rejects.toThrow('Conversa não encontrada');
      await db.scheduledMessage.update({
        where: { id: reminder.id },
        data: { automationRuleId: ruleId },
      });
      await expect(turnBuilder.build(input)).rejects.toThrow(
        'UNOWNED_HYDRATION_REMINDER',
      );
      await db.scheduledMessage.update({
        where: { id: reminder.id },
        data: {
          automationRuleId: hydrationRuleId,
          status: 'PENDING',
          sentAt: null,
        },
      });
      await expect(turnBuilder.build(input)).rejects.toThrow(
        'UNOWNED_HYDRATION_REMINDER',
      );
      await db.scheduledMessage.update({
        where: { id: reminder.id },
        data: { status: 'SENT', sentAt: reminderAt },
      });
      await db.scheduledMessage.update({
        where: { id: reminder.id },
        data: { responseExpiresAt: new Date(at.getTime() - 1) },
      });
      await expect(turnBuilder.build(input)).rejects.toThrow(
        'UNOWNED_HYDRATION_REMINDER',
      );
      expect(provider.createTextResponse).not.toHaveBeenCalled();
    });
    it('isolates another user at the inbound boundary without provider calls', async () => {
      const message = await db.message.create({
        data: {
          conversationId,
          direction: 'INBOUND',
          type: 'TEXT',
          content: realCalories,
        },
      });
      await expect(
        command.processTextMessage({
          userId: foreignId,
          messageId: message.id,
        }),
      ).resolves.toMatchObject({
        handled: false,
        reason: 'TEXT_MESSAGE_NOT_FOUND',
      });
      expect(provider.createTextResponse).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
    it('macro P0 dinner preserves two distinct options without aggregating their ingredients into a copied plan meal', async () => {
      const first = 'Peito de frango com batata e abobrinha.';
      const second = 'Arroz branco com peixe e feijão.';
      const text = `${first} Outra ideia é ${second}`;
      outputs.push({
        ...answer(text),
        nutritionComposition: {
          previous: [],
          current: [
            composition(
              first,
              ['Peito de frango', 'batata'],
              'Peito de frango',
              ['abobrinha'],
            ),
            composition(second, ['Arroz branco', 'peixe'], 'peixe', ['feijão']),
          ],
        },
      });
      expect(
        (await inbound('Me dê uma dica para jantar hoje')).response.content,
      ).toBe(text);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
    });
    it.each([true, false])(
      'macro P0 rejects a full copied meal even when composition omits it, within or outside the declared quote: %s',
      async (withinQuote) => {
        const copied =
          'Arroz branco com peito de frango grelhado, abobrinha e feijão.';
        const fresh = 'Batata assada com peixe.';
        const text = `${fresh} Outra opção é ${copied}`;
        outputs.push(
          {
            ...answer(text),
            nutritionComposition: {
              previous: [],
              current: [
                composition(
                  withinQuote ? text : fresh,
                  ['batata', 'peixe'],
                  'peixe',
                ),
              ],
            },
          },
          answer(newDinner),
        );
        const turn = await inbound('Me dê uma dica para jantar hoje');
        expect(turn.response.content).toBe(newDinner);
        expect(provider.createTextResponse).toHaveBeenCalledTimes(2);
        const audit = await db.auditLog.findFirstOrThrow({
          where: { userId, action: 'CONVERSATION_RUNTIME_EVALUATED' },
        });
        expect(audit.metadata).toMatchObject({
          nutritionAdviceInitialViolation:
            'NUTRITION_ADVICE_REPEATS_CURRENT_MEAL',
          nutritionAdviceRetryOutcome: 'RECOVERED',
        });
      },
    );
    it.each([
      ['me dá uma dica de janta 😋!!', 'jantar', newDinner],
      [
        'me de uma dica pra jantar',
        'jantar',
        'Uma ideia aproximada para jantar é macarrão com bife bovino e cenoura.',
      ],
      [
        'o que eu como hoje a noite?',
        null,
        'Para hoje à noite, uma ideia aproximada é batata assada com peixe.',
      ],
      [
        'tô com fome, o que faço?',
        null,
        'Se está com fome, uma ideia é banana com aveia, respeitando suas restrições.',
      ],
      [
        'manda um lanche',
        'lanche',
        'Uma ideia para o lanche é banana com aveia.',
      ],
      [
        'um lanche pra tarde',
        'lanche',
        'Uma ideia para o lanche da tarde é um sanduíche de frango com pepino.',
      ],
      [
        'o que eu como antes do treino?',
        null,
        'Antes do treino, uma ideia aproximada e simples é banana com aveia.',
      ],
      [
        'que posso comer depois da academia?',
        null,
        'Depois da academia, uma ideia aproximada é um sanduíche de frango com cenoura.',
      ],
      [
        'e pro café da manhã?',
        'cafe da manha',
        'Para o café da manhã, uma ideia é aveia com banana.',
      ],
      [
        'o que eu como agora?',
        null,
        'Para comer agora, uma ideia simples é banana com aveia.',
      ],
      [
        'tô com fome agora, o que faço?',
        null,
        'Uma ideia para essa fome agora é um sanduíche de frango com pepino.',
      ],
    ] as const)(
      'macro P0 everyday language reaches controlled QA and a single public response: %s',
      async (text, meal, recommendation) => {
        outputs.push(answer(recommendation));
        const turn = await inbound(text);
        const audit = await db.auditLog.findFirstOrThrow({
          where: { userId, action: 'CONVERSATION_RUNTIME_EVALUATED' },
        });
        expect(audit.metadata).toMatchObject({
          routeKind: expect.stringMatching(
            /^(NUTRITION_GUIDANCE|ANSWER_MESSAGE)$/u,
          ),
          answerSource: 'AI',
        });
        expect(turn.response.content).toBe(recommendation);
        expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
        const payload: {
          request: string;
          nutritionGuidance: { meal: string | null; intent: string };
        } = JSON.parse(provider.createTextResponse.mock.calls[0][0].input);
        expect(payload.request).toBe(text);
        expect(payload.nutritionGuidance).toMatchObject({
          meal,
          intent: 'NUTRITION_ADVICE',
        });
      },
    );
    it('macro P0 sequence calories then dinner then snack then two options preserves targets, safety and retries', async () => {
      const calories =
        'Como aproximação para 95 kg e 60 minutos de musculação, o gasto pode ficar em torno de 350 a 550 kcal, conforme intensidade e pausas. Não é uma medição individual.';
      outputs.push(answer(calories, 'WORKOUT'));
      expect((await inbound(realCalories)).response.content).toBe(calories);
      for (const [request, meal, recommendation] of [
        ['Me dê uma dica para jantar hoje', 'jantar', newDinner],
        [
          'Me dê uma dica de lanche da tarde',
          'lanche da tarde',
          'Uma ideia para o lanche da tarde é banana com aveia.',
        ],
      ]) {
        outputs.push(answer(recommendation));
        expect((await inbound(request)).response.content).toBe(recommendation);
        const payload: {
          request: string;
          nutritionGuidance: { meal: string | null };
        } = JSON.parse(provider.createTextResponse.mock.calls.at(-1)![0].input);
        expect(payload.request).toBe(request);
        expect(payload.nutritionGuidance.meal).toBe(meal);
      }
      const text = 'Batata com peixe. Outra ideia é macarrão com bife bovino.';
      outputs.push({
        ...answer(text),
        nutritionComposition: {
          previous: [],
          current: [
            composition('Batata com peixe.', ['batata', 'peixe'], 'peixe'),
            composition(
              'macarrão com bife bovino.',
              ['macarrão', 'bife bovino'],
              'bife bovino',
            ),
          ],
        },
      });
      expect(
        (
          await inbound(
            'Me sugira duas opções de jantar para hoje, considerando meu plano alimentar atual e minhas restrições.',
          )
        ).response.content,
      ).toBe(text);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(4);
    });
    it('macro P0 elliptical substitution retains the delivered meal and clarifies missing evidence without granting permission', async () => {
      outputs.push(answer(newDinner));
      await inbound('Me dê uma dica para jantar hoje');
      outputs.push({
        ...answer('', 'NUTRITION'),
        disposition: 'CLARIFY',
        answer: null,
        followUpQuestion:
          'Qual alimento do jantar você quer substituir por ovo?',
      });
      const turn = await inbound('troca por ovo?');
      expect(turn.response.content).not.toMatch(
        /pode (?:sim|trocar)|\b\d+ ovos?\b/iu,
      );
      expect(provider.createTextResponse).toHaveBeenCalledTimes(2);
      const job = await db.aIJob.findFirstOrThrow({
        where: { userId, messageId: turn.inbound.id },
      });
      expect(job.result).toMatchObject({
        disposition: 'CLARIFY',
        domain: 'NUTRITION',
        nutritionDecisionSource: 'DOMAIN',
      });
      expect(turn.response.content).toBe(
        'Qual é o alimento original dessa troca?',
      );
    });
    it('macro P0 snack is independent from a dinner plan and failed dinner clarification', async () => {
      await db.scheduledMessage.create({
        data: {
          userId,
          conversationId,
          automationRuleId: ruleId,
          scheduledFor: new Date(at.getTime() - 1000),
          sentAt: new Date(at.getTime() - 1000),
          status: 'SENT',
          content: 'Que alimentos você tem disponíveis para uma alternativa?',
        },
      });
      const text =
        'Uma ideia aproximada para o lanche é arroz branco com peito de frango, abobrinha e feijão.';
      outputs.push(answer(text));
      expect(
        (await inbound('Me dê uma dica de lanche da tarde')).response.content,
      ).toBe(text);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
    });
    it('macro P0 two dinner options repair malformed composition once and publish the valid correction', async () => {
      const first = 'Batata com peixe.';
      const second = 'Macarrão com bife bovino.';
      outputs.push({
        ...answer(`${first} ${second}`),
        nutritionComposition: {
          previous: [],
          current: [composition(first, ['batata', 'peixe'], 'PEIXE')],
        },
      });
      const text = `${first} Outra ideia é ${second}`;
      outputs.push({
        ...answer(text),
        nutritionComposition: {
          previous: [],
          current: [
            composition(first, ['batata', 'peixe'], 'peixe'),
            composition(second, ['macarrão', 'bife bovino'], 'bife bovino'),
          ],
        },
      });
      expect(
        (
          await inbound(
            'Me sugira duas opções de jantar para hoje, considerando meu plano alimentar atual e minhas restrições.',
          )
        ).response.content,
      ).toBe(text);
      expect(provider.createTextResponse).toHaveBeenCalledTimes(2);
    });
  },
);
