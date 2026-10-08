import type { ConversationAIService } from '../ai/conversation-ai.service';
import { chunkWorkoutWhatsApp } from '../workout/v2/workout-whatsapp.chunker';
import { explicitContinuationDomain } from '../conversation/understanding/explicit-continuation-domain.policy';
import { isWorkoutCurrentPlanRead } from '../workout/v2/workout-current-plan-read.policy';
import { Test } from '@nestjs/testing';
import { IntegrationEventHandlersService } from '../event-bus/integration-event-handlers.service';
import { EventHandlerRegistry } from '../event-bus/event-handler.registry';
import { INTERNAL_EVENT } from '../event-bus/event-bus.constants';
import { AutomationService } from './automation.service';
import type { OutboxEvent } from '@prisma/client';
import {
  historicalWorkoutPlan,
  longitudinalWorkoutSnapshot,
} from '../workout/v2/workout-longitudinal.fixtures';
import type { WorkoutPlanV2 } from '../workout/v2/workout-plan-v2.contract';
import { AIJobStatus, AIJobType } from '@prisma/client';
import { AIService } from '../ai/ai.service';
import { ConversationModule } from '../conversation/conversation.module';
import { CoachConversationHumanContextBuilder } from '../context/coach-conversation-human-context.builder';
import {
  goalPreparationInput,
  goalDecision,
  routingSnapshot,
  readyAdaptiveDecision,
} from '../conversation/tests/conversation-routing.fixtures';
import { LegacyCoachIntentAdapter } from './legacy-coach-intent.adapter';
import { ConversationGoalPlannerService } from '../context/conversation-goal-planner.service';
import { PlanningExecutionRoutePolicyService } from './planning-execution-route-policy.service';
import { GenerateWorkoutPlanV2InputBuilder } from '../workout/v2/generate-workout-plan-v2-input.builder';
import { WorkoutPlanMutationResolverService } from '../workout/v2/workout-plan-mutation-resolver.service';
import type { CoachProfileSnapshotBuilder } from '../context/coach-profile-snapshot.builder';
import type { CoachAdaptiveProfileCollectorService } from '../context/coach-adaptive-profile-collector.service';
import type { WorkoutApplicationExecutorService } from '../workout/v2/execution/workout-application-executor.service';
import type { WorkoutPlanV2Formatter } from '../workout/v2/workout-plan-v2.formatter';
import type { CurrentWorkoutPlanReaderService } from '../workout/v2/current-workout-plan-reader.service';
import { understandingInput } from '../conversation/tests/conversation-understanding.fixtures';
import type { ConversationRuntimeInput } from '../conversation/contracts/conversation-runtime.contract';
import { ConversationRuntimeService } from '../conversation/runtime/conversation-runtime.service';
import { ConversationExecutionBridgeService } from '../conversation/runtime/conversation-execution-bridge.service';
import { ConversationResponsePayloadBuilder } from '../conversation/runtime/conversation-response-payload.builder';
import { ConversationLanguageRealizerService } from '../conversation/runtime/conversation-language-realizer.service';
import { ConversationResponseFormatterService } from '../conversation/runtime/conversation-response-formatter.service';
import { ConversationResponseValidatorService } from '../conversation/runtime/conversation-response-validator.service';
import { ConversationOfficialSelectionService } from '../conversation/runtime/conversation-official-selection.service';
import { ConversationShadowComparatorService } from '../conversation/runtime/conversation-shadow-comparator.service';
import { ConversationRuntimeOperationalConfigService } from '../conversation/runtime/conversation-runtime-operational-config.service';
import { ConversationRuntimeAuditService } from '../conversation/runtime/conversation-runtime-audit.service';
import { ConversationTurnContextBuilderService } from '../conversation/runtime/conversation-turn-context-builder.service';
import { ConversationQAExecutorService } from '../conversation/runtime/conversation-qa-executor.service';
import { ConversationCurrentNutritionContextService } from '../conversation/runtime/conversation-current-nutrition-context.service';
import { ConversationPublicAnswerBoundaryService } from '../conversation/runtime/conversation-public-answer-boundary.service';
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ScheduledMessageStatus } from '@prisma/client';
import { DietGeneratorService } from '../diet/diet-generator.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutGeneratorService } from '../workout/workout-generator.service';
import { AUTOMATION_RULE_CODES } from './automation.constants';
import { CoachCommandService } from './coach-command.service';
import { DurableTextPendingError } from '../ai/durable-text-operation.contract';
import { ConversationContinuationService } from '../conversation/runtime/conversation-continuation.service';
import { ConversationContinuationStore } from '../conversation/runtime/conversation-continuation.store';
import { ConversationContinuationSemanticsService } from '../conversation/runtime/conversation-continuation-semantics.service';
import { ConversationSafetyDetectorService } from '../conversation/understanding/conversation-safety-detector.service';
import { ConversationMessageNormalizerService } from '../conversation/understanding/conversation-message-normalizer.service';
import type { ConversationQAFollowUpContextService } from '../conversation/runtime/conversation-qa-follow-up-context.service';
import type { CurrentNutritionPlanReaderService } from '../diet/current-nutrition-plan-reader.service';
import type { NutritionConsumptionSummaryService } from '../nutrition/nutrition-consumption-summary.service';
import { continuation } from '../conversation/runtime/conversation-continuation.contract';
import { ConversationDailyQueryService } from '../conversation/runtime/conversation-daily-query.service';
import { ConversationProfileConsentService } from '../conversation/runtime/conversation-profile-consent.service';
import { CoachPlanningExecutionDispatcherService } from './coach-planning-execution-dispatcher.service';
import type { CoachPlanningBothApplicationExecutorService } from './coach-planning-both-application-executor.service';
import { CoachPlanningExecutionService } from './coach-planning-execution.service';
import { ConversationGoalShadowPipelineService } from './conversation-goal-shadow-pipeline.service';
import { ConversationRuntimeIntegrationService } from '../conversation/runtime/conversation-runtime-integration.service';
import type { CoachPlanningConversationResponseService } from './coach-planning-conversation-response.service';
import type { ProfileAcquisitionInternalRolloutService } from '../context/profile-acquisition/profile-acquisition-internal-rollout.service';
import type { CurrentWorkoutPlanReaderService } from '../workout/v2/current-workout-plan-reader.service';

