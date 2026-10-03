import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  OutboundMessageStatus,
  ResponseType,
  UserRole,
} from '@prisma/client';
import { createHash } from 'crypto';
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
import { ProfileAcquisitionAuthorizationService } from './profile-acquisition-authorization.service';
import { SubscriptionAccessService } from '../../subscriptions/subscription-access.service';
import { ProfileAcquisitionRuntimeService } from './profile-acquisition-runtime.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import { workoutEquipmentBaseline } from '../../workout/v2/workout-equipment-defaults';
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

  const responseToken = (messageId: string) =>
    createHash('sha256').update(messageId).digest('hex');

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
      answeredAt: Date | null;
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
      answeredAt: overrides.answeredAt ?? null,
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

  function subject(mode: 'OFF' | 'INTERNAL' | 'PRODUCTIVE' = 'INTERNAL') {
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
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'question-id',
            externalMessageId: 'question-external',
            sentAt,
            sourceMessageId: 'source-message-id',
          },
        ]),
      },
      scheduledMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      coachProfileAcquisitionCycle: {
        updateMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve({
              id: where.id,
              role: UserRole.USER,
              isActive: true,
              onboardingCompleted: true,
            }),
          ),
      },
      subscription: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: { where: { userId: string } }) =>
            Promise.resolve({
              id: 'subscription',
              userId: where.userId,
              status: 'ACTIVE',
              plan: { isActive: true, type: 'BASIC' },
              currentPeriodEnd: new Date('2030-01-01'),
              endedAt: null,
              cancelAtPeriodEnd: false,
            }),
          ),
        updateMany: jest.fn(),
      },
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
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'question-id',
            externalMessageId: 'question-external',
            sentAt,
            sourceMessageId: 'source-message-id',
          },
        ]),
      },
      scheduledMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'answer-message-id',
          content: 'quatro refeições',
          timestamp: answerAt,
          conversationId: 'conversation-id',
          replyToExternalMessageId: null,
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
      fromSelectedField: jest.fn().mockReturnValue(specification),
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
      recognizeContextualConfirmation: jest.fn().mockReturnValue({
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
      expireActiveIfNeeded: jest.fn().mockResolvedValue(undefined),
      prepare: jest.fn().mockResolvedValue({
        status: 'CREATED',
        cycleId: 'cycle-id',
        cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
        reasonCode: 'CYCLE_PREPARED',
      }),
      supersedeActiveAndPrepare: jest.fn().mockResolvedValue({
        status: 'CREATED',
        cycleId: 'superseded-cycle-id',
        cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
        reasonCode: 'SUPERSEDED_PREVIOUS',
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
      new ProfileAcquisitionAuthorizationService(
        prisma as unknown as PrismaService,
        config as unknown as ProfileAcquisitionOperationalConfigService,
        eligibility as unknown as ProfileAcquisitionInternalEligibilityService,
        new SubscriptionAccessService(prisma as unknown as PrismaService),
      ),
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
      mutationFactory,
      mutationService,
      cycles,
    };
  }

  it.each(new CoachProfileFieldRegistryService().all())(
    'materializes and authorizes the selected $field for commercial USER',
    async (definition) => {
      const s = subject('PRODUCTIVE');
      const questions = new ProfileQuestionSpecificationService(
        new CoachProfileFieldRegistryService(),
      );
      s.questionSpecifications.fromSelectedField.mockImplementation(
        (
          ...args: Parameters<
            ProfileQuestionSpecificationService['fromSelectedField']
          >
        ) => questions.fromSelectedField(...args),
      );
      await expect(
        s.service.requestProductiveClarification({
          userId: 'common-user-id',
          sourceMessageId: 'answer-message-id',
          referenceDate: sentAt,
          intent: 'BOTH',
          preselectedQuestion: {
            selectedProfileField: questions.toCollectorField(definition.field)!,
            logicalTurn: 1,
          },
        }),
      ).resolves.toMatchObject({
        questionCreated: true,
        field: definition.field,
      });
      s.prisma.outboundMessage.findUnique.mockResolvedValue({
        id: 'question-outbound-id',
        userId: 'common-user-id',
        conversationId: 'conversation-id',
        sourceMessageId: 'answer-message-id',
        responseType: ResponseType.PROFILE_ACQUISITION,
      });
      s.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          userId: 'common-user-id',
          sourceMessageId: 'answer-message-id',
          field: definition.field,
          origin: 'COMBINED_V2_PRODUCTIVE_GENERATION:answer-message-id',
        }),
      );
      await expect(
        s.service.authorizeQuestionSend('question-outbound-id'),
      ).resolves.toBe(true);
      expect(s.eligibility.evaluate).not.toHaveBeenCalled();
    },
  );

  function freshProductiveSubject(
    options: {
      prepare?: boolean;
      cycleUserId?: string;
      cycleSourceId?: string;
      foreignConversation?: boolean;
    } = {},
  ) {
    const test = subject('PRODUCTIVE');
    test.runtime.evaluate.mockResolvedValue({
      evaluation: {
        logicalTurn: 4,
        selectedField: CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
        canAsk: true,
        reason: 'READY',
      },
      specification: {
        ...specification,
        field: CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
      },
    });
    let storedCycle: ReturnType<typeof activeCycle> | null = null;
    let storedOutbound: Awaited<
      ReturnType<typeof test.tx.outboundMessage.create>
    > | null = null;
    const createOutbound =
      test.tx.outboundMessage.create.getMockImplementation()!;
    test.tx.outboundMessage.create.mockImplementation(async (input) => {
      storedOutbound = await createOutbound(input);
      return storedOutbound;
    });
    test.tx.outboundMessage.findUnique.mockImplementation(() =>
      Promise.resolve(storedOutbound),
    );
    const persisted = new Map<
      string,
      { field: CoachProfileAcquisitionField; value: unknown; source: string }
    >();
    test.eligibility.evaluate.mockResolvedValue({
      internal: false,
      eligible: false,
      reason: 'USER_NOT_INTERNAL',
    });
    test.prisma.message.findFirst.mockImplementation(
      ({
        where,
      }: {
        where: {
          id: string;
          conversationId?: string;
          conversation?: { userId: string };
        };
      }) =>
        Promise.resolve(
          where.id === 'workout-request-id' &&
            where.conversation?.userId === 'common-user-id' &&
            (!where.conversationId ||
              (!options.foreignConversation &&
                where.conversationId === 'conversation-id'))
            ? {
                id: 'workout-request-id',
                content: 'Quero um treino para academia 5x por semana',
                timestamp: answerAt,
                conversationId: 'conversation-id',
                replyToExternalMessageId: null,
              }
            : null,
        ),
    );
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockImplementation(() =>
      Promise.resolve(storedCycle),
    );
    test.cycles.prepare.mockImplementation(async () => {
      expect(storedCycle).toBeNull();
      expect(test.mutationService.execute).not.toHaveBeenCalled();
      if (options.prepare === false)
        return { status: 'REJECTED', cycleId: null };
      storedCycle = activeCycle({
        userId: options.cycleUserId ?? 'common-user-id',
        sourceMessageId: options.cycleSourceId ?? 'workout-request-id',
        field: CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:workout-request-id',
        askedAt: null,
      });
      return { status: 'CREATED', cycleId: storedCycle.id };
    });
    const recognizer = new ProfileAnswerRecognizerService(
      new CoachProfileFieldRegistryService(),
    );
    const factory = new CoachProfileMutationCommandFactoryService(
      new CoachProfileFieldRegistryService(),
    );
    test.answerRecognizer.recognize.mockImplementation((spec, text) =>
      recognizer.recognize(spec, text),
    );
    test.questionSpecifications.forField.mockImplementation((field) => ({
      ...specification,
      field,
    }));
    test.mutationFactory.create.mockImplementation((input) =>
      factory.create(input),
    );
    test.mutationService.execute.mockImplementation(async (command) => {
      expect(storedCycle).not.toBeNull();
      const duplicate = persisted.has(command.operationKey);
      if (!duplicate)
        persisted.set(command.operationKey, {
          field: command.field,
          value: command.value,
          source: command.source,
        });
      return {
        status: duplicate ? 'DUPLICATE' : 'CREATED',
        field: command.field,
        valueId: 'value-id',
        reasonCode: 'MUTATION_APPLIED',
      };
    });
    return { ...test, persisted };
  }

  it('persists a fresh common user request only after preparing its own productive cycle; retry is idempotent', async () => {
    const test = freshProductiveSubject();
    const input = {
      userId: 'common-user-id',
      sourceMessageId: 'workout-request-id',
      referenceDate: answerAt,
    };
    await expect(
      test.service.requestWorkoutClarification(input),
    ).resolves.toMatchObject({ questionCreated: true });
    expect(test.cycles.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'common-user-id',
        sourceMessageId: 'workout-request-id',
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:workout-request-id',
      }),
    );
    expect([...test.persisted.values()]).toEqual([
      {
        field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
        value: 'FULL_GYM',
        source: 'USER_REPORTED',
      },
      {
        field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
        value: 5,
        source: 'USER_REPORTED',
      },
    ]);
    await test.service.requestWorkoutClarification(input);
    expect(test.cycles.prepare).toHaveBeenCalledTimes(1);
    expect(test.persisted.size).toBe(2);
    expect(test.mutationService.execute).toHaveBeenCalledTimes(4);
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
    for (const field of [
      CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
      CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
    ]) {
      expect(test.mutationFactory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceOperationKey: `productive-inline:workout-request-id:${field}`,
        }),
      );
    }
  });

  it.each([
    { prepare: false },
    { cycleUserId: 'another-user-id' },
    { cycleSourceId: 'another-request-id' },
    { foreignConversation: true },
  ])(
    'does not persist fresh inline facts without its own authorized cycle: %j',
    async (options) => {
      const test = freshProductiveSubject(options);
      await test.service.requestWorkoutClarification({
        userId: 'common-user-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: answerAt,
      });
      expect(test.mutationService.execute).not.toHaveBeenCalled();
      expect(test.persisted.size).toBe(0);
    },
  );

  it('does not persist on rejected preparation even for an eligible internal user', async () => {
    const test = freshProductiveSubject({ prepare: false });
    test.cycles.prepare.mockResolvedValue({
      status: 'REJECTED',
      cycleId: 'rejected-cycle-id',
    });
    test.eligibility.evaluate.mockResolvedValue({
      internal: true,
      eligible: true,
      reason: 'READY',
    });
    await test.service.requestWorkoutClarification({
      userId: 'common-user-id',
      sourceMessageId: 'workout-request-id',
      referenceDate: answerAt,
    });
    expect(test.eventBus.publish).not.toHaveBeenCalled();
    expect(test.mutationService.execute).not.toHaveBeenCalled();
  });

  it('audits post-dispatch mutation failure and retries without another question', async () => {
    const test = freshProductiveSubject();
    test.mutationService.execute.mockRejectedValueOnce(
      new Error('inline persistence failure'),
    );
    const input = {
      userId: 'common-user-id',
      sourceMessageId: 'workout-request-id',
      referenceDate: answerAt,
    };
    await expect(
      test.service.requestWorkoutClarification(input),
    ).resolves.toMatchObject({ questionCreated: true });
    const firstCommand = test.mutationService.execute.mock.calls[0][0];
    expect(test.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            event: 'PRODUCTIVE_INLINE_PERSISTENCE_FAILED',
            operationKey: firstCommand.operationKey,
          }),
        }),
      }),
    );
    await test.service.requestWorkoutClarification(input);
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
    expect(test.cycles.prepare).toHaveBeenCalledTimes(1);
    expect(test.cycles.complete).not.toHaveBeenCalled();
    expect(test.mutationService.execute.mock.calls[2][0].operationKey).toBe(
      firstCommand.operationKey,
    );
    expect(test.persisted.size).toBe(2);
  });

  it('does not persist when publishing/preparing the fresh productive question fails', async () => {
    const test = freshProductiveSubject();
    test.eventBus.publish.mockRejectedValue(new Error('outbound failure'));
    await expect(
      test.service.requestWorkoutClarification({
        userId: 'common-user-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: answerAt,
      }),
    ).rejects.toThrow('outbound failure');
    expect(test.mutationService.execute).not.toHaveBeenCalled();
  });

  it('provides productive inline facts before selecting a question and persists user reports', async () => {
    const test = subject();
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      content: 'Quero montar um treino para academia 5 vezes por semana',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    const recognizer = new ProfileAnswerRecognizerService(
      new CoachProfileFieldRegistryService(),
    );
    test.answerRecognizer.recognize.mockImplementation((spec, text) =>
      recognizer.recognize(spec, text),
    );
    test.questionSpecifications.forField.mockImplementation((field) => ({
      ...specification,
      field,
    }));
    await test.service.requestWorkoutClarification({
      userId: 'admin-id',
      sourceMessageId: 'workout-request-id',
      referenceDate: answerAt,
    });
    const context = test.runtime.evaluate.mock.calls[0][3];
    expect(context.environment).toEqual({
      value: 'FULL_GYM',
      evidence: 'EXPLICIT',
    });
    expect(context.weeklyFrequency).toEqual({ value: 5, evidence: 'EXPLICIT' });
    const baseline = workoutEquipmentBaseline('FULL_GYM');
    if (baseline?.status === 'INFERRED')
      expect(context.equipment.value).toBe(baseline.value);
    expect(test.mutationService.execute).toHaveBeenCalledTimes(2);
    expect(test.answerRecognizer.recognize).toHaveBeenCalledWith(
      expect.objectContaining({
        field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
      }),
      'FULL_GYM',
    );
    expect(test.answerRecognizer.recognize).toHaveBeenCalledWith(
      expect.objectContaining({
        field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
      }),
      '5',
    );
  });

  it('keeps inline persistence fail-closed in OFF mode', async () => {
    const test = subject('OFF');
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      content: 'Quero montar um treino para academia 5 vezes por semana',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    await test.service.requestWorkoutClarification({
      userId: 'admin-id',
      sourceMessageId: 'workout-request-id',
      referenceDate: answerAt,
    });
    expect(test.mutationService.execute).not.toHaveBeenCalled();
  });

  it.each([
    'monte um treino completo para eu fazer na academia, 05 vezes por semana',
    'Quero um treino para academia 5x por semana',
    'Monte um treino sem corrida, não quero cardio',
  ])(
    'does not claim or reprompt equipment for the new productive command: %s',
    async (content) => {
      const test = subject();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          field: CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
          origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:source-message-id',
        }),
      );
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'new-workout-id',
        content,
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      });
      const recognizer = new ProfileAnswerRecognizerService(
        new CoachProfileFieldRegistryService(),
      );
      test.answerRecognizer.recognize.mockImplementation((spec, text) =>
        recognizer.recognize(spec, text),
      );
      test.questionSpecifications.forField.mockImplementation((field) => ({
        ...specification,
        field,
      }));
      await expect(
        test.service.captureActiveResponse({
          userId: 'admin-id',
          messageId: 'new-workout-id',
        }),
      ).resolves.toMatchObject({ handled: false, reason: 'ANSWER_UNRELATED' });
      expect(test.cycles.claimResponse).not.toHaveBeenCalled();
      expect(test.eventBus.publish).not.toHaveBeenCalled();
    },
  );

  it.each([
    [CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS, 'não', null],
    [CoachProfileAcquisitionField.TRAINING_ENVIRONMENT, 'Academia', null],
    [CoachProfileAcquisitionField.WEEKLY_FREQUENCY, '5 vezes', null],
    [
      CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
      'não',
      'question-external',
    ],
    [
      CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
      'Academia',
      'question-external',
    ],
  ] as const)(
    'captures contextual %s answer %s (quote=%s) with the canonical recognizer',
    async (field, content, replyToExternalMessageId) => {
      const test = subject();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({ field }),
      );
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'quoted-answer-id',
        content,
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId,
      });
      const recognizer = new ProfileAnswerRecognizerService(
        new CoachProfileFieldRegistryService(),
      );
      test.answerRecognizer.recognize.mockImplementation((spec, text) =>
        recognizer.recognize(spec, text),
      );
      test.questionSpecifications.forField.mockImplementation((field) => ({
        ...specification,
        field,
      }));
      await expect(
        test.service.captureActiveResponse({
          userId: 'admin-id',
          messageId: 'quoted-answer-id',
        }),
      ).resolves.toMatchObject({
        handled: true,
        persisted: true,
        reason: 'ANSWER_PERSISTED',
        cycleId: 'cycle-id',
        field,
      });
      expect(test.cycles.claimResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: 'cycle-id',
          messageId: 'quoted-answer-id',
        }),
      );
      expect(test.cycles.supersedeActiveAndPrepare).not.toHaveBeenCalled();
    },
  );

  it.each([
    { internal: false, eligible: false, reason: 'USER_NOT_INTERNAL' },
    { internal: true, eligible: false, reason: 'USER_INACTIVE' },
    { internal: true, eligible: false, reason: 'ONBOARDING_INCOMPLETE' },
  ])(
    'does not mutate inline facts without canonical authorization: $reason',
    async (access) => {
      const test = subject();
      test.eligibility.evaluate.mockResolvedValue(access);
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'workout-request-id',
        content: 'Quero um treino para academia 5x por semana',
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      });
      await test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: answerAt,
      });
      expect(test.eligibility.evaluate).toHaveBeenCalledWith('admin-id');
      expect(test.mutationService.execute).not.toHaveBeenCalled();
    },
  );

  it('preserves productive-cycle authorization for a non-internal user', async () => {
    const test = subject('PRODUCTIVE');
    test.eligibility.evaluate.mockResolvedValue({
      internal: false,
      eligible: false,
      reason: 'USER_NOT_INTERNAL',
    });
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      content: 'Quero um treino para academia 5x por semana',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        userId: 'common-user-id',
        sourceMessageId: 'workout-request-id',
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:workout-request-id',
      }),
    );
    await test.service.requestWorkoutClarification({
      userId: 'common-user-id',
      sourceMessageId: 'workout-request-id',
      referenceDate: answerAt,
    });
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();
    expect(test.mutationService.execute).toHaveBeenCalledTimes(2);
  });

  it.each(['academia ou casa', '5 vezes ou 3 vezes por semana'])(
    'does not persist conflicting inline facts: %s',
    async (content) => {
      const test = subject();
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'workout-request-id',
        content,
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      });
      await test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: answerAt,
      });
      expect(test.mutationService.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
      'PHYSICAL_LIMITATIONS',
      false,
    ],
    [
      CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
      'TRAINING_ENVIRONMENT',
      true,
    ],
    [CoachProfileAcquisitionField.WEEKLY_FREQUENCY, 'TRAINING_FREQUENCY', true],
    [
      CoachProfileAcquisitionField.AVAILABLE_EQUIPMENT,
      'TRAINING_EQUIPMENT',
      true,
    ],
  ] as const)(
    'only re-evaluates preselection satisfied by inline facts: %s',
    async (field, selectedProfileField, reevaluated) => {
      const test = subject();
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'workout-request-id',
        content: 'Quero um treino para academia 5x por semana',
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      });
      test.questionSpecifications.fromSelectedField.mockReturnValue({
        ...specification,
        field,
      });
      await test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: answerAt,
        preselectedQuestion: { selectedProfileField, logicalTurn: 9 },
      });
      if (reevaluated) expect(test.runtime.evaluate).toHaveBeenCalledTimes(1);
      else {
        expect(test.runtime.evaluate).not.toHaveBeenCalled();
        expect(test.cycles.prepare).toHaveBeenCalledWith(
          expect.objectContaining({
            specification: expect.objectContaining({
              field: CoachProfileAcquisitionField.PHYSICAL_LIMITATIONS,
            }),
            logicalTurn: 9,
          }),
        );
      }
    },
  );

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

  it('uses a preselected field without re-evaluating profile acquisition', async () => {
    const test = subject();
    const currentRunningDistance = Object.freeze({
      ...specification,
      field: CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE,
      templateCode: 'PROFILE_QUESTION_CURRENT_RUNNING_DISTANCE_V1',
    });
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      conversationId: 'conversation-id',
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);
    test.questionSpecifications.fromSelectedField.mockReturnValue(
      currentRunningDistance,
    );

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'common-user-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: sentAt,
        preselectedQuestion: {
          selectedProfileField: 'CURRENT_RUNNING_DISTANCE',
          logicalTurn: 9,
        },
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      field: CoachProfileAcquisitionField.CURRENT_RUNNING_DISTANCE,
    });
    expect(test.questionSpecifications.fromSelectedField).toHaveBeenCalledWith(
      'CURRENT_RUNNING_DISTANCE',
    );
    expect(test.runtime.evaluate).not.toHaveBeenCalled();
    expect(test.cycles.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        specification: currentRunningDistance,
        logicalTurn: 9,
      }),
    );
  });

  it.each(['BASIC', 'PREMIUM'])(
    'runs the productive Workout V2 clarification lifecycle for a paid USER %s with the canonical context',
    async (plan) => {
      const test = subject('PRODUCTIVE');
      test.prisma.subscription.findFirst.mockImplementation(
        ({ where }: { where: { userId: string } }) =>
          Promise.resolve({
            id: 'subscription',
            userId: where.userId,
            status: 'ACTIVE',
            plan: { isActive: true, type: plan },
            currentPeriodEnd: new Date('2030-01-01'),
            endedAt: null,
            cancelAtPeriodEnd: false,
          }),
      );
      test.eligibility.evaluate.mockResolvedValue({
        internal: false,
        eligible: false,
        reason: 'USER_NOT_INTERNAL',
      });
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
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        null,
      );
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
        expect.objectContaining(context),
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
      test.prisma.outboundMessage.findMany.mockResolvedValue([
        {
          id: 'question-outbound-id',
          sourceMessageId: 'workout-request-id',
          externalMessageId: 'workout-question',
          sentAt,
        },
      ]);

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
    },
  );

  it.each(['DIET', 'BOTH'] as const)(
    'continues the original commercial %s request after acquiring a field',
    async (intent) => {
      const s = subject('PRODUCTIVE');
      const origin =
        intent === 'DIET'
          ? 'NUTRITION_V2_PRODUCTIVE_GENERATION'
          : 'COMBINED_V2_PRODUCTIVE_GENERATION';
      s.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          userId: 'common-user-id',
          origin: `${origin}:original-request-id`,
        }),
      );
      s.prisma.message.findFirst.mockResolvedValue({
        id: 'answer-id',
        content: 'nenhuma',
        timestamp: answerAt,
        conversationId: 'conversation-id',
      });
      await expect(
        s.service.captureActiveResponse({
          userId: 'common-user-id',
          messageId: 'answer-id',
        }),
      ).resolves.toMatchObject({
        handled: true,
        persisted: true,
        continuationMessageId: 'answer-id',
        originalRequestMessageId: 'original-request-id',
        originalIntent: intent,
      });
      expect(s.mutationService.execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'o que é hipertrofia?',
    'qual meu treino de hoje?',
    'quanto consumi hoje?',
  ])(
    'does not start acquisition for a read or general answer: %s',
    async () => {
      const s = subject('PRODUCTIVE');
      await expect(
        s.service.afterCoachResponseSent({
          userId: 'common-user-id',
          sourceMessageId: 'source-message-id',
          intent: 'UNKNOWN',
          sentAt,
        }),
      ).resolves.toMatchObject({ questionCreated: false });
      expect(s.runtime.evaluate).not.toHaveBeenCalled();
      expect(s.cycles.prepare).not.toHaveBeenCalled();
    },
  );

  it('prepares productive Nutrition acquisition for a non-ADMIN user', async () => {
    const test = subject('PRODUCTIVE');
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'nutrition-request-id',
      conversationId: 'conversation-id',
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);

    await expect(
      test.service.requestProductiveClarification({
        userId: 'common-user-id',
        sourceMessageId: 'nutrition-request-id',
        referenceDate: sentAt,
        intent: 'DIET',
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
    });
    expect(test.cycles.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'common-user-id',
        origin: 'NUTRITION_V2_PRODUCTIVE_GENERATION:nutrition-request-id',
      }),
    );
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();
  });

  it('isolates simultaneous productive clarification requests for two non-ADMIN users', async () => {
    const test = subject('PRODUCTIVE');
    test.prisma.message.findFirst.mockImplementation(
      ({
        where,
      }: {
        where: { id: string; conversation: { userId: string } };
      }) =>
        Promise.resolve({
          id: where.id,
          conversationId: `conversation-${where.conversation.userId}`,
        }),
    );
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);

    const [userA, userB] = await Promise.all([
      test.service.requestWorkoutClarification({
        userId: 'user-a',
        sourceMessageId: 'message-a',
        referenceDate: sentAt,
      }),
      test.service.requestWorkoutClarification({
        userId: 'user-b',
        sourceMessageId: 'message-b',
        referenceDate: sentAt,
      }),
    ]);

    expect(userA.questionCreated).toBe(true);
    expect(userB.questionCreated).toBe(true);
    expect(test.cycles.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-a',
        sourceMessageId: 'message-a',
      }),
    );
    expect(test.cycles.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-b',
        sourceMessageId: 'message-b',
      }),
    );
    expect(test.prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'message-a',
          conversation: { userId: 'user-a' },
        }),
      }),
    );
    expect(test.prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'message-b',
          conversation: { userId: 'user-b' },
        }),
      }),
    );
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();
  });

  it.each(['INTERNAL', 'OFF'] as const)(
    'blocks USER productive requests in %s before preparing a question',
    async (mode) => {
      const s = subject(mode);
      s.eligibility.evaluate.mockResolvedValue({
        internal: false,
        eligible: false,
        reason: 'USER_NOT_INTERNAL',
      });
      await expect(
        s.service.requestWorkoutClarification({
          userId: 'common-user-id',
          sourceMessageId: 'source-message-id',
          referenceDate: sentAt,
        }),
      ).resolves.toMatchObject({ questionCreated: false });
      expect(s.cycles.prepare).not.toHaveBeenCalled();
      expect(s.eventBus.publish).not.toHaveBeenCalled();
    },
  );

  it('revalidates revoked commercial access at send, sent and response phases', async () => {
    const s = subject('PRODUCTIVE');
    s.prisma.subscription.findFirst.mockResolvedValue(null);
    s.prisma.outboundMessage.findUnique.mockResolvedValue({
      id: 'question-id',
      userId: 'common-user-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'source-message-id',
      responseType: ResponseType.PROFILE_ACQUISITION,
      status: OutboundMessageStatus.SENT,
      sentAt,
    });
    await expect(s.service.authorizeQuestionSend('question-id')).resolves.toBe(
      false,
    );
    await expect(
      s.service.afterOutboundSent('question-id'),
    ).resolves.toMatchObject({ reason: 'USER_NOT_ELIGIBLE' });
    await expect(
      s.service.captureActiveResponse({
        userId: 'common-user-id',
        messageId: 'answer-id',
      }),
    ).resolves.toMatchObject({ handled: false, persisted: false });
    expect(s.cycles.markAsked).not.toHaveBeenCalled();
    expect(s.mutationService.execute).not.toHaveBeenCalled();
  });

  it('blocks commercial acquisition when canonical access is denied', async () => {
    const s = subject('PRODUCTIVE');
    s.prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(
      s.service.requestProductiveClarification({
        userId: 'common-user-id',
        sourceMessageId: 'source-message-id',
        referenceDate: sentAt,
        intent: 'DIET',
      }),
    ).resolves.toMatchObject({ questionCreated: false });
    expect(s.cycles.prepare).not.toHaveBeenCalled();
    expect(s.eventBus.publish).not.toHaveBeenCalled();
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

  it('supersedes a fenced failed-reprompt productive cycle when a new independent workout request arrives', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockReset();
    test.prisma.message.findFirst
      .mockResolvedValueOnce({
        id: 'new-workout-request-id',
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      })
      .mockResolvedValueOnce({ id: 'source-message-id' });

    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
        resultCode: `REPROMPT:${responseToken('failed-reprompt-source-id')}`,
      }),
    );

    test.prisma.outboundMessage.findMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'original-question-outbound-id',
          externalMessageId: 'original-question-external-id',
          sentAt,
          sourceMessageId: 'source-message-id',
        },
      ])
      .mockResolvedValueOnce([
        { sourceMessageId: 'failed-reprompt-source-id' },
      ]);

    test.prisma.outboundMessage.findFirst.mockResolvedValue({
      id: 'critical-coach-outbound-id',
    });
    test.prisma.scheduledMessage.findFirst.mockResolvedValue(null);

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'new-workout-request-id',
        originalRequestMessageId: 'new-workout-root-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
      cycleId: 'superseded-cycle-id',
    });

    expect(test.cycles.supersedeActiveAndPrepare).toHaveBeenCalledWith({
      expectedActiveCycleId: 'cycle-id',
      expectedActiveCycleUpdatedAt: sentAt,
      command: expect.objectContaining({
        userId: 'admin-id',
        sourceMessageId: 'new-workout-request-id',
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:new-workout-root-id',
      }),
    });
    expect(test.cycles.prepare).not.toHaveBeenCalled();
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('keeps a recoverable failed-reprompt productive cycle active when there is no critical fence', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockReset();
    test.prisma.message.findFirst
      .mockResolvedValueOnce({
        id: 'new-workout-request-id',
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      })
      .mockResolvedValueOnce({ id: 'source-message-id' });

    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
        resultCode: `REPROMPT:${responseToken('failed-reprompt-source-id')}`,
      }),
    );

    test.prisma.outboundMessage.findMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 'original-question-outbound-id',
          externalMessageId: 'original-question-external-id',
          sentAt,
          sourceMessageId: 'source-message-id',
        },
      ])
      .mockResolvedValueOnce([
        { sourceMessageId: 'failed-reprompt-source-id' },
      ]);

    test.prisma.outboundMessage.findFirst.mockResolvedValue(null);
    test.prisma.scheduledMessage.findFirst.mockResolvedValue(null);

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'new-workout-request-id',
        originalRequestMessageId: 'new-workout-root-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'QUESTION_ALREADY_ACTIVE',
      cycleId: 'cycle-id',
    });

    expect(test.cycles.supersedeActiveAndPrepare).not.toHaveBeenCalled();
    expect(test.cycles.prepare).not.toHaveBeenCalled();
    expect(test.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                context: expect.objectContaining({
                  equals: 'COACH_PROACTIVE_V1',
                }),
              }),
              expect.objectContaining({
                context: expect.objectContaining({
                  equals: 'COACH_RETENTION_V1',
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('does not supersede while the active productive response is PROCESSING, even with a critical fence', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockResolvedValue({
      id: 'new-workout-request-id',
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
        resultCode: `PROCESSING:${responseToken('in-flight-answer-id')}`,
      }),
    );

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'new-workout-request-id',
        originalRequestMessageId: 'new-workout-root-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'QUESTION_ALREADY_ACTIVE',
      cycleId: 'cycle-id',
    });

    expect(test.cycles.supersedeActiveAndPrepare).not.toHaveBeenCalled();
    expect(test.prisma.outboundMessage.findMany).not.toHaveBeenCalled();
    expect(test.prisma.scheduledMessage.findFirst).not.toHaveBeenCalled();
  });

  it('supersedes after a critical scheduled fence while preserving proactive and retention exclusions', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockReset();
    test.prisma.message.findFirst
      .mockResolvedValueOnce({
        id: 'new-workout-request-id',
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      })
      .mockResolvedValueOnce({ id: 'source-message-id' });

    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
      }),
    );

    test.prisma.outboundMessage.findMany.mockReset().mockResolvedValue([
      {
        id: 'original-question-outbound-id',
        externalMessageId: 'original-question-external-id',
        sentAt,
        sourceMessageId: 'source-message-id',
      },
    ]);
    test.prisma.outboundMessage.findFirst.mockResolvedValue(null);
    test.prisma.scheduledMessage.findFirst.mockResolvedValue({
      id: 'critical-scheduled-id',
    });

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'new-workout-request-id',
        originalRequestMessageId: 'new-workout-root-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
    });

    expect(test.cycles.supersedeActiveAndPrepare).toHaveBeenCalledTimes(1);
    expect(test.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                context: expect.objectContaining({
                  equals: 'COACH_PROACTIVE_V1',
                }),
              }),
              expect.objectContaining({
                context: expect.objectContaining({
                  equals: 'COACH_RETENTION_V1',
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('does not supersede an active productive cycle from a quoted new request', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockResolvedValue({
      id: 'quoted-workout-request-id',
      conversationId: 'conversation-id',
      replyToExternalMessageId: 'quoted-external-id',
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
      }),
    );

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'quoted-workout-request-id',
        originalRequestMessageId: 'new-workout-root-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'QUESTION_ALREADY_ACTIVE',
    });

    expect(test.cycles.supersedeActiveAndPrepare).not.toHaveBeenCalled();
    expect(test.prisma.outboundMessage.findMany).not.toHaveBeenCalled();
  });

  it('does not supersede a productive cycle from another conversation', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockReset();
    test.prisma.message.findFirst
      .mockResolvedValueOnce({
        id: 'new-workout-request-id',
        conversationId: 'new-conversation-id',
        replyToExternalMessageId: null,
      })
      .mockResolvedValueOnce(null);

    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
      }),
    );

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'new-workout-request-id',
        originalRequestMessageId: 'new-workout-root-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'QUESTION_ALREADY_ACTIVE',
    });

    expect(test.cycles.supersedeActiveAndPrepare).not.toHaveBeenCalled();
    expect(test.prisma.outboundMessage.findMany).not.toHaveBeenCalled();
  });

  it('does not supersede when the incoming productive clarification belongs to the same root request', async () => {
    const test = subject('INTERNAL');

    test.prisma.message.findFirst.mockResolvedValue({
      id: 'continuation-message-id',
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
      }),
    );

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'continuation-message-id',
        originalRequestMessageId: 'root-workout-message-id',
        referenceDate: answerAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: false,
      reason: 'QUESTION_ALREADY_ACTIVE',
    });

    expect(test.cycles.supersedeActiveAndPrepare).not.toHaveBeenCalled();
  });

  it('expires a stale confirmation cycle before preparing a workout question', async () => {
    const test = subject();
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'workout-request-id',
      conversationId: 'conversation-id',
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);

    await expect(
      test.service.requestWorkoutClarification({
        userId: 'admin-id',
        sourceMessageId: 'workout-request-id',
        referenceDate: sentAt,
      }),
    ).resolves.toMatchObject({
      questionCreated: true,
      reason: 'QUESTION_PREPARED',
    });

    expect(test.cycles.expireActiveIfNeeded).toHaveBeenCalledWith({
      userId: 'admin-id',
      referenceDate: sentAt.toISOString(),
      resultCode: 'EXPIRED:' + responseToken('workout-request-id'),
    });
    expect(test.cycles.prepare).toHaveBeenCalledTimes(1);
    expect(test.eventBus.publish).toHaveBeenCalledTimes(1);
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

  it('does not authorize a profile outbound using another productive cycle', async () => {
    const test = subject('PRODUCTIVE');
    test.prisma.outboundMessage.findUnique.mockResolvedValue({
      id: 'foreign-cycle-outbound-id',
      userId: 'common-user-id',
      conversationId: 'conversation-id',
      sourceMessageId: 'second-request-message-id',
      responseType: ResponseType.PROFILE_ACQUISITION,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        userId: 'common-user-id',
        sourceMessageId: 'first-request-message-id',
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:first-request-message-id',
      }),
    );

    await expect(
      test.service.authorizeQuestionSend('foreign-cycle-outbound-id'),
    ).resolves.toBe(false);
    expect(test.eligibility.evaluate).not.toHaveBeenCalled();
  });

  it.each(['PROCESSING', 'REPROMPT'] as const)(
    'authorizes a productive %s reprompt using the inbound response source',
    async (resultCodePrefix) => {
      const test = subject('PRODUCTIVE');
      const originalRequestMessageId = 'original-request-message-id';
      const invalidAnswerMessageId = 'invalid-answer-message-id';
      test.prisma.outboundMessage.findUnique.mockResolvedValue({
        id: 'reprompt-outbound-id',
        userId: 'common-user-id',
        conversationId: 'conversation-id',
        sourceMessageId: invalidAnswerMessageId,
        responseType: ResponseType.PROFILE_ACQUISITION,
      });
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          userId: 'common-user-id',
          field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
          sourceMessageId: originalRequestMessageId,
          origin: `WORKOUT_V2_PRODUCTIVE_GENERATION:${originalRequestMessageId}`,
          resultCode: `${resultCodePrefix}:${responseToken(invalidAnswerMessageId)}`,
        }),
      );
      test.prisma.message.findFirst.mockResolvedValue({ id: 'message-id' });

      await expect(
        test.service.authorizeQuestionSend('reprompt-outbound-id'),
      ).resolves.toBe(true);
      expect(test.tx.outboundMessage.updateMany).not.toHaveBeenCalled();
      expect(test.prisma.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: invalidAnswerMessageId,
          conversationId: 'conversation-id',
          conversation: { userId: 'common-user-id' },
        },
        select: { id: true },
      });
    },
  );

  it('authorizes a productive confirmation using its answer source', async () => {
    const test = subject('PRODUCTIVE');
    const originalRequestMessageId = 'original-request-message-id';
    const answerMessageId = 'answer-message-id';
    test.prisma.outboundMessage.findUnique.mockResolvedValue({
      id: 'confirmation-outbound-id',
      userId: 'common-user-id',
      conversationId: 'conversation-id',
      sourceMessageId: answerMessageId,
      responseType: ResponseType.PROFILE_ACQUISITION,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        userId: 'common-user-id',
        sourceMessageId: originalRequestMessageId,
        origin: `WORKOUT_V2_PRODUCTIVE_GENERATION:${originalRequestMessageId}`,
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        confirmationState: CoachProfileConfirmationState.PENDING,
        answeredAt: answerAt,
        resultCode: `ANSWERED:${responseToken(answerMessageId)}`,
      }),
    );
    test.prisma.message.findFirst.mockResolvedValue({ id: 'message-id' });

    await expect(
      test.service.authorizeQuestionSend('confirmation-outbound-id'),
    ).resolves.toBe(true);
    expect(test.tx.outboundMessage.updateMany).not.toHaveBeenCalled();
  });

  it.each(['REPROMPT', 'PROCESSING'] as const)(
    'fails closed for a productive %s reprompt with a different token',
    async (resultCodePrefix) => {
      const test = subject('PRODUCTIVE');
      const originalRequestMessageId = 'original-request-message-id';
      const invalidAnswerMessageId = 'invalid-answer-message-id';
      test.prisma.outboundMessage.findUnique.mockResolvedValue({
        id: 'reprompt-outbound-id',
        userId: 'common-user-id',
        conversationId: 'conversation-id',
        sourceMessageId: invalidAnswerMessageId,
        responseType: ResponseType.PROFILE_ACQUISITION,
      });
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          userId: 'common-user-id',
          sourceMessageId: originalRequestMessageId,
          origin: `WORKOUT_V2_PRODUCTIVE_GENERATION:${originalRequestMessageId}`,
          resultCode: `${resultCodePrefix}:${responseToken('other-message-id')}`,
        }),
      );

      await expect(
        test.service.authorizeQuestionSend('reprompt-outbound-id'),
      ).resolves.toBe(false);
      expect(test.tx.outboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OutboundMessageStatus.FAILED,
            errorMessage: 'PROFILE_ACQUISITION_DISABLED',
          }),
        }),
      );
    },
  );

  it.each([
    ['another conversation', 'other-conversation-id', 'common-user-id'],
    ['another user', 'conversation-id', 'other-user-id'],
  ] as const)(
    'fails closed for a productive reprompt whose inbound source belongs to %s',
    async (
      _caseName: string,
      sourceConversationId: string,
      sourceUserId: string,
    ) => {
      const test = subject('PRODUCTIVE');
      const originalRequestMessageId = 'original-request-message-id';
      const invalidAnswerMessageId = 'invalid-answer-message-id';
      test.prisma.outboundMessage.findUnique.mockResolvedValue({
        id: 'reprompt-outbound-id',
        userId: 'common-user-id',
        conversationId: 'conversation-id',
        sourceMessageId: invalidAnswerMessageId,
        responseType: ResponseType.PROFILE_ACQUISITION,
      });
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          userId: 'common-user-id',
          sourceMessageId: originalRequestMessageId,
          origin: `WORKOUT_V2_PRODUCTIVE_GENERATION:${originalRequestMessageId}`,
          resultCode: `REPROMPT:${responseToken(invalidAnswerMessageId)}`,
        }),
      );
      test.prisma.message.findFirst
        .mockResolvedValueOnce({ id: originalRequestMessageId })
        .mockResolvedValueOnce(
          sourceConversationId === 'conversation-id' &&
            sourceUserId === 'common-user-id'
            ? { id: invalidAnswerMessageId }
            : null,
        );

      await expect(
        test.service.authorizeQuestionSend('reprompt-outbound-id'),
      ).resolves.toBe(false);
      expect(test.prisma.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: invalidAnswerMessageId,
          conversationId: 'conversation-id',
          conversation: { userId: 'common-user-id' },
        },
        select: { id: true },
      });
      expect(test.tx.outboundMessage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OutboundMessageStatus.FAILED,
            errorMessage: 'PROFILE_ACQUISITION_DISABLED',
          }),
        }),
      );
    },
  );

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

  it('keeps a productive asked response contextual after low-priority proactive turns', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
      }),
    );
    test.prisma.scheduledMessage.findFirst.mockResolvedValue(null);

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      persisted: true,
      reason: 'ANSWER_PERSISTED',
    });
    expect(test.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                context: expect.objectContaining({
                  equals: 'COACH_PROACTIVE_V1',
                }),
              }),
              expect.objectContaining({
                context: expect.objectContaining({
                  equals: 'COACH_RETENTION_V1',
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('persists Academia for TRAINING_ENVIRONMENT without publishing an invalid-answer reprompt', async () => {
    const test = subject();
    const trainingEnvironmentSpecification = Object.freeze({
      ...specification,
      field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
    });
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
        resultCode: `REPROMPT:${responseToken('failed-reprompt-source-id')}`,
      }),
    );
    test.prisma.outboundMessage.findMany
      .mockResolvedValueOnce([
        {
          id: 'original-question-outbound-id',
          externalMessageId: 'original-question-external-id',
          sentAt,
          sourceMessageId: 'source-message-id',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'failed-reprompt-outbound-id',
          externalMessageId: null,
          sentAt: null,
          sourceMessageId: 'failed-reprompt-source-id',
        },
      ]);
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'answer-message-id',
      content: 'Academia',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    test.questionSpecifications.forField.mockReturnValue(
      trainingEnvironmentSpecification,
    );
    test.answerRecognizer.recognize.mockReturnValue({
      field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
      disposition: 'RECOGNIZED',
      valueType: 'TEXT',
      value: 'FULL_GYM',
      confidence: 'DETERMINISTIC',
      reasonCode: 'DETERMINISTIC_MATCH',
      confirmationRequired: false,
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: true,
      persisted: true,
      reason: 'ANSWER_PERSISTED',
    });
    expect(test.mutationService.execute).toHaveBeenCalledTimes(1);
    const failedQuery = test.prisma.outboundMessage.findMany.mock.calls[1]?.[0];
    expect(failedQuery?.where).toMatchObject({
      userId: 'admin-id',
      conversationId: 'conversation-id',
      responseType: ResponseType.PROFILE_ACQUISITION,
      status: OutboundMessageStatus.FAILED,
      createdAt: { gte: sentAt, lt: answerAt },
    });
    expect(failedQuery?.where).not.toHaveProperty('sentAt');
    expect(test.tx.outboundMessage.create).not.toHaveBeenCalled();
    expect(test.cycles.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'ANSWERED' }),
    );
  });

  it('does not recover a failed reprompt when its token does not match the active cycle', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
        resultCode: `REPROMPT:${responseToken('expected-reprompt-source-id')}`,
      }),
    );
    test.prisma.outboundMessage.findMany
      .mockResolvedValueOnce([
        {
          id: 'original-question-outbound-id',
          externalMessageId: 'original-question-external-id',
          sentAt,
          sourceMessageId: 'source-message-id',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'failed-reprompt-outbound-id',
          externalMessageId: null,
          sentAt: null,
          sourceMessageId: 'different-reprompt-source-id',
        },
      ]);
    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: false,
      persisted: false,
      reason: 'ANSWER_UNRELATED',
    });
    expect(test.cycles.claimResponse).not.toHaveBeenCalled();
    expect(test.mutationService.execute).not.toHaveBeenCalled();
  });

  it('does not recover a failed reprompt when the original acquisition question was not sent', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
        origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:root-workout-message-id',
        resultCode: `REPROMPT:${responseToken('failed-reprompt-source-id')}`,
      }),
    );
    test.prisma.outboundMessage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'failed-reprompt-outbound-id',
          externalMessageId: null,
          sentAt: null,
          sourceMessageId: 'failed-reprompt-source-id',
        },
      ]);
    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'answer-message-id',
      }),
    ).resolves.toMatchObject({
      handled: false,
      persisted: false,
      reason: 'ANSWER_UNRELATED',
    });
    expect(test.cycles.claimResponse).not.toHaveBeenCalled();
    expect(test.mutationService.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['INVALID', 'VALUE_OUT_OF_RANGE', 'ANSWER_INVALID'],
    ['UNRELATED', 'NO_DETERMINISTIC_MATCH', 'ANSWER_INVALID'],
  ] as const)(
    'keeps contextual %s responses inside acquisition',
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
        handled: true,
        persisted: false,
        reason: expectedReason,
      });
      expect(test.cycles.claimResponse).toHaveBeenCalledTimes(1);
      expect(test.tx.outboundMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceMessageId: 'answer-message-id',
          responseType: ResponseType.PROFILE_ACQUISITION,
        }),
      });
      expect(test.cycles.releaseResponseClaim).toHaveBeenCalledWith({
        userId: 'admin-id',
        cycleId: 'cycle-id',
        claimCode: 'PROCESSING:token',
        previousResultCode: `REPROMPT:${responseToken('answer-message-id')}`,
      });
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

  it('does not consume a confirmation that was never sent', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
        confirmationState: CoachProfileConfirmationState.PENDING,
        answeredAt: new Date('2026-07-16T12:03:00.000Z'),
        resultCode: `ANSWERED:${responseToken('answer-message-id')}`,
      }),
    );
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'confirmation-message-id',
      content: 'sim',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'confirmation-message-id',
      }),
    ).resolves.toMatchObject({
      handled: false,
      persisted: false,
      reason: 'QUESTION_NOT_SENT',
    });
    expect(
      test.mutationService.resolvePendingConfirmation,
    ).not.toHaveBeenCalled();
  });

  it('fences an unquoted confirmation after a newer scheduled coach turn', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
        confirmationState: CoachProfileConfirmationState.PENDING,
        answeredAt: new Date('2026-07-16T12:03:00.000Z'),
        resultCode: `ANSWERED:${responseToken('answer-message-id')}`,
      }),
    );
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'confirmation-message-id',
      content: 'sim',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    test.prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'confirmation-outbound-id',
        externalMessageId: 'external-confirmation-id',
        sentAt: new Date('2026-07-16T12:04:00.000Z'),
        sourceMessageId: 'answer-message-id',
      },
    ]);
    test.prisma.scheduledMessage.findFirst.mockResolvedValue({
      id: 'newer-scheduled-turn-id',
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'confirmation-message-id',
      }),
    ).resolves.toMatchObject({ handled: false, reason: 'QUESTION_NOT_SENT' });
    expect(
      test.mutationService.resolvePendingConfirmation,
    ).not.toHaveBeenCalled();
  });

  it.each(['COACH_PROACTIVE_V1', 'COACH_RETENTION_V1'])(
    'keeps an unquoted confirmation contextual after newer low-priority scheduled %s',
    async (source) => {
      const test = subject();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
          field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
          confirmationState: CoachProfileConfirmationState.PENDING,
          answeredAt: new Date('2026-07-16T12:03:00.000Z'),
          resultCode: `ANSWERED:${responseToken('answer-message-id')}`,
        }),
      );
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'confirmation-message-id',
        content: 'sim',
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId: null,
      });
      test.prisma.outboundMessage.findMany.mockResolvedValue([
        {
          id: 'confirmation-outbound-id',
          externalMessageId: 'external-confirmation-id',
          sentAt: new Date('2026-07-16T12:04:00.000Z'),
          sourceMessageId: 'answer-message-id',
        },
      ]);
      test.prisma.scheduledMessage.findFirst.mockResolvedValue(null);

      await expect(
        test.service.captureActiveResponse({
          userId: 'admin-id',
          messageId: 'confirmation-message-id',
        }),
      ).resolves.toMatchObject({ handled: true, persisted: true });
      expect(test.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  context: expect.objectContaining({ equals: source }),
                }),
              ]),
            }),
          }),
        }),
      );
    },
  );

  it('fences an unquoted confirmation after a newer outbound coach turn', async () => {
    const test = subject();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
    test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      activeCycle({
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
        confirmationState: CoachProfileConfirmationState.PENDING,
        answeredAt: new Date('2026-07-16T12:03:00.000Z'),
        resultCode: `ANSWERED:${responseToken('answer-message-id')}`,
      }),
    );
    test.prisma.message.findFirst.mockResolvedValue({
      id: 'confirmation-message-id',
      content: 'sim',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    test.prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'confirmation-outbound-id',
        externalMessageId: 'external-confirmation-id',
        sentAt: new Date('2026-07-16T12:04:00.000Z'),
        sourceMessageId: 'answer-message-id',
      },
    ]);
    test.prisma.outboundMessage.findFirst.mockResolvedValue({
      id: 'newer-outbound-turn-id',
    });

    await expect(
      test.service.captureActiveResponse({
        userId: 'admin-id',
        messageId: 'confirmation-message-id',
      }),
    ).resolves.toMatchObject({ handled: false, reason: 'QUESTION_NOT_SENT' });
    expect(
      test.mutationService.resolvePendingConfirmation,
    ).not.toHaveBeenCalled();
  });

  it.each(['external-confirmation-id', 'external-unrelated-id'])(
    'only consumes a quoted confirmation addressed to the exact outbound: %s',
    async (replyToExternalMessageId) => {
      const test = subject();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockReset();
      test.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
        activeCycle({
          status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
          field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
          confirmationState: CoachProfileConfirmationState.PENDING,
          answeredAt: new Date('2026-07-16T12:03:00.000Z'),
          resultCode: `ANSWERED:${responseToken('answer-message-id')}`,
        }),
      );
      test.prisma.message.findFirst.mockResolvedValue({
        id: 'confirmation-message-id',
        content: 'sim',
        timestamp: answerAt,
        conversationId: 'conversation-id',
        replyToExternalMessageId,
      });
      test.prisma.outboundMessage.findMany.mockResolvedValue([
        {
          id: 'confirmation-outbound-id',
          externalMessageId: 'external-confirmation-id',
          sentAt: new Date('2026-07-16T12:04:00.000Z'),
          sourceMessageId: 'answer-message-id',
        },
      ]);

      await expect(
        test.service.captureActiveResponse({
          userId: 'admin-id',
          messageId: 'confirmation-message-id',
        }),
      ).resolves.toMatchObject({
        reason:
          replyToExternalMessageId === 'external-confirmation-id'
            ? 'CONFIRMATION_COMPLETED'
            : 'QUESTION_NOT_SENT',
        handled: replyToExternalMessageId === 'external-confirmation-id',
        persisted: replyToExternalMessageId === 'external-confirmation-id',
      });
      expect(
        test.mutationService.resolvePendingConfirmation,
      ).toHaveBeenCalledTimes(
        replyToExternalMessageId === 'external-confirmation-id' ? 1 : 0,
      );
    },
  );

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
        resultCode: `ANSWERED:${responseToken('answer-message-id')}`,
        answeredAt: new Date('2026-07-16T12:03:00.000Z'),
      }),
    );
    confirmation.prisma.message.findFirst.mockResolvedValue({
      id: 'confirmation-message-id',
      content: 'sim',
      timestamp: answerAt,
      conversationId: 'conversation-id',
      replyToExternalMessageId: null,
    });
    confirmation.prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: 'confirmation-outbound-id',
        externalMessageId: 'external-confirmation-id',
        sentAt: new Date('2026-07-16T12:04:00.000Z'),
        sourceMessageId: 'answer-message-id',
      },
    ]);

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
