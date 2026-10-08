import { Prisma } from '@prisma/client';
import { ConversationContinuationService } from '../runtime/conversation-continuation.service';
import { ConversationContinuationStore } from '../runtime/conversation-continuation.store';
import {
  ConversationContinuationSemanticsService,
  type ContinuationInterpretation,
} from '../runtime/conversation-continuation-semantics.service';
import {
  continuation,
  parseContinuation,
} from '../runtime/conversation-continuation.contract';
import { ConversationRuntimeOperationalConfigService } from '../runtime/conversation-runtime-operational-config.service';
import { ConversationPublicAnswerBoundaryService } from '../runtime/conversation-public-answer-boundary.service';
import { ConversationSafetyDetectorService } from '../understanding/conversation-safety-detector.service';
import { ConversationMessageNormalizerService } from '../understanding/conversation-message-normalizer.service';
import type { ConversationQAFollowUpContextService } from '../runtime/conversation-qa-follow-up-context.service';
import type { ConversationCurrentNutritionContextService } from '../runtime/conversation-current-nutrition-context.service';
import type { CurrentWorkoutPlanReaderService } from '../../workout/v2/current-workout-plan-reader.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConversationAIService } from '../../ai/conversation-ai.service';
import type { ConfigService } from '@nestjs/config';

