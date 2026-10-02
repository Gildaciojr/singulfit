import {
  CoachProfileAcquisitionCycleStatus,
  CoachProfileAcquisitionField,
  CoachProfileConfirmationState,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROFILE_ACQUISITION_MODE,
  type ProfileAcquisitionCycleCommand,
  type ProfileQuestionSpecification,
} from './profile-acquisition.contract';
import { ProfileAcquisitionCycleService } from './profile-acquisition-cycle.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';

describe('ProfileAcquisitionCycleService', () => {
  const referenceDate = new Date('2026-09-28T22:00:43.000Z');
  const expiresAt = new Date('2026-09-30T22:00:43.000Z');
  const activeUpdatedAt = new Date('2026-09-28T15:13:42.000Z');

  const baseSpecification: ProfileQuestionSpecification = Object.freeze({
    field: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
    questionKind: 'SINGLE_CHOICE',
    responseType: 'OPTION',
    allowedOptions: Object.freeze([
      Object.freeze({
        value: 'FULL_GYM',
        label: 'Academia completa',
      }),
    ]),
    allowsFreeText: true,
    confirmationPolicy: 'IMPLICIT_ON_VALID_RESPONSE',
    reasonCode: 'MISSING_CONTEXTUAL_FIELD',
    version: 1,
    templateCode: 'PROFILE_QUESTION_TRAINING_ENVIRONMENT_V1',
  });

  const command = (
    overrides: Partial<ProfileAcquisitionCycleCommand> = {},
  ): ProfileAcquisitionCycleCommand =>
    Object.freeze({
      userId: 'user-id',
      specification: baseSpecification,
      logicalTurn: 9,
      origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:new-request-id',
      operationKey: 'operation-key',
      referenceDate: referenceDate.toISOString(),
      expiresAt: expiresAt.toISOString(),
      sourceMessageId: 'new-request-id',
      ...overrides,
    });

  const cycle = (
    overrides: Partial<{
      id: string;
      userId: string;
      field: CoachProfileAcquisitionField;
      status: CoachProfileAcquisitionCycleStatus;
      questionVersion: number;
      operationKey: string;
      active: boolean;
      expiresAt: Date;
      sourceMessageId: string | null;
      confirmationState: CoachProfileConfirmationState;
      updatedAt: Date;
    }> = {},
  ) => ({
    id: overrides.id ?? 'old-cycle-id',
    userId: overrides.userId ?? 'user-id',
    field: overrides.field ?? CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
    status: overrides.status ?? CoachProfileAcquisitionCycleStatus.ASKED,
    questionKind: 'SINGLE_CHOICE',
    questionVersion: overrides.questionVersion ?? 1,
    logicalTurn: 8,
    origin: 'WORKOUT_V2_PRODUCTIVE_GENERATION:old-request-id',
    operationKey: overrides.operationKey ?? 'old-operation-key',
    active: overrides.active ?? true,
    resultCode: null,
    confirmationState:
      overrides.confirmationState ?? CoachProfileConfirmationState.NOT_REQUIRED,
    referenceDate: new Date('2026-09-28T15:13:39.000Z'),
    askedAt: new Date('2026-09-28T15:13:42.000Z'),
    answeredAt: null,
    expiresAt: overrides.expiresAt ?? expiresAt,
    cooldownUntil: null,
    completedAt: null,
    sourceMessageId: overrides.sourceMessageId ?? 'old-request-id',
    createdAt: new Date('2026-09-28T15:13:39.000Z'),
    updatedAt: overrides.updatedAt ?? activeUpdatedAt,
  });

  function subject(mode: 'INTERNAL' | 'OFF' = 'INTERNAL') {
    const createdCycle = cycle({
      id: 'new-cycle-id',
      status: CoachProfileAcquisitionCycleStatus.PENDING,
      operationKey: 'operation-key',
      sourceMessageId: 'new-request-id',
      confirmationState: CoachProfileConfirmationState.NOT_REQUIRED,
    });

    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      coachProfileAcquisitionCycle: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(cycle({ active: false })),
        create: jest.fn().mockResolvedValue(createdCycle),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-id' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    const operationalConfig = {
      get: jest.fn().mockReturnValue({
        mode:
          mode === 'INTERNAL'
            ? PROFILE_ACQUISITION_MODE.INTERNAL
            : PROFILE_ACQUISITION_MODE.OFF,
      }),
    };

    const service = new ProfileAcquisitionCycleService(
      prisma as unknown as PrismaService,
      operationalConfig as unknown as ProfileAcquisitionOperationalConfigService,
    );

    return {
      service,
      prisma,
      tx,
      createdCycle,
    };
  }

  it('keeps normal prepare behavior and uses exactly one transaction and one advisory lock', async () => {
    const test = subject();

    await expect(test.service.prepare(command())).resolves.toEqual({
      status: 'CREATED',
      cycleId: 'new-cycle-id',
      cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
      reasonCode: 'CYCLE_PREPARED',
    });

    expect(test.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(test.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.coachProfileAcquisitionCycle.create).toHaveBeenCalledTimes(
      1,
    );
    expect(test.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PROFILE_ACQUISITION_CYCLE_PREPARED',
        entityId: 'new-cycle-id',
        metadata: expect.objectContaining({
          result: 'CREATED',
        }),
      }),
    });
  });

  it('checks operationKey duplicate before reading or mutating the active cycle', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findUnique.mockResolvedValue(
      cycle({
        id: 'duplicate-cycle-id',
        operationKey: 'operation-key',
      }),
    );

    await expect(test.service.prepare(command())).resolves.toMatchObject({
      status: 'DUPLICATE',
      cycleId: 'duplicate-cycle-id',
      reasonCode: 'DUPLICATE_OPERATION',
    });

    expect(
      test.tx.coachProfileAcquisitionCycle.findFirst,
    ).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.create).not.toHaveBeenCalled();

    expect(test.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      test.tx.coachProfileAcquisitionCycle.findUnique.mock
        .invocationCallOrder[0],
    );
  });

  it('preserves QUESTION_ALREADY_ACTIVE for a valid non-expired active cycle', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(cycle());

    await expect(test.service.prepare(command())).resolves.toEqual({
      status: 'QUESTION_ALREADY_ACTIVE',
      cycleId: 'old-cycle-id',
      cycleStatus: CoachProfileAcquisitionCycleStatus.ASKED,
      reasonCode: 'QUESTION_ALREADY_ACTIVE',
    });

    expect(test.tx.coachProfileAcquisitionCycle.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.create).not.toHaveBeenCalled();
  });

  it('expires a stale active cycle and creates a replacement in the same transaction', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      cycle({
        expiresAt: new Date('2026-09-28T21:59:00.000Z'),
      }),
    );

    await expect(test.service.prepare(command())).resolves.toEqual({
      status: 'EXPIRED_PREVIOUS',
      cycleId: 'new-cycle-id',
      cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
      reasonCode: 'EXPIRED_PREVIOUS',
    });

    expect(test.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(test.tx.coachProfileAcquisitionCycle.update).toHaveBeenCalledWith({
      where: { id: 'old-cycle-id' },
      data: {
        active: false,
        status: CoachProfileAcquisitionCycleStatus.EXPIRED,
        completedAt: referenceDate,
        resultCode: 'EXPIRED_WITHOUT_ANSWER',
      },
    });
    expect(test.tx.coachProfileAcquisitionCycle.create).toHaveBeenCalledTimes(
      1,
    );
  });

  it('atomically supersedes exactly the expected active cycle and creates the replacement', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      cycle({ id: 'old-cycle-id' }),
    );

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: 'old-cycle-id',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toEqual({
      status: 'CREATED',
      cycleId: 'new-cycle-id',
      cycleStatus: CoachProfileAcquisitionCycleStatus.PENDING,
      reasonCode: 'SUPERSEDED_PREVIOUS',
    });

    expect(test.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(test.tx.$queryRaw).toHaveBeenCalledTimes(1);

    expect(test.tx.coachProfileAcquisitionCycle.update).toHaveBeenCalledWith({
      where: { id: 'old-cycle-id' },
      data: {
        active: false,
        status: CoachProfileAcquisitionCycleStatus.CANCELLED,
        completedAt: referenceDate,
        resultCode: 'SUPERSEDED_BY_NEW_PRODUCTIVE_REQUEST',
      },
    });

    expect(test.tx.coachProfileAcquisitionCycle.create).toHaveBeenCalledTimes(
      1,
    );

    const updateOrder =
      test.tx.coachProfileAcquisitionCycle.update.mock.invocationCallOrder[0];
    const createOrder =
      test.tx.coachProfileAcquisitionCycle.create.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(createOrder);

    expect(test.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PROFILE_ACQUISITION_CYCLE_SUPERSEDED',
        entityType: 'COACH_PROFILE_ACQUISITION_CYCLE',
        entityId: 'old-cycle-id',
        metadata: expect.objectContaining({
          oldCycleId: 'old-cycle-id',
          oldField: CoachProfileAcquisitionField.TRAINING_ENVIRONMENT,
          reason: 'SUPERSEDED_BY_NEW_PRODUCTIVE_REQUEST',
          newSourceMessageId: 'new-request-id',
          newCycleId: 'new-cycle-id',
        }),
      }),
    });
  });

  it('does not supersede when the expected cycle changed state after the authorization snapshot', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      cycle({
        id: 'old-cycle-id',
        status: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
        updatedAt: new Date('2026-09-28T15:14:00.000Z'),
      }),
    );

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: 'old-cycle-id',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toEqual({
      status: 'QUESTION_ALREADY_ACTIVE',
      cycleId: 'old-cycle-id',
      cycleStatus: CoachProfileAcquisitionCycleStatus.CONFIRMATION_PENDING,
      reasonCode: 'ACTIVE_CYCLE_CHANGED',
    });

    expect(test.tx.coachProfileAcquisitionCycle.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.create).not.toHaveBeenCalled();
  });

  it('does not supersede if another active cycle won the race before the lock recheck', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(
      cycle({ id: 'different-cycle-id' }),
    );

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: 'expected-cycle-id',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toEqual({
      status: 'QUESTION_ALREADY_ACTIVE',
      cycleId: 'different-cycle-id',
      cycleStatus: CoachProfileAcquisitionCycleStatus.ASKED,
      reasonCode: 'ACTIVE_CYCLE_CHANGED',
    });

    expect(test.tx.coachProfileAcquisitionCycle.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.create).not.toHaveBeenCalled();
  });

  it('does not create a replacement when the expected active cycle no longer exists', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findFirst.mockResolvedValue(null);

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: 'old-cycle-id',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toEqual({
      status: 'QUESTION_ALREADY_ACTIVE',
      cycleId: null,
      cycleStatus: null,
      reasonCode: 'ACTIVE_CYCLE_CHANGED',
    });

    expect(test.tx.coachProfileAcquisitionCycle.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.create).not.toHaveBeenCalled();
  });

  it('keeps supersession replay idempotent by checking operationKey before active-cycle mutation', async () => {
    const test = subject();
    test.tx.coachProfileAcquisitionCycle.findUnique.mockResolvedValue(
      cycle({
        id: 'new-cycle-id',
        status: CoachProfileAcquisitionCycleStatus.PENDING,
        operationKey: 'operation-key',
        sourceMessageId: 'new-request-id',
      }),
    );

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: 'old-cycle-id',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toMatchObject({
      status: 'DUPLICATE',
      cycleId: 'new-cycle-id',
      reasonCode: 'DUPLICATE_OPERATION',
    });

    expect(
      test.tx.coachProfileAcquisitionCycle.findFirst,
    ).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.update).not.toHaveBeenCalled();
    expect(test.tx.coachProfileAcquisitionCycle.create).not.toHaveBeenCalled();
  });

  it('preserves explicit confirmation state on a newly prepared cycle', async () => {
    const test = subject();
    const explicitSpecification: ProfileQuestionSpecification = Object.freeze({
      ...baseSpecification,
      confirmationPolicy: 'EXPLICIT',
    });

    await test.service.prepare(
      command({
        specification: explicitSpecification,
      }),
    );

    expect(test.tx.coachProfileAcquisitionCycle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        confirmationState: CoachProfileConfirmationState.PENDING,
      }),
    });
  });

  it('rejects an empty expected active cycle id without opening a transaction', async () => {
    const test = subject();

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: '   ',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toEqual({
      status: 'REJECTED',
      cycleId: null,
      cycleStatus: null,
      reasonCode: 'INVALID_SUPERSESSION_COMMAND',
    });

    expect(test.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid prepare commands before opening a transaction', async () => {
    const test = subject();

    await expect(
      test.service.prepare(
        command({
          logicalTurn: -1,
        }),
      ),
    ).resolves.toEqual({
      status: 'REJECTED',
      cycleId: null,
      cycleStatus: null,
      reasonCode: 'INVALID_CYCLE_COMMAND',
    });

    expect(test.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('remains inert when profile acquisition mode is OFF', async () => {
    const test = subject('OFF');

    await expect(test.service.prepare(command())).resolves.toEqual({
      status: 'REJECTED',
      cycleId: null,
      cycleStatus: null,
      reasonCode: 'ACQUISITION_DISABLED',
    });

    await expect(
      test.service.supersedeActiveAndPrepare({
        expectedActiveCycleId: 'old-cycle-id',
        expectedActiveCycleUpdatedAt: activeUpdatedAt,
        command: command(),
      }),
    ).resolves.toEqual({
      status: 'REJECTED',
      cycleId: null,
      cycleStatus: null,
      reasonCode: 'ACQUISITION_DISABLED',
    });

    expect(test.prisma.$transaction).not.toHaveBeenCalled();
  });
});
