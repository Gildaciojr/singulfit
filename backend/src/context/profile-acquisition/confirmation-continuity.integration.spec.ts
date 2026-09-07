import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  CoachProfileAcquisitionCycle,
  CoachProfileAcquisitionField,
  CoachProfileFieldValue,
  OutboxEvent,
  OutboundMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EventHandlerRegistry } from '../../event-bus/event-handler.registry';
import { IntegrationEventHandlersService } from '../../event-bus/integration-event-handlers.service';
import { INTERNAL_EVENT } from '../../event-bus/event-bus.constants';
import { CoachProfileFieldRegistryService } from './coach-profile-field-registry.service';
import {
  CoachProfileMutationService,
  CoachProfileMutationCommandFactoryService,
} from './coach-profile-mutation.service';
import { ProfileAcquisitionCycleService } from './profile-acquisition-cycle.service';
import { ProfileAcquisitionOperationalConfigService } from './profile-acquisition-operational-config.service';
import { ProfileAcquisitionInternalRolloutService } from './profile-acquisition-internal-rollout.service';
import { ProfileAnswerRecognizerService } from './profile-answer-recognizer.service';
import {
  ProfileQuestionSpecificationService,
  ProfileQuestionRealizerService,
} from './profile-question.service';

describe('Confirmation continuity through the inbound handler and real acquisition services', () => {
  const at = new Date('2026-09-06T18:53:53Z');
  const token = (id: string) => createHash('sha256').update(id).digest('hex');
  type Value = Pick<
    CoachProfileFieldValue,
    | 'id'
    | 'userId'
    | 'field'
    | 'valueType'
    | 'textListValue'
    | 'valueFingerprint'
    | 'status'
    | 'isActive'
    | 'operationKey'
  >;
  function subject(
    text = 'Pode. Eu não tenho nenhuma alergia alimentar',
    stored: string[] = ['Não.'],
  ) {
    const cycle: CoachProfileAcquisitionCycle = {
      id: 'fictional-cycle',
      userId: 'fictional-user',
      field: 'ALLERGIES',
      status: 'CONFIRMATION_PENDING',
      active: true,
      confirmationState: 'PENDING',
      origin: 'NUTRITION_V2_PRODUCTIVE_GENERATION:fictional-root',
      askedAt: new Date('2026-09-06T18:53:15.047Z'),
      answeredAt: new Date('2026-09-06T18:53:23Z'),
      expiresAt: new Date('2026-09-08T18:53:11Z'),
      sourceMessageId: 'fictional-root',
      resultCode: 'ANSWERED:' + token('fictional-answer'),
      referenceDate: new Date('2026-09-06T18:53:11Z'),
      completedAt: null,
      cooldownUntil: null,
      logicalTurn: 1,
      questionKind: 'SHORT_TEXT_LIST',
      questionVersion: 1,
      operationKey: 'fictional-cycle-operation',
      createdAt: at,
      updatedAt: at,
    };
    const values: Value[] = [
      {
        id: 'old-value',
        userId: cycle.userId,
        field: 'ALLERGIES',
        valueType: 'TEXT_LIST',
        textListValue: stored,
        valueFingerprint: 'old-fingerprint',
        status: 'ANSWERED_UNCONFIRMED',
        isActive: true,
        operationKey: 'old-operation',
      },
    ];
    type Outbound = {
      id: string;
      userId: string;
      conversationId: string;
      sourceMessageId: string;
      responseType: string;
      content: string;
      status: OutboundMessageStatus;
      externalMessageId: string | null;
      sentAt: Date | null;
    };
    const outbounds: Outbound[] = [
      {
        id: 'initial-outbound',
        userId: cycle.userId,
        conversationId: 'fictional-conversation',
        sourceMessageId: 'fictional-answer',
        responseType: 'PROFILE_ACQUISITION',
        status: 'SENT',
        content: 'Só para confirmar: Não.. Posso salvar assim?',
        externalMessageId: 'initial-external',
        sentAt: new Date('2026-09-06T18:53:28.067Z'),
      },
    ];
    const messages = new Map([
      [
        'confirmation-id',
        {
          id: 'confirmation-id',
          content: text,
          timestamp: at,
          conversationId: 'fictional-conversation',
          replyToExternalMessageId: null as string | null,
        },
      ],
    ]);
    let hasCycle = true;
    const usageBucket = {
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    };
    const usageEvent = { create: jest.fn() };
    const aiJob = { create: jest.fn() };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      coachProfileFieldValue: {
        findUnique: jest.fn(
          ({ where }: { where: { operationKey: string } }) =>
            values.find((v) => v.operationKey === where.operationKey) ?? null,
        ),
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: {
              userId: string;
              field: CoachProfileAcquisitionField;
              status?: string;
            };
          }) =>
            values.find(
              (v) =>
                v.userId === where.userId &&
                v.field === where.field &&
                v.isActive &&
                (!where.status || v.status === where.status),
            ) ?? null,
        ),
        create: jest.fn(({ data }: { data: Omit<Value, 'id'> }) => {
          const value = { ...data, id: 'value-' + values.length };
          values.push(value);
          return value;
        }),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<Value>;
          }) => {
            const value = values.find((v) => v.id === where.id)!;
            Object.assign(value, data);
            return value;
          },
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: {
              userId: string;
              active?: boolean;
              resultCode?: { endsWith: string };
            };
          }) =>
            hasCycle &&
            where.userId === cycle.userId &&
            (where.active === undefined || cycle.active === where.active) &&
            (!where.resultCode ||
              cycle.resultCode?.endsWith(where.resultCode.endsWith))
              ? { ...cycle }
              : null,
        ),
        findUnique: jest.fn(() => (hasCycle ? { ...cycle } : null)),
        update: jest.fn(
          ({ data }: { data: Partial<CoachProfileAcquisitionCycle> }) => {
            Object.assign(cycle, data);
            return { ...cycle };
          },
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { resultCode: string };
            data: Partial<CoachProfileAcquisitionCycle>;
          }) => {
            if (cycle.resultCode !== where.resultCode) return { count: 0 };
            Object.assign(cycle, data);
            return { count: 1 };
          },
        ),
      },
      outboundMessage: {
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: {
              sourceMessageId_responseType: { sourceMessageId: string };
            };
          }) =>
            outbounds.find(
              (o) =>
                o.sourceMessageId ===
                where.sourceMessageId_responseType.sourceMessageId,
            ) ?? null,
        ),
        create: jest.fn(
          ({
            data,
          }: {
            data: Omit<
              Outbound,
              'id' | 'status' | 'externalMessageId' | 'sentAt'
            >;
          }) => {
            const outbound: Outbound = {
              ...data,
              id: 'outbound-' + outbounds.length,
              status: 'PENDING',
              externalMessageId: null,
              sentAt: null,
            };
            outbounds.push(outbound);
            return outbound;
          },
        ),
        findMany: jest.fn(
          ({ where }: { where: { sentAt: { gt: Date; lt: Date } } }) =>
            outbounds.filter(
              (o) =>
                o.sentAt &&
                o.sentAt > where.sentAt.gt &&
                o.sentAt < where.sentAt.lt,
            ),
        ),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      scheduledMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn() },
      usageBucket,
      usageEvent,
      aiJob,
    };
    let queue = Promise.resolve();
    const prisma = {
      ...tx,
      message: {
        findFirst: jest.fn(
          ({ where }: { where: { id: string; conversationId?: string } }) =>
            where.id === 'fictional-root'
              ? where.conversationId === 'fictional-conversation'
                ? { id: where.id }
                : null
              : (messages.get(where.id) ?? null),
        ),
      },
      $transaction: <T>(
        callback: (client: typeof tx) => Promise<T>,
      ): Promise<T> => {
        const result = queue.then(() => callback(tx));
        queue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    const config = new ProfileAcquisitionOperationalConfigService(
      new ConfigService({ PROFILE_ACQUISITION_MODE: 'INTERNAL' }),
    );
    const registry = new CoachProfileFieldRegistryService();
    const mutations = new CoachProfileMutationService(
      prisma as unknown as PrismaService,
      registry,
      config,
    );
    const cycles = new ProfileAcquisitionCycleService(
      prisma as unknown as PrismaService,
      config,
    );
    const published = new Set<string>();
    const eventBus = {
      publish: jest.fn((event: { aggregateId: string }) => {
        published.add(event.aggregateId);
      }),
    };
    const rollout = new ProfileAcquisitionInternalRolloutService(
      prisma as unknown as PrismaService,
      eventBus as unknown as EventBusService,
      config,
      { evaluate: () => ({ internal: true, eligible: true }) } as never,
      {
        evaluate: () => ({
          evaluation: { canAsk: false },
          specification: null,
        }),
      } as never,
      new ProfileQuestionSpecificationService(registry),
      new ProfileQuestionRealizerService(),
      new ProfileAnswerRecognizerService(registry),
      new CoachProfileMutationCommandFactoryService(registry),
      mutations,
      cycles,
    );
    const commands = {
      shouldHandleBeforeProfileAcquisition: jest.fn().mockResolvedValue(false),
      processTextMessage: jest.fn(),
    };
    const onboarding = {
      processTextMessage: jest.fn().mockResolvedValue({ handled: false }),
    };
    const handlersRegistry = new EventHandlerRegistry();
    const handlers = new IntegrationEventHandlersService(
      handlersRegistry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      commands as never,
      {} as never,
      {} as never,
      onboarding as never,
      rollout,
      { authorizeOrNotify: () => true } as never,
    );
    handlers.onModuleInit();
    const handle = async (id = 'confirmation-id', userId = cycle.userId) => {
      await handlersRegistry.get(
        INTERNAL_EVENT.COACH_ONBOARDING_TEXT_RECEIVED,
      )!({
        payload: { userId, messageId: id },
        createdAt: at,
      } as OutboxEvent);
    };
    return {
      cycle,
      values,
      outbounds,
      messages,
      prisma,
      tx,
      rollout,
      commands,
      onboarding,
      published,
      mutations,
      cycles,
      handle,
      removeCycle: () => {
        hasCycle = false;
      },
    };
  }

  it.each(['Sim', 'Pode', 'Pode.', 'Correto.'])(
    'consumes natural confirmation and resumes only the original productive request: %s',
    async (text) => {
      const test = subject(text, []);
      await test.handle();
      expect(test.cycle).toMatchObject({
        active: false,
        status: 'COMPLETED',
        confirmationState: 'CONFIRMED',
      });
      expect(test.values.find((v) => v.isActive)).toMatchObject({
        textListValue: [],
        status: 'CONFIRMED',
      });
      expect(test.commands.processTextMessage).toHaveBeenCalledTimes(1);
      expect(test.commands.processTextMessage).toHaveBeenCalledWith({
        userId: 'fictional-user',
        messageId: 'confirmation-id',
        planningContinuation: {
          originalRequestMessageId: 'fictional-root',
          intent: 'DIET',
        },
      });
      expect(test.onboarding.processTextMessage).not.toHaveBeenCalled();
    },
  );

  it.each([
    'Pode. Eu não tenho nenhuma alergia alimentar',
    'Isso mesmo, não tenho alergia.',
  ])(
    'repairs the exact incident value and resumes once, including replay: %s',
    async (text) => {
      const test = subject(text);
      await test.handle();
      await test.handle();
      expect(test.values.find((v) => v.isActive)).toMatchObject({
        textListValue: [],
        status: 'CONFIRMED',
      });
      expect(test.tx.coachProfileFieldValue.create).toHaveBeenCalledTimes(1);
      expect(test.cycle.active).toBe(false);
      expect(test.commands.processTextMessage).toHaveBeenCalledTimes(1);
      expect(test.commands.processTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          planningContinuation: {
            intent: 'DIET',
            originalRequestMessageId: 'fictional-root',
          },
        }),
      );
      expect(test.onboarding.processTextMessage).not.toHaveBeenCalled();
      expect(test.tx.outboundMessage.create).not.toHaveBeenCalled();
      expect(test.tx.usageBucket.create).not.toHaveBeenCalled();
      expect(test.tx.usageBucket.update).not.toHaveBeenCalled();
      expect(test.tx.usageBucket.upsert).not.toHaveBeenCalled();
      expect(test.tx.usageEvent.create).not.toHaveBeenCalled();
      expect(test.tx.aiJob.create).not.toHaveBeenCalled();
    },
  );

  it('persists an explicit correction, asks again, then confirms the corrected value', async () => {
    const test = subject('Não, na verdade tenho alergia a amendoim.');
    await test.handle();
    expect(test.values.find((v) => v.isActive)).toMatchObject({
      textListValue: ['amendoim'],
      status: 'ANSWERED_UNCONFIRMED',
    });
    expect(test.cycle).toMatchObject({
      active: true,
      status: 'CONFIRMATION_PENDING',
    });
    expect(test.commands.processTextMessage).not.toHaveBeenCalled();
    expect(test.outbounds[1].content).toContain('amendoim');
    test.outbounds[1].sentAt = new Date(at.getTime() + 1000);
    test.outbounds[1].status = 'SENT';
    test.messages.set('second-id', {
      id: 'second-id',
      content: 'Pode.',
      timestamp: new Date(at.getTime() + 2000),
      conversationId: 'fictional-conversation',
      replyToExternalMessageId: null,
    });
    await test.handle('second-id');
    expect(test.values.find((v) => v.isActive)).toMatchObject({
      textListValue: ['amendoim'],
      status: 'CONFIRMED',
    });
    expect(test.cycle.active).toBe(false);
    expect(test.commands.processTextMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['acho que sim', 'talvez', 'não sei'])(
    'keeps ambiguous confirmation and emits one clarification on replay: %s',
    async (text) => {
      const test = subject(text);
      await test.handle();
      await test.handle();
      expect(test.cycle).toMatchObject({
        active: true,
        status: 'CONFIRMATION_PENDING',
      });
      expect(test.tx.coachProfileFieldValue.create).not.toHaveBeenCalled();
      expect(test.tx.outboundMessage.create).toHaveBeenCalledTimes(1);
      expect(test.published.size).toBe(1);
      expect(test.commands.processTextMessage).not.toHaveBeenCalled();
      expect(test.onboarding.processTextMessage).not.toHaveBeenCalled();
    },
  );

  it.each(['same', 'different'])(
    'keeps claims and mutation idempotent under concurrent %s messages',
    async (scenario) => {
      const test = subject();
      const secondId = scenario === 'same' ? 'confirmation-id' : 'second-id';
      test.messages.set(secondId, {
        ...test.messages.get('confirmation-id')!,
        id: secondId,
      });
      await Promise.all([test.handle(), test.handle(secondId)]);
      expect(test.values.filter((v) => v.isActive)).toHaveLength(1);
      expect(test.tx.coachProfileFieldValue.create).toHaveBeenCalledTimes(1);
      expect(test.commands.processTextMessage).toHaveBeenCalledTimes(1);
      expect(test.commands.processTextMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          planningContinuation: expect.objectContaining({ intent: 'DIET' }),
        }),
      );
      expect(test.tx.$queryRaw).toHaveBeenCalled();
    },
  );

  it.each([
    'missing',
    'expired',
    'inactive',
    'foreign-user',
    'foreign-conversation',
    'wrong-quote',
  ])('does not consume an inapplicable cycle: %s', async (scenario) => {
    const test = subject();
    if (scenario === 'missing') test.removeCycle();
    if (scenario === 'expired') test.cycle.expiresAt = at;
    if (scenario === 'inactive') test.cycle.active = false;
    if (scenario === 'foreign-conversation')
      test.messages.get('confirmation-id')!.conversationId =
        'foreign-conversation';
    if (scenario === 'wrong-quote')
      test.messages.get('confirmation-id')!.replyToExternalMessageId =
        'wrong-external';
    await test.handle(
      'confirmation-id',
      scenario === 'foreign-user' ? 'foreign-user' : 'fictional-user',
    );
    expect(test.tx.coachProfileFieldValue.create).not.toHaveBeenCalled();
    expect(test.commands.processTextMessage).toHaveBeenCalledWith({
      userId: scenario === 'foreign-user' ? 'foreign-user' : 'fictional-user',
      messageId: 'confirmation-id',
    });
  });

  it('restores the confirmation source token after a failed claimed response', async () => {
    const test = subject();
    const previous = test.cycle.resultCode;
    jest
      .spyOn(test.mutations, 'resolvePendingConfirmation')
      .mockRejectedValueOnce(new Error('simulated mutation failure'));
    await expect(test.handle()).rejects.toThrow('simulated mutation failure');
    expect(test.cycle.resultCode).toBe(previous);
    expect(test.commands.processTextMessage).not.toHaveBeenCalled();
    await test.handle();
    expect(test.cycle.active).toBe(false);
    expect(test.commands.processTextMessage).toHaveBeenCalledTimes(1);
  });

  it('accepts the exact quoted confirmation', async () => {
    const test = subject();
    test.messages.get('confirmation-id')!.replyToExternalMessageId =
      'initial-external';
    await test.handle();
    expect(test.cycle.active).toBe(false);
  });

  it('lets an unequivocal independent workout read follow its normal route', async () => {
    const test = subject('Qual é meu treino atual?');
    await test.handle();
    expect(test.cycle.active).toBe(true);
    expect(test.tx.coachProfileFieldValue.create).not.toHaveBeenCalled();
    expect(test.commands.processTextMessage).toHaveBeenCalledWith({
      userId: 'fictional-user',
      messageId: 'confirmation-id',
    });
  });

  it('does not apply an allergy declaration to another field', async () => {
    const test = subject();
    test.cycle.field = 'FOOD_INTOLERANCES';
    await test.handle();
    expect(test.tx.coachProfileFieldValue.create).not.toHaveBeenCalled();
    expect(test.cycle.active).toBe(true);
    expect(test.commands.processTextMessage).not.toHaveBeenCalled();
  });
});