describe('Canonical conversation continuation', () => {
  const at = new Date('2026-10-04T15:00:00Z');
  const base: ContinuationInterpretation = {
    action: 'UNRESOLVED',
    day: 'UNRESOLVED',
    consumption: 'UNKNOWN',
    meal: 'UNKNOWN',
    description: null,
    hydrationGoal: false,
    reference: 'PENDING',
  };
  function subject(
    kind:
      | 'WORKOUT_COMPLETION_CHECK'
      | 'WORKOUT_DAY_QUERY'
      | 'MEAL_COMPLETION_CHECK'
      | 'MEAL_CONTENT_REQUEST'
      | 'HYDRATION_CHECK'
      | null = 'MEAL_COMPLETION_CHECK',
    interpretation: Partial<ContinuationInterpretation> = {},
  ) {
    let row = kind
      ? {
          id: 'scheduled',
          userId: 'user',
          conversationId: 'conversation',
          content: 'Já almoçou?',
          context: {
            continuation: continuation(
              kind,
              new Date(at.getTime() - 1000),
              'LUNCH',
              'AUTOMATION',
            ),
          },
          sentAt: new Date(at.getTime() - 1000),
          scheduledFor: new Date(at.getTime() - 1000),
          responseExpiresAt: null as Date | null,
          responseMessageId: null as string | null,
        }
      : null;
    const prisma = {
      $queryRaw: jest.fn(),
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message',
          content: 'sim',
          timestamp: at,
          conversationId: 'conversation',
          replyToExternalMessageId: null,
          conversation: { userId: 'user' },
        }),
      },
      scheduledMessage: {
        findFirst: jest.fn().mockImplementation(() => row),
        findUnique: jest.fn().mockImplementation(() => row),
        updateMany: jest
          .fn()
          .mockImplementation(
            (input: { data: { responseMessageId: string } }) => {
              if (!row || row.responseMessageId) return { count: 0 };
              row.responseMessageId = input.data.responseMessageId;
              return { count: 1 };
            },
          ),
      },
      outboundMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      coachProfileAcquisitionCycle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const semantics = {
      interpret: jest.fn().mockResolvedValue({ ...base, ...interpretation }),
      evaluate: jest.fn().mockResolvedValue({
        adherence: 'NOT_ALIGNED',
        content:
          'Uma refeição diferente não apaga seu progresso. Retome seu plano nas próximas refeições, sem compensar.',
      }),
    };
    const config = {
      get: jest.fn().mockReturnValue({ valid: true, killSwitch: false }),
      isOfficiallyEligible: jest.fn().mockReturnValue(true),
    };
    const workout = {
      presentCanonicalDay: jest.fn().mockResolvedValue({
        content: 'Sessão de domingo; somente exercícios daquele dia.',
        resolvedLocalDate: '2026-10-04',
      }),
      present: jest
        .fn()
        .mockResolvedValue(
          'Sessão de domingo; somente exercícios daquele dia.',
        ),
    };
    const nutrition = {
      read: jest.fn().mockResolvedValue({
        status: 'AVAILABLE',
        plan: {
          days: [
            {
              label: 'domingo',
              meals: [
                {
                  name: 'Almoço',
                  items: [{ name: 'frango', quantity: '120 g' }],
                },
              ],
            },
          ],
          substitutions: [{ source: 'frango', alternative: 'carne' }],
        },
      }),
    };
    const qa = {
      findPending: jest.fn().mockResolvedValue(null),
      findReferent: jest.fn().mockResolvedValue(null),
      hasBlockingLifecycle: jest.fn().mockResolvedValue(false),
    };
    const store = new ConversationContinuationStore(
      prisma as unknown as PrismaService,
      config as unknown as ConversationRuntimeOperationalConfigService,
    );
    // Functional resolver unit tests isolate the gate; its real PostgreSQL
    // concurrency/at-most-once contract is exercised by the integration suite.
    jest
      .spyOn(store, 'resolveOnce')
      .mockImplementation((_user, _id, _type, execute) => execute());
    const service = new ConversationContinuationService(
      prisma as unknown as PrismaService,
      semantics as unknown as ConversationContinuationSemanticsService,
      workout as unknown as CurrentWorkoutPlanReaderService,
      nutrition as unknown as ConversationCurrentNutritionContextService,
      new ConversationPublicAnswerBoundaryService(),
      new ConversationSafetyDetectorService(),
      new ConversationMessageNormalizerService(),
      qa as unknown as ConversationQAFollowUpContextService,
      store,
    );
    return {
      service,
      prisma,
      semantics,
      config,
      workout,
      nutrition,
      qa,
      row: () => row,
      setRow: (value: typeof row) => {
        row = value;
      },
    };
  }
  it.each([
    ['INDEPENDENT', 'EXPLICIT'],
    ['WORKOUT_REPLY', 'EXPLICIT'],
    ['HYDRATION_REPLY', 'EXPLICIT'],
    ['WORKOUT_REPLY', 'PENDING'],
    ['HYDRATION_REPLY', 'PENDING'],
  ] as const)(
    'delegates an independent guidance question instead of publishing interpreter prose: %s',
    async (action, reference) => {
      const s = subject(null, {
        action,
        reference,
        workoutEffect: 'NONE',
        response: 'Resposta genérica do interpretador sem perfil.',
      });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content:
          'Acabei de terminar meu treino de superiores na academia e já tomei aproximadamente 1 litro de água hoje. Como você acha que estou indo?',
      });
      const result = await s.service.resolve('user', 'message');
      expect(result).toMatchObject({
        pending: null,
        evidence: { delegateRuntime: true },
      });
      expect(result?.content).not.toBe(
        'Resposta genérica do interpretador sem perfil.',
      );
    },
  );
  it('keeps the real hydration + completed workout report in its quoted reminder and preserves the AI response', async () => {
    const content =
      'Bom dia. Já tomei 1 litro de água pela manhã e já realizei meu treino de superiores na academia.';
    const response =
      'Bom dia! Você já começou a manhã se hidratando e concluiu o treino de superiores. Continue distribuindo a água ao longo do dia. Como ficou sua energia?';
    const s = subject('HYDRATION_CHECK', {
      action: 'HYDRATION_REPLY',
      consumption: 'CONFIRMED',
      reference: 'PENDING',
      workoutEffect: 'NONE',
      workoutRequestQuote: null,
      response,
    });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content,
      replyToExternalMessageId: 'quoted-hydration',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result).toMatchObject({
      content: response,
      domain: 'HYDRATION',
      outcome: 'COMPLETED',
      pending: { scheduledMessageId: 'scheduled' },
      evidence: { workoutEffect: 'NONE', hydrationGoal: false },
    });
    expect(s.semantics.interpret).toHaveBeenCalledWith(
      content,
      expect.objectContaining({
        continuation: expect.objectContaining({ kind: 'HYDRATION_CHECK' }),
      }),
    );
    expect(s.workout.present).not.toHaveBeenCalled();
    expect(s.workout.presentCanonicalDay).not.toHaveBeenCalled();
  });
  it('preserves a historical COMPLETED/null receipt without repeating its semantic attempt', async () => {
    const execute = jest.fn();
    const row = {
      id: 'receipt',
      payload: {
        userId: 'user',
        conversationId: 'conversation',
        sourceMessageId: 'message',
        state: 'COMPLETED',
        result: null,
      },
    };
    const prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message',
          conversationId: 'conversation',
          conversation: { userId: 'user' },
          timestamp: at,
        }),
      },
      outboxEvent: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    const config = {
      get: () => ({ valid: true, killSwitch: false }),
      isOfficiallyEligible: () => true,
    };
    const store = new ConversationContinuationStore(
      prisma as unknown as PrismaService,
      config as unknown as ConversationRuntimeOperationalConfigService,
    );
    const fallback = {
      content: 'Pode esclarecer o contexto?',
      domain: 'GENERAL' as const,
      pending: null,
      next: null,
      outcome: 'UNKNOWN' as const,
      evidence: {},
    };
    expect(
      await store.resolveOnce('user', 'message', 'TEXT', execute, fallback),
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    expect(row.payload.result).toBeNull();
  });
  it('hands off only the current explicit request in a mixed report', async () => {
    const requestQuote =
      'Monte um novo treino de CrossFit para mim, 4x por semana';
    const s = subject('HYDRATION_CHECK', {
      action: 'INDEPENDENT',
      workoutEffect: 'GENERATE',
      workoutRequestQuote: requestQuote,
    });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: `Já tomei água e treinei na academia. ${requestQuote}`,
      replyToExternalMessageId: 'quoted-hydration',
    });
    expect(
      (await s.service.resolve('user', 'message'))?.evidence,
    ).toMatchObject({
      workoutEffect: 'GENERATE',
      workoutRequestQuote: requestQuote,
    });
    expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    [null, null],
    [null, 'UNRESOLVED'],
    ['MEAL_CONTENT_REQUEST', null],
    ['MEAL_CONTENT_REQUEST', 'UNRESOLVED'],
    ['WORKOUT_DAY_QUERY', null],
    ['WORKOUT_DAY_QUERY', 'UNRESOLVED'],
  ] as const)(
    'delegates autonomous advice before interpreter with pending=%s and result=%s',
    async (kind, action) => {
      const s = subject(kind);
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: 'Me dê uma dica para lanche da tarde',
      });
      s.semantics.interpret.mockResolvedValue(
        action ? { ...base, action } : null,
      );
      expect(await s.service.resolve('user', 'message')).toBeNull();
      expect(s.semantics.interpret).not.toHaveBeenCalled();
      expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
      expect(s.nutrition.read).not.toHaveBeenCalled();
    },
  );

  it.each(['Outra opção', 'E esse?', 'Troca esse'])(
    'clarifies an unresolved dependent reply without writes: %s',
    async (text) => {
      const s = subject(null);
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      expect((await s.service.resolve('user', 'message'))?.content).toContain(
        'Pode me dizer a que mensagem',
      );
      expect(s.semantics.interpret).toHaveBeenCalled();
      expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
      expect(s.nutrition.read).not.toHaveBeenCalled();
    },
  );

  it('keeps a dependent alternative with valid Q&A referent in the runtime', async () => {
    const s = subject(null);
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'Outra opção',
    });
    s.qa.findPending.mockResolvedValue({
      previousAnswer: 'Uma opção é fruta com aveia.',
      previousFollowUpQuestion: 'Quer uma alternativa salgada?',
    });
    expect(await s.service.resolve('user', 'message')).toMatchObject({
      evidence: { delegateRuntime: true },
    });
    expect(s.semantics.interpret).toHaveBeenCalled();
  });

  it('does not bypass explicit persistent meal mutation', async () => {
    const s = subject(null, { action: 'INDEPENDENT' });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'Troque permanentemente meu lanche por uma fruta',
    });
    expect(await s.service.resolve('user', 'message')).toBeNull();
    expect(s.semantics.interpret).toHaveBeenCalled();
  });

  it('keeps safety before autonomous nutrition advice', async () => {
    const s = subject(null);
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'Me dê uma dica para lanche da tarde, estou com dor no peito',
    });
    expect(await s.service.resolve('user', 'message')).toMatchObject({
      evidence: { safetyAction: 'URGENT_GUIDANCE' },
    });
    expect(s.semantics.interpret).not.toHaveBeenCalled();
  });

  it.each(['bom dia', 'oi', 'beleza', 'tudo certo'])(
    'does not promote greeting %s to a workout fact',
    async (text) => {
      const s = subject('WORKOUT_COMPLETION_CHECK', { action: 'INDEPENDENT' });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      expect(await s.service.resolve('user', 'message')).toBeNull();
      expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each([
    'Qual minha próxima refeição?',
    'Não mandei sobre treino. Perguntei QUAL A MINHA PRÓXIMA REFEIÇÃO DE HOJE',
    'não perguntei de treino, perguntei minha próxima refeição',
    'O que posso comer no jantar?',
    'Me dê uma dica para lanche da tarde',
    'O que posso comer no lugar do meu lanche da tarde?',
    'Quero um lanche da tarde rápido e proteico',
    'Me sugira algo diferente para comer agora',
    'Me sugira algo sem lactose',
    'Quanto de proteína consumi hoje?',
    'Posso substituir o frango por outra proteína?',
    'Quero uma dieta',
  ])(
    'bypasses incompatible workout context before interpretation for %s',
    async (text) => {
      const s = subject('WORKOUT_DAY_QUERY', {
        action: 'WORKOUT_QUERY',
        day: 'NEXT',
      });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      expect(await s.service.resolve('user', 'message')).toBeNull();
      expect(s.semantics.interpret).not.toHaveBeenCalled();
      expect(s.workout.presentCanonicalDay).not.toHaveBeenCalled();
      expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
      expect(s.row()?.responseMessageId).toBeNull();
    },
  );
  it.each([
    'MEAL_COMPLETION_CHECK',
    'MEAL_CONTENT_REQUEST',
    'HYDRATION_CHECK',
  ] as const)(
    'reads explicit workout without consuming incompatible %s',
    async (kind) => {
      const s = subject(kind, {
        action: 'WORKOUT_QUERY',
        day: 'TOMORROW',
        reference: 'EXPLICIT',
      });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: 'Qual meu treino de amanhã?',
      });
      const reply = await s.service.resolve('user', 'message');
      expect(s.semantics.interpret).toHaveBeenCalledWith(
        'Qual meu treino de amanhã?',
        null,
      );
      expect(reply).toMatchObject({
        domain: 'WORKOUT',
        pending: null,
        next: { kind: 'WORKOUT_DAY_QUERY' },
      });
      if (!reply) throw new Error('Missing workout reply');
      expect(
        await s.service.claim(
          s.prisma as unknown as Prisma.TransactionClient,
          'user',
          'conversation',
          'message',
          reply,
          at,
        ),
      ).toBe(true);
      expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
      expect(s.row()?.responseMessageId).toBeNull();
    },
  );
  it.each([
    ['E depois?', 'NEXT'],
    ['e amanhã?', 'TOMORROW'],
  ] as const)(
    'preserves compatible workout follow-up %s and its claim',
    async (text, day) => {
      const s = subject('WORKOUT_DAY_QUERY', {
        action: 'WORKOUT_QUERY',
        day,
        reference: 'PENDING',
      });
      const row = s.row();
      if (!row) throw new Error('Missing workout pending');
      s.setRow({
        ...row,
        context: {
          continuation: continuation(
            'WORKOUT_DAY_QUERY',
            row.sentAt,
            'UNKNOWN',
            'USER_QUERY',
            '2026-10-06',
          ),
        },
      });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      const reply = await s.service.resolve('user', 'message');
      expect(reply?.domain).toBe('WORKOUT');
      expect(s.workout.presentCanonicalDay).toHaveBeenCalledWith(
        'user',
        day === 'NEXT' ? 'qual meu próximo treino' : 'amanhã',
        at,
        day === 'NEXT' ? '2026-10-06' : undefined,
      );
      if (!reply) throw new Error('Missing workout reply');
      expect(
        await s.service.claim(
          s.prisma as unknown as Prisma.TransactionClient,
          'user',
          'conversation',
          'message',
          reply,
          at,
        ),
      ).toBe(true);
      expect(s.row()?.responseMessageId).toBe('message');
    },
  );
  it('does not conclude workout from sim without pending context', async () => {
    const s = subject(null, {
      action: 'WORKOUT_REPLY',
      consumption: 'CONFIRMED',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result?.outcome).toBe('UNKNOWN');
    expect(result?.content).not.toContain('concluído');
  });
  it('cannot fall through to a historical workout read after an incorrect independent classification', async () => {
    const s = subject(null, { action: 'INDEPENDENT', reference: 'EXPLICIT' });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'Qual meu treino de hoje?',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result).toMatchObject({
      domain: 'GENERAL',
      next: null,
      outcome: 'UNKNOWN',
    });
    expect(s.workout.present).not.toHaveBeenCalled();
  });
  it.each([
    ['CONFIRMED', 'COMPLETED'],
    ['NOT_YET', 'SKIPPED'],
    ['PLANNED', 'DEFERRED'],
  ] as const)(
    'keeps workout evidence %s in its own domain',
    async (consumption, outcome) => {
      const s = subject('WORKOUT_COMPLETION_CHECK', {
        action: 'WORKOUT_REPLY',
        consumption,
      });
      const text = {
        CONFIRMED: 'sim',
        NOT_YET: 'ainda não',
        PLANNED: 'vou às 19',
      }[consumption];
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      const reply = await s.service.resolve('user', 'message');
      expect(reply).toMatchObject({
        domain: 'WORKOUT',
        outcome,
        next: {
          kind:
            outcome === 'COMPLETED'
              ? 'WORKOUT_FEEDBACK'
              : 'WORKOUT_COMPLETION_CHECK',
        },
      });
      expect(s.nutrition.read).not.toHaveBeenCalled();
      expect(s.semantics.interpret).toHaveBeenCalledWith(
        text,
        expect.objectContaining({
          continuation: expect.objectContaining({ domain: 'WORKOUT' }),
        }),
      );
    },
  );
  it.each(['TODAY', 'TOMORROW', 'FRIDAY', 'NEXT', 'WHOLE_PLAN'] as const)(
    'dispatches %s to the owned canonical reader with inbound time',
    async (day) => {
      const s = subject('WORKOUT_DAY_QUERY', { action: 'WORKOUT_QUERY', day });
      const result = await s.service.resolve('user', 'message');
      const request = {
        TODAY: 'hoje',
        TOMORROW: 'amanhã',
        FRIDAY: 'sexta-feira',
        NEXT: 'qual meu próximo treino',
        WHOLE_PLAN: 'meu treino',
      }[day];
      expect(s.workout.presentCanonicalDay).toHaveBeenCalledWith(
        'user',
        request,
        at,
        undefined,
      );
      expect(result?.content).toBe(
        'Sessão de domingo; somente exercícios daquele dia.',
      );
      expect(result?.next?.kind).toBe('WORKOUT_DAY_QUERY');
    },
  );
  it('does not invent a day for unresolved follow-up', async () => {
    const s = subject(null, { action: 'UNRESOLVED' });
    expect((await s.service.resolve('user', 'message'))?.outcome).toBe(
      'UNKNOWN',
    );
    expect(s.workout.present).not.toHaveBeenCalled();
  });
  it.each(['CONFIRMED', 'UNKNOWN'] as const)(
    'asks food contents without claiming adherence from %s',
    async (consumption) => {
      const s = subject('MEAL_COMPLETION_CHECK', {
        action: 'MEAL_REPLY',
        consumption,
      });
      const result = await s.service.resolve('user', 'message');
      expect(result).toMatchObject({
        domain: 'NUTRITION',
        next: { kind: 'MEAL_CONTENT_REQUEST' },
        evidence: {
          contentKnown: false,
          adherence: 'INSUFFICIENT_INFORMATION',
        },
      });
      expect(result?.content).toContain('O que você comeu');
      expect(s.semantics.evaluate).not.toHaveBeenCalled();
    },
  );
  it('preserves dinner for já', async () => {
    const s = subject('MEAL_COMPLETION_CHECK', {
      action: 'MEAL_REPLY',
      consumption: 'CONFIRMED',
    });
    const row = s.row();
    if (!row) throw new Error('Missing reminder');
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'já',
    });
    s.setRow({
      ...row,
      context: {
        continuation: continuation(
          'MEAL_COMPLETION_CHECK',
          row.sentAt,
          'DINNER',
        ),
      },
    });
    expect((await s.service.resolve('user', 'message'))?.content).toContain(
      'no jantar',
    );
  });
  it.each([
    'ALIGNED',
    'PARTIALLY_ALIGNED',
    'NOT_ALIGNED',
    'INSUFFICIENT_INFORMATION',
  ])(
    'compares reported contents to canonical plan with result %s',
    async (adherence) => {
      const s = subject('MEAL_CONTENT_REQUEST', {
        action: 'MEAL_REPLY',
        description: 'arroz, feijão, frango e salada',
        consumption: 'CONFIRMED',
      });
      s.semantics.evaluate.mockResolvedValue({
        adherence,
        content: 'Vamos seguir com consistência, sem compensações.',
      });
      const result = await s.service.resolve('user', 'message');
      expect(s.nutrition.read).toHaveBeenCalledWith('user');
      expect(s.semantics.evaluate).toHaveBeenCalledWith(
        'arroz, feijão, frango e salada',
        'LUNCH',
        expect.objectContaining({
          days: expect.arrayContaining([
            expect.objectContaining({ label: 'domingo' }),
          ]),
          substitutions: [{ source: 'frango', alternative: 'carne' }],
        }),
        false,
      );
      expect(result?.evidence.adherence).toBe(adherence);
      expect(result?.content).not.toContain('O que você comeu');
    },
  );
  it('does not praise adherence to an absent active plan', async () => {
    const s = subject('MEAL_CONTENT_REQUEST', {
      action: 'MEAL_REPLY',
      description: 'pizza',
      consumption: 'CONFIRMED',
    });
    s.nutrition.read.mockResolvedValue({ status: 'ABSENT', plan: null });
    const result = await s.service.resolve('user', 'message');
    expect(result?.evidence.adherence).toBe('INSUFFICIENT_INFORMATION');
    expect(result?.content).toContain('Não encontrei um plano alimentar ativo');
    expect(s.semantics.evaluate).not.toHaveBeenCalled();
  });
  it('gives pizza a semantic comparison instead of automatic encouragement', async () => {
    const s = subject('MEAL_COMPLETION_CHECK', {
      action: 'MEAL_REPLY',
      description: 'pizza',
      consumption: 'CONFIRMED',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result?.evidence.adherence).toBe('NOT_ALIGNED');
    expect(result?.content).not.toContain('Continue seguindo');
    expect(result?.content).not.toContain('culpa');
  });
  it('keeps the real lunch report across a three-hour quantity follow-up without repeating the question', async () => {
    const foods = 'arroz, linguiça cozida e batata grelhada';
    const quantities =
      '2 conchas médias de arroz, dois gomos de linguiça cozida e uma porção pequena de batata cozida';
    const s = subject('MEAL_COMPLETION_CHECK', {
      action: 'MEAL_REPLY',
      description: foods,
      consumption: 'CONFIRMED',
      meal: 'LUNCH',
      reference: 'PENDING',
    });
    const provider = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({
          status: 'COMPLETED',
          structuredOutput: {
            adherence: 'INSUFFICIENT_INFORMATION',
            content: 'Qual foi a porção de arroz, linguiça e batata?',
            dayIndex: 0,
            mealIndex: 0,
            matches: [],
            unmatchedFoodQuotes: [],
            reportedFoods: ['arroz', 'linguiça cozida', 'batata grelhada'].map(
              (foodQuote) => ({ foodQuote, quantityQuote: null }),
            ),
          },
        })
        .mockResolvedValueOnce({
          status: 'COMPLETED',
          structuredOutput: {
            adherence: 'INSUFFICIENT_INFORMATION',
            content:
              'Recebi as porções. Você descreveu a batata como cozida neste último relato; ainda não consigo confirmar a comparação com o plano.',
            dayIndex: null,
            mealIndex: null,
            matches: [],
            unmatchedFoodQuotes: [],
            reportedFoods: [
              { foodQuote: 'arroz', quantityQuote: '2 conchas médias' },
              { foodQuote: 'linguiça cozida', quantityQuote: 'dois gomos' },
              {
                foodQuote: 'batata cozida',
                quantityQuote: 'uma porção pequena',
              },
            ],
          },
        }),
    };
    const real = new ConversationContinuationSemanticsService(
      provider as unknown as ConversationAIService,
      new ConversationPublicAnswerBoundaryService(),
    );
    s.semantics.evaluate.mockImplementation(
      (...args: Parameters<typeof real.evaluate>) => real.evaluate(...args),
    );
    const first = await s.service.resolve('user', 'message');
    expect(first?.next?.kind).toBe('MEAL_CONTENT_REQUEST');
    expect(first?.evidence.reportedContent).toBe(foods);
    const prior = s.row();
    if (!prior || !first?.next) throw new Error('Missing meal follow-up');
    const followUp = {
      ...prior,
      id: 'quantity-question',
      responseMessageId: null,
      content: first.content,
      context: {
        continuation: first.next,
        continuationEvidence: first.evidence,
      },
    };
    s.setRow(followUp);
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      id: 'second-message',
      content: quantities,
      timestamp: new Date(at.getTime() + 3 * 60 * 60 * 1000),
    });
    s.semantics.interpret.mockResolvedValue({
      ...base,
      action: 'MEAL_REPLY',
      description: quantities,
      meal: 'LUNCH',
      reference: 'PENDING',
      consumption: 'CONFIRMED',
    });
    const second = await s.service.resolve('user', 'second-message');
    expect(provider.execute.mock.calls[1][0].payload.description).toBe(
      `${foods}; ${quantities}`,
    );
    expect(second?.content).toBe(
      'Recebi as porções. Você descreveu a batata como cozida neste último relato; ainda não consigo confirmar a comparação com o plano.',
    );
    expect(second?.next).toBeNull();
    expect(second?.evidence).toMatchObject({
      mealReportStatus: 'COMPLETE',
      mealComparisonStatus: 'INCONCLUSIVE',
      adherence: 'INSUFFICIENT_INFORMATION',
    });
  });
  it('does not ask for received foods again when meal comparison fails technically', async () => {
    const s = subject('MEAL_CONTENT_REQUEST', {
      action: 'MEAL_REPLY',
      description: '2 conchas médias de arroz',
      consumption: 'CONFIRMED',
    });
    s.semantics.evaluate.mockResolvedValue(null);
    const reply = await s.service.resolve('user', 'message');
    expect(reply?.next).toBeNull();
    expect(reply?.evidence).toMatchObject({
      mealComparisonStatus: 'TECHNICAL_FAILURE',
      reportedContent: '2 conchas médias de arroz',
    });
    expect(reply?.content).toContain('Não precisa reenviar');
  });
  it('compares an explicit independent food report to the active plan without inventing a reminder', async () => {
    const s = subject(null, {
      action: 'MEAL_REPLY',
      reference: 'EXPLICIT',
      description: 'pizza',
      meal: 'DINNER',
      consumption: 'CONFIRMED',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result).toMatchObject({
      domain: 'NUTRITION',
      pending: null,
      evidence: { adherence: 'NOT_ALIGNED' },
    });
    expect(s.nutrition.read).toHaveBeenCalledWith('user');
  });
  it('accepts explicit workout completion without inventing a reminder receipt', async () => {
    const s = subject(null, {
      action: 'WORKOUT_REPLY',
      reference: 'EXPLICIT',
      consumption: 'CONFIRMED',
    });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'treinei hoje',
    });
    expect(await s.service.resolve('user', 'message')).toMatchObject({
      domain: 'WORKOUT',
      pending: null,
      outcome: 'COMPLETED',
      next: { kind: 'WORKOUT_FEEDBACK' },
    });
  });
  it('preserves hydration without inventing daily goal completion', async () => {
    const s = subject('HYDRATION_CHECK', {
      action: 'HYDRATION_REPLY',
      consumption: 'CONFIRMED',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result).toMatchObject({
      domain: 'HYDRATION',
      evidence: { hydrationGoal: false },
    });
    expect(result?.content).not.toContain('meta');
    expect(s.workout.present).not.toHaveBeenCalled();
  });
  it.each(['user', 'conversation', 'expired', 'consumed', 'invalid'] as const)(
    'fails closed for %s pending context',
    async (invalid) => {
      const s = subject();
      const row = s.row();
      if (!row) throw new Error('Missing reminder');
      if (invalid === 'user') row.userId = 'other';
      if (invalid === 'conversation') row.conversationId = 'other';
      if (invalid === 'expired')
        row.responseExpiresAt = new Date(at.getTime() - 1);
      if (invalid === 'consumed') row.responseMessageId = 'old';
      if (invalid === 'invalid')
        s.setRow({
          ...row,
          context: {
            continuation: { ...row.context.continuation, domain: 'WORKOUT' },
          },
        });
      expect(
        await s.service.pending('user', {
          conversationId: 'conversation',
          timestamp: at,
          replyToExternalMessageId: null,
        }),
      ).toBeNull();
    },
  );
  it('explicit query overrides pending lunch without consuming it as a meal', async () => {
    const s = subject('MEAL_COMPLETION_CHECK', {
      action: 'WORKOUT_QUERY',
      day: 'TODAY',
      reference: 'EXPLICIT',
    });
    const result = await s.service.resolve('user', 'message');
    expect(result).toMatchObject({ domain: 'WORKOUT', pending: null });
    expect(s.nutrition.read).not.toHaveBeenCalled();
  });
  it('explicit reply selects its source instead of latest reminder', async () => {
    const s = subject();
    await s.service.pending('user', {
      conversationId: 'conversation',
      timestamp: at,
      replyToExternalMessageId: 'quoted',
    });
    expect(s.prisma.scheduledMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          externalMessageId: 'quoted',
          userId: 'user',
          conversationId: 'conversation',
        }),
      }),
    );
  });
  it('rejects inference after an intervening outbound', async () => {
    const s = subject();
    s.prisma.outboundMessage.findFirst.mockResolvedValue({ id: 'newer' });
    expect(
      await s.service.pending('user', {
        conversationId: 'conversation',
        timestamp: at,
        replyToExternalMessageId: null,
      }),
    ).toBeNull();
  });
  it.each(['OFF', 'SHADOW', 'NOT_ELIGIBLE', 'KILL_SWITCH'])(
    'preserves historical behavior for %s',
    async (mode) => {
      const s = subject();
      s.config.isOfficiallyEligible.mockReturnValue(false);
      if (mode === 'KILL_SWITCH')
        s.config.get.mockReturnValue({ valid: true, killSwitch: true });
      expect(await s.service.resolve('user', 'message')).toBeNull();
      expect(s.semantics.interpret).not.toHaveBeenCalled();
    },
  );
  it('keeps active profile acquisition answers with their owner', async () => {
    const s = subject();
    s.prisma.coachProfileAcquisitionCycle.findFirst.mockResolvedValue({
      id: 'profile',
    });
    expect(await s.service.resolve('user', 'message')).toBeNull();
  });
  it('delegates a valid active Q&A follow-up to canonical runtime', async () => {
    const s = subject(null);
    s.qa.findPending.mockResolvedValue({
      previousAnswer: 'answer',
      previousFollowUpQuestion: 'question',
    });
    expect(
      (await s.service.resolve('user', 'message'))?.evidence.delegateRuntime,
    ).toBe(true);
  });
  it('safety takes precedence without recording completion', async () => {
    const s = subject();
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      content: 'dor no peito',
    });
    expect(
      (await s.service.resolve('user', 'message'))?.evidence.safetyAction,
    ).toBe('URGENT_GUIDANCE');
    expect(s.semantics.interpret).not.toHaveBeenCalled();
  });
  it('claims a pending question once and requires user/conversation identity', async () => {
    const s = subject('MEAL_COMPLETION_CHECK', {
      action: 'MEAL_REPLY',
      consumption: 'CONFIRMED',
    });
    const reply = await s.service.resolve('user', 'message');
    if (!reply) throw new Error('Missing reply');
    const tx = s.prisma as unknown as Prisma.TransactionClient;
    expect(
      await s.service.claim(tx, 'user', 'conversation', 'message', reply, at),
    ).toBe(true);
    expect(
      await s.service.claim(tx, 'user', 'conversation', 'second', reply, at),
    ).toBe(false);
    expect(s.prisma.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user',
          conversationId: 'conversation',
          responseMessageId: null,
        }),
      }),
    );
  });
  it('binds an owned meal image to the same typed continuation', async () => {
    const s = subject('MEAL_CONTENT_REQUEST');
    await s.service.bindMedia('user', 'message');
    expect(s.prisma.scheduledMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responseMessageId: 'message',
          context: expect.objectContaining({
            mediaContinuation: expect.objectContaining({
              domain: 'NUTRITION',
              meal: 'LUNCH',
            }),
          }),
        }),
      }),
    );
    const row = s.row();
    if (!row) throw new Error('Missing receipt');
    s.setRow({
      ...row,
      context: {
        ...row.context,
        mediaContinuation: row.context.continuation,
        mediaReceiptState: 'BOUND',
        mediaReceiptMessageId: 'message',
      } as typeof row.context,
    });
    const result = await s.service.mediaReply(
      'user',
      'message',
      'frango: 120 g estimados',
    );
    expect(result?.evidence.estimated).toBe(true);
    expect(result?.evidence.consumption).toBe('UNKNOWN');
  });
  it('does not capture an independent photo', async () => {
    const s = subject(null);
    await s.service.bindMedia('user', 'message');
    expect(s.prisma.scheduledMessage.updateMany).not.toHaveBeenCalled();
    expect(await s.service.mediaReply('user', 'message', 'pizza')).toBeNull();
  });
  it('rejects invalid continuation vocabulary and oversized expiry', () => {
    expect(
      parseContinuation(
        { ...continuation('WORKOUT_DAY_QUERY', at), expectedInput: 'YES_NO' },
        at,
      ),
    ).toBeNull();
    expect(
      parseContinuation(
        { ...continuation('WORKOUT_DAY_QUERY', at), expiresAt: '2030-01-01' },
        at,
      ),
    ).toBeNull();
  });
  it('continues lunch confirmation into food description, consuming each question once', async () => {
    const s = subject('MEAL_COMPLETION_CHECK', {
      action: 'MEAL_REPLY',
      consumption: 'CONFIRMED',
    });
    const first = await s.service.resolve('user', 'message');
    if (!first?.next) throw new Error('Missing food continuation');
    await s.service.claim(
      s.prisma as unknown as Prisma.TransactionClient,
      'user',
      'conversation',
      'message',
      first,
      at,
    );
    const row = s.row();
    if (!row) throw new Error('Missing source');
    s.setRow({
      ...row,
      id: 'food-request',
      responseMessageId: null,
      content: first.content,
      context: { continuation: first.next },
    });
    s.semantics.interpret.mockResolvedValue({
      ...base,
      action: 'MEAL_REPLY',
      description: 'arroz, feijão, frango e salada',
      consumption: 'CONFIRMED',
    });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      id: 'food-message',
      content: 'arroz, feijão, frango e salada',
      timestamp: new Date(at.getTime() + 1000),
    });
    const second = await s.service.resolve('user', 'food-message');
    expect(second?.pending?.scheduledMessageId).toBe('food-request');
    expect(second?.content).not.toContain('O que você comeu');
    expect(s.semantics.evaluate).toHaveBeenCalledTimes(1);
    expect(s.semantics.interpret.mock.calls[1][1].continuation.kind).toBe(
      'MEAL_CONTENT_REQUEST',
    );
  });
  it('uses workout day continuation for tomorrow without requiring workout in the second inbound', async () => {
    const s = subject(null, {
      action: 'WORKOUT_QUERY',
      day: 'TODAY',
      reference: 'EXPLICIT',
    });
    const first = await s.service.resolve('user', 'message');
    if (!first?.next) throw new Error('Missing workout continuation');
    const sent = new Date(at.getTime() + 1000);
    s.setRow({
      id: 'day-reply',
      userId: 'user',
      conversationId: 'conversation',
      content: first.content,
      context: { continuation: first.next },
      sentAt: sent,
      scheduledFor: sent,
      responseMessageId: null,
      responseExpiresAt: null,
    });
    s.prisma.message.findFirst.mockResolvedValue({
      ...(await s.prisma.message.findFirst()),
      id: 'tomorrow',
      content: 'e amanhã?',
      timestamp: new Date(at.getTime() + 2000),
    });
    s.semantics.interpret.mockResolvedValue({
      ...base,
      action: 'WORKOUT_QUERY',
      day: 'TOMORROW',
      reference: 'PENDING',
    });
    await s.service.resolve('user', 'tomorrow');
    expect(s.workout.presentCanonicalDay.mock.calls).toEqual([
      ['user', 'hoje', at, undefined],
      ['user', 'amanhã', new Date(at.getTime() + 2000), undefined],
    ]);
    expect(s.semantics.interpret.mock.calls[1][0]).toBe('e amanhã?');
  });
  it('cannot resolve tomorrow through an expired pending reference even if provider suggests a query', async () => {
    const s = subject(null, {
      action: 'WORKOUT_QUERY',
      day: 'TOMORROW',
      reference: 'PENDING',
    });
    expect((await s.service.resolve('user', 'message'))?.outcome).toBe(
      'UNKNOWN',
    );
    expect(s.workout.present).not.toHaveBeenCalled();
  });
  it.each(['OFF', 'SHADOW', 'INTERNAL', 'PRIMARY'] as const)(
    'uses real rollout eligibility for %s without changing kill switch',
    (mode) => {
      const values: Record<string, string> = {
        CONVERSATION_RUNTIME_MODE: mode,
        CONVERSATION_RUNTIME_KILL_SWITCH: 'false',
        CONVERSATION_RUNTIME_CANARY_PERCENTAGE: '0',
        CONVERSATION_RUNTIME_TIMEOUT_MS: '25000',
        CONVERSATION_RUNTIME_INTERNAL_USER_IDS: '',
      };
      const config = new ConversationRuntimeOperationalConfigService({
        get: (key: string) => values[key],
      } as unknown as ConfigService);
      expect(config.isOfficiallyEligible('normal-user', config.get())).toBe(
        mode === 'PRIMARY',
      );
      values.CONVERSATION_RUNTIME_KILL_SWITCH = 'true';
      expect(config.get().mode).toBe('OFF');
      expect(config.isOfficiallyEligible('normal-user', config.get())).toBe(
        false,
      );
    },
  );
  it.each([
    ['vou comer arroz e frango', 'PLANNED', 'DEFERRED'],
    ['estou pensando em comer pizza', 'PLANNED', 'DEFERRED'],
    ['arroz e frango', 'UNKNOWN', 'UNKNOWN'],
    ['comi arroz e frango', 'CONFIRMED', 'COMPLETED'],
    ['acabei de jantar arroz e frango', 'CONFIRMED', 'COMPLETED'],
  ] as const)(
    'preserves consumption evidence for %s',
    async (text, consumption, outcome) => {
      const description = text.includes('pizza') ? 'pizza' : 'arroz e frango';
      const s = subject(null, {
        action: 'MEAL_REPLY',
        reference: 'EXPLICIT',
        description,
        meal: 'LUNCH',
        consumption,
      });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      const result = await s.service.resolve('user', 'message');
      expect(result?.evidence.consumption).toBe(consumption);
      expect(result?.outcome).toBe(outcome);
      expect(s.semantics.evaluate).toHaveBeenCalledTimes(
        consumption === 'CONFIRMED' ? 1 : 0,
      );
    },
  );
  it('accepts contents after a consumed-food question without fabricating an independent fact', async () => {
    const s = subject('MEAL_CONTENT_REQUEST', {
      action: 'MEAL_REPLY',
      description: 'arroz e frango',
      consumption: 'CONFIRMED',
    });
    expect(
      (await s.service.resolve('user', 'message'))?.evidence.consumption,
    ).toBe('CONFIRMED');
  });
  it('carries image provenance through a later text detail', async () => {
    const s = subject('MEAL_CONTENT_REQUEST', {
      action: 'MEAL_REPLY',
      description: '120 g',
      consumption: 'UNKNOWN',
    });
    const row = s.row();
    if (!row) throw new Error('Missing fixture');
    s.setRow({
      ...row,
      context: {
        ...row.context,
        continuationEvidence: {
          estimated: true,
          reportedContent: 'frango estimado',
        },
      },
    } as typeof row);
    const result = await s.service.resolve('user', 'message');
    expect(result?.evidence).toMatchObject({
      estimated: true,
      consumption: 'UNKNOWN',
    });
    expect(s.semantics.evaluate).toHaveBeenCalledWith(
      'frango estimado; 120 g',
      'LUNCH',
      expect.objectContaining({ days: expect.any(Array) }),
      true,
    );
  });
  it.each(['não quero falar disso', 'prefiro não responder', 'deixa pra lá'])(
    'ends refused continuation without food evaluation: %s',
    async (text) => {
      const s = subject('MEAL_CONTENT_REQUEST', {
        action: 'DECLINE',
        consumption: 'UNKNOWN',
      });
      s.prisma.message.findFirst.mockResolvedValue({
        ...(await s.prisma.message.findFirst()),
        content: text,
      });
      const result = await s.service.resolve('user', 'message');
      expect(result).toMatchObject({
        next: null,
        outcome: 'UNKNOWN',
        evidence: { declined: true },
      });
      expect(result?.pending).not.toBeNull();
      expect(s.semantics.evaluate).not.toHaveBeenCalled();
    },
  );
  it('uses the last resolved civil day for NEXT instead of resetting to today', async () => {
    const s = subject('WORKOUT_DAY_QUERY', {
      action: 'WORKOUT_QUERY',
      day: 'NEXT',
    });
    const row = s.row();
    if (!row) throw new Error('Missing fixture');
    s.setRow({
      ...row,
      context: {
        continuation: {
          ...row.context.continuation,
          resolvedLocalDate: '2026-10-05',
        },
      },
    });
    await s.service.resolve('user', 'message');
    expect(s.workout.presentCanonicalDay).toHaveBeenCalledWith(
      'user',
      'qual meu próximo treino',
      at,
      '2026-10-05',
    );
  });
});

