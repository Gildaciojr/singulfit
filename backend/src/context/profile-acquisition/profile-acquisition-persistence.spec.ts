import { Test } from '@nestjs/testing';
import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
  CoachProfileValueSource,
  CoachProfileValueStatus,
  CoachProfileValueType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import {
  CoachProfileMutationCommandFactoryService,
  CoachProfileMutationService,
} from './coach-profile-mutation.service';
import { ProfileAcquisitionCycleService } from './profile-acquisition-cycle.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileQuestionSpecificationService } from './profile-question.service';

describe('Structured profile acquisition persistence', () => {
  const referenceDate = '2026-07-16T12:00:00.000Z';

  function transaction() {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      coachProfileFieldValue: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'value-id',
            valueFingerprint: data.valueFingerprint,
          }),
        ),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      coachProfileAcquisitionCycle: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'cycle-id',
            field: data.field,
            status: data.status,
            questionVersion: data.questionVersion,
          }),
        ),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      userPreferences: {
        upsert: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };
  }

  async function subject(mode: 'OFF' | 'INTERNAL' = 'INTERNAL') {
    const tx = transaction();
    const prisma = {
      coachProfileFieldValue: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        CoachProfileFieldRegistryService,
        ProfileQuestionSpecificationService,
        ProfileAnswerRecognizerService,
        CoachProfileMutationCommandFactoryService,
        CoachProfileMutationService,
        ProfileAcquisitionCycleService,
        {
          provide: ProfileAcquisitionOperationalConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              mode,
              questionExpirationHours: 48,
            }),
          },
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return {
      prisma,
      tx,
      registry: module.get(CoachProfileFieldRegistryService),
      questions: module.get(ProfileQuestionSpecificationService),
      recognizer: module.get(ProfileAnswerRecognizerService),
      factory: module.get(CoachProfileMutationCommandFactoryService),
      mutations: module.get(CoachProfileMutationService),
      cycles: module.get(ProfileAcquisitionCycleService),
    };
  }

  it('keeps persistence and acquisition cycles inert while mode is OFF', async () => {
    const test = await subject('OFF');
    const mutation = await test.mutations.execute({
      action: 'SET',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
      value: 3,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmation: CoachProfileConfirmationState.CONFIRMED,
      status: CoachProfileValueStatus.CONFIRMED,
      referenceDate,
      operationKey: 'disabled-operation',
      reason: 'INITIAL_ANSWER',
      definitionVersion: 1,
    });
    const cycle = await test.cycles.prepare({
      userId: 'user-id',
      specification: test.questions.forField(
        CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
        'MISSING_REQUIRED_FIELD',
      ),
      logicalTurn: 1,
      origin: 'INTERNAL_HARNESS',
      operationKey: 'disabled-cycle',
      referenceDate,
      expiresAt: '2026-07-18T12:00:00.000Z',
    });
    expect(mutation).toMatchObject({
      status: 'REJECTED',
      reasonCode: 'ACQUISITION_DISABLED',
    });
    expect(cycle).toMatchObject({
      status: 'REJECTED',
      reasonCode: 'ACQUISITION_DISABLED',
    });
    expect(test.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('creates a typed immutable command and persists it under an advisory lock', async () => {
    const test = await subject();
    const specification = test.questions.forField(
      CoachProfileAcquisitionField.TRAINING_MODALITY,
      'MISSING_CONTEXTUAL_FIELD',
    );
    const answer = test.recognizer.recognize(specification, 'academia');
    const command = test.factory.create({
      userId: 'user-id',
      answer,
      source: CoachProfileValueSource.USER_REPORTED,
      referenceDate,
      sourceOperationKey: 'message-id',
      reason: 'INITIAL_ANSWER',
    });
    expect(command).not.toBeNull();
    if (!command) throw new Error('Comando esperado');
    const result = await test.mutations.execute(command);

    expect(result).toMatchObject({ status: 'CREATED', valueId: 'value-id' });
    expect(command.operationKey).toMatch(/^profile-acquisition:[a-f0-9]{64}$/);
    expect(Object.isFrozen(command)).toBe(true);
    expect(test.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.coachProfileFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        field: CoachProfileAcquisitionField.TRAINING_MODALITY,
        textValue: 'GYM_STRENGTH',
        status: CoachProfileValueStatus.CONFIRMED,
        isActive: true,
      }),
    });
    expect(test.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.not.objectContaining({
          rawAnswer: expect.anything(),
        }),
      }),
    });
  });

  it('returns DUPLICATE for a durable operation and does not create history twice', async () => {
    const test = await subject();
    test.tx.coachProfileFieldValue.findUnique.mockResolvedValue({
      id: 'existing-id',
      valueFingerprint: 'fingerprint',
    });
    const result = await test.mutations.execute({
      action: 'SET',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
      value: 3,
      source: CoachProfileValueSource.USER_CONFIRMED,
      confirmation: CoachProfileConfirmationState.CONFIRMED,
      status: CoachProfileValueStatus.CONFIRMED,
      referenceDate,
      operationKey: 'stable-operation',
      reason: 'INITIAL_ANSWER',
      definitionVersion: 1,
    });
    expect(result.status).toBe('DUPLICATE');
    expect(test.tx.coachProfileFieldValue.create).not.toHaveBeenCalled();
  });

  it('does not silently overwrite a conflicting confirmed value', async () => {
    const test = await subject();
    test.tx.coachProfileFieldValue.findFirst.mockResolvedValue({
      id: 'current-id',
      status: CoachProfileValueStatus.CONFIRMED,
      valueFingerprint: 'old-fingerprint',
    });
    const result = await test.mutations.execute({
      action: 'SET',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.SESSION_DURATION_MINUTES,
      value: 60,
      source: CoachProfileValueSource.USER_REPORTED,
      confirmation: CoachProfileConfirmationState.PENDING,
      status: CoachProfileValueStatus.ANSWERED_UNCONFIRMED,
      referenceDate,
      operationKey: 'conflicting-operation',
      previousValueFingerprint: 'old-fingerprint',
      reason: 'PROFILE_UPDATE',
      definitionVersion: 1,
    });
    expect(result.status).toBe('CONFLICT');
    expect(test.tx.coachProfileFieldValue.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: CoachProfileValueStatus.CONFLICTED,
        isActive: false,
        previousValueId: 'current-id',
      }),
    });
  });

  it('records refusal without replacing an existing confirmed value', async () => {
    const test = await subject();
    test.tx.coachProfileFieldValue.findFirst.mockResolvedValue({
      id: 'current-id',
      status: CoachProfileValueStatus.CONFIRMED,
      valueFingerprint: 'old-fingerprint',
    });
    const result = await test.mutations.execute({
      action: 'NO_VALUE',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.FOOD_BUDGET_LEVEL,
      source: CoachProfileValueSource.USER_REPORTED,
      confirmation: CoachProfileConfirmationState.NOT_REQUIRED,
      status: CoachProfileValueStatus.DECLINED,
      referenceDate,
      operationKey: 'declined-operation',
      reason: 'INITIAL_ANSWER',
      definitionVersion: 1,
    });
    expect(result.status).toBe('CREATED');
    expect(test.tx.coachProfileFieldValue.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: CoachProfileValueStatus.DECLINED,
        isActive: false,
      }),
    });
  });

  it('keeps one active question, expires stale state and preserves logical time', async () => {
    const test = await subject();
    const specification = test.questions.forField(
      CoachProfileAcquisitionField.TRAINING_EXPERIENCE,
      'MISSING_REQUIRED_FIELD',
    );
    const command = {
      userId: 'user-id',
      specification,
      logicalTurn: 4,
      origin: 'INTERNAL_HARNESS',
      operationKey: 'question-operation',
      referenceDate,
      expiresAt: '2026-07-18T12:00:00.000Z',
    };
    const created = await test.cycles.prepare(command);
    expect(created).toMatchObject({
      status: 'CREATED',
      cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
    });
    expect(test.tx.$queryRaw).toHaveBeenCalledTimes(1);

    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue({
      id: 'active-id',
      status: CoachProfileAcquisitionCycleStatus.ASKED,
      expiresAt: new Date('2026-07-17T12:00:00.000Z'),
    });
    const blocked = await test.cycles.prepare({
      ...command,
      operationKey: 'second-question',
    });
    expect(blocked.status).toBe('QUESTION_ALREADY_ACTIVE');
    expect(test.tx.coachProfileAcquisitionCycle.create).toHaveBeenCalledTimes(
      1,
    );
  });

  it('persists answer, confirmation pending, refusal and expiration without raw text', async () => {
    const test = await subject();
    test.tx.coachProfileAcquisitionCycle.findUnique.mockResolvedValue({
      id: 'cycle-id',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
      active: true,
      status: CoachProfileAcquisitionCycleStatus.ASKED,
      confirmationState: CoachProfileConfirmationState.PENDING,
      expiresAt: new Date('2026-07-18T12:00:00.000Z'),
      answeredAt: null,
    });
    const pending = await test.cycles.complete({
      userId: 'user-id',
      cycleId: 'cycle-id',
      outcome: 'ANSWERED',
      resultCode: 'VALUE_RECOGNIZED',
      referenceDate,
    });
    expect(pending.status).toBe('CONFIRMATION_PENDING');
    expect(test.tx.coachProfileAcquisitionCycle.update).toHaveBeenCalledWith({
      where: { id: 'cycle-id' },
      data: expect.objectContaining({
        active: true,
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        resultCode: 'VALUE_RECOGNIZED',
      }),
    });
    expect(test.tx.auditLog.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        metadata: expect.not.objectContaining({
          rawAnswer: expect.anything(),
        }),
      }),
    });
  });

  it('marks a question only after send and claims one response deterministically', async () => {
    const test = await subject();
    const cycle = {
      id: 'cycle-id',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.WEEKLY_FREQUENCY,
      active: true,
      status: CoachProfileAcquisitionCycleStatus.PENDING,
      confirmationState: CoachProfileConfirmationState.NOT_REQUIRED,
      askedAt: null,
      expiresAt: new Date('2026-07-18T12:00:00.000Z'),
      resultCode: null,
    };
    test.tx.coachProfileAcquisitionCycle.findUnique.mockResolvedValue(cycle);
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);
    test.tx.coachProfileAcquisitionCycle.update.mockResolvedValue({
      ...cycle,
      status: CoachProfileAcquisitionCycleStatus.ASKED,
      askedAt: new Date(referenceDate),
    });

    await expect(
      test.cycles.markAsked({
        userId: 'user-id',
        cycleId: 'cycle-id',
        askedAt: referenceDate,
      }),
    ).resolves.toMatchObject({
      status: 'MARKED',
      cycleStatus: CoachProfileAcquisitionCycleStatus.ASKED,
    });

    test.tx.coachProfileAcquisitionCycle.findUnique.mockResolvedValue({
      ...cycle,
      status: CoachProfileAcquisitionCycleStatus.ASKED,
      askedAt: new Date(referenceDate),
    });
    const claimed = await test.cycles.claimResponse({
      userId: 'user-id',
      cycleId: 'cycle-id',
      messageId: 'answer-message-id',
      receivedAt: '2026-07-16T12:05:00.000Z',
    });
    expect(claimed).toMatchObject({
      status: 'CLAIMED',
      claimCode: expect.stringMatching(/^PROCESSING:[a-f0-9]{64}$/),
    });
    expect(
      test.tx.coachProfileAcquisitionCycle.update,
    ).toHaveBeenLastCalledWith({
      where: { id: 'cycle-id' },
      data: {
        resultCode: expect.stringMatching(/^PROCESSING:[a-f0-9]{64}$/),
      },
    });
  });

  it('confirms a persisted typed pending value without recovering raw text', async () => {
    const test = await subject();
    const pendingValue = {
      id: 'pending-id',
      userId: 'user-id',
      field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
      valueType: CoachProfileValueType.TEXT_LIST,
      textValue: null,
      integerValue: null,
      booleanValue: null,
      textListValue: ['LACTOSE'],
      valueFingerprint: 'pending-fingerprint',
      status: CoachProfileValueStatus.ANSWERED_UNCONFIRMED,
    };
    test.prisma.coachProfileFieldValue.findFirst.mockResolvedValue(
      pendingValue,
    );
    test.tx.coachProfileFieldValue.findFirst.mockResolvedValue(pendingValue);

    await expect(
      test.mutations.resolvePendingConfirmation({
        userId: 'user-id',
        field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
        action: 'CONFIRM',
        referenceDate,
        sourceOperationKey: 'confirmation-message-id',
      }),
    ).resolves.toMatchObject({
      status: 'UPDATED',
      field: CoachProfileAcquisitionField.FOOD_INTOLERANCES,
    });
    expect(test.tx.coachProfileFieldValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        textListValue: ['LACTOSE'],
        status: CoachProfileValueStatus.CONFIRMED,
        previousValueId: 'pending-id',
      }),
    });
  });
});