describe('CoachCommandService', () => {
  function dietPlan(): Parameters<
    CoachPlanningExecutionDispatcherService['formatDiet']
  >[0] {
    return {
      id: 'diet-id',
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'ai-job-id',
      title: 'Plano alimentar brasileiro',
      objective: 'WEIGHT_LOSS',
      dailyCaloriesTarget: new Prisma.Decimal('1800'),
      proteinTarget: new Prisma.Decimal('140'),
      carbsTarget: new Prisma.Decimal('180'),
      fatTarget: new Prisma.Decimal('60'),
      status: 'ACTIVE',
      generatedAt: new Date('2026-06-10T12:00:00.000Z'),
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      meals: [
        {
          id: 'meal-id',
          dietPlanId: 'diet-id',
          name: 'Café da manhã',
          order: 1,
          caloriesTarget: new Prisma.Decimal('430'),
          notes: 'Priorize proteína.',
          items: [
            {
              id: 'item-id',
              dietMealId: 'meal-id',
              foodName: 'Ovos',
              quantity: '2 unidades',
              calories: new Prisma.Decimal('140'),
              protein: new Prisma.Decimal('12'),
              carbs: new Prisma.Decimal('1'),
              fat: new Prisma.Decimal('10'),
              substitutionGroup: 'proteína',
            },
          ],
        },
      ],
      aiJob: {
        usage: [],
      },
    } as unknown as Parameters<
      CoachPlanningExecutionDispatcherService['formatDiet']
    >[0];
  }

  function workoutPlan(): Parameters<
    CoachPlanningExecutionDispatcherService['formatWorkout']
  >[0] {
    return {
      id: 'workout-id',
      userId: 'user-id',
      profileId: 'profile-id',
      aiJobId: 'ai-job-id',
      title: 'Treino inicial',
      objective: 'MUSCLE_GAIN',
      status: 'ACTIVE',
      generatedAt: new Date('2026-06-10T12:00:00.000Z'),
      createdAt: new Date('2026-06-10T12:00:00.000Z'),
      updatedAt: new Date('2026-06-10T12:00:00.000Z'),
      days: [
        {
          id: 'day-id',
          workoutPlanId: 'workout-id',
          dayNumber: 1,
          title: 'Força geral',
          exercises: [
            {
              id: 'exercise-id',
              workoutDayId: 'day-id',
              exerciseName: 'Agachamento',
              sets: 3,
              reps: '10',
              restSeconds: 90,
              notes: null,
            },
          ],
        },
      ],
    } as unknown as Parameters<
      CoachPlanningExecutionDispatcherService['formatWorkout']
    >[0];
  }

  function createSubject(options?: {
    content?: string;
    onboardingCompleted?: boolean;
    existingContent?: string | null;
    dietFailure?: Error;
    workoutFailure?: Error;
    runtimeContent?: string;
    runtimeFailure?: Error;
    runtimeLegacy?: boolean;
    runtimeHandoff?: boolean;
    controlledPlanning?: boolean;
    controlledPreviousPlan?: WorkoutPlanV2;
    controlledAdherenceScore?: number;
    controlledProfileReady?: boolean;
    runtimePlanningDecision?: import('../context/conversation-goal-planner.contract').ConversationGoalDecision;
    runtimeProfileAcquisitionHandoff?: boolean;
    planningConversationContent?: string;
    workoutClarification?: boolean;
    workoutSelection?: boolean;
    selectionExpired?: boolean;
    replyToExternalMessageId?: string | null;
    latestSelectionAction?: string;
    activeProfileAskedAt?: Date | null;
    currentWorkoutStatus?:
      | 'AVAILABLE'
      | 'LEGACY_RELATIONAL'
      | 'NO_PLAN'
      | 'INVALID_V2_PLAN';
    currentWorkoutPlanId?: string;
    dailyEnabled?: boolean;
    dailyQueries?: ConversationDailyQueryService;
    dailyContent?: string | null;
    profileConsentContent?: string;
    continuations?: ConversationContinuationService;
  }) {
    const at = new Date('2026-06-10T12:00:00.000Z');
    const rule = {
      id: 'rule-id',
      code: AUTOMATION_RULE_CODES.DAILY_COACH,
      name: 'Coach diário',
      enabled: true,
    };
    const scheduledMessage = {
      id: 'scheduled-id',
      userId: 'user-id',
      automationRuleId: rule.id,
      scheduledFor: at,
      status: ScheduledMessageStatus.PENDING,
      content: 'Resposta',
      attempts: 0,
      leaseExpiresAt: null,
      createdAt: at,
      automationRule: rule,
    };
    const transaction = {
      automationRule: { findUnique: jest.fn().mockResolvedValue(rule) },
      userAutomationPreference: { upsert: jest.fn() },
      $queryRaw: jest.fn(),
      coachMessage: {
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((input: { data: Record<string, unknown> }) => ({
            id: 'canonical-coach',
            ...input.data,
          })),
      },
      scheduledMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue(scheduledMessage),
      },
    };
    const prisma = {
      fitnessCheckIn: {
        findMany: jest.fn().mockResolvedValue(
          options?.controlledAdherenceScore === undefined
            ? []
            : [
                {
                  userId: 'user-id',
                  profileId: 'profile-id',
                  adherenceScore: options.controlledAdherenceScore,
                  createdAt: new Date('2026-06-09T12:00:00Z'),
                },
              ],
        ),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message-id',
          content: options?.content ?? 'quero uma dieta',
          timestamp: at,
          replyToExternalMessageId: options?.replyToExternalMessageId ?? null,
          conversationId: 'conversation-id',
          conversation: {
            id: 'conversation-id',
            user: {
              onboardingCompleted: options?.onboardingCompleted ?? true,
              ...(options?.controlledPlanning
                ? { fitnessProfile: { id: 'profile-id' } }
                : {}),
            },
          },
        }),
      },
      coachMessage: {
        findUnique: jest.fn().mockResolvedValue(
          options?.existingContent
            ? {
                id: 'coach-message-id',
                content: options.existingContent,
              }
            : null,
        ),
        create: jest.fn().mockResolvedValue({
          id: 'coach-message-id',
        }),
      },
      scheduledMessage: {
        findFirst: jest.fn().mockResolvedValue(
          options?.workoutSelection
            ? {
                context: {
                  action:
                    options?.latestSelectionAction ??
                    'WORKOUT_SESSION_SELECTION',
                  workoutPlanId: 'workout-id',
                  allowedSessionSequences: [1, 2],
                },
                responseExpiresAt: options?.selectionExpired
                  ? new Date('2026-06-10T11:59:00.000Z')
                  : new Date('2026-06-11T12:00:00.000Z'),
                scheduledFor: new Date('2026-06-10T11:55:00.000Z'),
                sentAt: new Date('2026-06-10T11:55:01.000Z'),
              }
            : null,
        ),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.activeProfileAskedAt
              ? { askedAt: options.activeProfileAskedAt }
              : null,
          ),
      },
      automationRule: {
        findUnique: jest.fn().mockResolvedValue(rule),
      },
      userAutomationPreference: {
        upsert: jest.fn().mockResolvedValue({
          id: 'preference-id',
        }),
      },
      $transaction: jest.fn(
        (operation: (client: typeof transaction) => Promise<unknown>) =>
          operation(transaction),
      ),
    };
    const dietGenerator = {
      generate: options?.dietFailure
        ? jest.fn().mockRejectedValue(options.dietFailure)
        : jest.fn().mockResolvedValue(dietPlan()),
      generateCandidate: options?.dietFailure
        ? jest.fn().mockRejectedValue(options.dietFailure)
        : jest.fn().mockResolvedValue({ domain: 'DIET' }),
      failCandidate: jest.fn().mockResolvedValue(undefined),
    };
    const workoutGenerator = {
      generate: options?.workoutFailure
        ? jest.fn().mockRejectedValue(options.workoutFailure)
        : jest.fn().mockResolvedValue(workoutPlan()),
      generateCandidate: options?.workoutFailure
        ? jest.fn().mockRejectedValue(options.workoutFailure)
        : jest.fn().mockResolvedValue({ domain: 'WORKOUT' }),
    };
    const bothExecutor = {
      execute: jest.fn().mockResolvedValue({
        dietPlan: dietPlan(),
        workoutPlan: workoutPlan(),
      }),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({
        id: 'outbox-id',
      }),
    };
    const conversationGoalShadow = {
      execute: jest.fn(),
    };
    const conversationRuntime = {
      decide: options?.runtimeFailure
        ? jest.fn().mockRejectedValue(options.runtimeFailure)
        : options?.runtimeProfileAcquisitionHandoff
          ? jest.fn().mockResolvedValue({
              source: 'PLANNING_HANDOFF',
              reason: 'PROFILE_ACQUISITION_REQUIRES_SINGLE_EXECUTION',
              profileAcquisition: {
                executionRoute: {
                  kind: 'PROFILE_ACQUISITION',
                  targetPlan: 'WORKOUT',
                  selectedProfileField: 'CURRENT_RUNNING_DISTANCE',
                },
                logicalTurn: 7,
              },
            })
          : options?.runtimeHandoff
            ? jest.fn().mockResolvedValue({
                source: 'PLANNING_HANDOFF',
                reason: 'SIDE_EFFECT_ROUTE_REQUIRES_SINGLE_EXECUTION',
                planningDecision: options.runtimePlanningDecision,
              })
            : jest.fn().mockResolvedValue({
                source: options?.runtimeContent
                  ? 'CONVERSATION_RUNTIME'
                  : 'LEGACY',
                reason: options?.runtimeContent
                  ? 'RUNTIME_SELECTED'
                  : 'RUNTIME_DISABLED',
                ...(options?.runtimeContent
                  ? { content: options.runtimeContent }
                  : {}),
              }),
    };
    const controlledWorkoutExecutor = {
      execute: jest.fn().mockResolvedValue({
        kind: 'PLAN',
        document: { sessions: [] },
        projection: { days: [] },
        aiJobCompleted: true,
      }),
    };
    const controlledWorkoutReader = {
      readPrevious: jest
        .fn()
        .mockResolvedValue(
          options?.controlledPreviousPlan
            ? { userId: 'user-id', document: options.controlledPreviousPlan }
            : null,
        ),
      read: jest.fn().mockResolvedValue(
        options?.controlledPreviousPlan
          ? {
              status: 'AVAILABLE',
              plan: {
                userId: 'user-id',
                document: options.controlledPreviousPlan,
              },
            }
          : { status: 'NO_PLAN', plan: null },
      ),
      present: jest.fn().mockResolvedValue('Plano atual controlado'),
    };
    const controlledSnapshotBuilder = {
      build: jest
        .fn()
        .mockResolvedValue(
          options?.controlledPreviousPlan
            ? longitudinalWorkoutSnapshot()
            : routingSnapshot(),
        ),
    };
    const planningDispatcher = new CoachPlanningExecutionDispatcherService(
      dietGenerator as unknown as DietGeneratorService,
      workoutGenerator as unknown as WorkoutGeneratorService,
      bothExecutor as unknown as CoachPlanningBothApplicationExecutorService,
      undefined,
      undefined,
      options?.controlledPlanning
        ? (controlledWorkoutExecutor as unknown as WorkoutApplicationExecutorService)
        : undefined,
      options?.controlledPlanning
        ? ({
            format: () => ['Treino V2 controlado'],
          } as unknown as WorkoutPlanV2Formatter)
        : undefined,
      options?.controlledPlanning
        ? (controlledWorkoutReader as unknown as CurrentWorkoutPlanReaderService)
        : undefined,
    );
    const planningExecution = new CoachPlanningExecutionService(
      planningDispatcher,
      options?.controlledPlanning
        ? (controlledSnapshotBuilder as unknown as CoachProfileSnapshotBuilder)
        : undefined,
      options?.controlledPlanning ? new LegacyCoachIntentAdapter() : undefined,
      options?.controlledPlanning
        ? ({
            decide: () =>
              options.controlledProfileReady === false
                ? {
                    ...readyAdaptiveDecision(),
                    readiness: [
                      {
                        plan: 'WORKOUT',
                        ready: false,
                        blockingFields: ['TRAINING_EXPERIENCE'],
                      },
                    ],
                  }
                : readyAdaptiveDecision(),
          } as unknown as CoachAdaptiveProfileCollectorService)
        : undefined,
      options?.controlledPlanning
        ? new ConversationGoalPlannerService()
        : undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options?.controlledPlanning
        ? new PlanningExecutionRoutePolicyService({
            evaluate: () => ({ status: 'DISABLED', eligible: false }),
          } as never)
        : undefined,
      undefined,
      prisma as unknown as PrismaService,
      undefined,
      undefined,
      options?.controlledPlanning
        ? new GenerateWorkoutPlanV2InputBuilder(
            controlledSnapshotBuilder as unknown as CoachProfileSnapshotBuilder,
            prisma as unknown as PrismaService,
            controlledWorkoutReader as unknown as CurrentWorkoutPlanReaderService,
          )
        : undefined,
      options?.controlledPlanning
        ? new WorkoutPlanMutationResolverService(
            controlledWorkoutReader as unknown as CurrentWorkoutPlanReaderService,
          )
        : undefined,
    );
    const planningConversationResponse = {
      select: jest
        .fn()
        .mockResolvedValue(
          options?.planningConversationContent ?? 'resposta conversacional',
        ),
    };
    const profileAcquisitionRollout = {
      requestWorkoutClarification: jest.fn().mockResolvedValue({
        executed: true,
        questionCreated: true,
        reason: 'QUESTION_PREPARED' as const,
        mode: 'INTERNAL' as const,
        cycleId: 'cycle-id',
        field: 'TRAINING_EXPERIENCE' as const,
      }),
      requestProductiveClarification: jest.fn().mockResolvedValue({
        executed: true,
        questionCreated: true,
        reason: 'QUESTION_PREPARED' as const,
        mode: 'INTERNAL' as const,
        cycleId: 'cycle-id',
        field: 'DESIRED_MEAL_COUNT' as const,
      }),
    };
    const currentWorkoutPlanReader = {
      read: jest.fn().mockResolvedValue(
        options?.currentWorkoutStatus === 'NO_PLAN' ||
          options?.currentWorkoutStatus === 'INVALID_V2_PLAN'
          ? { status: options.currentWorkoutStatus, plan: null }
          : options?.currentWorkoutStatus === 'LEGACY_RELATIONAL'
            ? {
                status: 'LEGACY_RELATIONAL',
                plan: {
                  aggregateId: options.currentWorkoutPlanId ?? 'workout-id',
                  sessions: [{ sequence: 1 }, { sequence: 2 }],
                },
              }
            : {
                status: 'AVAILABLE',
                plan: {
                  aggregateId: options?.currentWorkoutPlanId ?? 'workout-id',
                  document: { sessions: [{ sequence: 1 }, { sequence: 2 }] },
                },
              },
      ),
    };
    const profileConsent = {
      accepts: jest.fn().mockReturnValue(true),
      process: jest.fn().mockResolvedValue(options?.profileConsentContent),
    };
    const service = new CoachCommandService(
      prisma as unknown as PrismaService,
      planningExecution,
      eventBus as unknown as EventBusService,
      conversationGoalShadow as unknown as ConversationGoalShadowPipelineService,
      options?.runtimeContent ||
        options?.runtimeFailure ||
        options?.runtimeLegacy ||
        options?.runtimeHandoff ||
        options?.runtimeProfileAcquisitionHandoff
        ? (conversationRuntime as unknown as ConversationRuntimeIntegrationService)
        : undefined,
      options?.planningConversationContent
        ? (planningConversationResponse as unknown as CoachPlanningConversationResponseService)
        : undefined,
      undefined,
      options?.workoutClarification
        ? (profileAcquisitionRollout as unknown as ProfileAcquisitionInternalRolloutService)
        : undefined,
      currentWorkoutPlanReader as unknown as CurrentWorkoutPlanReaderService,
      options?.dailyQueries ??
        (options?.dailyEnabled
          ? ({
              accepts: () => options.dailyContent !== undefined,
              answer: () => Promise.resolve(options.dailyContent ?? null),
            } as unknown as ConversationDailyQueryService)
          : undefined),
      options?.profileConsentContent
        ? (profileConsent as unknown as ConversationProfileConsentService)
        : undefined,
      options?.continuations,
    );

    return {
      service,
      prisma,
      transaction,
      planningDispatcher,
      planningExecution,
      controlledWorkoutExecutor,
      controlledWorkoutReader,
      dietGenerator,
      workoutGenerator,
      eventBus,
      conversationGoalShadow,
      conversationRuntime,
      planningConversationResponse,
      profileAcquisitionRollout,
      currentWorkoutPlanReader,
      profileConsent,
    };
  }

  it('does not lose a read-only response when canonical continuation returns null', async () => {
    const content =
      'Bom dia. Já tomei 1 litro de água pela manhã e já realizei meu treino de superiores na academia.';
    const continuations = {
      enabled: () => true,
      source: jest.fn().mockResolvedValue({
        id: 'message-id',
        conversationId: 'conversation-id',
        content,
        timestamp: new Date(),
      }),
      resolve: jest.fn().mockResolvedValue(null),
    };
    const s = createSubject({
      content,
      continuations:
        continuations as unknown as ConversationContinuationService,
      runtimeContent:
        'Bom dia! Você já se hidratou e concluiu o treino. Como ficou sua energia?',
    });
    expect(
      await s.service.processCanonicalContinuation({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).toBe(false);
    const result = await s.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(result.handled).toBe(true);
    expect(s.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(s.dietGenerator.generate).not.toHaveBeenCalled();
    const row = {
      id: 'coach-id',
      ...s.prisma.coachMessage.create.mock.calls[0][0].data,
    };
    s.prisma.coachMessage.findUnique.mockResolvedValue(row);
    await s.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(s.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(s.conversationRuntime.decide).toHaveBeenCalledTimes(1);
  });
  it('cannot generate from a retrospective report plus caller-provided planning metadata or quote', async () => {
    const content =
      'Já tomei água e concluí meu treino de musculação na academia.';
    const s = createSubject({
      content,
      controlledPlanning: true,
      runtimeHandoff: true,
      runtimePlanningDecision: goalDecision(
        'GENERATE_WORKOUT_PLAN',
        'WORKOUT_PLAN_REQUEST',
        { targetPlan: 'WORKOUT' },
      ),
    });
    await s.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
      workoutEffectAuthorization: { effect: 'GENERATE', requestQuote: content },
    });
    expect(s.controlledWorkoutExecutor.execute).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    const result = await s.planningExecution.executeStructured(
      'user-id',
      'WORKOUT',
      {
        messageId: 'message-id',
        conversationId: 'conversation-id',
        correlationId: 'message-id',
        referenceDate: new Date(),
        planningDecision: goalDecision(
          'GENERATE_WORKOUT_PLAN',
          'WORKOUT_PLAN_REQUEST',
          { targetPlan: 'WORKOUT' },
        ),
      },
    );
    expect(result.dispatch.workoutDisposition).toBe('BLOCKED');
    expect(s.controlledWorkoutExecutor.execute).not.toHaveBeenCalled();
  });
  it('does not let a shortened model request span erase current-turn safety', async () => {
    const requestQuote = 'Monte um treino de CrossFit para mim';
    const s = createSubject({
      content: `Senti dor no peito. ${requestQuote}`,
      controlledPlanning: true,
    });
    await s.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
      workoutEffectAuthorization: { effect: 'GENERATE', requestQuote },
    });
    expect(s.controlledWorkoutExecutor.execute).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
  });
  it('delivers one report response through the real onboarding event, completed/null receipt, scheduling retry and automation send', async () => {
    const content =
      'Bom dia. Já tomei 1 litro de água pela manhã e já realizei meu treino de superiores na academia.';
    const answer =
      'Bom dia! Você já se hidratou e concluiu o treino. Como ficou sua energia?';
    const s = createSubject({ content, runtimeContent: answer });
    const forbiddenWrites = {
      aiJob: { create: jest.fn() },
      workoutPlan: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    Object.assign(s.prisma, forbiddenWrites);
    const source = await s.prisma.message.findFirst();
    s.prisma.message.findFirst.mockResolvedValue({
      ...source,
      conversation: {
        ...source.conversation,
        userId: 'user-id',
        user: {
          ...source.conversation.user,
          preferences: { timezone: 'America/Sao_Paulo' },
        },
      },
    });
    const receipt = {
      id: 'receipt',
      createdAt: source.timestamp,
      payload: {
        userId: 'user-id',
        conversationId: 'conversation-id',
        sourceMessageId: 'message-id',
        state: 'COMPLETED',
        result: null,
      },
    };
    const receiptBefore = JSON.stringify(receipt);
    const events = new Map<string, OutboxEvent>();
    const outbox = {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            eventType_aggregateType_aggregateId: {
              eventType: string;
              aggregateId: string;
            };
          };
        }) => {
          const key = where.eventType_aggregateType_aggregateId;
          return Promise.resolve(
            key.eventType === 'CONTINUATION_SEMANTIC_RECEIPT'
              ? receipt
              : (events.get(key.aggregateId) ?? null),
          );
        },
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: Pick<
            OutboxEvent,
            | 'eventType'
            | 'aggregateType'
            | 'aggregateId'
            | 'payload'
            | 'availableAt'
          >;
        }) => {
          const row: OutboxEvent = {
            ...data,
            id: 'outbound-event',
            status: 'PENDING',
            attempts: 0,
            claimedAt: null,
            processedAt: null,
            failedAt: null,
            lastError: null,
            createdAt: source.timestamp,
            updatedAt: source.timestamp,
          };
          events.set(data.aggregateId, row);
          return Promise.resolve(row);
        },
      ),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    Object.assign(s.transaction, { outboxEvent: outbox });
    const config = {
      get: () => ({ valid: true, killSwitch: false }),
      isOfficiallyEligible: () => true,
    };
    const store = new ConversationContinuationStore(
      s.prisma as unknown as PrismaService,
      config as unknown as ConversationRuntimeOperationalConfigService,
    );
    const semantics = { interpret: jest.fn() };
    const continuations = new ConversationContinuationService(
      s.prisma as unknown as PrismaService,
      semantics as unknown as ConversationContinuationSemanticsService,
      {} as never,
      {} as never,
      new ConversationPublicAnswerBoundaryService(),
      new ConversationSafetyDetectorService(),
      new ConversationMessageNormalizerService(),
      {} as never,
      store,
    );
    Object.defineProperty(s.service, 'continuations', { value: continuations });
    let coach: {
      id: string;
      content: string;
      context: Prisma.JsonValue;
    } | null = null;
    s.prisma.coachMessage.create.mockImplementation(({ data }) => {
      coach = { id: 'coach-id', content: data.content, context: data.context };
      return Promise.resolve(coach);
    });
    s.prisma.coachMessage.findUnique.mockImplementation(() =>
      Promise.resolve(coach),
    );
    type Scheduled = Prisma.ScheduledMessageGetPayload<{
      include: { automationRule: true; user: true };
    }>;
    let scheduled: Scheduled | null = null;
    s.transaction.scheduledMessage.findMany.mockImplementation(() =>
      Promise.resolve(scheduled ? [scheduled] : []),
    );
    s.transaction.scheduledMessage.upsert.mockRejectedValueOnce(
      new Error('transient scheduling failure'),
    );
    s.transaction.scheduledMessage.upsert.mockImplementation(({ create }) => {
      scheduled = {
        ...create,
        id: 'scheduled-id',
        attempts: 0,
        leaseExpiresAt: null,
        automationRule: {
          id: 'rule-id',
          code: AUTOMATION_RULE_CODES.DAILY_COACH,
          enabled: true,
        },
        user: {
          isActive: true,
          phone: 'local-test-only',
          phoneE164: null,
          preferences: null,
        },
      } as unknown as Scheduled;
      return Promise.resolve(scheduled);
    });
    const bus = new EventBusService(s.prisma as unknown as PrismaService);
    s.eventBus.publish.mockImplementation((input, client) =>
      bus.publish(input, client),
    );
    const scheduledStore = {
      findUnique: jest.fn(() => Promise.resolve(scheduled)),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(scheduled)),
      update: jest.fn(
        ({
          data,
        }: {
          data: { status: ScheduledMessageStatus; leaseExpiresAt?: Date };
        }) => {
          if (!scheduled) throw new Error('Missing scheduled row');
          scheduled = { ...scheduled, ...data };
          return Promise.resolve(scheduled);
        },
      ),
      updateMany: jest.fn(({ data }: { data: Partial<Scheduled> }) => {
        if (!scheduled) throw new Error('Missing scheduled row');
        scheduled = { ...scheduled, ...data };
        return Promise.resolve({ count: 1 });
      }),
    };
    const sendTransaction = {
      message: s.prisma.message,
      $queryRaw: jest.fn(),
      scheduledMessage: scheduledStore,
      userAutomationPreference: {
        findUnique: jest.fn().mockResolvedValue({
          remindersEnabled: false,
          progressReminderEnabled: false,
        }),
      },
    };
    const sendPrisma = {
      scheduledMessage: scheduledStore,
      $transaction: (run: (tx: typeof sendTransaction) => Promise<unknown>) =>
        run(sendTransaction),
    };
    const gateway = {
      sendText: jest
        .fn()
        .mockResolvedValue({ externalMessageId: 'local-send-id' }),
    };
    const automation = new AutomationService(
      sendPrisma as unknown as PrismaService,
      {} as never,
      {} as never,
      gateway as never,
      {
        requireAccessInTransaction: jest.fn().mockResolvedValue(undefined),
      } as never,
      bus,
      {} as never,
      {} as never,
      {} as never,
    );
    const registry = new EventHandlerRegistry();
    const acquisition = {
      captureActiveResponse: jest.fn().mockResolvedValue({ handled: false }),
      afterCoachResponseSent: jest.fn(),
    };
    const onboarding = {
      processTextMessage: jest.fn().mockResolvedValue({ handled: false }),
    };
    const handlerService = new IntegrationEventHandlersService(
      registry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      s.service,
      automation,
      {} as never,
      onboarding as never,
      acquisition as never,
      { authorizeOrNotify: jest.fn().mockResolvedValue(true) } as never,
      undefined,
      continuations,
    );
    handlerService.onModuleInit();
    const inbound = registry.get(INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED);
    const delivery = registry.get(INTERNAL_EVENT.AUTOMATION_TRIGGERED);
    if (!inbound || !delivery) throw new Error('Missing registered handlers');
    const event: OutboxEvent = {
      id: 'inbound-event',
      eventType: INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      aggregateType: 'MESSAGE',
      aggregateId: 'message-id',
      payload: { userId: 'user-id', messageId: 'message-id' },
      status: 'PROCESSING',
      attempts: 1,
      availableAt: source.timestamp,
      claimedAt: source.timestamp,
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: source.timestamp,
      updatedAt: source.timestamp,
    };
    await expect(inbound(event)).rejects.toThrow(
      'transient scheduling failure',
    );
    await inbound(event);
    await inbound(event);
    expect(events.size).toBe(1);
    const outbound = events.get('scheduled-id');
    if (!outbound) throw new Error('Missing public delivery');
    await delivery(outbound);
    await delivery(outbound);
    await inbound(event);
    expect(gateway.sendText).toHaveBeenCalledTimes(1);
    expect(gateway.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: answer }),
    );
    expect(s.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(s.conversationRuntime.decide).toHaveBeenCalledTimes(1);
    expect(semantics.interpret).not.toHaveBeenCalled();
    expect(outbox.update).not.toHaveBeenCalled();
    expect(outbox.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(receipt)).toBe(receiptBefore);
    expect(s.controlledWorkoutExecutor.execute).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(s.dietGenerator.generate).not.toHaveBeenCalled();
    expect(forbiddenWrites.aiJob.create).not.toHaveBeenCalled();
    expect(forbiddenWrites.workoutPlan.create).not.toHaveBeenCalled();
    expect(forbiddenWrites.workoutPlan.update).not.toHaveBeenCalled();
    expect(forbiddenWrites.workoutPlan.updateMany).not.toHaveBeenCalled();
  });
  it('preserves the report acknowledgment and the authorized plan request in one mixed response', async () => {
    const requestQuote =
      'Monte um treino de CrossFit para mim, 4 vezes por semana';
    const content = `Já tomei água e concluí meu treino na academia. ${requestQuote}`;
    const acknowledgement =
      'Você já se hidratou e concluiu o treino; vou considerar seu pedido de CrossFit.';
    const continuations = {
      enabled: () => true,
      source: jest.fn().mockResolvedValue({
        id: 'message-id',
        conversationId: 'conversation-id',
        content,
        timestamp: new Date('2026-06-10T12:00:00Z'),
      }),
      resolve: jest.fn().mockResolvedValue({
        content: acknowledgement,
        domain: 'GENERAL',
        next: null,
        pending: { scheduledMessageId: 'hydration' },
        outcome: 'COMPLETED',
        evidence: {
          workoutEffect: 'GENERATE',
          workoutRequestQuote: requestQuote,
        },
      }),
      claim: jest.fn().mockResolvedValue(true),
    };
    const s = createSubject({
      content,
      controlledPlanning: true,
      continuations:
        continuations as unknown as ConversationContinuationService,
    });
    expect(
      await s.service.processCanonicalContinuation({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).toBe(true);
    expect(s.controlledWorkoutExecutor.execute).toHaveBeenCalledTimes(1);
    expect(s.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(
      s.prisma.coachMessage.create.mock.calls[0][0].data.content,
    ).toContain(acknowledgement);
    expect(continuations.claim).toHaveBeenCalledTimes(1);
  });
  it.each([
    'Qual minha próxima refeição?',
    'Não mandei sobre treino. Perguntei QUAL A MINHA PRÓXIMA REFEIÇÃO DE HOJE',
    'não perguntei de treino, perguntei minha próxima refeição',
    'O que posso comer no jantar?',
  ])(
    'routes %s through nutrition without claiming the pending workout',
    async (content) => {
      const at = new Date('2026-06-10T12:00:00Z');
      const source = {
        id: 'message-id',
        content,
        timestamp: at,
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
        conversation: {
          userId: 'user-id',
          user: { preferences: { timezone: 'America/Sao_Paulo' } },
        },
      };
      const config = {
        get: () => ({ valid: true, killSwitch: false }),
        isOfficiallyEligible: () => true,
      };
      const store = new ConversationContinuationStore(
        {} as PrismaService,
        config as unknown as ConversationRuntimeOperationalConfigService,
      );
      jest.spyOn(store, 'source').mockResolvedValue(source);
      jest
        .spyOn(store, 'resolveOnce')
        .mockImplementation((_user, _id, _type, execute) => execute());
      jest.spyOn(store, 'pending').mockResolvedValue({
        scheduledMessageId: 'old-workout',
        question: 'Treino de terça-feira',
        continuation: continuation(
          'WORKOUT_DAY_QUERY',
          at,
          'UNKNOWN',
          'USER_QUERY',
          '2026-06-09',
        ),
      });
      const semantics = {
        interpret: jest.fn().mockResolvedValue({
          action: 'WORKOUT_QUERY',
          day: 'NEXT',
          reference: 'PENDING',
        }),
      };
      const workout = { presentCanonicalDay: jest.fn() };
      const resolver = new ConversationContinuationService(
        {} as PrismaService,
        semantics as unknown as ConversationContinuationSemanticsService,
        workout as unknown as CurrentWorkoutPlanReaderService,
        {} as ConversationCurrentNutritionContextService,
        new ConversationPublicAnswerBoundaryService(),
        new ConversationSafetyDetectorService(),
        new ConversationMessageNormalizerService(),
        {} as ConversationQAFollowUpContextService,
        store,
      );
      const claim = jest.spyOn(store, 'claim');
      const dailyPrisma = {
        userPreferences: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
        },
        message: { findFirst: jest.fn().mockResolvedValue(null) },
        scheduledMessage: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const nutrition = {
        getCurrent: jest.fn().mockResolvedValue({
          userId: 'user-id',
          implementation: 'V2',
          document: {
            artifactType: 'WEEKLY_PLAN',
            days: [
              {
                label: 'Quarta-feira',
                dayNumber: 4,
                meals: [
                  {
                    period: 'LUNCH',
                    name: 'Almoço quarta',
                    suggestedTime: '12:00',
                    items: [{ quantity: '120 g', foodName: 'Peixe' }],
                  },
                  {
                    period: 'DINNER',
                    name: 'Jantar quarta',
                    suggestedTime: '19:00',
                    items: [{ quantity: '120 g', foodName: 'Peixe' }],
                  },
                ],
              },
            ],
          },
        }),
      };
      const daily = new ConversationDailyQueryService(
        dailyPrisma as unknown as PrismaService,
        {} as NutritionConsumptionSummaryService,
        nutrition as unknown as CurrentNutritionPlanReaderService,
      );
      const s = createSubject({
        content,
        continuations: resolver,
        dailyQueries: daily,
        runtimeContent: 'Não executar',
      });
      const input = { userId: 'user-id', messageId: 'message-id' };
      expect(await s.service.processCanonicalContinuation(input)).toBe(false);
      expect(claim).not.toHaveBeenCalled();
      expect(await s.service.processReadOnlyText(input)).toBe(true);
      expect(claim).not.toHaveBeenCalled();
      expect(semantics.interpret).not.toHaveBeenCalled();
      expect(workout.presentCanonicalDay).not.toHaveBeenCalled();
      expect(s.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
      expect(nutrition.getCurrent).toHaveBeenCalledWith('user-id');
      expect(s.prisma.coachMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining('Peixe'),
          }),
        }),
      );
      expect(s.conversationRuntime.decide).not.toHaveBeenCalled();
      expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(s.dietGenerator.generate).not.toHaveBeenCalled();
      expect(s.transaction.coachMessage.create).not.toHaveBeenCalled();
      expect(s.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    },
  );

  it('routes a combined current-plan read through general routing without a workout-only shortcut', async () => {
    const content = 'Qual meu treino de amanhã e qual minha dieta atual?';
    expect(explicitContinuationDomain(content)).toBe('COMBINED');
    expect(isWorkoutCurrentPlanRead(content)).toBe(true);
    const continuations = {
      enabled: jest.fn().mockReturnValue(true),
    };
    const response = 'Treino de amanhã e dieta atual: resposta combinada.';
    const subject = createSubject({
      content,
      runtimeContent: response,
      continuations:
        continuations as unknown as ConversationContinuationService,
    });
    const canonical = jest
      .spyOn(subject.service, 'processCanonicalContinuation')
      .mockResolvedValue(true);
    const planning = jest.spyOn(subject.planningExecution, 'executeStructured');

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(canonical).not.toHaveBeenCalled();
    expect(subject.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
    expect(subject.conversationRuntime.decide).toHaveBeenCalledWith(
      expect.objectContaining({ text: content }),
    );
    expect(planning).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: response,
          context: expect.not.objectContaining({
            action: 'WORKOUT_SESSION_SELECTION',
          }),
        }),
      }),
    );
  });

  it('persists typed canonical continuation and reuses ordered delivery without planning or regeneration', async () => {
    const at = new Date('2026-06-10T12:00:00Z');
    const next = continuation('WORKOUT_DAY_QUERY', at);
    const continuations = {
      publicText: (content: string) => content,
      enabled: jest.fn().mockReturnValue(true),
      source: jest.fn().mockResolvedValue({
        id: 'message-id',
        content: 'Qual meu treino de hoje?',
        conversationId: 'conversation-id',
        timestamp: at,
        replyToExternalMessageId: null,
      }),
      resolve: jest.fn().mockResolvedValue({
        content: 'Treino de hoje: agachamento.',
        domain: 'WORKOUT',
        next,
        pending: null,
        outcome: 'UNKNOWN',
        evidence: { day: 'TODAY' },
      }),
      claim: jest.fn().mockResolvedValue(true),
    };
    const s = createSubject({
      content: 'Qual meu treino de hoje?',
      continuations:
        continuations as unknown as ConversationContinuationService,
    });
    s.transaction.scheduledMessage.upsert.mockImplementation(
      (input: { create: { context: Prisma.InputJsonObject } }) => ({
        id: 'scheduled-id',
        scheduledFor: at,
        context: input.create.context,
      }),
    );
    expect(
      await s.service.processCanonicalContinuation({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).toBe(true);
    expect(s.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          context: expect.objectContaining({
            continuation: next,
            deliveryMode: 'ORDERED_COACH_RESPONSE_BATCH',
          }),
        }),
      }),
    );
    expect(s.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          scheduledMessageIds: expect.any(Array),
        }),
      }),
      s.transaction,
    );
    expect(s.dietGenerator.generate).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(s.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(continuations.claim.mock.calls[0][0]).toBe(s.transaction);
    const stored = s.transaction.coachMessage.create.mock.results[0].value;
    s.prisma.coachMessage.findUnique.mockResolvedValue(stored);
    await s.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(continuations.resolve).toHaveBeenCalledTimes(1);
    expect(continuations.claim).toHaveBeenCalledTimes(1);
    expect(s.transaction.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(s.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
  });

  it.each([
    'sim',
    'não',
    'ok',
    'já fiz',
    'já comi',
    'feito',
    'não consegui',
    'vou fazer depois',
  ])(
    'fails closed for uncorrelated short reply %s before runtime/planning',
    async (content) => {
      const s = createSubject({
        content,
        dailyEnabled: true,
        runtimeContent: 'não deve executar',
      });
      expect(
        await s.service.processUncorrelatedShortReply({
          userId: 'user-id',
          messageId: 'message-id',
        }),
      ).toBe(true);
      expect(s.conversationRuntime.decide).not.toHaveBeenCalled();
      expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(s.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
      expect(s.dietGenerator.generate).not.toHaveBeenCalled();
      expect(
        s.profileAcquisitionRollout.requestProductiveClarification,
      ).not.toHaveBeenCalled();
      expect(s.prisma.coachMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining('a que sua resposta se refere'),
          }),
        }),
      );
    },
  );
  it('preserves a quoted acquisition reply for its existing correlation handler', async () => {
    const s = createSubject({
      content: 'sim',
      dailyEnabled: true,
      replyToExternalMessageId: 'profile-question',
    });
    expect(
      await s.service.processUncorrelatedShortReply({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).toBe(false);
    expect(s.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
  });
  it('answers a daily query without runtime, profile acquisition, or legacy generation', async () => {
    const s = createSubject({
      content: 'quanto consumi hoje?',
      dailyEnabled: true,
      dailyContent: '500 kcal registradas',
      runtimeContent: 'não executar',
    });
    expect(
      await s.service.processReadOnlyText({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).toBe(true);
    expect(s.conversationRuntime.decide).not.toHaveBeenCalled();
    expect(s.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(s.dietGenerator.generate).not.toHaveBeenCalled();
    expect(s.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: '500 kcal registradas' }),
      }),
    );
  });

  function installPersistentEffectHarness(
    subject: ReturnType<typeof createSubject>,
    options?: { concurrentInitialLookups?: number },
  ) {
    let coachMessage: { id: string; content: string } | null = null;
    let lookupCount = 0;
    const scheduledMessages = new Map<
      string,
      {
        id: string;
        scheduledFor: Date;
        content: string;
        conversationId: string;
        context: Record<string, unknown>;
      }
    >();
    const outboxEvents = new Map<
      string,
      { aggregateId: string; availableAt: Date }
    >();
    const publishedEvents: Array<{
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      availableAt: Date;
      payload: Record<string, unknown>;
    }> = [];

    subject.prisma.coachMessage.findUnique.mockImplementation(() => {
      lookupCount += 1;
      return Promise.resolve(
        lookupCount <= (options?.concurrentInitialLookups ?? 0)
          ? null
          : coachMessage,
      );
    });
    subject.prisma.coachMessage.create.mockImplementation(
      (input: { data: { content: string } }) => {
        if (coachMessage) {
          return Promise.reject(
            Object.assign(new Error('Unique constraint conflict'), {
              code: 'P2002',
            }),
          );
        }
        coachMessage = {
          id: 'coach-message-persisted',
          content: input.data.content,
        };
        return Promise.resolve(coachMessage);
      },
    );
    subject.transaction.scheduledMessage.upsert.mockImplementation(
      (input: {
        create: {
          scheduledFor: Date;
          content: string;
          conversationId: string;
          context: Record<string, unknown>;
        };
      }) => {
        const key = input.create.scheduledFor.toISOString();
        const existing = scheduledMessages.get(key);
        if (existing) return Promise.resolve(existing);
        const created = {
          id: `scheduled-${scheduledMessages.size}`,
          ...input.create,
        };
        scheduledMessages.set(key, created);
        return Promise.resolve(created);
      },
    );
    subject.eventBus.publish.mockImplementation(
      (input: {
        eventType: string;
        aggregateType: string;
        aggregateId: string;
        availableAt: Date;
        payload: Record<string, unknown>;
      }) => {
        publishedEvents.push(input);
        const key = `${input.eventType}:${input.aggregateType}:${input.aggregateId}`;
        const existing = outboxEvents.get(key);
        if (existing) return Promise.resolve(existing);
        const created = {
          aggregateId: input.aggregateId,
          availableAt: input.availableAt,
        };
        outboxEvents.set(key, created);
        return Promise.resolve(created);
      },
    );

    return { scheduledMessages, outboxEvents, publishedEvents };
  }

  it('enqueues one final workout batch across duplicate asynchronous completions', async () => {
    const subject = createSubject();
    const planning = jest.spyOn(subject.planningExecution, 'executeStructured');
    const effects = installPersistentEffectHarness(subject);
    let response: { id: string; content: string } | null = null;
    subject.transaction.coachMessage.upsert.mockImplementation(
      (input: { create: { content: string } }) => {
        response ??= { id: 'coach-final', content: input.create.content };
        return Promise.resolve(response);
      },
    );
    subject.transaction.scheduledMessage.findMany.mockImplementation(() =>
      Promise.resolve([...effects.scheduledMessages.values()]),
    );
    const input = {
      userId: 'user-id',
      messageId: 'message-id',
      aiJobId: 'job-id',
      content: 'Seu treino personalizado está pronto.',
    };
    await subject.service.deliverWorkoutCompletion(input);
    await subject.service.deliverWorkoutCompletion(input);
    expect(effects.scheduledMessages.size).toBe(1);
    expect(effects.outboxEvents.size).toBe(1);
    expect(subject.transaction.coachMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'user-id:WHATSAPP_COACH_COMMAND:message-id' },
        update: {},
      }),
    );
    expect(planning).not.toHaveBeenCalled();
  });

  it('keeps a WhatsApp Workout pending without creating a fallback response or outbound batch', async () => {
    const subject = createSubject({
      content: 'Monte um treino de musculação para mim, 4 vezes por semana.',
      controlledPlanning: true,
    });
    subject.controlledWorkoutExecutor.execute.mockRejectedValueOnce(
      new DurableTextPendingError(),
    );
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(subject.controlledWorkoutExecutor.execute).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.transaction.scheduledMessage.upsert).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
  });

  it.each([
    ['A', 'Quero treinar na academia', 'WORKOUT', 1],
    ['B', 'Quero um treino em casa', 'WORKOUT', 1],
    ['C', 'Quero fazer Crossfit', 'WORKOUT', 1],
    ['D', 'Quero começar a correr 5 km', 'WORKOUT', 1],
    ['E', 'Quero um plano para correr 10 km', 'WORKOUT', 1],
    ['F', 'Quero caminhar 4 vezes por semana', 'WORKOUT', 1],
    ['G', 'Quero melhorar meu condicionamento com treino', 'WORKOUT', 1],
    ['H', 'Troque supino por outro exercício', 'WORKOUT', 0],
    ['I', 'Refaça meu treino', 'WORKOUT', 1],
    ['J', 'Qual é meu treino atual?', 'UNKNOWN', 0],
    ['K', 'Qual é meu treino de hoje?', 'UNKNOWN', 0],
    ['M', 'Olá, como vai?', 'UNKNOWN', 0],
  ] as const)(
    'controlled public chain %s: %s',
    async (_row, content, intent, executions) => {
      const subject = createSubject({ content, controlledPlanning: true });
      expect(subject.service.classify(content)).toBe(intent);
      const planning = jest.spyOn(
        subject.planningExecution,
        'executeStructured',
      );
      await subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      });
      expect(subject.controlledWorkoutExecutor.execute).toHaveBeenCalledTimes(
        executions,
      );
      const planned = await planning.mock.results[0].value;
      if (executions) {
        expect(planned.decision).toMatchObject({
          goal: 'GENERATE_WORKOUT_PLAN',
          targetPlan: 'WORKOUT',
          canExecute: true,
        });
        expect(planned.dispatch.executor).toBe('WORKOUT_V2');
      }
      if (_row === 'H')
        expect(planned.dispatch.workoutDisposition).toBe('CLARIFICATION');
      if (_row === 'H')
        expect(subject.controlledWorkoutReader.read).toHaveBeenCalledWith(
          'user-id',
        );
      if (_row === 'J' || _row === 'K')
        expect(subject.controlledWorkoutReader.present).toHaveBeenCalledTimes(
          1,
        );
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Refaça meu treino', 5, 'FULL_GYM', 1],
    ['Quero um treino completamente diferente', 5, 'FULL_GYM', 1],
    ['Agora só posso treinar em casa 3x', 3, 'HOME', 0],
    ['Agora quero treinar 4x', 4, 'FULL_GYM', 0],
    ['Adapte meu treino para casa, 3 vezes por semana', 3, 'HOME', 1],
    ['Troque supino por outro exercício', 5, 'FULL_GYM', 1],
    ['Qual é meu treino atual?', 5, 'FULL_GYM', 0],
    ['Qual é meu treino de hoje?', 5, 'FULL_GYM', 0],
    ['Como funciona meu treino?', 5, 'FULL_GYM', 0],
    ['Olá', 5, 'FULL_GYM', 0],
  ] as const)(
    'longitudinal public chain: %s',
    async (content, frequency, environment, calls) => {
      const previousPlan = historicalWorkoutPlan();
      const subject = createSubject({
        content,
        controlledPlanning: true,
        controlledPreviousPlan: previousPlan,
        controlledAdherenceScore: 30,
        runtimeHandoff: content.startsWith('Agora'),
        runtimePlanningDecision: content.startsWith('Agora')
          ? goalDecision('UPDATE_WORKOUT_PLAN', 'WORKOUT_PLAN_UPDATE_REQUEST', {
              targetPlan: 'WORKOUT',
            })
          : undefined,
      });
      await subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      });
      expect(subject.controlledWorkoutExecutor.execute).toHaveBeenCalledTimes(
        calls,
      );
      if (calls) {
        const input =
          subject.controlledWorkoutExecutor.execute.mock.calls[0][0]
            .generationInput;
        expect(input.previousPlan).toBe(previousPlan);
        expect(input.progressEvidence).toMatchObject([
          {
            source: 'FITNESS_CHECK_IN',
            adherenceScore: 30,
            completedSessions: null,
          },
        ]);
        expect(
          input.recognizedContext.weeklyFrequency?.value ??
            input.snapshot.training.weeklyFrequency.value,
        ).toBe(frequency);
        expect(
          input.recognizedContext.environment?.value ??
            input.snapshot.training.environment.value,
        ).toBe(environment);
        if (environment === 'HOME')
          expect(input.recognizedContext.equipment.value).toEqual([
            'BODYWEIGHT',
          ]);
      }
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    },
  );

  it('fails the controlled public V2 chain closed without invoking Legacy', async () => {
    const subject = createSubject({
      content: 'Quero um plano para correr 10 km',
      controlledPlanning: true,
    });
    subject.controlledWorkoutExecutor.execute.mockRejectedValueOnce(
      new Error('controlled provider failure'),
    );
    const planning = jest.spyOn(subject.planningExecution, 'executeStructured');
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    const planned = await planning.mock.results[0].value;
    expect(planned.dispatch).toMatchObject({
      executor: 'FAILURE_FALLBACK',
      generationCompleted: false,
    });
    expect(subject.controlledWorkoutExecutor.execute).toHaveBeenCalledTimes(1);
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
  });

  it.each([
    ['quero uma dieta', 'DIET'],
    ['Me ajuda com alimentação', 'DIET'],
    ['monte meu treino', 'WORKOUT'],
    ['quero treinar na academia', 'WORKOUT'],
    ['quero começar a correr', 'WORKOUT'],
    ['quero fazer CrossFit', 'WORKOUT'],
    ['quero um aeróbico em casa', 'WORKOUT'],
    ['quero me preparar para uma prova de 10 km', 'WORKOUT'],
    ['quero os dois', 'BOTH'],
    ['dieta e treino', 'BOTH'],
    ['olá', 'UNKNOWN'],
    ['Quero um plano para correr 10 km', 'WORKOUT'],
    ['Quero começar a correr 5 km', 'WORKOUT'],
    ['Quero caminhar 4 vezes por semana', 'WORKOUT'],
    ['Quero um plano de caminhada', 'WORKOUT'],
    ['Quero melhorar meu condicionamento com treino', 'WORKOUT'],
    ['Refaça meu treino', 'WORKOUT'],
    ['Quero um treino novo', 'WORKOUT'],
    ['Monte novamente minha ficha', 'WORKOUT'],
    ['Quero trocar um exercício do meu treino atual', 'WORKOUT'],
    ['Troque supino por outro exercício', 'WORKOUT'],
    ['Quero adaptar meu treino atual', 'WORKOUT'],
    ['Quero melhorar meu condicionamento', 'UNKNOWN'],
    ['Como funciona a academia?', 'UNKNOWN'],
    ['Hoje caminhei 4 km', 'UNKNOWN'],
    ['Quero comprar tênis para correr', 'UNKNOWN'],
    ['Não quero treino', 'UNKNOWN'],
  ] as const)('classifies "%s" as %s', (text, intent) => {
    const subject = createSubject();

    expect(subject.service.classify(text)).toBe(intent);
  });

  it('never schedules a legacy diet generation when modern preparation is unavailable', async () => {
    const subject = createSubject({ content: 'quero uma dieta' });

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: true,
        duplicated: false,
        intent: 'DIET',
      }),
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'user-id:WHATSAPP_COACH_COMMAND:message-id',
          content: expect.stringContaining('Nenhum plano foi criado'),
        }),
      }),
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'AUTOMATION_TRIGGERED',
        payload: expect.objectContaining({
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'message-id',
        }),
      }),
      subject.transaction,
    );
    expect(subject.conversationGoalShadow.execute).toHaveBeenCalledWith({
      userId: 'user-id',
      messageId: 'message-id',
      legacyIntent: 'DIET',
      referenceTimestamp: '2026-06-10T12:00:00.000Z',
      onboardingActive: false,
      equivalentGenerationInProgress: false,
    });
  });

  it('generates and schedules a workout command response', async () => {
    const subject = createSubject({ content: 'monte meu treino' });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: '🏋️ *Seu treino V2*\n\nTreino estruturado',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        dispatch: {
          content: '🏋️ *Seu treino V2*\n\nTreino estruturado',
          executor: 'WORKOUT_V2',
          generationCompleted: true,
          fallbackApplied: false,
          workoutDisposition: 'PLAN',
        },
      } as never);

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: true,
        duplicated: false,
        intent: 'WORKOUT',
      }),
    );

    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: '🏋️ *Seu treino V2*\n\nTreino estruturado',
        }),
      }),
    );
    expect(subject.eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'AUTOMATION_TRIGGERED',
        payload: expect.objectContaining({
          source: 'WHATSAPP_COACH_COMMAND',
          sourceMessageId: 'message-id',
        }),
      }),
      subject.transaction,
    );
  });

  it('sends only the acquisition question when Workout V2 needs clarification', async () => {
    const subject = createSubject({
      content: 'monte um treino para mim',
      workoutClarification: true,
    });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: 'Quanto tempo você tem para treinar?',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        profileAcquisitionContext: {
          modality: { value: 'GYM', evidence: 'EXPLICIT' },
          environment: { value: 'FULL_GYM', evidence: 'EXPLICIT' },
          weeklyFrequency: { value: 4, evidence: 'EXPLICIT' },
          sessionDurationMinutes: { value: 60, evidence: 'EXPLICIT' },
        },
        dispatch: {
          content: 'Quanto tempo você tem para treinar?',
          executor: 'WORKOUT_V2',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(
      subject.profileAcquisitionRollout.requestWorkoutClarification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationContext: {
          modality: { value: 'GYM', evidence: 'EXPLICIT' },
          environment: { value: 'FULL_GYM', evidence: 'EXPLICIT' },
          weeklyFrequency: { value: 4, evidence: 'EXPLICIT' },
          sessionDurationMinutes: { value: 60, evidence: 'EXPLICIT' },
        },
      }),
    );
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it.each(['PLANNER_READY', 'NO_ELIGIBLE_FIELD'] as const)(
    'preserves the V2 clarification without the technical acquisition failure: %s',
    async (reason) => {
      const subject = createSubject({
        content:
          'Monte um treino de Crossfit para mim, 4 vezes por semana, considerando meu perfil e meu nível atual.',
        workoutClarification: true,
      });
      const content =
        'Qual é seu condicionamento atual para ajustar o esforço do treino?';
      subject.profileAcquisitionRollout.requestWorkoutClarification.mockResolvedValueOnce(
        {
          questionCreated: false,
          reason: 'NO_ELIGIBLE_FIELD',
        },
      );
      jest
        .spyOn(subject.planningExecution, 'executeStructured')
        .mockResolvedValueOnce({
          content,
          responseRequired: true,
          selectedSource: 'WORKOUT_V2',
          decision:
            reason === 'PLANNER_READY'
              ? {
                  goal: 'GENERATE_WORKOUT_PLAN',
                  targetPlan: 'WORKOUT',
                  selectedProfileField: null,
                  canExecute: true,
                }
              : undefined,
          dispatch: {
            content,
            executor: 'WORKOUT_V2',
            generationCompleted: false,
            fallbackApplied: false,
            workoutDisposition: 'CLARIFICATION',
          },
        } as never);
      await subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      });
      expect(
        subject.profileAcquisitionRollout.requestWorkoutClarification,
      ).toHaveBeenCalledTimes(reason === 'PLANNER_READY' ? 0 : 1);
      expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ content }) }),
      );
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    },
  );

  it('preserves the runtime-selected profile field without re-planning', async () => {
    const subject = createSubject({
      content: 'monte um treino de corrida para mim',
      runtimeProfileAcquisitionHandoff: true,
      workoutClarification: true,
    });
    const replanThatWouldDiverge = jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: '',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        decision: {
          goal: 'ASK_PROFILE_INFORMATION',
          targetPlan: 'WORKOUT',
          selectedProfileField: 'TARGET_DISTANCE',
        },
        profileAcquisitionContext: {
          modality: { value: 'RUNNING', evidence: 'EXPLICIT' },
        },
        dispatch: {
          content: '',
          executor: 'WORKOUT_V2',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(replanThatWouldDiverge).not.toHaveBeenCalled();
    expect(
      subject.profileAcquisitionRollout.requestWorkoutClarification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        sourceMessageId: 'message-id',
        preselectedQuestion: {
          selectedProfileField: 'CURRENT_RUNNING_DISTANCE',
          logicalTurn: 7,
        },
      }),
    );
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
  });

  it('sends productive Nutrition acquisition for a public user without legacy generation', async () => {
    const subject = createSubject({
      content: 'monte um plano alimentar para mim',
      workoutClarification: true,
    });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: '',
        responseRequired: true,
        selectedSource: 'NUTRITION_V2',
        decision: {
          goal: 'ASK_PROFILE_INFORMATION',
          targetPlan: 'DIET',
        },
        dispatch: {
          content: '',
          executor: 'PROFILE_ACQUISITION',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(
      subject.profileAcquisitionRollout.requestProductiveClarification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        sourceMessageId: 'message-id',
        intent: 'DIET',
      }),
    );
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
  });

  it('fails closed without sending an untracked Workout V2 clarification when acquisition is OFF', async () => {
    const subject = createSubject({
      content: 'monte um treino para mim',
      workoutClarification: true,
    });
    subject.profileAcquisitionRollout.requestWorkoutClarification.mockResolvedValueOnce(
      {
        executed: false,
        questionCreated: false,
        reason: 'MODE_OFF',
        mode: 'OFF',
        cycleId: null,
        field: null,
      },
    );
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: 'Qual é a sua experiência de treino?',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        dispatch: {
          content: 'Qual é a sua experiência de treino?',
          executor: 'WORKOUT_V2',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining(
            'Não consegui registrar com segurança',
          ),
        }),
      }),
    );
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Qual é a sua experiência de treino?',
        }),
      }),
    );
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
  });

  it('fails closed when Workout V2 clarification has no acquisition dependency', async () => {
    const subject = createSubject({ content: 'monte um treino para mim' });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: 'Qual é a sua experiência de treino?',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        dispatch: {
          content: 'Qual é a sua experiência de treino?',
          executor: 'WORKOUT_V2',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining(
            'Não consegui registrar com segurança',
          ),
        }),
      }),
    );
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
  });

  it('suppresses a concurrent clarification when an acquisition question is already active', async () => {
    const subject = createSubject({
      content: 'monte um treino para mim',
      workoutClarification: true,
    });
    subject.profileAcquisitionRollout.requestWorkoutClarification.mockResolvedValueOnce(
      {
        executed: true,
        questionCreated: false,
        reason: 'QUESTION_ALREADY_ACTIVE',
        mode: 'INTERNAL',
        cycleId: 'active-cycle-id',
        field: 'TRAINING_EXPERIENCE',
      },
    );
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: 'Qual é a sua experiência de treino?',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        dispatch: {
          content: 'Qual é a sua experiência de treino?',
          executor: 'WORKOUT_V2',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('reprocesses a productive clarification continuation as WORKOUT with the original request context', async () => {
    const originalMessage =
      'Quero que você monte um treino de musculação para mim. quero treinar 4 vezes por semana, cerca de 60 minutos por treino, na academia.';
    const subject = createSubject({
      content: 'Não tenho nenhuma.',
      workoutClarification: true,
    });
    subject.prisma.message.findFirst
      .mockResolvedValueOnce({
        id: 'answer-message-id',
        content: 'Não tenho nenhuma.',
        timestamp: new Date('2026-06-10T12:05:00.000Z'),
        conversation: {
          id: 'conversation-id',
          user: { onboardingCompleted: true },
        },
      })
      .mockResolvedValueOnce({ content: originalMessage });
    const context = {
      modality: { value: 'GYM' as const, evidence: 'EXPLICIT' as const },
      environment: { value: 'FULL_GYM', evidence: 'EXPLICIT' as const },
      weeklyFrequency: { value: 4, evidence: 'EXPLICIT' as const },
      sessionDurationMinutes: { value: 60, evidence: 'EXPLICIT' as const },
    };
    const execution = jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValueOnce({
        content: 'Qual é a sua experiência de treino?',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        profileAcquisitionContext: context,
        dispatch: {
          content: 'Qual é a sua experiência de treino?',
          executor: 'WORKOUT_V2',
          generationCompleted: false,
          fallbackApplied: false,
          workoutDisposition: 'CLARIFICATION',
        },
      } as never);

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'answer-message-id',
        planningContinuation: {
          originalRequestMessageId: 'original-request-id',
          intent: 'WORKOUT',
        },
      }),
    ).resolves.toMatchObject({ intent: 'WORKOUT' });

    expect(execution).toHaveBeenCalledWith(
      'user-id',
      'WORKOUT',
      expect.objectContaining({ currentMessage: originalMessage }),
    );
    expect(
      subject.profileAcquisitionRollout.requestWorkoutClarification,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        originalRequestMessageId: 'original-request-id',
        conversationContext: context,
      }),
    );
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('does not invoke legacy candidates for a combined command', async () => {
    const subject = createSubject({ content: 'quero os dois' });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.dietGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generateCandidate).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.any(String),
        }),
      }),
    );
  });

  it('responds conversationally without a numbered menu for unknown commands', async () => {
    const subject = createSubject({ content: 'oi' });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Me conta com suas palavras'),
        }),
      }),
    );
    const persisted = subject.prisma.coachMessage.create.mock.calls[0][0].data
      .content as string;
    expect(persisted).not.toMatch(/Escolha uma opção|\b[123]\./u);
  });

  it('decides and uses runtime content before any legacy planning effect', async () => {
    const subject = createSubject({
      content: 'oi',
      runtimeContent: 'Resposta oficial do runtime',
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.conversationRuntime.decide).toHaveBeenCalledTimes(1);
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Resposta oficial do runtime',
        }),
      }),
    );
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it.each([
    'O que posso comer no jantar hoje?',
    'Qual meu jantar de hoje',
    'Monte meu jantar de hoje',
    'Monte uma refeição para meu jantar de hoje',
    'Me indique um almoço para hoje',
    'O que você sugere para o almoço?',
    'Tenho treino à noite, o que posso jantar?',
    'Posso trocar o arroz hoje só nessa refeição?',
  ])(
    'routes meal QA through real command/runtime/QA with no plan usage: %s',
    async (content) => {
      const answer =
        'Para essa refeição, combine arroz, feijão, legumes e uma fonte de proteína conforme suas preferências.';
      const subject = createSubject({ content, runtimeContent: 'enabled' });
      const effects = installPersistentEffectHarness(subject);
      const planning = jest.spyOn(subject.planningExecution, 'execute');
      const base = goalPreparationInput({} as never);
      const human = new CoachConversationHumanContextBuilder().build(
        base.snapshot,
        {
          currentMessage: content,
          recentConversation: [
            { direction: 'COACH', text: 'Já conseguiu almoçar hoje?' },
          ],
        },
      );
      const ai = {
        createJob: jest
          .fn()
          .mockResolvedValue({ id: 'fake-qa', status: AIJobStatus.PENDING }),
        runTextJob: jest.fn().mockResolvedValue({
          outputText: JSON.stringify({
            disposition: 'ANSWER',
            domain: 'NUTRITION',
            answer,
            followUpQuestion: null,
            grounding: 'GENERAL_KNOWLEDGE',
            confidence: 'HIGH',
          }),
          model: 'fake',
          totalTokens: 0,
        }),
        completeJobInTransaction: jest.fn(),
        failJob: jest.fn(),
      };
      const config = {
        get: () => ({
          valid: true,
          mode: 'PRIMARY',
          killSwitch: false,
          timeoutMs: 25000,
        }),
        isOfficiallyEligible: () => true,
      };
      const audit = { record: jest.fn() };
      const module = await Test.createTestingModule({
        imports: [ConversationModule],
        providers: [
          ConversationRuntimeIntegrationService,
          ConversationRuntimeService,
          {
            provide: ConversationExecutionBridgeService,
            inject: [ConversationQAExecutorService],
            useFactory: (qa: ConversationQAExecutorService) =>
              new ConversationExecutionBridgeService(
                new ConversationResponsePayloadBuilder(),
                new ConversationLanguageRealizerService(),
                new ConversationResponseFormatterService(),
                new ConversationResponseValidatorService(),
                qa,
              ),
          },
          ConversationResponsePayloadBuilder,
          ConversationLanguageRealizerService,
          ConversationResponseFormatterService,
          ConversationResponseValidatorService,
          ConversationOfficialSelectionService,
          ConversationShadowComparatorService,
          ConversationQAExecutorService,
          ConversationPublicAnswerBoundaryService,
          {
            provide: ConversationRuntimeOperationalConfigService,
            useValue: config,
          },
          { provide: ConversationRuntimeAuditService, useValue: audit },
          { provide: AIService, useValue: ai },
          { provide: PrismaService, useValue: subject.prisma },
          {
            provide: ConversationCurrentNutritionContextService,
            useValue: {
              read: jest
                .fn()
                .mockResolvedValue({ status: 'NO_PLAN', plan: null }),
            },
          },
          {
            provide: ConversationTurnContextBuilderService,
            useValue: {
              build: jest.fn().mockResolvedValue({
                understandingInput: understandingInput(content),
                snapshot: base.snapshot,
                adaptiveDecision: base.adaptiveDecision,
                humanContext: human,
                preparationBase: {
                  snapshot: base.snapshot,
                  adaptiveDecision: base.adaptiveDecision,
                  progressContextAvailable: base.progressContextAvailable,
                  confirmationPending: base.confirmationPending,
                  recentHistory: base.recentHistory,
                  continuity: base.continuity,
                  referenceDate: base.referenceDate,
                },
              }),
            },
          },
        ],
      }).compile();
      try {
        const runtime = module.get(ConversationRuntimeIntegrationService);
        const evaluate = jest.spyOn(
          module.get(ConversationRuntimeService),
          'evaluate',
        );
        const bridge = jest.spyOn(
          module.get(ConversationExecutionBridgeService),
          'execute',
        );
        subject.conversationRuntime.decide.mockImplementation(
          (request: ConversationRuntimeInput) => runtime.decide(request),
        );
        const request = {
          userId: 'user-id',
          messageId: 'message-id',
          proactiveReply: true,
        };
        await subject.service.processTextMessage(request);
        await subject.service.processTextMessage(request);
        expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
        expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
        expect(planning).not.toHaveBeenCalled();
        await expect(evaluate.mock.results[0]?.value).resolves.toMatchObject({
          summary: { routeKind: 'NUTRITION_GUIDANCE' },
        });
        await expect(bridge.mock.results[0]?.value).resolves.toMatchObject({
          status: 'COMPLETED',
        });
        expect(ai.createJob).toHaveBeenCalledTimes(1);
        expect(ai.createJob).toHaveBeenCalledWith(
          expect.objectContaining({ type: AIJobType.TEXT }),
        );
        expect(JSON.stringify(ai.createJob.mock.calls)).not.toMatch(
          /DIET_PLAN_GENERATION|WORKOUT_PLAN_GENERATION/,
        );
        expect(ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(ai.runTextJob.mock.calls)).toContain(content);
        expect(effects.scheduledMessages.size).toBe(1);
        expect(effects.outboxEvents.size).toBe(1);
        expect(
          JSON.stringify([...effects.scheduledMessages.values()]),
        ).toContain(answer);
      } finally {
        await module.close();
      }
    },
  );

  it.each([
    'Acabei de terminar meu treino de superiores na academia e já tomei aproximadamente 1 litro de água hoje. Como você acha que estou indo?',
    'Terminei meu treino de musculação. Como você acha que estou indo?',
    'Hoje fiz CrossFit e bebi água. Como você acha que estou indo?',
  ])(
    'routes workout guidance through real command/runtime/QA without plan effects: %s',
    async (content) => {
      const answer =
        'Concluir o treino é um avanço na sua consistência. Como você se sentiu durante a sessão?';
      const subject = createSubject({ content, runtimeContent: 'enabled' });
      const effects = installPersistentEffectHarness(subject);
      const planning = jest.spyOn(subject.planningExecution, 'execute');
      const base = goalPreparationInput({} as never);
      const human = new CoachConversationHumanContextBuilder().build(
        base.snapshot,
        {
          currentMessage: content,
        },
      );
      const ai = {
        createJob: jest
          .fn()
          .mockResolvedValue({ id: 'fake-qa', status: AIJobStatus.PENDING }),
        runTextJob: jest.fn().mockResolvedValue({
          outputText: JSON.stringify({
            disposition: 'ANSWER',
            domain: 'WORKOUT',
            answer,
            followUpQuestion: null,
            grounding: 'GENERAL_KNOWLEDGE',
            confidence: 'HIGH',
          }),
          model: 'fake',
          totalTokens: 0,
        }),
        completeJobInTransaction: jest.fn(),
        failJob: jest.fn(),
      };
      const config = {
        get: () => ({
          valid: true,
          mode: 'PRIMARY',
          killSwitch: false,
          timeoutMs: 25000,
        }),
        isOfficiallyEligible: () => true,
      };
      const interpretationProvider = {
        execute: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          structuredOutput: {
            action: 'INDEPENDENT',
            reference: 'EXPLICIT',
            workoutEffect: 'NONE',
            day: 'UNRESOLVED',
            meal: 'UNKNOWN',
            consumption: 'UNKNOWN',
            description: null,
            hydrationGoal: false,
            response: 'Resposta genérica sem contexto individual.',
          },
        }),
      };
      const interpreter = new ConversationContinuationSemanticsService(
        interpretationProvider as unknown as ConversationAIService,
        new ConversationPublicAnswerBoundaryService(),
      );
      const interpret = jest.spyOn(interpreter, 'interpret');
      const store = new ConversationContinuationStore(
        subject.prisma as unknown as PrismaService,
        config as unknown as ConversationRuntimeOperationalConfigService,
      );
      const source = await subject.prisma.message.findFirst();
      subject.prisma.message.findFirst.mockResolvedValue({
        ...source,
        conversation: { ...source.conversation, userId: 'user-id' },
      });
      Object.assign(subject.transaction, {
        message: subject.prisma.message,
        coachMessage: subject.prisma.coachMessage,
      });
      jest.spyOn(store, 'pending').mockResolvedValue(null);
      jest
        .spyOn(store, 'resolveOnce')
        .mockImplementation((_userId, _messageId, _type, execute) => execute());
      subject.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        null,
      );
      const continuations = new ConversationContinuationService(
        subject.prisma as unknown as PrismaService,
        interpreter as unknown as ConversationContinuationSemanticsService,
        subject.currentWorkoutPlanReader as unknown as CurrentWorkoutPlanReaderService,
        {} as ConversationCurrentNutritionContextService,
        new ConversationPublicAnswerBoundaryService(),
        new ConversationSafetyDetectorService(),
        new ConversationMessageNormalizerService(),
        {} as ConversationQAFollowUpContextService,
        store,
      );
      Object.defineProperty(subject.service, 'continuations', {
        value: continuations,
      });
      const audit = { record: jest.fn() };
      const module = await Test.createTestingModule({
        imports: [ConversationModule],
        providers: [
          ConversationRuntimeIntegrationService,
          ConversationRuntimeService,
          {
            provide: ConversationExecutionBridgeService,
            inject: [ConversationQAExecutorService],
            useFactory: (qa: ConversationQAExecutorService) =>
              new ConversationExecutionBridgeService(
                new ConversationResponsePayloadBuilder(),
                new ConversationLanguageRealizerService(),
                new ConversationResponseFormatterService(),
                new ConversationResponseValidatorService(),
                qa,
              ),
          },
          ConversationResponsePayloadBuilder,
          ConversationLanguageRealizerService,
          ConversationResponseFormatterService,
          ConversationResponseValidatorService,
          ConversationOfficialSelectionService,
          ConversationShadowComparatorService,
          ConversationQAExecutorService,
          ConversationPublicAnswerBoundaryService,
          {
            provide: ConversationRuntimeOperationalConfigService,
            useValue: config,
          },
          { provide: ConversationRuntimeAuditService, useValue: audit },
          { provide: AIService, useValue: ai },
          { provide: PrismaService, useValue: subject.prisma },
          {
            provide: ConversationCurrentNutritionContextService,
            useValue: {
              read: jest
                .fn()
                .mockResolvedValue({ status: 'NO_PLAN', plan: null }),
            },
          },
          {
            provide: ConversationTurnContextBuilderService,
            useValue: {
              build: jest.fn().mockResolvedValue({
                understandingInput: understandingInput(content),
                snapshot: base.snapshot,
                adaptiveDecision: base.adaptiveDecision,
                humanContext: human,
                preparationBase: {
                  snapshot: base.snapshot,
                  adaptiveDecision: base.adaptiveDecision,
                  progressContextAvailable: base.progressContextAvailable,
                  confirmationPending: base.confirmationPending,
                  recentHistory: base.recentHistory,
                  continuity: base.continuity,
                  referenceDate: base.referenceDate,
                },
              }),
            },
          },
        ],
      }).compile();
      try {
        const runtime = module.get(ConversationRuntimeIntegrationService);
        const qa = jest.spyOn(
          module.get(ConversationQAExecutorService),
          'execute',
        );
        const evaluate = jest.spyOn(
          module.get(ConversationRuntimeService),
          'evaluate',
        );
        const bridge = jest.spyOn(
          module.get(ConversationExecutionBridgeService),
          'execute',
        );
        subject.conversationRuntime.decide.mockImplementation(
          (request: ConversationRuntimeInput) => runtime.decide(request),
        );
        const request = {
          userId: 'user-id',
          messageId: 'message-id',
          proactiveReply: true,
        };
        expect(
          await subject.service.processCanonicalContinuation(request),
        ).toBe(true);
        expect(
          await subject.service.processCanonicalContinuation(request),
        ).toBe(true);
        expect(interpret).toHaveBeenCalledTimes(1);
        expect(audit.record).toHaveBeenCalledTimes(1);
        expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
        expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
        expect(planning).not.toHaveBeenCalled();
        await expect(evaluate.mock.results[0]?.value).resolves.toMatchObject({
          summary: {
            recognizedIntent: 'GENERAL_GUIDANCE_REQUEST',
            goal: 'GENERAL_GUIDANCE',
            routeKind: 'ANSWER_MESSAGE',
          },
          decision: { understanding: { domain: 'WORKOUT' } },
        });
        await expect(bridge.mock.results[0]?.value).resolves.toMatchObject({
          status: 'COMPLETED',
        });
        expect(qa).toHaveBeenCalledTimes(1);
        expect(qa).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-id',
            messageId: 'message-id',
            humanContext: human,
            route: expect.objectContaining({ kind: 'ANSWER_MESSAGE' }),
          }),
        );
        await expect(
          subject.conversationRuntime.decide.mock.results[0]?.value,
        ).resolves.toMatchObject({
          source: 'CONVERSATION_RUNTIME',
          content: answer,
        });
        expect(ai.createJob).toHaveBeenCalledTimes(1);
        expect(ai.createJob).toHaveBeenCalledWith(
          expect.objectContaining({ type: AIJobType.TEXT }),
        );
        expect(JSON.stringify(ai.createJob.mock.calls)).not.toMatch(
          /DIET_PLAN_GENERATION|WORKOUT_PLAN_GENERATION/,
        );
        expect(ai.runTextJob).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(ai.runTextJob.mock.calls)).toContain(content);
        const providerInput = JSON.parse(
          ai.runTextJob.mock.calls[0][1].input as string,
        ) as {
          policy: { readOnly: boolean; mutationsMustBeDeferred: boolean };
          trustedContext: { goal: string | null };
        };
        expect(providerInput.policy).toMatchObject({
          readOnly: true,
          mutationsMustBeDeferred: true,
        });
        expect(providerInput.trustedContext.goal).toBe(
          human.goal?.value ?? null,
        );
        expect(effects.scheduledMessages.size).toBe(1);
        expect(effects.outboxEvents.size).toBe(1);
        expect(
          JSON.stringify([...effects.scheduledMessages.values()]),
        ).not.toContain('Resposta genérica sem contexto individual.');
        expect(
          subject.prisma.coachMessage.create.mock.calls[0][0].data.context,
        ).toMatchObject({
          continuationEvidence: {
            responseSource: 'CONVERSATION_RUNTIME',
            responseSelectionReason: 'RUNTIME_SELECTED',
          },
        });
        expect(
          JSON.stringify([...effects.scheduledMessages.values()]),
        ).toContain(answer);
      } finally {
        await module.close();
      }
    },
  );

  it('fails closed after the runtime decides fallback without legacy generation', async () => {
    const subject = createSubject({
      content: 'quero uma dieta',
      runtimeLegacy: true,
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.conversationRuntime.decide).toHaveBeenCalledTimes(1);
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
  });

  it('persists only the content selected after one structured planning execution', async () => {
    const subject = createSubject({
      content: 'quero uma dieta',
      planningConversationContent: 'Resposta selecionada',
    });
    const structured = jest.spyOn(
      subject.planningExecution,
      'executeStructured',
    );
    const adapter = jest.spyOn(subject.planningExecution, 'execute');

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(structured).toHaveBeenCalledTimes(1);
    expect(adapter).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Nenhum plano foi criado'),
        }),
      }),
    );
  });

  it('uses the deterministic Nutrition V2 response without language realization', async () => {
    const subject = createSubject({
      content: 'quero uma dieta',
      planningConversationContent: 'Resposta de segunda geração',
    });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValue({
        content: '🥗 *Seu plano alimentar*\n\nResposta determinística',
        responseRequired: true,
        selectedSource: 'NUTRITION_V2',
      } as unknown as Awaited<
        ReturnType<CoachPlanningExecutionService['executeStructured']>
      >);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: '🥗 *Seu plano alimentar*\n\nResposta determinística',
        }),
      }),
    );
  });

  it('persists a canonical Nutrition read without language realization or generation', async () => {
    const subject = createSubject({
      content: 'qual é minha dieta?',
      planningConversationContent: 'Resposta de segunda geração',
    });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValue({
        content: 'Plano canônico preexistente',
        responseRequired: true,
        selectedSource: 'NUTRITION_CANONICAL',
      } as unknown as Awaited<
        ReturnType<CoachPlanningExecutionService['executeStructured']>
      >);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Plano canônico preexistente',
        }),
      }),
    );
  });

  it('persists one canonical Workout read without Nutrition realization or generation', async () => {
    const subject = createSubject({
      content: 'Qual é meu treino atual?',
      planningConversationContent: 'Resposta de segunda geração',
    });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValue({
        content: 'Plano Workout canônico preexistente',
        responseRequired: true,
        selectedSource: 'WORKOUT_V2',
        dispatch: {
          content: 'Plano Workout canônico preexistente',
          executor: 'WORKOUT_V2_READER',
          generationCompleted: false,
          fallbackApplied: false,
        },
      } as unknown as Awaited<
        ReturnType<CoachPlanningExecutionService['executeStructured']>
      >);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
      1,
    );
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Plano Workout canônico preexistente',
          context: expect.objectContaining({
            action: 'WORKOUT_SESSION_SELECTION',
            workoutPlanId: 'workout-id',
            allowedSessionSequences: [1, 2],
          }),
        }),
      }),
    );
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          responseExpiresAt: expect.any(Date),
          context: expect.objectContaining({
            action: 'WORKOUT_SESSION_SELECTION',
          }),
        }),
      }),
    );
  });

  it.each(['1', '2'])(
    'resolves a contextual session %s through the canonical workout reader path',
    async (sequence) => {
      const subject = createSubject({
        content: sequence,
        workoutSelection: true,
      });
      const executeStructured = jest
        .spyOn(subject.planningExecution, 'executeStructured')
        .mockResolvedValue({
          content: `*Sessão ${sequence}*\nAgachamento\n3 × 10`,
          responseRequired: true,
          selectedSource: 'WORKOUT_V2',
        } as unknown as Awaited<
          ReturnType<CoachPlanningExecutionService['executeStructured']>
        >);

      await subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      });

      expect(executeStructured).toHaveBeenCalledWith(
        'user-id',
        'WORKOUT',
        expect.objectContaining({ currentMessage: `sessão ${sequence}` }),
      );
      expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
      expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
      expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
      expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
        1,
      );
    },
  );

  it('does not steal a standalone numeric answer without valid workout context', async () => {
    const subject = createSubject({ content: '1' });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.scheduledMessage.findFirst).toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
  });

  it('does not use an expired workout selection context', async () => {
    const subject = createSubject({
      content: '1',
      workoutSelection: true,
      selectionExpired: true,
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
  });

  it('claims a valid numeric workout continuation before profile acquisition', async () => {
    const subject = createSubject({ content: '1', workoutSelection: true });

    await expect(
      subject.service.shouldHandleBeforeProfileAcquisition({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toBe(true);
    expect(subject.currentWorkoutPlanReader.read).toHaveBeenCalledWith(
      'user-id',
      false,
    );
  });
  it('uses only the canonical reader for an eligible numeric workout follow-up', async () => {
    const subject = createSubject({
      content: '1',
      workoutSelection: true,
      continuations: {
        enabled: () => true,
      } as unknown as ConversationContinuationService,
    });
    await subject.service.shouldHandleBeforeProfileAcquisition({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(subject.currentWorkoutPlanReader.read).toHaveBeenCalledWith(
      'user-id',
      true,
    );
  });

  it('rejects a workout selection created for a stale plan', async () => {
    const subject = createSubject({
      content: '1',
      workoutSelection: true,
      currentWorkoutPlanId: 'new-workout-id',
    });

    await expect(
      subject.service.shouldHandleBeforeProfileAcquisition({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toBe(false);
  });

  it.each(['NO_PLAN', 'INVALID_V2_PLAN'] as const)(
    'rejects workout selection when current reader returns %s',
    async (currentWorkoutStatus) => {
      const subject = createSubject({
        content: '1',
        workoutSelection: true,
        currentWorkoutStatus,
      });

      await expect(
        subject.service.shouldHandleBeforeProfileAcquisition({
          userId: 'user-id',
          messageId: 'message-id',
        }),
      ).resolves.toBe(false);
    },
  );

  it('accepts a matching legacy relational current workout plan', async () => {
    const subject = createSubject({
      content: '2',
      workoutSelection: true,
      currentWorkoutStatus: 'LEGACY_RELATIONAL',
    });

    await expect(
      subject.service.shouldHandleBeforeProfileAcquisition({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toBe(true);
  });

  it('does not steal a numeric answer from a newer profile question', async () => {
    const subject = createSubject({
      content: '1',
      workoutSelection: true,
      activeProfileAskedAt: new Date('2026-06-10T11:56:00.000Z'),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
  });

  it('does not skip a newer unrelated actionable outbound to reuse an older workout selection', async () => {
    const subject = createSubject({
      content: '1',
      workoutSelection: true,
      latestSelectionAction: 'HYDRATION_CHECK',
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.currentWorkoutPlanReader.read).not.toHaveBeenCalled();
  });

  it('does not send a non-nutrition LEGACY/UNKNOWN response to the Nutrition realizer', async () => {
    const subject = createSubject({
      content: 'mensagem desconhecida',
      planningConversationContent: 'Resposta de segunda geração',
    });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValue({
        content: 'Resposta oficial desconhecida',
        responseRequired: true,
        selectedSource: 'LEGACY',
        decision: null,
        dispatch: {
          content: 'Resposta oficial desconhecida',
          executor: 'UNKNOWN_LEGACY',
          generationCompleted: false,
          fallbackApplied: false,
        },
      } as unknown as Awaited<
        ReturnType<CoachPlanningExecutionService['executeStructured']>
      >);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Resposta oficial desconhecida',
        }),
      }),
    );
  });

  it('persists a deterministic commercial limit without language realization', async () => {
    const subject = createSubject({ content: 'quero outra dieta' });
    jest
      .spyOn(subject.planningExecution, 'executeStructured')
      .mockResolvedValue({
        content: 'Olá, Ana. Você atingiu seu limite.',
        responseRequired: true,
        selectedSource: 'COMMERCIAL_LIMIT',
      } as unknown as Awaited<
        ReturnType<CoachPlanningExecutionService['executeStructured']>
      >);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Olá, Ana. Você atingiu seu limite.',
        }),
      }),
    );
  });

  it('fails closed without legacy generation after the runtime fails', async () => {
    const subject = createSubject({
      content: 'quero uma dieta',
      runtimeFailure: new Error('runtime unavailable'),
    });

    const planning = jest.spyOn(subject.planningExecution, 'executeStructured');
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(planning).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining(
            'Não consegui concluir isso com segurança',
          ),
        }),
      }),
    );
  });

  it.each([
    ['WORKOUT', 'WORKOUT_PLAN_REQUEST', 'GENERATE_WORKOUT_PLAN'],
    ['DIET', 'DIET_PLAN_REQUEST', 'GENERATE_DIET_PLAN'],
    ['BOTH', 'COMBINED_PLAN_REQUEST', 'GENERATE_COMBINED_PLANS'],
  ] as const)(
    'preserves canonical %s handoff after an UNKNOWN entry',
    async (targetPlan, recognizedIntent, goal) => {
      const planningDecision = goalDecision(goal, recognizedIntent, {
        targetPlan,
      });
      const subject = createSubject({
        content: 'prepare conforme combinamos',
        runtimeHandoff: true,
        runtimePlanningDecision: planningDecision,
        controlledPlanning: true,
      });
      expect(subject.service.classify('prepare conforme combinamos')).toBe(
        'UNKNOWN',
      );
      const planning = jest.spyOn(
        subject.planningExecution,
        'executeStructured',
      );
      const result = await subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      });
      expect(planning).toHaveBeenCalledWith(
        'user-id',
        targetPlan,
        expect.objectContaining({ planningDecision }),
      );
      expect(result.intent).toBe(targetPlan);
      expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            context: expect.objectContaining({ intent: targetPlan }),
          }),
        }),
      );
      expect(planning).toHaveBeenCalledTimes(1);
      const planned = await planning.mock.results[0].value;
      if (targetPlan !== 'DIET') {
        expect(planned.dispatch.workoutDisposition).toBe('BLOCKED');
        expect(
          subject.controlledWorkoutExecutor.execute,
        ).not.toHaveBeenCalled();
        return;
      }
      expect(planned.decision).toMatchObject({
        recognizedIntent,
        targetPlan,
        goal,
      });
      expect(subject.controlledWorkoutExecutor.execute).not.toHaveBeenCalled();
    },
  );

  it('keeps a canonical UNKNOWN-to-WORKOUT handoff in acquisition when the profile is incomplete', async () => {
    const subject = createSubject({
      content: 'prepare conforme combinamos',
      runtimeHandoff: true,
      runtimePlanningDecision: goalDecision(
        'GENERATE_WORKOUT_PLAN',
        'WORKOUT_PLAN_REQUEST',
        { targetPlan: 'WORKOUT' },
      ),
      controlledPlanning: true,
      controlledProfileReady: false,
    });
    const planning = jest.spyOn(subject.planningExecution, 'executeStructured');
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    const planned = await planning.mock.results[0].value;
    expect(planned.decision).toMatchObject({
      recognizedIntent: 'WORKOUT_PLAN_REQUEST',
      targetPlan: 'WORKOUT',
      goal: 'ASK_PROFILE_INFORMATION',
      canExecute: false,
    });
    expect(planned.metadata.routeSelection.workout).toBe('V2');
    expect(subject.controlledWorkoutExecutor.execute).not.toHaveBeenCalled();
  });

  it('executes planning once for an explicit runtime planning handoff', async () => {
    const subject = createSubject({ runtimeHandoff: true });
    const planning = jest.spyOn(subject.planningExecution, 'executeStructured');
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(planning).toHaveBeenCalledTimes(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
  });

  it('does not process commands before onboarding is completed', async () => {
    const subject = createSubject({ onboardingCompleted: false });

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: false,
        reason: 'ONBOARDING_NOT_COMPLETED',
      }),
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.conversationGoalShadow.execute).not.toHaveBeenCalled();
  });

  it('routes explicit profile consent before runtime and planning', async () => {
    const subject = createSubject({
      content: 'quero que você lembre disso',
      profileConsentContent: 'Registrei no seu perfil.',
      runtimeContent: 'Outra resposta',
    });
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(subject.profileConsent.process).toHaveBeenCalledTimes(1);
    expect(subject.profileConsent.process).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-id', messageId: 'message-id' }),
    );
    expect(subject.conversationRuntime.decide).not.toHaveBeenCalled();
    expect(subject.conversationGoalShadow.execute).not.toHaveBeenCalled();
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          content: 'Registrei no seu perfil.',
        }),
      }),
    );
  });

  it('does not repeat profile consent after a canonical response already exists', async () => {
    const subject = createSubject({
      content: 'quero que você lembre disso',
      profileConsentContent: 'Registrei no seu perfil.',
      existingContent: 'Registro confirmado',
    });
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(subject.profileConsent.process).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.conversationGoalShadow.execute).not.toHaveBeenCalled();
  });

  it('keeps idempotency by messageId for repeated events', async () => {
    const subject = createSubject({
      content: 'Qual é meu treino atual?',
      existingContent: 'Resposta existente',
      planningConversationContent: 'Resposta de segunda geração',
      runtimeLegacy: true,
    });

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        handled: true,
        duplicated: true,
      }),
    );
    expect(subject.dietGenerator.generate).not.toHaveBeenCalled();
    expect(subject.workoutGenerator.generate).not.toHaveBeenCalled();
    expect(subject.planningConversationResponse.select).not.toHaveBeenCalled();
    expect(subject.prisma.coachMessage.create).not.toHaveBeenCalled();
    expect(subject.conversationGoalShadow.execute).not.toHaveBeenCalled();
    expect(subject.conversationRuntime.decide).not.toHaveBeenCalled();
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          content: 'Resposta existente',
        }),
      }),
    );
  });

  it('sends a profile guidance message when the user has no profile', async () => {
    const subject = createSubject({
      dietFailure: new NotFoundException(
        'Complete o perfil fitness antes de gerar uma dieta',
      ),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Nenhum plano foi criado'),
        }),
      }),
    );
  });

  it('sends an access guidance message when subscription is inactive', async () => {
    const subject = createSubject({
      dietFailure: new ForbiddenException('Assinatura expirada'),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Nenhum plano foi criado'),
        }),
      }),
    );
  });

  it('sends a safe failure message when OpenAI fails', async () => {
    const subject = createSubject({
      dietFailure: new BadGatewayException('OpenAI retornou JSON inválido'),
    });

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.stringContaining('Nenhum plano foi criado'),
        }),
      }),
    );
  });

  it('formats diet and workout plans for WhatsApp', () => {
    const subject = createSubject();

    expect(subject.planningDispatcher.formatDiet(dietPlan())).toContain(
      'refeições para consultar',
    );
    expect(subject.planningDispatcher.formatWorkout(workoutPlan())).toContain(
      'divisão semanal',
    );
  });

  it('persists one ordered multipart sequence and reuses it on replay', async () => {
    const content = Array.from(
      { length: 420 },
      (_, index) => `Bloco ${index + 1}: progressão técnica controlada.`,
    ).join('\n');
    const subject = createSubject({ runtimeContent: content });
    const effects = installPersistentEffectHarness(subject);
    const service = subject.service as unknown as {
      messageParts(value: string): readonly string[];
    };
    const expectedParts = service.messageParts(content);

    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });

    const firstSequence = [...effects.scheduledMessages.values()];
    const firstEvents = effects.publishedEvents.slice();
    expect(expectedParts.length).toBeGreaterThan(1);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(firstSequence).toHaveLength(expectedParts.length);
    expect(firstSequence.map((part) => part.content)).toEqual(expectedParts);
    expect(firstSequence.every((part) => part.content.length <= 3_400)).toBe(
      true,
    );
    expect(firstSequence.map((part) => part.context.partIndex)).toEqual(
      expectedParts.map((_, index) => index),
    );
    expect(firstSequence.map((part) => part.context.partCount)).toEqual(
      expectedParts.map(() => expectedParts.length),
    );
    expect(firstSequence.map((part) => part.context.sourceMessageId)).toEqual(
      expectedParts.map(() => 'message-id'),
    );
    expect(firstSequence.map((part) => part.conversationId)).toEqual(
      expectedParts.map(() => 'conversation-id'),
    );
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents.map((event) => event.eventType)).toEqual([
      'AUTOMATION_TRIGGERED',
    ]);
    expect(firstEvents.map((event) => event.aggregateId)).toEqual([
      firstSequence[0].id,
    ]);
    expect(firstEvents.map((event) => event.payload.sourceMessageId)).toEqual([
      'message-id',
    ]);
    expect(firstEvents.map((event) => event.availableAt.getTime())).toEqual([
      firstSequence[0].scheduledFor.getTime(),
    ]);
    expect(firstSequence.map((part) => part.scheduledFor.getTime())).toEqual(
      firstSequence.map(
        (_, index) => firstSequence[0].scheduledFor.getTime() + index,
      ),
    );
    const persistedSnapshot = firstSequence.map((part) => ({
      id: part.id,
      scheduledFor: part.scheduledFor.toISOString(),
      content: part.content,
      context: part.context,
    }));

    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toEqual(expect.objectContaining({ duplicated: true }));

    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(1);
    expect(effects.scheduledMessages.size).toBe(expectedParts.length);
    expect(
      [...effects.scheduledMessages.values()].map((part) => ({
        id: part.id,
        scheduledFor: part.scheduledFor.toISOString(),
        content: part.content,
        context: part.context,
      })),
    ).toEqual(persistedSnapshot);
    expect(subject.transaction.scheduledMessage.upsert).toHaveBeenCalledTimes(
      expectedParts.length * 2,
    );
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(2);
    expect(effects.outboxEvents.size).toBe(1);
  });

  it('converges concurrent executions to one logical multipart sequence', async () => {
    const content = Array.from(
      { length: 420 },
      (_, index) => `Sessão ${index + 1}: execução estável e segura.`,
    ).join('\n');
    const subject = createSubject({ runtimeContent: content });
    const effects = installPersistentEffectHarness(subject, {
      concurrentInitialLookups: 2,
    });
    const service = subject.service as unknown as {
      messageParts(value: string): readonly string[];
    };
    const expectedParts = service.messageParts(content);

    const results = await Promise.all([
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ]);

    expect(results.map((result) => result.duplicated).sort()).toEqual([
      false,
      true,
    ]);
    expect(subject.prisma.coachMessage.create).toHaveBeenCalledTimes(2);
    expect(effects.scheduledMessages.size).toBe(expectedParts.length);
    expect(
      [...effects.scheduledMessages.values()].map(({ content }) => content),
    ).toEqual(expectedParts);
    expect(effects.outboxEvents.size).toBe(1);
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(2);
  });

  it('preserves a long BOTH response with semantic Workout boundaries and one header', async () => {
    const nutrition =
      '*Plano alimentar*\n' + 'Refeições variadas. '.repeat(60).trim();
    const sessions = Array.from(
      { length: 5 },
      (_, index) =>
        `*Sessão ${index + 1} — Treino*\n${'Exercício controlado. '.repeat(60).trim()}`,
    );
    const content = [nutrition, '*Sua semana de treino*', ...sessions].join(
      '\n\n',
    );
    const subject = createSubject({
      content: 'quero dieta e treino',
      runtimeContent: content,
    });
    const effects = installPersistentEffectHarness(subject);
    await expect(
      subject.service.processTextMessage({
        userId: 'user-id',
        messageId: 'message-id',
      }),
    ).resolves.toMatchObject({ intent: 'BOTH' });
    const sequence = [...effects.scheduledMessages.values()];
    const parts = sequence.map((part) => part.content);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 3400)).toBe(true);
    expect(
      parts
        .map((part) =>
          part.replace(
            /^➡️ \*Continuação do seu treino — mensagem \d+ de \d+\*\n\n/u,
            '',
          ),
        )
        .join('\n\n'),
    ).toBe(content);
    for (const session of sessions)
      expect(parts.some((part) => part.includes(session))).toBe(true);
    expect(
      parts.slice(1).every((part) => part.startsWith('➡️ *Continuação')),
    ).toBe(true);
    expect(parts.join('').split('*Sua semana de treino*')).toHaveLength(2);
    expect(sequence.map((part) => part.context.partIndex)).toEqual(
      parts.map((_, index) => index),
    );
    expect(
      sequence.every((part) => part.context.partCount === parts.length),
    ).toBe(true);
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(effects.scheduledMessages.size).toBe(parts.length);
  });

  it('replays an existing legacy Workout sequence without rechunking or changing its event identity', async () => {
    const subject = createSubject({
      content: 'quero um treino',
      existingContent: 'Resposta histórica',
    });
    const legacy = [0, 1].map((partIndex) => ({
      id: `legacy-${partIndex}`,
      scheduledFor: new Date(`2026-06-10T12:00:00.00${partIndex}Z`),
      context: {
        source: 'WHATSAPP_COACH_COMMAND',
        sourceMessageId: 'message-id',
        intent: 'WORKOUT',
        partIndex,
        partCount: 2,
      },
    }));
    subject.transaction.scheduledMessage.findMany.mockResolvedValue(legacy);
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(subject.transaction.scheduledMessage.upsert).not.toHaveBeenCalled();
    expect(subject.eventBus.publish).toHaveBeenCalledTimes(2);
    expect(
      subject.eventBus.publish.mock.calls.map(
        (call: readonly { payload: { scheduledMessageId: string } }[]) =>
          call[0].payload.scheduledMessageId,
      ),
    ).toEqual(['legacy-0', 'legacy-1']);
    expect(
      subject.eventBus.publish.mock.calls.every(
        (call) => !('scheduledMessageIds' in call[0].payload),
      ),
    ).toBe(true);
  });

  it('schedules a Workout response as one ordered batch and reuses the same event on replay', async () => {
    const content = [
      'Preparei seu treino.',
      ...Array.from(
        { length: 5 },
        (_, index) =>
          `📅 *Sessão ${index + 1} — Treino*\n\n*1. Movimento*\n• Repetições: 10\n\n💡 ${'Controle o movimento. '.repeat(65).trim()}`,
      ),
    ].join('\n\n');
    const subject = createSubject({
      content: 'quero um treino',
      runtimeContent: content,
    });
    const effects = installPersistentEffectHarness(subject);
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    const messages = [...effects.scheduledMessages.values()];
    expect(messages.map((message) => message.content)).toEqual(
      chunkWorkoutWhatsApp(content),
    );
    expect(
      messages.every(
        (message) =>
          message.context.deliveryMode === 'ORDERED_COACH_RESPONSE_BATCH',
      ),
    ).toBe(true);
    expect(effects.outboxEvents.size).toBe(1);
    expect(effects.publishedEvents[0].payload.scheduledMessageIds).toEqual(
      messages.map((message) => message.id),
    );
    await subject.service.processTextMessage({
      userId: 'user-id',
      messageId: 'message-id',
    });
    expect(effects.outboxEvents.size).toBe(1);
    expect(effects.scheduledMessages.size).toBe(messages.length);
  });

  it.each(['DIET', 'WORKOUT', 'BOTH', 'UNKNOWN'] as const)(
    'schedules any %s multipart coach response as one logical batch',
    async (intent) => {
      const subject = createSubject();
      const effects = installPersistentEffectHarness(subject);
      const schedule = subject.service as unknown as {
        scheduleResponse(input: {
          userId: string;
          conversationId: string;
          messageId: string;
          coachMessageId: string;
          content: string;
          scheduledFor: Date;
          intent: typeof intent;
          selectionContext: Record<string, never>;
        }): Promise<void>;
      };
      const content = Array.from(
        { length: 3 },
        (_, index) => `Parte ${index}. ${'Conteúdo do coach. '.repeat(110)}`,
      ).join('\n\n');
      await schedule.scheduleResponse({
        userId: 'user-id',
        conversationId: 'conversation-id',
        messageId: 'source-id',
        coachMessageId: 'coach-id',
        content,
        scheduledFor: new Date('2026-06-10T12:00:00Z'),
        intent,
        selectionContext: {},
      });
      const messages = [...effects.scheduledMessages.values()];
      expect(messages.length).toBeGreaterThan(1);
      expect(effects.publishedEvents).toHaveLength(1);
      expect(effects.publishedEvents[0].payload.scheduledMessageIds).toEqual(
        messages.map((message) => message.id),
      );
      expect(messages.map((message) => message.context.partIndex)).toEqual(
        messages.map((_, index) => index),
      );
      expect(
        messages.every(
          (message) =>
            message.context.deliveryMode === 'ORDERED_COACH_RESPONSE_BATCH' &&
            message.context.sourceMessageId === 'source-id' &&
            message.context.partCount === messages.length,
        ),
      ).toBe(true);
    },
  );

  it('splits long outbound content deterministically without losing text', () => {
    const service = createSubject().service as unknown as {
      messageParts(content: string, maximumLength?: number): readonly string[];
    };
    const content = Array.from(
      { length: 120 },
      (_, index) => `Exercício ${index + 1}: 4 × 8–12.`,
    ).join('\n');
    const first = service.messageParts(content, 180);
    const replay = service.messageParts(content, 180);
    expect(first).toEqual(replay);
    expect(first.length).toBeGreaterThan(1);
    expect(first.every((part) => part.length <= 180)).toBe(true);
    expect(first.join('\n')).toBe(content);
  });

  it('keeps whole Workout sessions at semantic boundaries with safe long-session fallback', () => {
    const service = createSubject().service as unknown as {
      messageParts(
        content: string,
        maximumLength: number,
        workout: boolean,
      ): readonly string[];
    };
    const sessions = Array.from(
      { length: 5 },
      (_, index) =>
        `*Sessão ${index + 1} — Corpo inteiro*\n${'Movimento controlado. '.repeat(60).trim()}`,
    );
    const content = ['Abertura única.', ...sessions].join('\n\n');
    const parts = service.messageParts(content, 3400, true);
    expect(parts.every((part) => part.length <= 3400)).toBe(true);
    for (const session of sessions)
      expect(parts.some((part) => part.includes(session))).toBe(true);
    expect(
      parts
        .map((part) =>
          part.replace(
            /^➡️ \*Continuação do seu treino — mensagem \d+ de \d+\*\n\n/u,
            '',
          ),
        )
        .join('\n\n'),
    ).toBe(content);
    expect(service.messageParts(content, 3400, true)).toEqual(parts);
    const long =
      `*Sessão 1 — Corpo inteiro*\n${'Orientação técnica. '.repeat(400)}`.trim();
    const longParts = service.messageParts(long, 3400, true);
    expect(longParts.every((part) => part.length <= 3400)).toBe(true);
    expect(
      longParts
        .map((part) =>
          part.replace(
            /^➡️ \*Continuação do seu treino — mensagem \d+ de \d+\*\n\n/u,
            '',
          ),
        )
        .join(' ')
        .replace(/\s+/gu, ' '),
    ).toBe(long.replace(/\s+/gu, ' '));
  });
});
