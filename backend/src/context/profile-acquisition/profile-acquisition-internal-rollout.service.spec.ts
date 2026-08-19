import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  OutboundMessageStatus,
  ResponseType,
  UserRole,
} from '@prisma/client';
import { EventBusService } from '../../event-bus/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PROFILE_ACQUISITION_INTENT } from '../coach-adaptive-profile-collector.contract';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from './coach-profile-mutation.service';
import { ProfileAcquisitionCycleService } from './profile-acquisition-cycle.service';
import { ProfileAcquisitionInternalEligibilityService } from './profile-acquisition-internal-eligibility.service';
import { ProfileAcquisitionInternalRolloutService } from './profile-acquisition-internal-rollout.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition-runtime.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import {
  ProfileQuestionRealizerService,
  ProfileQuestionSpecificationService,
} from './profile-question.service';

describe('ProfileAcquisitionInternalRolloutService', () => {
  const sentAt = new Date('2026-07-16T12:00:00.000Z');
  const answerAt = new Date('2026-07-16T12:05:00.000Z');
  const specification = Object.freeze({
    field: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
    questionKind: 'INTEGER' as const,
    responseType: 'INTEGER' as const,
    allowedOptions: Object.freeze([]),
    allowsFreeText: true,
    confirmationPolicy: 'IMPLICIT_ON_VALID_RESPONSE' as const,
    reasonCode: 'MISSING_CONTEXTUAL_FIELD' as const,
    version: 1,
    templateCode: 'PROFILE_QUESTION_DESIRED_MEAL_COUNT_V1',
  });

  function activeCycle(
    overrides: Partial<{
      status: CoachProfileAcquisitionCycleStatus;
      field: CoachProfileAcquisitionField;
      askedAt: Date | null;
      expiresAt: Date;
      sourceMessageId: string | null;
      resultCode: string | null;
      confirmationState: CoachProfileConfirmationState;
      origin: string;
      userId: string;
    }> = {},
  ) {
    return {
      id: 'cycle-id',
      userId: overrides.userId ?? 'admin-id',
      field: overrides.field ?? CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
      status: overrides.status ?? CoachProfileAcquisitionCycleStatus.ASKED,
      questionKind: 'INTEGER',
      questionVersion: 1,
      logicalTurn: 4,
      origin: overrides.origin ?? 'INTERNAL_PROFILE_ACQUISITION_ROLLOUT',
      operationKey: 'operation-key',
      active: true,
      resultCode: overrides.resultCode ?? null,
      confirmationState:
        overrides.confirmationState ??
        CoachProfileConfirmationState.NOT_REQUIRED,
      referenceDate: sentAt,
      askedAt: overrides.askedAt === undefined ? sentAt : overrides.askedAt,
      answeredAt: null,
      expiresAt: overrides.expiresAt ?? new Date('2026-07-18T12:00:00.000Z'),
      cooldownUntil: null,
      completedAt: null,
      sourceMessageId:
        overrides.sourceMessageId === undefined
          ? 'source-message-id'
          : overrides.sourceMessageId,
      createdAt: sentAt,
      updatedAt: sentAt,
    };
  }

  function subject(mode: 'OFF' | 'INTERNAL' = 'INTERNAL') {
    const tx = {
      outboundMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'question-outbound-id',
            status: OutboundMessageStatus.PENDING,
            ...data,
          }),
        ),
        updateMany: jest.fn(),
      },
      coachProfileAcquisitionCycle: {
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      outboundMessage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'official-outbound-id',
          userId: 'admin-id',
          conversationId: 'conversation-id',
          sourceMessageId: 'source-message-id',
          responseType: ResponseType.NUTRITION_ANALYSIS,
          status: OutboundMessageStatus.SENT,
          sentAt,
        }),
        updateMany: jest.fn(),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'answer-message-id',
          content: 'quatro refeições',
          timestamp: answerAt,
          conversationId: 'conversation-id',
        }),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(null),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const eventBus = {
      publish: jest.fn().mockResolvedValue({ id: 'event-id' }),
    };
    const config = {
      get: jest.fn().mockReturnValue({
        mode,
        questionExpirationHours: 48,
      }),
    };
    const eligibility = {
      evaluate: jest.fn().mockResolvedValue({
        internal: true,
        eligible: true,
        reason: 'INTERNAL_ELIGIBLE',
      }),
    };
    const runtime = {
      evaluate: jest.fn().mockResolvedValue({
        evaluation: {
          logicalTurn: 4,
          selectedField: specification.field,
          canAsk: true,
          reason: 'READY',
        },
        specification,
      }),
    };
    const questionSpecifications = {
      forField: jest.fn().mockReturnValue(specification),
    };
    const questionRealizer = {
      realize: jest.fn().mockReturnValue({
        field: specification.field,
        templateCode: specification.templateCode,
        templateVersion: 1,
        text: 'Quantas refeições funcionam na sua rotina?',
      }),
      realizeConfirmation: jest.fn().mockReturnValue({
        field: specification.field,
        templateCode: specification.templateCode + '_CONFIRMATION',
        templateVersion: 1,
        text: 'Só para confirmar: quatro refeições. Posso salvar assim?',
      }),
    };
    const answerRecognizer = {
      recognize: jest.fn().mockReturnValue({
        field: specification.field,
        disposition: 'RECOGNIZED',
        valueType: 'INTEGER',
        value: 4,
        confidence: 'DETERMINISTIC',
        reasonCode: 'DETERMINISTIC_MATCH',
        confirmationRequired: false,
      }),
      recognizeConfirmation: jest.fn().mockReturnValue({
        disposition: 'CONFIRMED',
        confidence: 'DETERMINISTIC',
        reasonCode: 'USER_CONFIRMED_VALUE',
      }),
    };
    const mutationFactory = {
      create: jest.fn().mockReturnValue(Object.freeze({ operation: 'set' })),
    };
    const mutationService = {
      execute: jest.fn().mockResolvedValue({
        status: 'CREATED',
        field: specification.field,
        valueId: 'value-id',
        activeValueFingerprint: 'fingerprint',
        reasonCode: 'MUTATION_APPLIED',
      }),
      resolvePendingConfirmation: jest.fn().mockResolvedValue({
        status: 'UPDATED',
        field: specification.field,
        valueId: 'value-id',
        activeValueFingerprint: 'fingerprint',
        reasonCode: 'MUTATION_APPLIED',
      }),
    };
    const cycles = {
      prepare: jest.fn().mockResolvedValue({
        status: 'CREATED',
        cycleId: 'cycle-id',
        cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
        reasonCode: 'CYCLE_PREPARED',
      }),
      markAsked: jest.fn().mockResolvedValue({
        status: 'MARKED',
        cycleId: 'cycle-id',
        cycleStatus: CoachProfileAcquisitionCycleStatus.ASKED,
      }),
      claimResponse: jest.fn().mockResolvedValue({
        status: 'CLAIMED',
        cycleId: 'cycle-id',
        claimCode: 'PROCESSING:token',
      }),
      releaseResponseClaim: jest.fn(),
      complete: jest.fn().mockResolvedValue({
        status: 'COMPLETED',
        cycleId: 'cycle-id',
        cycleStatus: CoachProfileAcquisitionCycleStatus.ANSWERED,
      }),
    };
    const service = new ProfileAcquisitionInternalRolloutService(
      prisma as unknown as PrismaService,
      eventBus as unknown as EventBusService,
      config as unknown as ProfileAcquisitionOperationalConfigService,
      eligibility as unknown as ProfileAcquisitionInternalEligibilityService,
      runtime as unknown as ProfileAcquisitionRuntimeService,
      questionSpecifications as unknown as ProfileQuestionSpecificationService,
      questionRealizer as unknown as ProfileQuestionRealizerService,
      answerRecognizer as unknown as ProfileAnswerRecognizerService,
      mutationFactory as unknown as CoachProfileMutationCommandFactoryService,
      mutationService as unknown as CoachProfileMutationService,
      cycles as unknown as ProfileAcquisitionCycleService,
    );

    return {
      service,
      prisma,
      tx,
      eventBus,
      config,
      eligibility,
      runtime,
      questionSpecifications,
      answerRecognizer,
      mutationService,
      cycles,
    };
  }

  it('is inert in OFF and performs no lookup or send preparation', async () => {
    const test = subject('OFF');

    await expect(
      test.service.afterOutboundSent('official-outbound-id'),
    ).resolves.toMatchObject({
      executed: false,
      questionCreated: false,
      reason: 'MODE_OFF',
    });
    expect(test.prisma.outboundMessage.findUnique).toHaveBeenCalledTimes(1);
    expect(test.eventBus.publish).not.toHaveBeenCalled();
  });

  it('runs the productive Workout V2 clarification lifecycle for a non-ADMIN user with the canonical context', async () => {
    const test = subject('INTERNAL');
    const context = Object.freeze({
      modality: Object.freeze({
        value: 'GYM' as const,
        evidence: 'EXPLICIT' as const,
      }),
      environment: Object.freeze({
        value: 'FULL_GYM',
        evidence: 'EXPLICIT' as const,
      }),
      weeklyFrequency: Object.freeze({
        value: 4,
        evidence: 'EXPLICIT' as const,
      }),
      sessionDurationMinutes: Object.freeze({
        value: 60,
        evidence: 'EXPLICIT' as const,
      }),
    });
    const workoutSpecification = Object.freeze({
      ...specification,
      field: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
      templateCode: 'PROFILE_QUESTION_TRAINING_EXPERIENCE_V1',
    });
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      conversationId: 'conversation-id',
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);
    test.runtime.evaluate.mockResolvedValue({
      evaluation: {
        logicalTurn: 4,
        selectedField: workoutSpecification.field,
        canAsk: true,
        reason: 'READY',
      },
      specification: workoutSpecification,
    });

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'common-user-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: sentAt,
        conversationContext: context,
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
      field: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
    });
    expect(test.runtime.evaluate).toHaveBeenCalledWith(
      'common-user-id',
      sentAt,
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      context,
    );
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();

    const productiveCycle = activeCycle({
      userId: 'common-user-id',
      field: CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
      sourceMessageId: 'workout-request-id',
      origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:workout-request-id',
    });
    test.prisma.outboundMessage.findUnique.mockResolvedValue({
      id: 'question-outbound-id',
      userId: 'common-user-id',
      sourceMessageId: 'workout-request-id',
      responseType: ResponseType.PROFILE_ACQUISITION,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      productiveCycle,
    );

    await expect(
      test.service.authorizeQuestionSend('question-outbound-id'),
    ).resolves.toBe(true);
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();

    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      productiveCycle,
    );
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'answer-message-id',
      content: 'sou iniciante',
      timestamp: answerAt,
      conversationId: 'conversation-id',
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'common-user-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      persisted: true,
      continuationMessageId: 'answer-message-id',
      originalRequestMessageId: 'workout-request-id',
    });
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();
  });

  it('keeps an external user completely outside the rollout', async () => {
    const test = subject();
    test.eligibility.evaluate.mockResolvedValue({
      internal: false,
      eligible: false,
      reason: 'USER_NOT_INTERNAL',
    });

    await expect(
      test.service.afterOutboundSent('official-outbound-id'),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'USER_NOT_INTERNAL',
    });
    expect(test.runtime.evaluate).not.toHaveBeenCalled();
    expect(test.cycles.prepare).not.toHaveBeenCalled();
  });

  it('prepares one adaptive question only after the official response is sent', async () => {
    const test = subject();

    await expect(
      test.service.afterOutboundSent('official-outbound-id'),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
      cycleId: 'cycle-id',
      field: CoachProfileAcquisitionField.DESIRED_MEAL_COUNT,
    });
    expect(test.runtime.evaluate).toHaveBeenCalledWith(
      'admin-id',
      sentAt,
      PROFILE_ACQUISITION_INTENT.DIET_PLAN_REQUEST,
      {},
    );
    expect(test.cycles.prepare).toHaveBeenCalledTimes(1);
    expect(test.tx.outboundMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        responseType: ResponseType.PROFILE_ACQUISITION,
        content: 'Quantas refeições funcionam na sua rotina?',
      }),
    });
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('does not send another question while one cycle is active', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle(),
    );

    await expect(
      test.service.afterOutboundSent('official-outbound-id'),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'QUESTION_ALREADY_ACTIVE',
    });
    expect(test.cycles.prepare).not.toHaveBeenCalled();
    expect(test.eventBus.publish).not.toHaveBeenCalled();
  });

  it('uses the contextual workout intent after a legacy coach response', async () => {
    const test = subject();
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      conversationId: 'conversation-id',
    });

    await expect(
      test.service.afterCoachResponseSent({
        userId: 'admin-id',
        sourceMessageId: 'workout-request-id',
        intent: 'WORKOUT',
        sentAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
    });
    expect(test.runtime.evaluate).toHaveBeenCalledWith(
      'admin-id',
      sentAt,
      PROFILE_ACQUISITION_INTENT.WORKOUT_PLAN_REQUEST,
      {},
    );
  });

  it('marks the cycle asked only after its acquisition outbound was sent', async () => {
    const test = subject();
    test.prisma.outboundMessage.findUnique.mockResolvedValue({
      id: 'question-outbound-id',
      userId: 'admin-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'source-message-id',
      responseType: ResponseType.PROFILE_ACQUISITION,
      status: OutboundMessageStatus.SENT,
      sentAt,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({ askedAt: null }),
    );

    await test.service.afterOutboundSent('question-outbound-id');

    expect(test.cycles.markAsked).toHaveBeenCalledWith({
      userId: 'admin-id',
      cycleId: 'cycle-id',
      askedAt: sentAt.toISOString(),
    });
  });

  it('fails closed and cancels an unsent question when rollout is OFF', async () => {
    const test = subject('OFF');
    test.prisma.outboundMessage.findUnique.mockResolvedValue({
      id: 'question-outbound-id',
      userId: 'admin-id',
      sourceMessageId: 'source-message-id',
      responseType: ResponseType.PROFILE_ACQUISITION,
    });

    await expect(
      test.service.authorizeQuestionSend('question-outbound-id'),
    ).resolves.toBe(false);
    expect(test.tx.outboundMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OutboundMessageStatus.FAILED,
          errorMessage: 'PROFILE_ACQUISITION_DISABLED',
        }),
      }),
    );
    expect(
      test.tx.coachProfileAcquisitionCycle.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: false,
          status: CoachProfileAcquisitionCycleStatus.CANCELLED,
        }),
      }),
    );
  });

  it('persists a valid answer, closes the cycle and immediately refreshes runtime state', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
      }),
    );

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      persisted: true,
      reason: 'ANSWER_PERSISTED',
      continuationMessageId: 'answer-message-id',
      originalRequestMessageId: 'root-workout-message-id',
    });
    expect(test.mutationService.execute).toHaveBeenCalledTimes(1);
    expect(test.cycles.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'ANSWERED' }),
    );
    expect(test.runtime.evaluate).toHaveBeenCalledWith('admin-id', answerAt);
  });

  it.each([
    ['INVALID', 'VALUE_OUT_OF_RANGE', 'ANSWER_INVALID'],
    ['UNRELATED', 'NO_DETERMINISTIC_MATCH', 'ANSWER_UNRELATED'],
  ] as const)(
    'leaves %s responses to the unchanged legacy flow',
    async (disposition, reasonCode, expectedReason) => {
      const test = subject();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle(),
      );
      test.answerRecognizer.recognize.mockReturnValue({
        field: specification.field,
        disposition,
        valueType: 'INTEGER',
        confidence: 'DETERMINISTIC',
        reasonCode,
        confirmationRequired: false,
      });

      await expect(
        test.service.captureActiveResponse({
          userId: 'admin-id',
          messageId: 'answer-message-id',
        }),
      ).resolves.toMatchObject({
        handled: false,
        persisted: false,
        reason: expectedReason,
      });
      expect(test.cycles.claimResponse).not.toHaveBeenCalled();
      expect(test.mutationService.execute).not.toHaveBeenCalled();
    },
  );

  it('expires an old question and does not consume the unrelated message', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({ expiresAt: new Date('2026-07-16T12:01:00.000Z') }),
    );

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: false,
      reason: 'QUESTION_EXPIRED',
    });
    expect(test.cycles.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'CANCELLED' }),
    );
  });

  it('records refusal and preserves collector cooldown history', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle(),
    );
    test.answerRecognizer.recognize.mockReturnValue({
      field: specification.field,
      disposition: 'DECLINED',
      valueType: 'INTEGER',
      confidence: 'DETERMINISTIC',
      reasonCode: 'USER_DECLINED',
      confirmationRequired: false,
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      reason: 'ANSWER_DECLINED',
    });
    expect(test.cycles.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'DECLINED' }),
    );
  });

  it('requests and completes explicit confirmation without storing free text', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst
      .mockResolvedValueOnce(activeCycle())
      .mockResolvedValue(null);
    test.mutationService.execute.mockResolvedValue({
      status: 'REQUIRES_CONFIRMATION',
      field: specification.field,
      valueId: 'value-id',
      activeValueFingerprint: 'fingerprint',
      reasonCode: 'CONFIRMATION_REQUIRED',
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      reason: 'CONFIRMATION_REQUESTED',
    });
    expect(test.tx.outboundMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceMessageId: 'answer-message-id',
        responseType: ResponseType.PROFILE_ACQUISITION,
      }),
    });

    const confirmation = subject();
    confirmation.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    confirmation.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
        confirmationState: CoachProfileConfirmationState.PENDING,
        resultCode: 'ANSWERED:previous-token',
      }),
    );
    confirmation.prisma.message.findFirst.mockResolvedValue({
      id: 'confirmation-message-id',
      content: 'sim',
      timestamp: answerAt,
      conversationId: 'conversation-id',
    });

    await expect(
      confirmation.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'confirmation-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      persisted: true,
      reason: 'CONFIRMATION_COMPLETED',
    });
    expect(
      confirmation.mutationService.resolvePendingConfirmation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONFIRM',
        field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
      }),
    );
  });

  it('keeps a conflicting mutation isolated from the legacy response path', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle(),
    );
    test.mutationService.execute.mockResolvedValue({
      status: 'CONFLICT',
      field: specification.field,
      valueId: 'conflict-id',
      activeValueFingerprint: 'old-fingerprint',
      reasonCode: 'STALE_PREVIOUS_VALUE',
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      persisted: false,
      reason: 'CONFLICT',
    });
    expect(test.cycles.releaseResponseClaim).toHaveBeenCalled();
  });

  it('uses persisted ADMIN role as the only internal-user mechanism', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            role: UserRole.ADMIN,
            isActive: true,
            onboardingCompleted: true,
          })
          .mockResolvedValueOnce({
            role: UserRole.USER,
            isActive: true,
            onboardingCompleted: true,
          }),
      },
    };
    const eligibility = new ProfileAcquisitionInternalEligibilityService(
      prisma as unknown as PrismaService,
    );

    await expect(eligibility.evaluate('admin-id')).resolves.toMatchObject({
      internal: true,
      eligible: true,
    });
    await expect(eligibility.evaluate('external-id')).resolves.toMatchObject({
      internal: false,
      eligible: false,
      reason: 'USER_NOT_INTERNAL',
    });
  });

  it('contains no nondeterministic or forbidden parser shortcut', () => {
    const source = [
      ProfileAcquisitionInternalRolloutService,
      ProfileAcquisitionInternalEligibilityService,
    ]
      .map((value) => value.toString())
      .join('\n');

    expect(source).not.toMatch(
      /\bany\b|console\.log|Math\.random|Date\.now|@ts-ignore|TODO|FIXME/,
    );
  });
});