describe('Continuation semantic provider boundary', () => {
  function subject(output: unknown) {
    const ai = {
      execute: jest
        .fn()
        .mockResolvedValue({ status: 'COMPLETED', structuredOutput: output }),
    };
    return {
      ai,
      service: new ConversationContinuationSemanticsService(
        ai as unknown as ConversationAIService,
        new ConversationPublicAnswerBoundaryService(),
      ),
    };
  }
  it('requires quoted food evidence rather than a model invented meal', async () => {
    const s = subject({
      action: 'MEAL_REPLY',
      day: 'UNRESOLVED',
      consumption: 'CONFIRMED',
      meal: 'LUNCH',
      description: 'frango',
      hydrationGoal: false,
      reference: 'PENDING',
    });
    expect(await s.service.interpret('sim', null)).toBeNull();
  });
  it.each([
    'AIJob',
    'promptVersionId',
    '```\nsegredo\n```',
    '123e4567-e89b-12d3-a456-426614174000',
  ])('rejects unsafe semantic public content %s', async (content) => {
    const s = subject({ adherence: 'ALIGNED', content });
    expect(await s.service.evaluate('frango', 'LUNCH', {}, false)).toBeNull();
  });
  it('supplies canonical facts without operational identities and prohibits invented substitutions', async () => {
    const s = subject({
      adherence: 'PARTIALLY_ALIGNED',
      content: 'Faltam as quantidades para comparar melhor.',
    });
    await s.service.evaluate('frango', 'LUNCH', { days: [] }, false);
    const request = s.ai.execute.mock.calls[0][0];
    expect(request.payload).toEqual({
      description: 'frango',
      meal: 'LUNCH',
      estimated: false,
      activePlan: { days: [] },
    });
    expect(request.instructions).toContain(
      'Não invente alimentos, porções ou substituições',
    );
    expect(request.instructions).toContain(
      'Não declare ALIGNED por apenas um item compatível',
    );
  });
  it('does not accept full adherence as a proven fact from estimated photo contents', async () => {
    const s = subject({
      adherence: 'ALIGNED',
      content: 'Você seguiu integralmente o plano.',
    });
    expect(
      await s.service.evaluate('frango', 'LUNCH', { days: [] }, true),
    ).toEqual(
      expect.objectContaining({ adherence: 'INSUFFICIENT_INFORMATION' }),
    );
  });
  it.each([
    'arroz e frango',
    'vou comer arroz e frango',
    'estou pensando em comer pizza',
    'não comi arroz',
  ])('vetoes unsupported model consumption for %s', async (text) => {
    const s = subject({
      action: 'MEAL_REPLY',
      day: 'UNRESOLVED',
      consumption: 'CONFIRMED',
      meal: 'LUNCH',
      description: null,
      hydrationGoal: false,
      reference: 'EXPLICIT',
    });
    expect((await s.service.interpret(text, null))?.consumption).not.toBe(
      'CONFIRMED',
    );
  });
  it.each([
    ['vou comer arroz e frango', 'PLANNED'],
    ['estou pensando em comer arroz e frango', 'PLANNED'],
    ['não comi arroz e frango', 'UNKNOWN'],
    ['arroz e frango', 'CONFIRMED'],
  ])(
    'checks full inbound evidence before contextual food confirmation: %s',
    async (text, expected) => {
      const s = subject({
        action: 'MEAL_REPLY',
        day: 'UNRESOLVED',
        consumption: 'UNKNOWN',
        meal: 'LUNCH',
        description: 'arroz e frango',
        hydrationGoal: false,
        reference: 'PENDING',
      });
      expect(
        (
          await s.service.interpret(text, {
            scheduledMessageId: 'meal',
            question: 'O que você comeu?',
            continuation: continuation('MEAL_CONTENT_REQUEST', new Date()),
          })
        )?.consumption,
      ).toBe(expected);
    },
  );
  const plan = {
    days: [
      {
        meals: [
          {
            name: 'Almoço',
            items: [
              { name: 'arroz', quantity: '100 g' },
              { name: 'frango', quantity: '120 g' },
            ],
          },
        ],
      },
    ],
    substitutions: [{ source: 'frango', alternative: 'carne' }],
  };
  const complete = {
    adherence: 'ALIGNED',
    content: 'Está totalmente alinhado.',
    dayIndex: 0,
    mealIndex: 0,
    matches: [
      {
        planItemIndex: 0,
        foodQuote: 'arroz',
        quantityQuote: '100 g',
        substitutionIndex: null,
      },
      {
        planItemIndex: 1,
        foodQuote: 'frango',
        quantityQuote: '120 g',
        substitutionIndex: null,
      },
    ],
    unmatchedFoodQuotes: [],
  };
  it('requires all components and quoted portions for complete adherence', async () => {
    const s = subject(complete);
    expect(
      await s.service.evaluate(
        'arroz 100 g e frango 120 g',
        'LUNCH',
        plan,
        false,
      ),
    ).toMatchObject({ adherence: 'ALIGNED' });
  });
  it('recognizes household portions independently of textual equivalence with the plan', async () => {
    const output = {
      ...complete,
      adherence: 'INSUFFICIENT_INFORMATION',
      content:
        'Recebi as porções em medidas caseiras; não tenho equivalência segura para confirmar a comparação.',
      dayIndex: null,
      mealIndex: null,
      matches: [],
      reportedFoods: [
        { foodQuote: 'arroz', quantityQuote: '2 conchas médias' },
      ],
    };
    const result = await subject(output).service.evaluate(
      '2 conchas médias de arroz',
      'LUNCH',
      plan,
      false,
    );
    expect(result).toMatchObject({
      adherence: 'INSUFFICIENT_INFORMATION',
      report: { status: 'COMPLETE', missingQuantityFoods: [] },
      comparison: 'INCONCLUSIVE',
      content: output.content,
    });
  });
  it('asks only for a genuinely missing portion, preserving the other received quantity', async () => {
    const result = await subject({
      ...complete,
      adherence: 'INSUFFICIENT_INFORMATION',
      content: 'Quais alimentos e quantidades você comeu?',
      dayIndex: null,
      mealIndex: null,
      matches: [],
      reportedFoods: [
        { foodQuote: 'arroz', quantityQuote: '2 conchas médias' },
        { foodQuote: 'frango', quantityQuote: null },
      ],
    }).service.evaluate(
      '2 conchas médias de arroz e frango',
      'LUNCH',
      plan,
      false,
    );
    expect(result?.content).toBe(
      'Recebi os alimentos que você relatou. Qual foi a porção de frango?',
    );
    expect(result?.report).toEqual({
      status: 'MISSING_QUANTITIES',
      missingQuantityFoods: ['frango'],
    });
  });
  it('does not accept invented quantities as recognized information', async () => {
    const result = await subject({
      ...complete,
      adherence: 'INSUFFICIENT_INFORMATION',
      content: 'Quais alimentos e quantidades?',
      reportedFoods: [{ foodQuote: 'arroz', quantityQuote: '200 g' }],
    }).service.evaluate('arroz', 'LUNCH', plan, false);
    expect(result?.report.status).toBe('UNKNOWN');
    expect(result?.content).not.toContain('200 g');
  });
  it.each([
    'Você consumiu 900 calorias nessa refeição.',
    'Recebi seus 900 g de arroz.',
    'Recebi seus 2 g de arroz.',
    'Troque o arroz por outro alimento.',
    'Você seguiu o plano.',
  ])(
    'does not humanize into ungrounded facts or unsolicited prescriptions: %s',
    async (content) => {
      const result = await subject({
        ...complete,
        adherence: 'INSUFFICIENT_INFORMATION',
        dayIndex: null,
        mealIndex: null,
        content,
        reportedFoods: [
          { foodQuote: 'arroz', quantityQuote: '2 conchas médias' },
        ],
      }).service.evaluate('2 conchas médias de arroz', 'LUNCH', plan, false);
      expect(result?.content).not.toBe(content);
      expect(result?.adherence).toBe('INSUFFICIENT_INFORMATION');
    },
  );
  it.each([
    { ...complete, matches: [complete.matches[0]] },
    {
      ...complete,
      matches: complete.matches.map((match) => ({
        ...match,
        quantityQuote: null,
      })),
    },
    { ...complete, adherence: 'PARTIALLY_ALIGNED' },
  ])(
    'derives partial wording without leaking contradictory raw prose',
    async (output) => {
      const s = subject(output);
      const result = await s.service.evaluate(
        'arroz 100 g e frango 120 g',
        'LUNCH',
        plan,
        false,
      );
      expect(result?.adherence).toBe('PARTIALLY_ALIGNED');
      expect(result?.content).not.toContain('totalmente alinhado');
    },
  );
  it('does not treat one coincident food as a complete larger meal', async () => {
    const s = subject({
      ...complete,
      matches: [{ ...complete.matches[0], quantityQuote: null }],
    });
    expect(
      (await s.service.evaluate('arroz e frango', 'LUNCH', plan, false))
        ?.adherence,
    ).toBe('PARTIALLY_ALIGNED');
  });
  it('validates a real substitution but cannot invent its equivalent portion', async () => {
    const s = subject({
      ...complete,
      matches: [
        {
          planItemIndex: 1,
          foodQuote: 'carne',
          quantityQuote: null,
          substitutionIndex: 0,
        },
      ],
    });
    expect(
      (await s.service.evaluate('carne', 'LUNCH', plan, false))?.adherence,
    ).toBe('PARTIALLY_ALIGNED');
  });
  it('rejects a nonexistent substitution', async () => {
    const s = subject({
      ...complete,
      matches: [
        {
          planItemIndex: 1,
          foodQuote: 'pizza',
          quantityQuote: null,
          substitutionIndex: 8,
        },
      ],
    });
    expect(
      (await s.service.evaluate('pizza', 'LUNCH', plan, false))?.adherence,
    ).toBe('INSUFFICIENT_INFORMATION');
  });
  it('recognizes grounded divergence without forwarding inconsistent model prose', async () => {
    const s = subject({
      ...complete,
      adherence: 'NOT_ALIGNED',
      matches: [],
      unmatchedFoodQuotes: ['pizza'],
    });
    const result = await s.service.evaluate('pizza', 'LUNCH', plan, false);
    expect(result?.adherence).toBe('NOT_ALIGNED');
    expect(result?.content).not.toContain('totalmente alinhado');
  });
  it('downgrades estimated complete components and rejects invented quantities', async () => {
    const s = subject(complete);
    expect(
      (
        await s.service.evaluate(
          'arroz 100 g e frango 120 g',
          'LUNCH',
          plan,
          true,
        )
      )?.adherence,
    ).toBe('PARTIALLY_ALIGNED');
    expect(
      (await s.service.evaluate('arroz e frango', 'LUNCH', plan, false))
        ?.adherence,
    ).toBe('INSUFFICIENT_INFORMATION');
  });
});
